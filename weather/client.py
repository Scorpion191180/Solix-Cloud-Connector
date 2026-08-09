"""Cached Open-Meteo access for the live day/night and weather scene."""

from __future__ import annotations

import asyncio
import os
import ssl
import time
from typing import Any

import aiohttp
import certifi


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
DEFAULT_TIMEZONE = "Europe/Berlin"


def _float_setting(name: str, default: float | None = None) -> float | None:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


class WeatherClient:
    """Fetch current weather at most once every ten minutes."""

    def __init__(self) -> None:
        # Die bereits serverseitig hinterlegten Audi-Hauskoordinaten können
        # wiederverwendet werden. Sie werden niemals an den Browser geliefert.
        self.latitude = _float_setting(
            "HOUSE_LATITUDE", _float_setting("AUDI_HOME_LATITUDE")
        )
        self.longitude = _float_setting(
            "HOUSE_LONGITUDE", _float_setting("AUDI_HOME_LONGITUDE")
        )
        self.timezone = os.getenv("APP_TIMEZONE", DEFAULT_TIMEZONE)
        self._cache_seconds = 10 * 60
        self._last_fetch = 0.0
        self._last_payload: dict[str, Any] | None = None
        self._lock = asyncio.Lock()
        self._session: aiohttp.ClientSession | None = None

    async def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            ssl_context = ssl.create_default_context(cafile=certifi.where())
            self._session = aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(ssl=ssl_context),
                timeout=aiohttp.ClientTimeout(total=12),
            )
        return self._session

    async def get_live(self) -> dict[str, Any]:
        async with self._lock:
            if self.latitude is None or self.longitude is None:
                return {
                    "available": False,
                    "stale": True,
                    "timezone": self.timezone,
                    "error": "Hauskoordinaten für Wetter sind nicht eingerichtet",
                    "source": "Open-Meteo",
                }
            now = time.monotonic()
            if (
                self._last_payload is not None
                and now - self._last_fetch < self._cache_seconds
            ):
                return dict(self._last_payload)

            try:
                session = await self._ensure_session()
                async with session.get(
                    OPEN_METEO_URL,
                    params={
                        "latitude": self.latitude,
                        "longitude": self.longitude,
                        "current": (
                            "temperature_2m,apparent_temperature,is_day,"
                            "precipitation,rain,snowfall,weather_code,"
                            "cloud_cover,wind_speed_10m"
                        ),
                        "daily": "sunrise,sunset",
                        "forecast_days": 1,
                        "timezone": self.timezone,
                    },
                ) as response:
                    response.raise_for_status()
                    data = await response.json()
                current = data.get("current") or {}
                daily = data.get("daily") or {}
                payload = {
                    "available": True,
                    "stale": False,
                    "timezone": data.get("timezone") or self.timezone,
                    "observed_at": current.get("time"),
                    "temperature_c": current.get("temperature_2m"),
                    "feels_like_c": current.get("apparent_temperature"),
                    "is_day": current.get("is_day"),
                    "precipitation_mm": current.get("precipitation"),
                    "rain_mm": current.get("rain"),
                    "snowfall_cm": current.get("snowfall"),
                    "weather_code": current.get("weather_code"),
                    "cloud_cover_percent": current.get("cloud_cover"),
                    "wind_speed_kmh": current.get("wind_speed_10m"),
                    "sunrise": (daily.get("sunrise") or [None])[0],
                    "sunset": (daily.get("sunset") or [None])[0],
                    "source": "Open-Meteo",
                    "error": None,
                }
                self._last_payload = payload
                self._last_fetch = now
                return dict(payload)
            except Exception:
                if self._last_payload is not None:
                    payload = dict(self._last_payload)
                    payload.update(
                        {
                            "stale": True,
                            "error": "Wetterdaten vorübergehend nicht erreichbar",
                        }
                    )
                    return payload
                return {
                    "available": False,
                    "stale": True,
                    "timezone": self.timezone,
                    "error": "Wetterdaten vorübergehend nicht erreichbar",
                    "source": "Open-Meteo",
                }

    async def close(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()
        self._session = None
