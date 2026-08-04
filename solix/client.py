"""Cached Solix Cloud access plus guarded A17X8 smart-plug control."""

from __future__ import annotations

import asyncio
import logging
import math
import os
import ssl
import time
from datetime import datetime, timezone
from typing import Any

import aiohttp
import certifi
from anker_solix_api.api import AnkerSolixApi
from anker_solix_api.apitypes import API_HEADERS
from anker_solix_api.errors import AuthorizationError


DEFAULT_CACHE_SECONDS = 60
MIN_CACHE_SECONDS = 30
DEFAULT_FAILURE_RETRY_SECONDS = 120
DEFAULT_AUTH_FAILURE_RETRY_SECONDS = 30 * 60
SMARTPLUG_TELEMETRY_WAIT_SECONDS = 1.0

_LOGGER = logging.getLogger(__name__)


def _integer_setting(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        return min(maximum, max(minimum, int(os.getenv(name, str(default)))))
    except ValueError:
        return default


class SolixClient:
    def __init__(self) -> None:
        self.api: AnkerSolixApi | None = None
        self._session: aiohttp.ClientSession | None = None
        self._lock = asyncio.Lock()
        self._last_refresh = 0.0
        self._cache_seconds = _integer_setting(
            "SOLIX_CACHE_SECONDS", DEFAULT_CACHE_SECONDS, MIN_CACHE_SECONDS, 3600
        )
        self._failure_retry_seconds = _integer_setting(
            "SOLIX_FAILURE_RETRY_SECONDS",
            DEFAULT_FAILURE_RETRY_SECONDS,
            MIN_CACHE_SECONDS,
            900,
        )
        self._auth_failure_retry_seconds = _integer_setting(
            "SOLIX_AUTH_FAILURE_RETRY_SECONDS",
            DEFAULT_AUTH_FAILURE_RETRY_SECONDS,
            5 * 60,
            60 * 60,
        )
        self._active_failure_retry_seconds = self._failure_retry_seconds
        self._solarbank_pn = os.getenv("SOLIX_SOLARBANK_PN", "").strip().upper()
        self._solarbank_sn = os.getenv("SOLIX_SOLARBANK_SN", "").strip().upper()
        self._battery_capacity_wh = _integer_setting(
            "SOLIX_BATTERY_CAPACITY_WH", 0, 0, 100_000
        )
        self._smartplug_sn = os.getenv("SOLIX_SMARTPLUG_SN", "").strip().upper()
        self._smartplug_command_timeout = _integer_setting(
            "SMARTPLUG_COMMAND_TIMEOUT_SECONDS", 45, 10, 90
        )
        self._last_smartplug_state: bool | None = None
        self._last_smartplug_telemetry_request = 0.0
        self._last_refresh_at: datetime | None = None
        self._last_refresh_attempt = 0.0
        self._last_refresh_error: str | None = None
        self._last_live_payload: dict[str, Any] | None = None

    async def _ensure_api_locked(self) -> None:
        if self.api is not None:
            return

        ssl_context = ssl.create_default_context(cafile=certifi.where())
        self._session = aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(ssl=ssl_context)
        )
        self.api = AnkerSolixApi(
            email=os.getenv("ANKER_EMAIL"),
            password=os.getenv("ANKER_PASSWORD"),
            countryId=os.getenv("ANKER_COUNTRY"),
            websession=self._session,
        )

    async def _discard_api_locked(self) -> None:
        """Close a rejected Anker session so the next request logs in cleanly."""
        if self.api is not None:
            self.api.stopMqttSession()
        if self._session is not None and not self._session.closed:
            await self._session.close()

        # anker-solix-api currently builds request headers by mutating its
        # module-level API_HEADERS dictionary. Once a token was used, the
        # rejected x-auth-token/gtoken therefore survive async_authenticate's
        # restart and are accidentally sent with the fresh login request. The
        # Anker endpoint answers that otherwise valid password login with
        # ``401 token error``. Remove only those two volatile values while the
        # client lock is held; the next session can then authenticate cleanly.
        API_HEADERS.pop("x-auth-token", None)
        API_HEADERS.pop("gtoken", None)
        self._session = None
        self.api = None
        self._last_smartplug_telemetry_request = 0.0

    async def _poll_cloud_locked(self) -> None:
        assert self.api is not None
        await self.api.update_sites()
        await self.api.update_site_details()
        await self.api.update_device_details()

    def _login_token_available_locked(self) -> bool | None:
        """Report whether the upstream client completed password login."""
        if self.api is None:
            return False
        apisession = getattr(self.api, "apisession", None)
        get_login_info = getattr(apisession, "get_login_info", None)
        if not callable(get_login_info):
            # Small test doubles and older library variants cannot expose the
            # distinction; preserve the normal transient-cloud backoff.
            return None
        return bool(get_login_info("auth_token"))

    async def _refresh_locked(self, force: bool = False) -> None:
        now = time.monotonic()
        cache_age = now - self._last_refresh
        if self.api is not None and not force and cache_age < self._cache_seconds:
            return

        failure_age = now - self._last_refresh_attempt
        if (
            not force
            and self._last_refresh_error is not None
            and failure_age < self._active_failure_retry_seconds
        ):
            raise RuntimeError("Solix-Cloud-Aktualisierung wartet auf erneuten Versuch")

        await self._ensure_api_locked()
        assert self.api is not None
        self._last_refresh_attempt = now
        try:
            await self._poll_cloud_locked()
        except AuthorizationError:
            # Anker invalidates access tokens independently of their nominal
            # lifetime. Reusing the same API instance then produces permanent
            # HTTP 401 responses. A completely new session performs a fresh
            # password login and recovers without a Render restart.
            _LOGGER.warning(
                "Anker rejected the cached Solix token; rebuilding the session"
            )
            # If the fresh password login below is also rejected, stop trying
            # for a longer period. Anker temporarily locks an account after a
            # handful of unsuccessful sign-ins, so the generic two-minute
            # cloud backoff is unsafe for authentication failures.
            self._active_failure_retry_seconds = self._auth_failure_retry_seconds
            await self._discard_api_locked()
            await self._ensure_api_locked()
            try:
                await self._poll_cloud_locked()
            except Exception as exc:
                self._last_refresh_error = type(exc).__name__
                await self._discard_api_locked()
                raise
        except Exception as exc:
            if self._login_token_available_locked() is False:
                # The Anker login endpoint sometimes reports code 26161
                # (RequestError) instead of AuthorizationError. With no login
                # token ever issued, it is still an authentication attempt and
                # must use the long lockout-safe delay.
                self._active_failure_retry_seconds = (
                    self._auth_failure_retry_seconds
                )
                await self._discard_api_locked()
            else:
                self._active_failure_retry_seconds = self._failure_retry_seconds
            self._last_refresh_error = type(exc).__name__
            raise
        else:
            self._active_failure_retry_seconds = self._failure_retry_seconds
            self._last_refresh_error = None

        # The dashboard only uses current device values. Energy-history
        # requests are comparatively expensive and caused Anker's
        # energy_analysis endpoint to throttle a single live refresh.
        self._last_refresh = time.monotonic()
        self._last_refresh_attempt = self._last_refresh
        self._last_refresh_at = datetime.now(timezone.utc)
        self._last_refresh_error = None

    async def connect(self) -> AnkerSolixApi:
        async with self._lock:
            await self._refresh_locked(force=True)
            assert self.api is not None
            return self.api

    async def refresh(self, force: bool = False) -> None:
        """Refresh at most once per cache window across concurrent callers."""
        async with self._lock:
            await self._refresh_locked(force=force)

    async def get_status(self) -> dict[str, Any]:
        await self.refresh()
        assert self.api is not None
        return {
            "sites": self.api.sites,
            "devices": self.api.devices,
        }

    async def get_site(self) -> dict[str, Any]:
        await self.refresh()
        assert self.api is not None
        return self.api.sites

    async def get_devices(self) -> dict[str, Any]:
        await self.refresh()
        assert self.api is not None
        return self.api.devices

    def _select_solarbank_locked(self) -> tuple[dict[str, Any], str, int]:
        """Select the intended system without exposing its serial number."""
        assert self.api is not None
        banks = [
            (serial, device)
            for serial, device in self.api.devices.items()
            if device.get("type") == "solarbank"
        ]
        if not banks:
            raise RuntimeError("Keine Solarbank gefunden")

        if self._solarbank_sn:
            matches = [
                device
                for serial, device in banks
                if serial.upper() == self._solarbank_sn
            ]
            if len(matches) != 1:
                raise RuntimeError(
                    "SOLIX_SOLARBANK_SN wurde im Anker-Konto nicht eindeutig gefunden"
                )
            return matches[0], "configured_serial", len(banks)

        if self._solarbank_pn:
            matches = [
                device
                for _, device in banks
                if str(device.get("device_pn", "")).upper() == self._solarbank_pn
            ]
            if len(matches) != 1:
                raise RuntimeError(
                    "SOLIX_SOLARBANK_PN wurde im Anker-Konto nicht eindeutig gefunden"
                )
            return matches[0], "configured_model", len(banks)

        if len(banks) == 1:
            return banks[0][1], "only_solarbank", 1

        # Safe deterministic fallback for existing installations: the main
        # system normally has the most expansion packs and largest capacity.
        # A configured model/serial still wins and is recommended.
        selected = max(
            (device for _, device in banks),
            key=lambda device: (
                self._number(device.get("sub_package_num")),
                self._number(device.get("battery_capacity")),
            ),
        )
        return selected, "auto_largest_system", len(banks)

    @staticmethod
    def _number(value: Any) -> int:
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return 0

    async def get_live(self) -> dict[str, Any]:
        try:
            await self.refresh()
        except Exception:
            if self._last_live_payload is None:
                return self._unavailable_live_payload()
            payload = dict(self._last_live_payload)
            payload.update(
                {
                    "stale": True,
                    "error": "Solix-Cloud vorübergehend nicht erreichbar",
                    "data_age_seconds": max(
                        0, int(time.monotonic() - self._last_refresh)
                    ),
                    "refresh_retry_seconds": max(
                        0,
                        int(
                            self._active_failure_retry_seconds
                            - (time.monotonic() - self._last_refresh_attempt)
                        ),
                    ),
                }
            )
            return payload
        assert self.api is not None

        solarbank, selection, solarbank_count = self._select_solarbank_locked()

        def to_int(value: Any) -> int:
            try:
                return int(value)
            except (TypeError, ValueError):
                return 0

        battery_percent = to_int(solarbank.get("battery_soc"))
        cloud_capacity_wh = to_int(solarbank.get("battery_capacity"))
        configured_capacity = self._battery_capacity_wh > 0
        battery_capacity_wh = (
            self._battery_capacity_wh if configured_capacity else cloud_capacity_wh
        )
        battery_energy_wh = (
            round(battery_capacity_wh * battery_percent / 100)
            if configured_capacity
            else to_int(solarbank.get("battery_energy"))
        )
        battery_charge_power = to_int(solarbank.get("bat_charge_power"))
        battery_discharge_power = to_int(solarbank.get("bat_discharge_power"))
        battery_power = (
            battery_charge_power
            if battery_charge_power > 0
            else -battery_discharge_power
        )

        payload = {
            "status": solarbank.get("status_desc"),
            "battery_percent": battery_percent,
            "battery_energy_wh": battery_energy_wh,
            "battery_capacity_wh": battery_capacity_wh,
            "battery_capacity_source": (
                "configured" if configured_capacity else "cloud"
            ),
            "battery_power": battery_power,
            "battery_charge_power": battery_charge_power,
            "battery_discharge_power": battery_discharge_power,
            "battery_flow_direction": (
                "charging"
                if battery_charge_power > 0
                else "discharging"
                if battery_discharge_power > 0
                else "idle"
            ),
            "system_output_power": to_int(solarbank.get("output_power")),
            "charging_status": solarbank.get("charging_status_desc"),
            "pv_total": sum(
                to_int(solarbank.get(f"solar_power_{number}"))
                for number in range(1, 5)
            ),
            "pv1": to_int(solarbank.get("solar_power_1")),
            "pv2": to_int(solarbank.get("solar_power_2")),
            "pv3": to_int(solarbank.get("solar_power_3")),
            "pv4": to_int(solarbank.get("solar_power_4")),
            "home_load": to_int(solarbank.get("to_home_load")),
            "grid_power": to_int(solarbank.get("grid_to_battery_power")),
            "firmware": solarbank.get("sw_version"),
            "wifi_signal": to_int(solarbank.get("wifi_signal")),
            "solarbank_model": solarbank.get("device_pn"),
            "solarbank_count": solarbank_count,
            "selection": selection,
            "last_update": (
                self._last_refresh_at.isoformat() if self._last_refresh_at else None
            ),
            "data_age_seconds": max(
                0, int(time.monotonic() - self._last_refresh)
            ),
            "refresh_interval_seconds": self._cache_seconds,
            "refresh_retry_seconds": 0,
            "stale": False,
            "error": None,
        }
        self._last_live_payload = dict(payload)
        return payload

    def _unavailable_live_payload(self) -> dict[str, Any]:
        """Return a truthful, automation-safe first-start outage payload."""
        retry_seconds = max(
            0,
            int(
                self._active_failure_retry_seconds
                - (time.monotonic() - self._last_refresh_attempt)
            ),
        )
        return {
            "status": None,
            "battery_percent": None,
            "battery_energy_wh": None,
            "battery_capacity_wh": (
                self._battery_capacity_wh if self._battery_capacity_wh > 0 else None
            ),
            "battery_capacity_source": (
                "configured" if self._battery_capacity_wh > 0 else None
            ),
            "battery_power": None,
            "battery_charge_power": None,
            "battery_discharge_power": None,
            "battery_flow_direction": "unknown",
            "system_output_power": None,
            "charging_status": None,
            "pv_total": None,
            "pv1": None,
            "pv2": None,
            "pv3": None,
            "pv4": None,
            "home_load": None,
            "grid_power": None,
            "firmware": None,
            "wifi_signal": None,
            "solarbank_model": None,
            "solarbank_count": 0,
            "selection": None,
            "last_update": None,
            "data_age_seconds": None,
            "refresh_interval_seconds": self._cache_seconds,
            "refresh_retry_seconds": retry_seconds,
            "stale": True,
            "error": "Solix-Anmeldung vorübergehend nicht verfügbar",
        }

    def _select_smartplug_locked(self) -> tuple[str, dict[str, Any]]:
        assert self.api is not None
        plugs = [
            (serial, device)
            for serial, device in self.api.devices.items()
            if device.get("type") == "smartplug"
        ]

        if self._smartplug_sn:
            selected = next(
                (
                    (serial, device)
                    for serial, device in plugs
                    if serial.upper() == self._smartplug_sn
                ),
                None,
            )
            if selected is None:
                raise RuntimeError("SOLIX_SMARTPLUG_SN wurde im Anker-Konto nicht gefunden")
            return selected

        if not plugs:
            raise RuntimeError("Kein Anker SOLIX Smart Plug gefunden")
        if len(plugs) > 1:
            raise RuntimeError(
                "Mehrere Smart Plugs gefunden; SOLIX_SMARTPLUG_SN muss gesetzt werden"
            )
        return plugs[0]

    @staticmethod
    def _as_switch_state(value: Any) -> bool | None:
        if isinstance(value, bool):
            return value
        if isinstance(value, int | float):
            return bool(value)
        text = str(value or "").strip().lower()
        if text in {"1", "on", "true", "enabled"}:
            return True
        if text in {"0", "off", "false", "disabled"}:
            return False
        return None

    @staticmethod
    def _optional_number(value: Any) -> int | float | None:
        if value is None or isinstance(value, bool):
            return None
        if isinstance(value, int | float):
            number = float(value)
        else:
            text = str(value).strip().lower().replace(",", ".")
            if not text:
                return None
            cleaned = "".join(
                character
                for character in text
                if character in "-+.0123456789"
            )
            try:
                number = float(cleaned)
            except (TypeError, ValueError):
                return None
        if not math.isfinite(number):
            return None
        return int(number) if number.is_integer() else round(number, 2)

    @classmethod
    def _power_watts(cls, value: Any) -> int | float | None:
        number = cls._optional_number(value)
        if number is None:
            return None
        if isinstance(value, str) and "kw" in value.lower():
            number = float(number) * 1000
        return int(number) if float(number).is_integer() else round(float(number), 1)

    def _smartplug_status_locked(
        self, device: dict[str, Any], state: bool | None = None
    ) -> dict[str, Any]:
        mqtt_data = device.get("mqtt_data") or {}
        if state is None:
            for source in (mqtt_data, device):
                for key in (
                    "ac_output_switch",
                    "ac_output_power_switch",
                    "switch",
                ):
                    if key in source:
                        state = self._as_switch_state(source.get(key))
                        if state is not None:
                            break
                if state is not None:
                    break
        if state is None:
            state = self._last_smartplug_state

        power_w: int | float | None = None
        current_a: int | float | None = None
        voltage_v: int | float | None = None
        measurement_source: str | None = None
        for source_name, source in (("mqtt", mqtt_data), ("cloud", device)):
            for key in (
                "power",
                "current_power",
                "output_power",
                "ac_power",
                "ac_output_power",
            ):
                if key in source and (
                    measured_power := self._power_watts(source.get(key))
                ) is not None:
                    power_w = measured_power
                    measurement_source = source_name
                    break
            if power_w is not None:
                current_a = self._optional_number(source.get("current"))
                voltage_v = self._optional_number(source.get("voltage"))
                break

        return {
            "available": True,
            "name": device.get("alias_name")
            or device.get("device_name")
            or "Anker SOLIX Smart Plug",
            "model": device.get("device_pn"),
            "state": state,
            "power_w": power_w,
            "current_a": current_a,
            "voltage_v": voltage_v,
            "measurement_source": measurement_source,
        }

    async def _request_smartplug_telemetry_locked(
        self, serial: str, device: dict[str, Any]
    ) -> None:
        """Ask A17X8 for live measurements without changing its output."""
        if (
            device.get("mqtt_supported") is not True
            or self.api is None
            or not hasattr(self.api, "startMqttSession")
        ):
            return

        request_age = time.monotonic() - self._last_smartplug_telemetry_request
        if request_age < max(MIN_CACHE_SECONDS, self._cache_seconds):
            return
        self._last_smartplug_telemetry_request = time.monotonic()

        try:
            from anker_solix_api.mqtt_factory import SolixMqttDeviceFactory

            mqtt_device = SolixMqttDeviceFactory(
                api_instance=self.api, device_sn=serial
            ).create_device()
            if mqtt_device is None or not hasattr(mqtt_device, "status_request"):
                return

            mqtt_session = await self.api.startMqttSession()
            if mqtt_session is None or not mqtt_session.is_connected():
                return

            topic = f"{mqtt_session.get_topic_prefix(deviceDict=device)}#"
            mqtt_session.subscribe(topic)
            published = await mqtt_device.status_request()
            if published is None:
                return

            # The reply arrives on the MQTT callback thread. Give it a short
            # window, then merge the latest cache once before returning.
            await asyncio.sleep(SMARTPLUG_TELEMETRY_WAIT_SECONDS)
            self.api.update_device_mqtt()
        except Exception:
            # Missing live telemetry must never interrupt the charging policy.
            _LOGGER.warning(
                "Smart-plug live telemetry request failed", exc_info=True
            )

    async def get_smartplug_status(self) -> dict[str, Any]:
        await self.refresh()
        async with self._lock:
            serial, device = self._select_smartplug_locked()
            await self._request_smartplug_telemetry_locked(serial, device)
            return self._smartplug_status_locked(device)

    async def set_smartplug_power(self, enabled: bool) -> dict[str, Any]:
        """Switch the selected Anker A17X8 via its supported MQTT command."""
        await self.refresh()
        async with self._lock:
            from anker_solix_api.mqtt_factory import SolixMqttDeviceFactory

            assert self.api is not None
            serial, device = self._select_smartplug_locked()
            mqtt_device = SolixMqttDeviceFactory(
                api_instance=self.api, device_sn=serial
            ).create_device()
            if mqtt_device is None or not hasattr(mqtt_device, "set_ac_output"):
                raise RuntimeError("Smart Plug unterstützt keine MQTT-Steuerung")

            result = await asyncio.wait_for(
                mqtt_device.set_ac_output(enabled=enabled),
                timeout=self._smartplug_command_timeout,
            )
            if result is None:
                raise RuntimeError("Smart-Plug-Befehl wurde nicht bestätigt")

            self._last_smartplug_state = enabled
            device.setdefault("mqtt_data", {})["ac_output_switch"] = int(enabled)
            return self._smartplug_status_locked(device, state=enabled)

    async def close(self) -> None:
        async with self._lock:
            await self._discard_api_locked()
