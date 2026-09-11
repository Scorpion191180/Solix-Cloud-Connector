import time
import unittest

from solix.client import SolixClient


class FakeOutputApi:
    def __init__(self, device):
        self.devices = {"SECRET-SERIAL": device}
        self.sites = {"SECRET-SITE": {"energy_offset_tz": 0}}
        self.calls = []

    async def set_sb2_home_load(self, **kwargs):
        self.calls.append(kwargs)
        power = kwargs["preset"]
        self.devices["SECRET-SERIAL"]["schedule"] = {
            "mode_type": 3,
            "default_home_load": power,
            "custom_rate_plan": [
                {
                    "index": 0,
                    "week": list(range(7)),
                    "ranges": [
                        {"start_time": "00:00", "end_time": "24:00", "power": power}
                    ],
                }
            ],
        }
        return True


class SolixOutputTests(unittest.IsolatedAsyncioTestCase):
    def make_client(self, model="AE103"):
        device = {
            "type": "solarbank",
            "device_pn": model,
            "site_id": "SECRET-SITE",
            "is_admin": True,
            "schedule": {
                "mode_type": 3,
                "default_home_load": 0,
                "custom_rate_plan": None,
            },
        }
        client = SolixClient()
        client.api = FakeOutputApi(device)
        client._last_refresh = time.monotonic()
        return client

    async def test_set_output_uses_manual_schedule_without_exposing_ids(self):
        client = self.make_client()

        result = await client.set_solarbank_output_power(450)

        self.assertEqual(
            client.api.calls,
            [
                {
                    "siteId": "SECRET-SITE",
                    "deviceSn": "SECRET-SERIAL",
                    "preset": 450,
                    "usage_mode": 3,
                    "plan_name": "custom_rate_plan",
                }
            ],
        )
        self.assertEqual(result["manual_output_preset_w"], 450)
        self.assertNotIn("site_id", result)
        self.assertNotIn("serial", result)

    async def test_output_is_hard_limited_to_450_w(self):
        client = self.make_client()

        with self.assertRaisesRegex(ValueError, "0 und 450"):
            await client.set_solarbank_output_power(451)

        self.assertEqual(client.api.calls, [])

    async def test_wrong_model_is_never_written(self):
        client = self.make_client(model="A17C5")

        with self.assertRaisesRegex(RuntimeError, "AE103"):
            await client.set_solarbank_output_power(450)

        self.assertEqual(client.api.calls, [])


if __name__ == "__main__":
    unittest.main()
