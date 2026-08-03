"""Background controller combining Audi, Solix and smart-plug state."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

from .policy import AutomationDecision, decide_smartplug_state


DEFAULT_INTERVAL_SECONDS = 60
MIN_INTERVAL_SECONDS = 60
MIN_ON_THRESHOLD_PERCENT = 20
MAX_ON_THRESHOLD_PERCENT = 90

_LOGGER = logging.getLogger(__name__)


def _boolean_setting(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _integer_setting(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return min(maximum, max(minimum, int(os.getenv(name, str(default)))))
    except ValueError:
        return default


class ChargingAutomation:
    """Evaluate charging conditions and issue idempotent plug commands."""

    def __init__(self, solix_client: Any, audi_client: Any) -> None:
        self._solix = solix_client
        self._audi = audi_client
        self._enabled = _boolean_setting("AUTOMATION_ENABLED")
        # A newly enabled installation observes all inputs first and never
        # sends MQTT commands until dry-run mode is explicitly disabled.
        self._dry_run = _boolean_setting("AUTOMATION_DRY_RUN", default=True)
        self._on_threshold = _integer_setting(
            "AUTOMATION_ON_SOC",
            30,
            minimum=MIN_ON_THRESHOLD_PERCENT,
            maximum=MAX_ON_THRESHOLD_PERCENT,
        )
        self._off_threshold = _integer_setting(
            "AUTOMATION_OFF_SOC", 10, minimum=0, maximum=98
        )
        if self._off_threshold >= self._on_threshold:
            _LOGGER.warning(
                "Invalid automation thresholds; using safe defaults 10/30"
            )
            self._off_threshold = 10
            self._on_threshold = 30
        self._interval_seconds = _integer_setting(
            "AUTOMATION_INTERVAL_SECONDS",
            DEFAULT_INTERVAL_SECONDS,
            minimum=MIN_INTERVAL_SECONDS,
            maximum=24 * 60 * 60,
        )

        self._task: asyncio.Task[None] | None = None
        self._evaluation_lock = asyncio.Lock()
        self._last_commanded_state: bool | None = None
        self._last_evaluation: str | None = None
        self._last_action: str = "none"
        self._last_reason: str = (
            "waiting_for_first_evaluation"
            if self._enabled
            else "automation_disabled"
        )
        self._last_error: str | None = None
        self._last_battery_percent: int | float | None = None
        self._last_cable_connected: bool | None = None
        self._last_audi_stale = False
        self._last_audi_error: str | None = None
        self._smartplug: dict[str, Any] = {
            "available": False,
            "name": None,
            "model": None,
            "state": None,
            "power_w": None,
            "current_a": None,
            "voltage_v": None,
            "measurement_source": None,
        }

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def start(self) -> None:
        """Start the loop; disabled configurations remain completely passive."""
        if self._enabled and self._task is None:
            self._task = asyncio.create_task(
                self._run_loop(), name="audi-solix-charging-automation"
            )

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _run_loop(self) -> None:
        while True:
            try:
                await self.evaluate()
            except asyncio.CancelledError:
                raise
            except Exception:
                # The loop must survive cloud and MQTT outages. Public status
                # receives a generic error while full details stay in logs.
                self._last_error = "Automatik konnte nicht ausgeführt werden"
                _LOGGER.exception("Charging automation evaluation failed")
            await asyncio.sleep(self._interval_seconds)

    async def evaluate(self) -> dict[str, Any]:
        """Run one complete, serialized policy evaluation."""
        async with self._evaluation_lock:
            self._last_evaluation = datetime.now(timezone.utc).isoformat()
            self._last_action = "none"
            self._last_error = None

            audi_data, solix_data = await asyncio.gather(
                self._audi.get_live(), self._solix.get_live()
            )
            self._last_audi_stale = audi_data.get("stale") is True
            self._last_audi_error = (
                str(audi_data.get("error")) if audi_data.get("error") else None
            )
            self._last_cable_connected = (
                audi_data.get("plug_connected")
                if audi_data.get("available") is True
                and not self._last_audi_stale
                else None
            )
            self._last_battery_percent = self._number(
                solix_data.get("battery_percent")
            )

            plug_status = await self._solix.get_smartplug_status()
            self._smartplug = plug_status
            observed_state = plug_status.get("state")
            if isinstance(observed_state, bool):
                self._last_commanded_state = observed_state

            decision = decide_smartplug_state(
                enabled=self._enabled,
                cable_connected=self._last_cable_connected,
                battery_percent=self._last_battery_percent,
                current_state=self._last_commanded_state,
                on_threshold=self._on_threshold,
                off_threshold=self._off_threshold,
            )
            await self._apply(decision)
            return self.status()

    async def _apply(self, decision: AutomationDecision) -> None:
        self._last_reason = decision.reason
        if decision.desired_state is None:
            return

        if self._dry_run:
            self._last_action = (
                "would_turn_on" if decision.desired_state else "would_turn_off"
            )
            return

        try:
            result = await self._solix.set_smartplug_power(decision.desired_state)
        except Exception as exc:
            self._last_action = "error"
            self._last_error = self._public_error(exc)
            _LOGGER.exception("Smart plug command failed")
            return

        self._last_commanded_state = decision.desired_state
        self._last_action = "turned_on" if decision.desired_state else "turned_off"
        self._smartplug = result

    @staticmethod
    def _number(value: Any) -> int | float | None:
        if value is None or isinstance(value, bool):
            return None
        if isinstance(value, int | float):
            return value
        try:
            number = float(str(value).replace(",", ".").strip())
            return int(number) if number.is_integer() else number
        except ValueError:
            return None

    @staticmethod
    def _public_error(exc: Exception) -> str:
        if isinstance(exc, asyncio.TimeoutError):
            return "Zeitüberschreitung bei der Smart-Plug-Steuerung"
        message = str(exc)
        if message in {
            "Kein Anker SOLIX Smart Plug gefunden",
            "Mehrere Smart Plugs gefunden; SOLIX_SMARTPLUG_SN muss gesetzt werden",
            "SOLIX_SMARTPLUG_SN wurde im Anker-Konto nicht gefunden",
            "Smart Plug unterstützt keine MQTT-Steuerung",
            "Smart-Plug-Befehl wurde nicht bestätigt",
        }:
            return message
        return "Smart Plug ist derzeit nicht steuerbar; Details stehen im Render-Log"

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self._enabled,
            "dry_run": self._dry_run,
            "running": bool(self._task and not self._task.done()),
            "interval_seconds": self._interval_seconds,
            "on_threshold_percent": self._on_threshold,
            "off_threshold_percent": self._off_threshold,
            "last_evaluation": self._last_evaluation,
            "last_action": self._last_action,
            "reason": self._last_reason,
            "error": self._last_error,
            "audi_plug_connected": self._last_cable_connected,
            "audi_data_stale": self._last_audi_stale,
            "audi_error": self._last_audi_error,
            "solix_battery_percent": self._last_battery_percent,
            "smartplug": dict(self._smartplug),
        }

    async def set_on_threshold(self, percent: int) -> dict[str, Any]:
        """Apply a validated runtime start threshold without sending a command."""
        if isinstance(percent, bool) or not (
            MIN_ON_THRESHOLD_PERCENT <= percent <= MAX_ON_THRESHOLD_PERCENT
        ):
            raise ValueError(
                "Der Startwert muss zwischen 20 % und 90 % liegen"
            )

        async with self._evaluation_lock:
            self._on_threshold = percent
            self._last_reason = "start_threshold_updated"
            self._last_action = "none"
            self._last_error = None
            return self.status()

    def record_manual_result(
        self, result: dict[str, Any], enabled: bool
    ) -> None:
        """Reflect an authenticated manual command in the public status."""
        self._last_commanded_state = enabled
        self._last_action = "manually_turned_on" if enabled else "manually_turned_off"
        self._last_reason = "manual_control"
        self._last_error = None
        self._smartplug = dict(result)

    def record_manual_error(self, exc: Exception) -> None:
        self._last_action = "error"
        self._last_reason = "manual_control"
        self._last_error = self._public_error(exc)
        _LOGGER.error(
            "Manual smart plug command failed",
            exc_info=(type(exc), exc, exc.__traceback__),
        )
