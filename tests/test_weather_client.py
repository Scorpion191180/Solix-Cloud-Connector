import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from weather.client import WeatherClient, celestial_snapshot


class CelestialSnapshotTests(unittest.TestCase):
    latitude = 48.46991
    longitude = 8.44543

    def test_summer_sun_is_high_and_southerly_near_noon(self):
        snapshot = celestial_snapshot(
            self.latitude,
            self.longitude,
            datetime(2026, 6, 21, 12, 0, tzinfo=timezone.utc),
        )

        self.assertGreater(snapshot["sun"]["elevation_deg"], 55)
        self.assertLess(snapshot["sun"]["elevation_deg"], 70)
        self.assertGreater(snapshot["sun"]["azimuth_deg"], 175)
        self.assertLess(snapshot["sun"]["azimuth_deg"], 230)
        self.assertEqual(snapshot["orientation"]["panel_azimuth_deg"], 157.5)
        self.assertEqual(snapshot["orientation"]["panel_direction"], "Süd-Südost")

    def test_sun_is_below_horizon_at_local_midnight(self):
        snapshot = celestial_snapshot(
            self.latitude,
            self.longitude,
            datetime(2026, 6, 21, 22, 0, tzinfo=timezone.utc),
        )

        self.assertLess(snapshot["sun"]["elevation_deg"], 0)

    def test_moon_phase_and_motion_are_bounded(self):
        snapshot = celestial_snapshot(
            self.latitude,
            self.longitude,
            datetime(2026, 8, 12, 20, 0, tzinfo=timezone.utc),
        )
        moon = snapshot["moon"]

        self.assertGreaterEqual(moon["phase_fraction"], 0)
        self.assertLess(moon["phase_fraction"], 1)
        self.assertGreaterEqual(moon["illumination_percent"], 0)
        self.assertLessEqual(moon["illumination_percent"], 100)
        self.assertIn("phase_name", moon)
        self.assertLess(abs(moon["azimuth_rate_deg_per_minute"]), 2)
        self.assertLess(abs(moon["elevation_rate_deg_per_minute"]), 2)


class WeatherFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_httpx_fallback_returns_weather_if_aiohttp_fails(self):
        client = WeatherClient()
        client.latitude = 48.46991
        client.longitude = 8.44543

        class Response:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "timezone": "Europe/Berlin",
                    "current": {"temperature_2m": 21.4},
                }

        httpx_client = AsyncMock()
        httpx_client.get.return_value = Response()
        with (
            patch.object(
                client,
                "_ensure_session",
                AsyncMock(side_effect=RuntimeError("aiohttp unavailable")),
            ),
            patch.object(
                client,
                "_ensure_httpx_client",
                AsyncMock(return_value=httpx_client),
            ),
        ):
            data = await client._fetch_data()

        self.assertEqual(data["current"]["temperature_2m"], 21.4)
        httpx_client.get.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
