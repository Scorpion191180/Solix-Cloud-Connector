"""Cached Open-Meteo access for the live day/night and weather scene."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import math
import os
import ssl
import time
from typing import Any

import aiohttp
import certifi
import httpx


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
DEFAULT_TIMEZONE = "Europe/Berlin"
DEFAULT_PANEL_AZIMUTH_DEGREES = 157.5


def _float_setting(name: str, default: float | None = None) -> float | None:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _normal_degrees(value: float) -> float:
    return value % 360.0


def _signed_degrees(value: float) -> float:
    return (value + 180.0) % 360.0 - 180.0


def _julian_day(moment: datetime) -> float:
    return moment.timestamp() / 86400.0 + 2440587.5


def _horizontal_coordinates(
    right_ascension_degrees: float,
    declination_degrees: float,
    julian_day: float,
    latitude: float,
    longitude: float,
) -> tuple[float, float]:
    centuries = (julian_day - 2451545.0) / 36525.0
    sidereal = _normal_degrees(
        280.46061837
        + 360.98564736629 * (julian_day - 2451545.0)
        + 0.000387933 * centuries * centuries
        - centuries * centuries * centuries / 38710000.0
        + longitude
    )
    hour_angle = math.radians(
        _signed_degrees(sidereal - right_ascension_degrees)
    )
    declination = math.radians(declination_degrees)
    observer_latitude = math.radians(latitude)
    elevation = math.asin(
        math.sin(observer_latitude) * math.sin(declination)
        + math.cos(observer_latitude)
        * math.cos(declination)
        * math.cos(hour_angle)
    )
    # Azimut wird meteorologisch angegeben: 0° = Nord, 90° = Ost.
    azimuth = math.atan2(
        -math.sin(hour_angle),
        math.tan(declination) * math.cos(observer_latitude)
        - math.sin(observer_latitude) * math.cos(hour_angle),
    )
    return _normal_degrees(math.degrees(azimuth)), math.degrees(elevation)


def _equatorial_from_ecliptic(
    longitude_degrees: float,
    latitude_degrees: float,
    obliquity_degrees: float,
) -> tuple[float, float]:
    longitude = math.radians(longitude_degrees)
    latitude = math.radians(latitude_degrees)
    obliquity = math.radians(obliquity_degrees)
    x = math.cos(longitude) * math.cos(latitude)
    y = (
        math.sin(longitude) * math.cos(latitude) * math.cos(obliquity)
        - math.sin(latitude) * math.sin(obliquity)
    )
    z = (
        math.sin(longitude) * math.cos(latitude) * math.sin(obliquity)
        + math.sin(latitude) * math.cos(obliquity)
    )
    return _normal_degrees(math.degrees(math.atan2(y, x))), math.degrees(
        math.asin(z)
    )


def _sun_equatorial(julian_day: float) -> tuple[float, float, float]:
    days = julian_day - 2451545.0
    mean_anomaly = math.radians(_normal_degrees(357.529 + 0.98560028 * days))
    mean_longitude = _normal_degrees(280.459 + 0.98564736 * days)
    ecliptic_longitude = _normal_degrees(
        mean_longitude
        + 1.915 * math.sin(mean_anomaly)
        + 0.020 * math.sin(2.0 * mean_anomaly)
    )
    obliquity = 23.439 - 0.00000036 * days
    right_ascension, declination = _equatorial_from_ecliptic(
        ecliptic_longitude, 0.0, obliquity
    )
    return right_ascension, declination, ecliptic_longitude


def _moon_equatorial(julian_day: float) -> tuple[float, float, float]:
    # Kompakte, fuer die Visualisierung ausreichend genaue Mond-Ephemeride.
    # Die dominanten Terme bilden Umlaufbahn, Deklination und Mondphase ab.
    days = julian_day - 2451545.0
    mean_longitude = _normal_degrees(218.316 + 13.176396 * days)
    mean_anomaly = math.radians(_normal_degrees(134.963 + 13.064993 * days))
    argument_latitude = math.radians(_normal_degrees(93.272 + 13.229350 * days))
    ecliptic_longitude = _normal_degrees(
        mean_longitude + 6.289 * math.sin(mean_anomaly)
    )
    ecliptic_latitude = 5.128 * math.sin(argument_latitude)
    obliquity = 23.439 - 0.00000036 * days
    right_ascension, declination = _equatorial_from_ecliptic(
        ecliptic_longitude, ecliptic_latitude, obliquity
    )
    return right_ascension, declination, ecliptic_longitude


def _body_position(
    body: str,
    moment: datetime,
    latitude: float,
    longitude: float,
) -> tuple[float, float, float]:
    julian_day = _julian_day(moment)
    if body == "sun":
        right_ascension, declination, ecliptic_longitude = _sun_equatorial(
            julian_day
        )
    else:
        right_ascension, declination, ecliptic_longitude = _moon_equatorial(
            julian_day
        )
    azimuth, elevation = _horizontal_coordinates(
        right_ascension,
        declination,
        julian_day,
        latitude,
        longitude,
    )
    return azimuth, elevation, ecliptic_longitude


def _moon_phase_name(phase_fraction: float) -> str:
    names = (
        "Neumond",
        "zunehmende Sichel",
        "erstes Viertel",
        "zunehmender Mond",
        "Vollmond",
        "abnehmender Mond",
        "letztes Viertel",
        "abnehmende Sichel",
    )
    return names[int(phase_fraction * 8.0 + 0.5) % 8]


def celestial_snapshot(
    latitude: float,
    longitude: float,
    moment: datetime | None = None,
    panel_azimuth_degrees: float = DEFAULT_PANEL_AZIMUTH_DEGREES,
) -> dict[str, Any]:
    """Return privacy-safe current sky geometry without exposing coordinates."""
    current = (moment or datetime.now(timezone.utc)).astimezone(timezone.utc)
    one_minute_later = current + timedelta(minutes=1)
    sun_now = _body_position("sun", current, latitude, longitude)
    sun_next = _body_position("sun", one_minute_later, latitude, longitude)
    moon_now = _body_position("moon", current, latitude, longitude)
    moon_next = _body_position("moon", one_minute_later, latitude, longitude)
    phase_fraction = _normal_degrees(moon_now[2] - sun_now[2]) / 360.0
    illumination = (1.0 - math.cos(phase_fraction * math.tau)) / 2.0

    def body_payload(
        current_position: tuple[float, float, float],
        next_position: tuple[float, float, float],
    ) -> dict[str, float]:
        return {
            "azimuth_deg": round(current_position[0], 4),
            "elevation_deg": round(current_position[1], 4),
            "azimuth_rate_deg_per_minute": round(
                _signed_degrees(next_position[0] - current_position[0]), 6
            ),
            "elevation_rate_deg_per_minute": round(
                next_position[1] - current_position[1], 6
            ),
        }

    return {
        "calculated_at": current.isoformat().replace("+00:00", "Z"),
        "orientation": {
            "panel_azimuth_deg": round(panel_azimuth_degrees, 1),
            "panel_direction": "Süd-Südost",
        },
        "sun": body_payload(sun_now, sun_next),
        "moon": {
            **body_payload(moon_now, moon_next),
            "phase_fraction": round(phase_fraction, 6),
            "illumination_percent": round(illumination * 100.0, 2),
            "waxing": phase_fraction < 0.5,
            "phase_name": _moon_phase_name(phase_fraction),
        },
    }


class WeatherClient:
    """Fetch live weather while recalculating the sky for every response."""

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
        self.panel_azimuth = _float_setting(
            "PV_AZIMUTH_DEGREES", DEFAULT_PANEL_AZIMUTH_DEGREES
        ) or DEFAULT_PANEL_AZIMUTH_DEGREES
        self._cache_seconds = 5 * 60
        self._last_fetch = 0.0
        self._last_payload: dict[str, Any] | None = None
        self._lock = asyncio.Lock()
        self._session: aiohttp.ClientSession | None = None
        self._httpx_client: httpx.AsyncClient | None = None

    def _with_celestial(self, payload: dict[str, Any]) -> dict[str, Any]:
        decorated = dict(payload)
        if self.latitude is not None and self.longitude is not None:
            decorated["celestial"] = celestial_snapshot(
                self.latitude,
                self.longitude,
                panel_azimuth_degrees=self.panel_azimuth,
            )
        return decorated

    async def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            ssl_context = ssl.create_default_context(cafile=certifi.where())
            self._session = aiohttp.ClientSession(
                connector=aiohttp.TCPConnector(ssl=ssl_context),
                timeout=aiohttp.ClientTimeout(total=12),
            )
        return self._session

    async def _ensure_httpx_client(self) -> httpx.AsyncClient:
        if self._httpx_client is None or self._httpx_client.is_closed:
            self._httpx_client = httpx.AsyncClient(
                verify=certifi.where(),
                timeout=12,
                follow_redirects=True,
            )
        return self._httpx_client

    @property
    def _request_params(self) -> dict[str, Any]:
        return {
            "latitude": self.latitude,
            "longitude": self.longitude,
            "current": (
                "temperature_2m,apparent_temperature,is_day,"
                "precipitation,rain,snowfall,weather_code,"
                "cloud_cover,wind_speed_10m,wind_direction_10m"
            ),
            "daily": "sunrise,sunset",
            "forecast_days": 1,
            "timezone": self.timezone,
        }

    async def _fetch_data(self) -> dict[str, Any]:
        """Use aiohttp first and transparently fall back to httpx."""
        try:
            session = await self._ensure_session()
            async with session.get(OPEN_METEO_URL, params=self._request_params) as response:
                response.raise_for_status()
                return await response.json()
        except Exception:
            client = await self._ensure_httpx_client()
            response = await client.get(OPEN_METEO_URL, params=self._request_params)
            response.raise_for_status()
            return response.json()

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
                return self._with_celestial(self._last_payload)

            try:
                data = await self._fetch_data()
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
                    "wind_direction_deg": current.get("wind_direction_10m"),
                    "sunrise": (daily.get("sunrise") or [None])[0],
                    "sunset": (daily.get("sunset") or [None])[0],
                    "source": "Open-Meteo",
                    "error": None,
                }
                self._last_payload = payload
                self._last_fetch = now
                return self._with_celestial(payload)
            except Exception:
                if self._last_payload is not None:
                    payload = dict(self._last_payload)
                    payload.update(
                        {
                            "stale": True,
                            "error": "Wetterdaten vorübergehend nicht erreichbar",
                        }
                    )
                    return self._with_celestial(payload)
                return self._with_celestial({
                    "available": False,
                    "stale": True,
                    "timezone": self.timezone,
                    "error": "Wetterdaten vorübergehend nicht erreichbar",
                    "source": "Open-Meteo",
                })

    async def close(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()
        self._session = None
        if self._httpx_client is not None and not self._httpx_client.is_closed:
            await self._httpx_client.aclose()
        self._httpx_client = None
