import os
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import aiohttp

from audi.client import (
    AudiClient,
    ERROR_RETRY_SECONDS,
    MIN_CACHE_SECONDS,
    TOKEN_REFRESH_SECONDS,
)


class AudiClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_authorization_is_non_fatal(self):
        with patch.dict(os.environ, {}, clear=True):
            client = AudiClient()
            result = await client.get_live()

        self.assertFalse(result["configured"])
        self.assertFalse(result["available"])
        self.assertIn("AUDI_REFRESH_TOKEN", result["error"])

    async def test_success_is_served_from_cache(self):
        with patch.dict(
            os.environ,
            {"AUDI_REFRESH_TOKEN": "refresh-token"},
            clear=True,
        ):
            client = AudiClient()

        fresh = client._empty_payload()
        fresh.update(
            {
                "available": True,
                "cached": False,
                "stale": False,
                "cache_age_seconds": 0,
                "vehicle_name": "Q3",
            }
        )
        client._refresh_from_cloud = AsyncMock(return_value=fresh)

        first = await client.get_live()
        second = await client.get_live()

        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(second["vehicle_name"], "Q3")
        client._refresh_from_cloud.assert_awaited_once()

    async def test_failed_refresh_returns_stale_success(self):
        with patch.dict(
            os.environ,
            {"AUDI_REFRESH_TOKEN": "refresh-token"},
            clear=True,
        ):
            client = AudiClient()

        client._cache = client._empty_payload()
        client._cache.update({"available": True, "vehicle_name": "Q3"})
        client._last_success = time.time() - client._cache_seconds - 1
        client._refresh_from_cloud = AsyncMock(side_effect=RuntimeError("offline"))

        with patch("audi.client._LOGGER.exception"):
            result = await client.get_live()

        self.assertTrue(result["available"])
        self.assertTrue(result["cached"])
        self.assertTrue(result["stale"])
        self.assertEqual(result["error"], "offline")

    def test_vehicle_status_is_normalised_and_vin_is_masked(self):
        with patch.dict(
            os.environ,
            {"AUDI_REFRESH_TOKEN": "refresh-token"},
            clear=True,
        ):
            client = AudiClient()

        vehicle = {
            "vin": "WAU12345678901234",
            "nickname": "Mein Q3",
            "vehicle": {
                "media": {"shortName": "Q3", "longName": "Audi Q3 TFSI e"},
                "core": {"modelYear": "2024"},
            },
        }
        timestamp = "2026-08-02T10:00:00Z"
        raw = {
            "fuelStatus": {
                "rangeStatus": {
                    "value": {
                        "totalRange_km": 510,
                        "primaryEngine": {
                            "type": "gasoline",
                            "remainingRange_km": 455,
                        },
                        "secondaryEngine": {
                            "type": "electric",
                            "remainingRange_km": 55,
                        },
                        "carCapturedTimestamp": timestamp,
                    }
                }
            },
            "measurements": {
                "fuelLevelStatus": {
                    "value": {
                        "currentFuelLevel_pct": 72,
                        "carCapturedTimestamp": timestamp,
                    }
                }
            },
            "charging": {
                "batteryStatus": {
                    "value": {
                        "currentSOC_pct": 64,
                        "carCapturedTimestamp": timestamp,
                    }
                },
                "chargingStatus": {
                    "value": {
                        "chargingState": "charging",
                        "chargePower_kW": 3.5,
                        "remainingChargingTimeToComplete_min": 42,
                        "carCapturedTimestamp": timestamp,
                    }
                },
                "plugStatus": {
                    "value": {
                        "plugConnectionState": "connected",
                        "carCapturedTimestamp": timestamp,
                    }
                },
            },
        }

        result = client._normalise_vehicle(vehicle, raw)

        self.assertEqual(result["vehicle_name"], "Mein Q3")
        self.assertEqual(result["vin"], "*************1234")
        self.assertEqual(result["battery_percent"], 64)
        self.assertEqual(result["fuel_percent"], 72)
        self.assertEqual(result["electric_range_km"], 55)
        self.assertEqual(result["total_range_km"], 510)
        self.assertTrue(result["charging"])
        self.assertTrue(result["plug_connected"])

    def test_cache_setting_has_safe_minimum(self):
        with patch.dict(
            os.environ,
            {
                "AUDI_REFRESH_TOKEN": "refresh-token",
                "AUDI_CACHE_SECONDS": "1",
            },
            clear=True,
        ):
            client = AudiClient()

        self.assertEqual(client._cache_seconds, MIN_CACHE_SECONDS)

    async def test_parking_position_is_reduced_to_private_home_presence(self):
        with patch.dict(
            os.environ,
            {
                "AUDI_REFRESH_TOKEN": "refresh-token",
                "AUDI_HOME_LATITUDE": "48.100000",
                "AUDI_HOME_LONGITUDE": "8.200000",
                "AUDI_HOME_RADIUS_METERS": "120",
            },
            clear=True,
        ):
            client = AudiClient()

        client._ensure_auth = AsyncMock()
        client._vehicle_info = {"vin": "WAU123"}
        client._auth = SimpleNamespace(
            get_stored_position=AsyncMock(
                return_value={
                    "data": {
                        "lat": 48.10035,
                        "lon": 8.20020,
                        "carCapturedTimestamp": "2026-08-07T10:00:00Z",
                    }
                }
            )
        )

        result = await client.refresh_presence()
        public = client._with_presence(client._empty_payload())

        self.assertTrue(result["presence_available"])
        self.assertTrue(result["at_home"])
        self.assertEqual(result["presence_state"], "home")
        self.assertEqual(result["position_last_update"], "2026-08-07T10:00:00Z")
        self.assertNotIn("lat", public)
        self.assertNotIn("lon", public)
        self.assertNotIn("distance", public)

    async def test_position_outside_geofence_is_away(self):
        with patch.dict(
            os.environ,
            {
                "AUDI_REFRESH_TOKEN": "refresh-token",
                "AUDI_HOME_LATITUDE": "48.100000",
                "AUDI_HOME_LONGITUDE": "8.200000",
                "AUDI_HOME_RADIUS_METERS": "120",
            },
            clear=True,
        ):
            client = AudiClient()

        client._ensure_auth = AsyncMock()
        client._vehicle_info = {"vin": "WAU123"}
        client._auth = SimpleNamespace(
            get_stored_position=AsyncMock(
                return_value={"lat": 48.110000, "lon": 8.210000}
            )
        )

        result = await client.refresh_presence()

        self.assertTrue(result["presence_available"])
        self.assertFalse(result["at_home"])
        self.assertEqual(result["presence_state"], "away")

    async def test_missing_parking_position_does_not_guess_presence(self):
        with patch.dict(
            os.environ,
            {
                "AUDI_REFRESH_TOKEN": "refresh-token",
                "AUDI_HOME_LATITUDE": "48.100000",
                "AUDI_HOME_LONGITUDE": "8.200000",
            },
            clear=True,
        ):
            client = AudiClient()

        client._ensure_auth = AsyncMock()
        client._vehicle_info = {"vin": "WAU123"}
        client._auth = SimpleNamespace(
            get_stored_position=AsyncMock(return_value=None)
        )

        result = await client.refresh_presence()

        self.assertFalse(result["presence_available"])
        self.assertIsNone(result["at_home"])
        self.assertEqual(result["presence_state"], "unknown")

    async def test_auth_clock_is_not_reset_when_token_is_not_yet_due(self):
        with patch.dict(
            os.environ,
            {"AUDI_REFRESH_TOKEN": "refresh-token"},
            clear=True,
        ):
            client = AudiClient()

        original_auth_time = time.time() - TOKEN_REFRESH_SECONDS - 1
        auth = SimpleNamespace(
            refresh_tokens=AsyncMock(return_value=False),
            refresh_token="refresh-token",
        )
        client._auth = auth
        client._vehicle_info = {"vin": "WAU123"}
        client._auth_time = original_auth_time

        await client._ensure_auth()

        auth.refresh_tokens.assert_awaited_once()
        self.assertEqual(client._auth_time, original_auth_time)

    async def test_successful_token_refresh_updates_clock_and_rotated_token(self):
        with patch.dict(
            os.environ,
            {"AUDI_REFRESH_TOKEN": "old-refresh-token"},
            clear=True,
        ):
            client = AudiClient()

        auth = SimpleNamespace(
            refresh_tokens=AsyncMock(return_value=True),
            refresh_token="rotated-refresh-token",
        )
        client._auth = auth
        client._vehicle_info = {"vin": "WAU123"}
        client._auth_time = time.time() - TOKEN_REFRESH_SECONDS - 1

        await client._ensure_auth()

        self.assertGreater(client._auth_time, time.time() - 5)
        self.assertEqual(client._refresh_token, "rotated-refresh-token")

    async def test_401_forces_token_refresh_and_retries_vehicle_request(self):
        with patch.dict(
            os.environ,
            {"AUDI_REFRESH_TOKEN": "old-refresh-token"},
            clear=True,
        ):
            client = AudiClient()

        unauthorized = aiohttp.ClientResponseError(
            request_info=None,
            history=(),
            status=401,
            message="Unauthorized",
        )
        auth = SimpleNamespace(
            get_stored_vehicle_data=AsyncMock(
                side_effect=[unauthorized, {"charging": {}}]
            ),
            refresh_tokens=AsyncMock(return_value=True),
            refresh_token="rotated-refresh-token",
        )
        client._auth = auth
        client._vehicle_info = {"vin": "WAU123"}
        client._ensure_auth = AsyncMock()
        payload = client._empty_payload()
        payload["available"] = True
        client._normalise_vehicle = Mock(return_value=payload)

        result = await client._refresh_from_cloud()

        auth.refresh_tokens.assert_awaited_once_with(24 * 60 * 60)
        self.assertEqual(auth.get_stored_vehicle_data.await_count, 2)
        self.assertEqual(client._refresh_token, "rotated-refresh-token")
        self.assertTrue(result["available"])

    async def test_failed_cloud_refresh_is_retried_at_most_every_15_minutes(self):
        with patch.dict(
            os.environ,
            {"AUDI_REFRESH_TOKEN": "refresh-token"},
            clear=True,
        ):
            client = AudiClient()

        client._cache = client._empty_payload()
        client._cache.update({"available": True, "vehicle_name": "Q3"})
        client._last_success = time.time() - client._cache_seconds - 1
        client._last_error = "Audi Connect antwortet mit HTTP 401"
        client._last_attempt = time.time() - 10
        client._refresh_from_cloud = AsyncMock()

        result = await client.get_live()

        client._refresh_from_cloud.assert_not_awaited()
        self.assertTrue(result["stale"])
        self.assertGreaterEqual(
            result["retry_after_seconds"], ERROR_RETRY_SECONDS - 11
        )

    async def test_initial_auth_error_also_observes_retry_backoff(self):
        with patch.dict(
            os.environ,
            {"AUDI_REFRESH_TOKEN": "refresh-token"},
            clear=True,
        ):
            client = AudiClient()

        client._last_error = "Audi-Autorisierung wurde abgelehnt"
        client._last_attempt = time.time() - 10
        client._refresh_from_cloud = AsyncMock()

        result = await client.get_live()

        client._refresh_from_cloud.assert_not_awaited()
        self.assertFalse(result["available"])
        self.assertGreaterEqual(
            result["retry_after_seconds"], ERROR_RETRY_SECONDS - 11
        )


if __name__ == "__main__":
    unittest.main()
