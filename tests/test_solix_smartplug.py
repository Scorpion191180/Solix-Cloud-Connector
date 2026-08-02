import os
import time
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from solix.client import SolixClient


class FakeMqttDevice:
    def __init__(self, result=None):
        self.result = result or {"ac_output_switch": 1}
        self.commands = []

    async def set_ac_output(self, enabled):
        self.commands.append(enabled)
        return self.result


class FakeRefreshApi:
    def __init__(self):
        self.calls = []

    async def update_sites(self):
        self.calls.append("sites")

    async def update_site_details(self):
        self.calls.append("site_details")

    async def update_device_details(self):
        self.calls.append("device_details")

    async def update_device_energy(self):
        self.calls.append("device_energy")


class SolixSmartPlugTests(unittest.IsolatedAsyncioTestCase):
    def make_client(self, devices):
        client = SolixClient()
        client.api = SimpleNamespace(devices=devices)
        client._last_refresh = time.monotonic()
        return client

    async def test_single_smartplug_is_selected_without_exposing_serial(self):
        client = self.make_client(
            {
                "SECRET-SERIAL": {
                    "type": "smartplug",
                    "device_pn": "A17X8",
                    "alias_name": "Wallbox",
                    "mqtt_data": {"ac_output_switch": 0},
                }
            }
        )

        status = await client.get_smartplug_status()

        self.assertEqual(
            status,
            {
                "available": True,
                "name": "Wallbox",
                "model": "A17X8",
                "state": False,
            },
        )
        self.assertNotIn("serial", status)

    async def test_set_power_uses_supported_mqtt_device(self):
        client = self.make_client(
            {
                "SECRET-SERIAL": {
                    "type": "smartplug",
                    "device_pn": "A17X8",
                    "alias_name": "Wallbox",
                    "mqtt_data": {},
                }
            }
        )
        mqtt_device = FakeMqttDevice()

        with patch(
            "anker_solix_api.mqtt_factory.SolixMqttDeviceFactory"
        ) as factory:
            factory.return_value.create_device.return_value = mqtt_device
            status = await client.set_smartplug_power(True)

        self.assertEqual(mqtt_device.commands, [True])
        self.assertIs(status["state"], True)

    async def test_multiple_smartplugs_require_explicit_selection(self):
        client = self.make_client(
            {
                "ONE": {"type": "smartplug", "device_pn": "A17X8"},
                "TWO": {"type": "smartplug", "device_pn": "A17X8"},
            }
        )

        with self.assertRaisesRegex(RuntimeError, "Mehrere Smart Plugs"):
            await client.get_smartplug_status()

    async def test_live_refresh_skips_unused_energy_history(self):
        client = SolixClient()
        client.api = FakeRefreshApi()

        await client.refresh(force=True)

        self.assertEqual(
            client.api.calls,
            ["sites", "site_details", "device_details"],
        )

    async def test_configured_model_selects_solarbank_4(self):
        devices = {
            "SMALL-SECRET": {
                "type": "solarbank",
                "device_pn": "A17C5",
                "battery_soc": "92",
                "battery_capacity": "2688",
                "sub_package_num": 0,
            },
            "MAIN-SECRET": {
                "type": "solarbank",
                "device_pn": "AE103",
                "battery_soc": "18",
                "battery_energy": "2712",
                "battery_capacity": "15072",
                "sub_package_num": 2,
            },
        }
        with patch.dict(
            os.environ,
            {
                "SOLIX_SOLARBANK_PN": "AE103",
                "SOLIX_BATTERY_CAPACITY_WH": "10400",
            },
        ):
            client = self.make_client(devices)
        client._last_refresh_at = datetime.now(timezone.utc)

        result = await client.get_live()

        self.assertEqual(result["solarbank_model"], "AE103")
        self.assertEqual(result["battery_percent"], 18)
        self.assertEqual(result["battery_energy_wh"], 1872)
        self.assertEqual(result["battery_capacity_wh"], 10400)
        self.assertEqual(result["battery_capacity_source"], "configured")
        self.assertEqual(result["solarbank_count"], 2)
        self.assertEqual(result["selection"], "configured_model")
        self.assertNotIn("MAIN-SECRET", str(result))

    async def test_multiple_banks_fallback_to_largest_system(self):
        devices = {
            "SMALL-SECRET": {
                "type": "solarbank",
                "device_pn": "A17C5",
                "battery_soc": "92",
                "battery_capacity": "2688",
                "sub_package_num": 0,
            },
            "MAIN-SECRET": {
                "type": "solarbank",
                "device_pn": "AE103",
                "battery_soc": "18",
                "battery_capacity": "15072",
                "sub_package_num": 2,
            },
        }
        with patch.dict(
            os.environ,
            {"SOLIX_SOLARBANK_PN": "", "SOLIX_SOLARBANK_SN": ""},
        ):
            client = self.make_client(devices)
        client._last_refresh_at = datetime.now(timezone.utc)

        result = await client.get_live()

        self.assertEqual(result["solarbank_model"], "AE103")
        self.assertEqual(result["selection"], "auto_largest_system")


if __name__ == "__main__":
    unittest.main()
