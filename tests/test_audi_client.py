import os
import time
import unittest
from unittest.mock import AsyncMock, patch

from audi.client import AudiClient, MIN_CACHE_SECONDS


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


if __name__ == "__main__":
    unittest.main()
