import time
import unittest
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


if __name__ == "__main__":
    unittest.main()
