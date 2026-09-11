import time
import unittest

from solix.client import SolixClient


class FakeOutputApi:
    def __init__(self, device):
        self.devices = {"SECRET-SERIAL": device}
        self.sites = {"SECRET-SITE": {"energy_offset_tz": 0}}
        self.calls = []
        self.grid_calls = []
        self.grid_settings = {
            "feeder_0w": 0,
            "feed_times": None,
            "feed_switch": 0,
            "cached_power": 0,
            "feed_upper_limit": 4294967295,
        }

    async def get_device_parm(self, **kwargs):
        self.grid_calls.append(("get", kwargs))
        return {"param_data": dict(self.grid_settings)}

    async def set_device_parm(self, **kwargs):
        self.grid_calls.append(("set", kwargs))
        self.grid_settings.update(kwargs["paramData"])
        return {}

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
        self.assertEqual(
            [call[0] for call in client.api.grid_calls],
            ["get", "set", "get", "set", "get"],
        )
        switch_call = client.api.grid_calls[1][1]
        limit_call = client.api.grid_calls[3][1]
        self.assertEqual(switch_call["paramType"], "28")
        self.assertEqual(limit_call["paramType"], "28")
        self.assertEqual(
            switch_call["paramData"], {"feed_switch": 1}
        )
        self.assertEqual(limit_call["paramData"], {"cached_power": 450})
        self.assertEqual(result["manual_output_preset_w"], 450)
        self.assertEqual(result["grid_output_limit_w"], 450)
        self.assertTrue(result["grid_export_enabled"])
        self.assertNotIn("site_id", result)
        self.assertNotIn("serial", result)

    async def test_output_is_hard_limited_to_450_w(self):
        client = self.make_client()

        with self.assertRaisesRegex(ValueError, "0 und 450"):
            await client.set_solarbank_output_power(451)

        self.assertEqual(client.api.calls, [])
        self.assertEqual(client.api.grid_calls, [])

    async def test_wrong_model_is_never_written(self):
        client = self.make_client(model="A17C5")

        with self.assertRaisesRegex(RuntimeError, "AE103"):
            await client.set_solarbank_output_power(450)

        self.assertEqual(client.api.calls, [])
        self.assertEqual(client.api.grid_calls, [])

    async def test_existing_grid_limit_is_verified_without_rewriting(self):
        client = self.make_client()
        client.api.grid_settings.update({"feed_switch": 1, "cached_power": 450})

        await client.set_solarbank_output_power(200)

        self.assertEqual(
            [call[0] for call in client.api.grid_calls],
            ["get"],
        )

    async def test_output_is_not_changed_when_grid_limit_verification_fails(self):
        client = self.make_client()

        async def ignored_write(**kwargs):
            client.api.grid_calls.append(("set", kwargs))
            return {}

        client.api.set_device_parm = ignored_write

        with self.assertRaisesRegex(RuntimeError, "nicht korrekt übernommen"):
            await client.set_solarbank_output_power(450)

        self.assertEqual(client.api.calls, [])


if __name__ == "__main__":
    unittest.main()
