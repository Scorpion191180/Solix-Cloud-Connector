"""Read-only, cached access to the first configured Audi Connect vehicle."""

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


DEFAULT_CACHE_SECONDS = 4 * 60 * 60
MIN_CACHE_SECONDS = 15 * 60
TOKEN_REFRESH_SECONDS = 45 * 60
ERROR_RETRY_SECONDS = 15 * 60
DEFAULT_POSITION_INTERVAL_SECONDS = 2 * 60
MIN_POSITION_INTERVAL_SECONDS = 60
DEFAULT_HOME_RADIUS_METERS = 120

_LOGGER = logging.getLogger(__name__)


def _integer_setting(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _float_setting(name: str) -> float | None:
    value = os.getenv(name, "").strip()
    if not value:
        return None
    try:
        return float(value.replace(",", "."))
    except ValueError:
        return None


class AudiClient:
    """Small read-only adapter around the vendored myAudi client.

    Audi Connect is deliberately optional: missing authorization or an Audi
    cloud error are returned as API data and never prevent the Solix app from
    starting. Successful vehicle data is cached to protect the account from
    Audi's strict request limits.
    """

    def __init__(self) -> None:
        self._refresh_token = os.getenv("AUDI_REFRESH_TOKEN", "").strip()
        self._country = os.getenv("AUDI_COUNTRY", "DE").strip().upper() or "DE"
        self._spin = os.getenv("AUDI_SPIN", "").strip() or None
        self._vin = os.getenv("AUDI_VIN", "").strip().upper()
        self._api_level = _integer_setting("AUDI_API_LEVEL", 1, 0)
        self._cache_seconds = _integer_setting(
            "AUDI_CACHE_SECONDS", DEFAULT_CACHE_SECONDS, MIN_CACHE_SECONDS
        )
        self._token_file = os.getenv(
            "AUDI_TOKEN_FILE", "/tmp/solix-audi-connect-tokens.json"
        )
        self._home_latitude = _float_setting("AUDI_HOME_LATITUDE")
        self._home_longitude = _float_setting("AUDI_HOME_LONGITUDE")
        self._home_radius_meters = _integer_setting(
            "AUDI_HOME_RADIUS_METERS", DEFAULT_HOME_RADIUS_METERS, 20
        )
        self._position_interval_seconds = _integer_setting(
            "AUDI_POSITION_INTERVAL_SECONDS",
            DEFAULT_POSITION_INTERVAL_SECONDS,
            MIN_POSITION_INTERVAL_SECONDS,
        )

        self._session: aiohttp.ClientSession | None = None
        self._auth: Any = None
        self._auth_time = 0.0
        self._vehicle_info: dict[str, Any] | None = None
        self._cache: dict[str, Any] | None = None
        self._last_success: float | None = None
        self._last_attempt: float | None = None
        self._last_error: str | None = None
        self._lock = asyncio.Lock()
        self._presence_task: asyncio.Task[None] | None = None
        self._presence: dict[str, Any] = {
            "presence_configured": self.home_geofence_configured,
            "presence_available": False,
            "at_home": None,
            "presence_state": (
                "unknown" if self.home_geofence_configured else "home_not_configured"
            ),
            "position_last_update": None,
            "position_checked_at": None,
            "position_error": None,
        }

    @property
    def configured(self) -> bool:
        return bool(self._refresh_token)

    @property
    def home_geofence_configured(self) -> bool:
        return bool(
            self._home_latitude is not None
            and self._home_longitude is not None
            and -90 <= self._home_latitude <= 90
            and -180 <= self._home_longitude <= 180
        )

    def _with_presence(self, payload: dict[str, Any]) -> dict[str, Any]:
        public = dict(payload)
        public.update(self._presence)
        return public

    def _empty_payload(self) -> dict[str, Any]:
        return {
            "configured": self.configured,
            "available": False,
            "cached": False,
            "stale": False,
            "cache_age_seconds": None,
            "cache_ttl_seconds": self._cache_seconds,
            "retry_after_seconds": None,
            "last_update": None,
            "error": None,
            "vehicle_name": None,
            "vehicle_model": None,
            "vehicle_model_year": None,
            "vin": None,
            "battery_percent": None,
            "fuel_percent": None,
            "electric_range_km": None,
            "total_range_km": None,
            "charging": None,
            "charging_state": None,
            "charging_power_kw": None,
            "remaining_charging_minutes": None,
            "plug_connected": None,
            "plug_state": None,
            **self._presence,
        }

    @staticmethod
    def _mask_vin(vin: Any) -> str | None:
        value = str(vin or "").strip()
        if not value:
            return None
        return f"{'*' * max(0, len(value) - 4)}{value[-4:]}"

    @staticmethod
    def _state(data: Any, name: str) -> Any:
        state = data.get_state(name)
        return state.get("value") if state else None

    @staticmethod
    def _field(data: Any, name: str) -> Any:
        field = data.get_field(name)
        return field.value if field else None

    @staticmethod
    def _as_number(value: Any) -> int | float | None:
        if value is None or isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return value
        try:
            number = float(str(value).replace(",", ".").strip())
            return int(number) if number.is_integer() else number
        except ValueError:
            return None

    @staticmethod
    def _charging_bool(value: Any) -> bool | None:
        if value is None:
            return None
        text = str(value).strip().lower().replace("_", "")
        if text in {"charging", "active", "on"}:
            return True
        if text in {
            "off",
            "inactive",
            "notcharging",
            "readyforcharging",
            "notreadyforcharging",
            "fullycharged",
        }:
            return False
        return None

    @staticmethod
    def _plug_bool(value: Any) -> bool | None:
        if value is None:
            return None
        text = str(value).strip().lower().replace("_", "")
        if "disconnected" in text or "unplugged" in text:
            return False
        if "connected" in text or "plugged" in text:
            return True
        return None

    @staticmethod
    def _electric_range(data: Any) -> int | float | None:
        candidates = (
            (
                AudiClient._state(data, "engineTypeFirstEngine"),
                AudiClient._state(data, "primaryEngineRange"),
            ),
            (
                AudiClient._state(data, "engineTypeSecondEngine"),
                AudiClient._state(data, "secondaryEngineRange"),
            ),
        )
        for engine_type, engine_range in candidates:
            if engine_type and "electric" in str(engine_type).lower():
                return AudiClient._as_number(engine_range)
        return None

    def _normalise_vehicle(
        self, vehicle_info: dict[str, Any], raw_data: dict[str, Any]
    ) -> dict[str, Any]:
        # Importing here keeps the optional Audi layer isolated from Solix app
        # startup if a future dependency is temporarily unavailable.
        from .vendor.audi_connect.models import VehicleDataResponse

        data = VehicleDataResponse(raw_data)
        media = vehicle_info.get("vehicle", {}).get("media", {})
        core = vehicle_info.get("vehicle", {}).get("core", {})
        charging_state = self._state(data, "chargingState")
        plug_state = self._state(data, "plugState")

        payload = self._empty_payload()
        payload.update(
            {
                "available": True,
                "vehicle_name": vehicle_info.get("nickname")
                or media.get("shortName")
                or media.get("longName"),
                "vehicle_model": media.get("longName") or media.get("shortName"),
                "vehicle_model_year": core.get("modelYear"),
                "vin": self._mask_vin(vehicle_info.get("vin")),
                "battery_percent": self._as_number(
                    self._state(data, "stateOfCharge")
                ),
                "fuel_percent": self._as_number(
                    self._field(data, "TANK_LEVEL_IN_PERCENTAGE")
                ),
                "electric_range_km": self._electric_range(data),
                "total_range_km": self._as_number(
                    self._field(data, "TOTAL_RANGE")
                ),
                "charging": self._charging_bool(charging_state),
                "charging_state": charging_state,
                "charging_power_kw": self._as_number(
                    self._state(data, "chargingPower")
                ),
                "remaining_charging_minutes": self._as_number(
                    self._state(data, "remainingChargingTime")
                ),
                "plug_connected": self._plug_bool(plug_state),
                "plug_state": plug_state,
            }
        )
        return payload

    def _remember_refresh_token(self) -> None:
        """Keep a rotated token usable for the lifetime of this process."""
        if self._auth is None:
            return
        rotated_token = self._auth.refresh_token
        if rotated_token:
            self._refresh_token = rotated_token

    async def _login(
        self,
        refresh_token: str | None = None,
        *,
        clear_cached_tokens: bool = False,
    ) -> None:
        from .vendor.audi_connect.api import AudiAPI
        from .vendor.audi_connect.auth import AudiAuth
        from .vendor.audi_connect.token_store import TokenStore

        if self._session is None or self._session.closed:
            import certifi

            ssl_context = ssl.create_default_context(cafile=certifi.where())
            self._session = aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(ssl=ssl_context)
            )

        token_store = TokenStore(filepath=self._token_file)
        if clear_cached_tokens:
            token_store.clear()

        self._auth = AudiAuth(
            AudiAPI(self._session),
            country=self._country,
            spin=self._spin,
            api_level=self._api_level,
            token_store=token_store,
        )
        vehicles = await self._auth.login_with_refresh_token(
            refresh_token or self._refresh_token
        )
        self._remember_refresh_token()
        if self._vin:
            self._vehicle_info = next(
                (
                    vehicle
                    for vehicle in vehicles
                    if str(vehicle.get("vin", "")).upper() == self._vin
                ),
                None,
            )
            if self._vehicle_info is None:
                raise RuntimeError("AUDI_VIN wurde im myAudi-Konto nicht gefunden")
        else:
            self._vehicle_info = vehicles[0] if vehicles else None

        if self._vehicle_info is None:
            raise RuntimeError("Kein Fahrzeug im myAudi-Konto gefunden")
        self._auth_time = time.time()

    async def _ensure_auth(self) -> None:
        if self._auth is None or self._vehicle_info is None:
            await self._login()
            return

        elapsed = int(time.time() - self._auth_time)
        if elapsed < TOKEN_REFRESH_SECONDS:
            return

        try:
            refreshed = await self._auth.refresh_tokens(elapsed)
            if refreshed:
                self._remember_refresh_token()
                self._auth_time = time.time()
        except Exception:
            # A single full login is safer than repeatedly retrying a failed
            # token refresh. Further retries only happen on the next API call.
            self._auth = None
            self._vehicle_info = None
            await self._login()

    async def _recover_unauthorized(self) -> None:
        """Refresh an unexpectedly rejected bearer token, with one full fallback."""
        latest_refresh_token = self._refresh_token
        if self._auth is not None:
            latest_refresh_token = self._auth.refresh_token or latest_refresh_token
            try:
                refreshed = await self._auth.refresh_tokens(24 * 60 * 60)
                if refreshed:
                    self._remember_refresh_token()
                    self._auth_time = time.time()
                    return
            except Exception:
                _LOGGER.warning(
                    "Immediate Audi token refresh failed; starting a clean session",
                    exc_info=True,
                )

        self._auth = None
        self._vehicle_info = None
        await self._login(
            latest_refresh_token,
            clear_cached_tokens=True,
        )

    async def _refresh_from_cloud(self) -> dict[str, Any]:
        await self._ensure_auth()
        assert self._auth is not None
        assert self._vehicle_info is not None

        vin = str(self._vehicle_info.get("vin", ""))
        try:
            raw_data = await self._auth.get_stored_vehicle_data(vin)
        except aiohttp.ClientResponseError as exc:
            if exc.status != 401:
                raise
            _LOGGER.warning(
                "Audi bearer token was rejected; refreshing once before retry"
            )
            await self._recover_unauthorized()
            assert self._auth is not None
            assert self._vehicle_info is not None
            vin = str(self._vehicle_info.get("vin", ""))
            raw_data = await self._auth.get_stored_vehicle_data(vin)
        payload = self._normalise_vehicle(self._vehicle_info, raw_data)
        payload.update(
            {
                "cached": False,
                "stale": False,
                "cache_age_seconds": 0,
                "last_update": datetime.now(timezone.utc).isoformat(),
                "error": None,
            }
        )
        return payload

    @staticmethod
    def _position_values(raw_position: Any) -> tuple[float, float, Any] | None:
        if not isinstance(raw_position, dict):
            return None
        data = raw_position.get("data")
        if isinstance(data, dict):
            raw_position = data
        try:
            latitude = float(raw_position.get("lat"))
            longitude = float(raw_position.get("lon"))
        except (TypeError, ValueError):
            return None
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            return None
        return latitude, longitude, raw_position.get("carCapturedTimestamp")

    @staticmethod
    def _distance_meters(
        latitude_a: float,
        longitude_a: float,
        latitude_b: float,
        longitude_b: float,
    ) -> float:
        """Return great-circle distance without exposing either coordinate."""
        earth_radius_meters = 6_371_000
        lat_a = math.radians(latitude_a)
        lat_b = math.radians(latitude_b)
        delta_lat = lat_b - lat_a
        delta_lon = math.radians(longitude_b - longitude_a)
        haversine = (
            math.sin(delta_lat / 2) ** 2
            + math.cos(lat_a) * math.cos(lat_b) * math.sin(delta_lon / 2) ** 2
        )
        return 2 * earth_radius_meters * math.asin(min(1, math.sqrt(haversine)))

    async def refresh_presence(self) -> dict[str, Any]:
        """Refresh the private parking position and publish only home/away."""
        if not self.home_geofence_configured:
            return dict(self._presence)
        if not self.configured:
            self._presence.update(
                {
                    "presence_available": False,
                    "at_home": None,
                    "presence_state": "unknown",
                    "position_error": "Audi Connect ist nicht eingerichtet",
                }
            )
            return dict(self._presence)

        async with self._lock:
            checked_at = datetime.now(timezone.utc).isoformat()
            try:
                await self._ensure_auth()
                assert self._auth is not None
                assert self._vehicle_info is not None
                vin = str(self._vehicle_info.get("vin", ""))
                raw_position = await self._auth.get_stored_position(vin)
                position = self._position_values(raw_position)
                if position is None:
                    self._presence.update(
                        {
                            "presence_available": False,
                            "at_home": None,
                            "presence_state": "unknown",
                            "position_checked_at": checked_at,
                            "position_error": None,
                        }
                    )
                    return dict(self._presence)

                latitude, longitude, captured_at = position
                assert self._home_latitude is not None
                assert self._home_longitude is not None
                distance = self._distance_meters(
                    self._home_latitude,
                    self._home_longitude,
                    latitude,
                    longitude,
                )
                at_home = distance <= self._home_radius_meters
                self._presence.update(
                    {
                        "presence_available": True,
                        "at_home": at_home,
                        "presence_state": "home" if at_home else "away",
                        "position_last_update": captured_at,
                        "position_checked_at": checked_at,
                        "position_error": None,
                    }
                )
            except Exception as exc:
                self._presence.update(
                    {
                        "presence_available": False,
                        "at_home": None,
                        "presence_state": "unknown",
                        "position_checked_at": checked_at,
                        "position_error": self._public_error(exc),
                    }
                )
                _LOGGER.exception("Audi parking-position refresh failed")
            return dict(self._presence)

    async def _run_presence_monitor(self) -> None:
        while True:
            await self.refresh_presence()
            await asyncio.sleep(self._position_interval_seconds)

    async def start(self) -> None:
        """Start an immediate, privacy-preserving home-presence monitor."""
        if (
            self.configured
            and self.home_geofence_configured
            and self._presence_task is None
        ):
            self._presence_task = asyncio.create_task(
                self._run_presence_monitor(), name="audi-home-presence-monitor"
            )

    def _cached_payload(self) -> dict[str, Any] | None:
        if self._cache is None or self._last_success is None:
            return None
        age = int(time.time() - self._last_success)
        payload = dict(self._cache)
        payload["cached"] = True
        payload["stale"] = age >= self._cache_seconds
        payload["cache_age_seconds"] = age
        payload["error"] = self._last_error
        if self._last_error and self._last_attempt is not None:
            elapsed = int(time.time() - self._last_attempt)
            payload["retry_after_seconds"] = max(
                0, ERROR_RETRY_SECONDS - elapsed
            )
        return payload

    def _retry_delayed_after_error(self) -> bool:
        return bool(
            self._last_error
            and self._last_attempt is not None
            and (time.time() - self._last_attempt) < ERROR_RETRY_SECONDS
        )

    def _failed_payload(self) -> dict[str, Any]:
        cached = self._cached_payload()
        if cached:
            return cached
        payload = self._empty_payload()
        payload["error"] = self._last_error
        if self._last_attempt is not None:
            elapsed = int(time.time() - self._last_attempt)
            payload["retry_after_seconds"] = max(
                0, ERROR_RETRY_SECONDS - elapsed
            )
        return payload

    @staticmethod
    def _public_error(exc: Exception) -> str:
        name = type(exc).__name__
        if name in {"AuthenticationError", "TokenRefreshError"}:
            return (
                "Audi-Autorisierung ist abgelaufen oder wurde abgelehnt. "
                "Die Gerätefreigabe muss erneut durchgeführt werden."
            )
        if isinstance(exc, asyncio.TimeoutError) or name == "RequestTimeoutError":
            return "Zeitüberschreitung beim Abruf von Audi Connect"
        if isinstance(exc, aiohttp.ClientResponseError):
            return f"Audi Connect antwortet mit HTTP {exc.status}"
        if isinstance(exc, RuntimeError):
            return str(exc)
        return "Audi Connect ist derzeit nicht verfügbar; Details stehen im Render-Log"

    async def get_live(self) -> dict[str, Any]:
        """Return Audi data and fetch from the cloud at most once per cache TTL."""
        if not self.configured:
            payload = self._empty_payload()
            payload["error"] = "AUDI_REFRESH_TOKEN ist nicht gesetzt"
            return self._with_presence(payload)

        cached = self._cached_payload()
        if cached and not cached["stale"]:
            return self._with_presence(cached)
        if self._retry_delayed_after_error():
            return self._with_presence(self._failed_payload())

        async with self._lock:
            cached = self._cached_payload()
            if cached and not cached["stale"]:
                return self._with_presence(cached)
            if self._retry_delayed_after_error():
                return self._with_presence(self._failed_payload())
            self._last_attempt = time.time()
            try:
                self._cache = await self._refresh_from_cloud()
                self._last_success = time.time()
                self._last_error = None
                return self._with_presence(self._cache)
            except Exception as exc:
                self._last_error = self._public_error(exc)
                _LOGGER.exception("Audi Connect refresh failed")
                return self._with_presence(self._failed_payload())

    async def close(self) -> None:
        if self._presence_task is not None:
            self._presence_task.cancel()
            try:
                await self._presence_task
            except asyncio.CancelledError:
                pass
            self._presence_task = None
        if self._session and not self._session.closed:
            await self._session.close()
