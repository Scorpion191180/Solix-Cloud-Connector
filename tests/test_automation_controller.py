import os
import unittest
from unittest.mock import patch

from automation.controller import ChargingAutomation


class FakeAudiClient:
    def __init__(self, connected=True):
        self.connected = connected

    async def get_live(self):
        return {"available": True, "plug_connected": self.connected}


class FakeSolixClient:
    def __init__(self, battery_percent, state=False):
        self.battery_percent = battery_percent
        self.state = state
        self.commands = []

    async def get_live(self):
        return {"battery_percent": self.battery_percent}

    async def get_smartplug_status(self):
        return {
            "available": True,
            "name": "Smart Plug",
            "model": "A17X8",
            "state": self.state,
        }

    async def set_smartplug_power(self, enabled):
        self.commands.append(enabled)
        self.state = enabled
        return {
            "available": True,
            "name": "Smart Plug",
            "model": "A17X8",
            "state": enabled,
        }


class ChargingAutomationTests(unittest.IsolatedAsyncioTestCase):
    def make_controller(self, solix, audi, enabled="true"):
        settings = {
            "AUTOMATION_ENABLED": enabled,
            "AUTOMATION_ON_SOC": "30",
            "AUTOMATION_OFF_SOC": "10",
            "AUTOMATION_INTERVAL_SECONDS": "900",
        }
        env = patch.dict(os.environ, settings, clear=False)
        env.start()
        self.addCleanup(env.stop)
        return ChargingAutomation(solix, audi)

    async def test_evaluation_turns_plug_on(self):
        solix = FakeSolixClient(31, state=False)
        controller = self.make_controller(solix, FakeAudiClient(True))

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [True])
        self.assertEqual(status["last_action"], "turned_on")
        self.assertIs(status["smartplug"]["state"], True)

    async def test_evaluation_turns_plug_off_below_threshold(self):
        solix = FakeSolixClient(9, state=True)
        controller = self.make_controller(solix, FakeAudiClient(True))

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [False])
        self.assertEqual(status["last_action"], "turned_off")

    async def test_evaluation_turns_plug_off_when_cable_is_disconnected(self):
        solix = FakeSolixClient(80, state=True)
        controller = self.make_controller(solix, FakeAudiClient(False))

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [False])
        self.assertEqual(status["reason"], "cable_not_connected")

    async def test_hysteresis_does_not_send_a_command(self):
        solix = FakeSolixClient(20, state=True)
        controller = self.make_controller(solix, FakeAudiClient(True))

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [])
        self.assertEqual(status["reason"], "within_hysteresis_band")

    async def test_disabled_controller_remains_passive(self):
        solix = FakeSolixClient(90, state=False)
        controller = self.make_controller(solix, FakeAudiClient(True), enabled="false")

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [])
        self.assertEqual(status["reason"], "automation_disabled")


if __name__ == "__main__":
    unittest.main()
