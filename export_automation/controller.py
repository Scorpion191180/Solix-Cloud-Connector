"""Background controller for guarded Solarbank 4 surplus output."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

from .policy import ExportDecision, decide_export_output


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


class SolarExportAutomation:
    """Set the AE103 manual output only when the bank is nearly full."""

    def __init__(self, solix_client: Any) -> None:
        self._solix = solix_client
        # Monitoring starts automatically, but the default dry-run below
        # guarantees that a new deployment cannot write a setting by itself.
        self._enabled = _boolean_setting(
            "SOLAR_EXPORT_AUTOMATION_ENABLED", default=True
        )
        self._dry_run = _boolean_setting(
            "SOLAR_EXPORT_AUTOMATION_DRY_RUN", default=True
        )
        self._start_soc = _integer_setting(
            "SOLAR_EXPORT_START_SOC", 98, 90, 100
        )
        self._stop_soc = _integer_setting(
            "SOLAR_EXPORT_STOP_SOC", 90, 80, 99
        )
        if self._stop_soc >= self._start_soc:
            _LOGGER.warning("Invalid export SOC thresholds; using 90/98")
            self._stop_soc = 90
            self._start_soc = 98
        self._max_output_w = _integer_setting(
            "SOLAR_EXPORT_POWER_W", 450, 0, 450
        )
        self._interval_seconds = _integer_setting(
            "SOLAR_EXPORT_INTERVAL_SECONDS", 60, 60, 3600
        )
        self._error_retry_seconds = _integer_setting(
            "SOLAR_EXPORT_ERROR_RETRY_SECONDS", 900, 300, 3600
        )

        self._task: asyncio.Task[None] | None = None
        self._evaluation_lock = asyncio.Lock()
        self._last_evaluation: str | None = None
        self._last_action = "none"
        self._last_reason = (
            "waiting_for_first_evaluation"
            if self._enabled
            else "automation_disabled"
        )
        self._last_error: str | None = None
        self._last_error_at = 0.0
        self._last_attempted_w: int | None = None
        self._battery_percent: int | float | None = None
        self._pv_power_w: int | float | None = None
        self._observed_output_w: int | float | None = None
        self._target_output_w: int | None = None
        self._cycle_active = False
        self._evaluated_once = False
        self._solix_stale = False

    async def start(self) -> None:
        if self._enabled and self._task is None:
            self._task = asyncio.create_task(
                self._run_loop(), name="solarbank-surplus-output-automation"
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
                self._last_action = "error"
                self._last_error = "Solarbank-Ausgabeautomatik konnte nicht ausgeführt werden"
                _LOGGER.exception("Solarbank surplus-output evaluation failed")
            await asyncio.sleep(self._interval_seconds)

    async def evaluate(self) -> dict[str, Any]:
        async with self._evaluation_lock:
            self._last_evaluation = datetime.now(timezone.utc).isoformat()
            self._last_action = "none"
            self._last_error = None

            live = await self._solix.get_live()
            self._solix_stale = live.get("stale") is True
            self._battery_percent = (
                None if self._solix_stale else self._number(live.get("battery_percent"))
            )
            self._pv_power_w = (
                None if self._solix_stale else self._number(live.get("pv_total"))
            )
            observed_output = (
                None
                if self._solix_stale
                else self._number(live.get("manual_output_preset_w"))
            )
            # Keep the last verified value through a temporary telemetry gap.
            # This lets the policy request a safe 0 W if this process had
            # previously observed or commanded an active manual output.
            if observed_output is not None:
                self._observed_output_w = observed_output

            # Recover a running cycle after a service restart whenever the
            # Solarbank still exposes a non-zero manual output.  A zero-output
            # night-time cycle intentionally stays fail-safe and waits for the
            # next 98-% start after a process restart.
            if not self._evaluated_once:
                self._cycle_active = bool(
                    self._observed_output_w is not None
                    and self._observed_output_w > 0
                )
                self._evaluated_once = True

            decision = decide_export_output(
                enabled=self._enabled,
                battery_percent=self._battery_percent,
                pv_power_w=self._pv_power_w,
                current_output_w=self._observed_output_w,
                cycle_active=self._cycle_active,
                start_soc=self._start_soc,
                stop_soc=self._stop_soc,
                max_output_w=self._max_output_w,
            )
            self._cycle_active = decision.cycle_active
            await self._apply(decision)
            return self.status()

    async def _apply(self, decision: ExportDecision) -> None:
        self._last_reason = decision.reason
        self._target_output_w = decision.target_w
        if decision.target_w is None:
            return

        if self._dry_run:
            self._last_action = f"would_set_{decision.target_w}_w"
            return

        if (
            self._last_attempted_w == decision.target_w
            and self._last_error_at
            and time.monotonic() - self._last_error_at < self._error_retry_seconds
        ):
            self._last_action = "waiting_after_command_error"
            self._last_error = "Erneuter Schreibversuch wird zum Schutz des Anker-Kontos verzögert"
            return

        self._last_attempted_w = decision.target_w
        try:
            result = await self._solix.set_solarbank_output_power(decision.target_w)
        except Exception as exc:
            self._last_action = "error"
            self._last_error_at = time.monotonic()
            self._last_error = self._public_error(exc)
            _LOGGER.exception("Solarbank output command failed")
            return

        self._last_error_at = 0.0
        self._observed_output_w = result.get("manual_output_preset_w")
        self._last_action = f"set_{decision.target_w}_w"

    @staticmethod
    def _number(value: Any) -> int | float | None:
        if value is None or isinstance(value, bool):
            return None
        try:
            number = float(str(value).replace(",", ".").strip())
        except ValueError:
            return None
        return int(number) if number.is_integer() else number

    @staticmethod
    def _public_error(exc: Exception) -> str:
        message = str(exc)
        allowed = {
            "Ausgabeautomatik unterstützt ausschließlich die Solarbank 4 (AE103)",
            "Solarbank 4 ist in diesem Konto nicht als Administrator steuerbar",
            "Solarbank 4 besitzt keine Site-Zuordnung",
            "Benutzerdefinierte Solarbank-Ausgabe wurde nicht bestätigt",
        }
        if message in allowed:
            return message
        return "Solarbank-Ausgabe konnte nicht geändert werden; Details stehen im Render-Log"

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self._enabled,
            "dry_run": self._dry_run,
            "running": bool(self._task and not self._task.done()),
            "interval_seconds": self._interval_seconds,
            "start_soc_percent": self._start_soc,
            "stop_soc_percent": self._stop_soc,
            "max_output_w": self._max_output_w,
            "cycle_active": self._cycle_active,
            "last_evaluation": self._last_evaluation,
            "last_action": self._last_action,
            "reason": self._last_reason,
            "error": self._last_error,
            "solix_data_stale": self._solix_stale,
            "battery_percent": self._battery_percent,
            "pv_power_w": self._pv_power_w,
            "observed_output_w": self._observed_output_w,
            "target_output_w": self._target_output_w,
        }
