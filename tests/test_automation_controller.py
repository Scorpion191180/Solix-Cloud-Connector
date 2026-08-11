import os
import tempfile
import unittest
from unittest.mock import patch

from automation.controller import ChargingAutomation


class FakeAudiClient:
    def __init__(
        self,
        connected=True,
        stale=False,
        error=None,
        battery_percent=50,
        at_home=True,
        presence_configured=False,
    ):
        self.connected = connected
        self.stale = stale
        self.error = error
        self.battery_percent = battery_percent
        self.at_home = at_home
        self.presence_configured = presence_configured

    async def get_live(self):
        return {
            "available": True,
            "plug_connected": self.connected,
            "battery_percent": self.battery_percent,
            "presence_configured": self.presence_configured,
            "presence_available": self.at_home is not None,
            "at_home": self.at_home,
            "stale": self.stale,
            "error": self.error,
        }


class FakeSolixClient:
    def __init__(self, battery_percent, state=False, stale=False):
        self.battery_percent = battery_percent
        self.state = state
        self.stale = stale
        self.commands = []

    async def get_live(self):
        return {"battery_percent": self.battery_percent, "stale": self.stale}

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
    def make_controller(self, solix, audi, enabled="true", dry_run="false"):
        settings_dir = tempfile.TemporaryDirectory()
        self.addCleanup(settings_dir.cleanup)
        settings = {
            "AUTOMATION_ENABLED": enabled,
            "AUTOMATION_DRY_RUN": dry_run,
            "AUTOMATION_ON_SOC": "30",
            "AUTOMATION_OFF_SOC": "10",
            "AUTOMATION_INTERVAL_SECONDS": "900",
            "AUTOMATION_SETTINGS_FILE": os.path.join(
                settings_dir.name, "automation-settings.json"
            ),
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

    async def test_evaluation_turns_plug_off_when_audi_is_full(self):
        solix = FakeSolixClient(80, state=True)
        controller = self.make_controller(
            solix, FakeAudiClient(True, battery_percent=100)
        )

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [False])
        self.assertEqual(status["reason"], "audi_fully_charged")
        self.assertEqual(status["audi_battery_percent"], 100)

    async def test_evaluation_turns_plug_off_when_audi_drives_away(self):
        solix = FakeSolixClient(80, state=True)
        controller = self.make_controller(
            solix,
            FakeAudiClient(
                True,
                battery_percent=60,
                at_home=False,
                presence_configured=True,
            ),
        )

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [False])
        self.assertEqual(status["reason"], "audi_away")
        self.assertIs(status["audi_at_home"], False)

    async def test_stale_connected_audi_data_cannot_keep_plug_on(self):
        solix = FakeSolixClient(80, state=True)
        controller = self.make_controller(
            solix,
            FakeAudiClient(
                connected=True,
                stale=True,
                error="Audi Connect antwortet mit HTTP 401",
            ),
        )

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [False])
        self.assertTrue(status["audi_data_stale"])
        self.assertIsNone(status["audi_plug_connected"])
        self.assertEqual(status["reason"], "cable_not_connected")

    async def test_stale_solix_data_cannot_keep_plug_on(self):
        solix = FakeSolixClient(80, state=True, stale=True)
        controller = self.make_controller(solix, FakeAudiClient(True))

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [False])
        self.assertTrue(status["solix_data_stale"])
        self.assertIsNone(status["solix_battery_percent"])
        self.assertEqual(status["reason"], "solix_soc_unknown")

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

    async def test_dry_run_reports_action_without_sending_command(self):
        solix = FakeSolixClient(31, state=False)
        controller = self.make_controller(
            solix, FakeAudiClient(True), dry_run="true"
        )

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [])
        self.assertTrue(status["dry_run"])
        self.assertEqual(status["last_action"], "would_turn_on")
        self.assertIs(status["smartplug"]["state"], False)

    def test_automation_interval_has_one_minute_safety_floor(self):
        with patch.dict(
            os.environ,
            {
                "AUTOMATION_ENABLED": "false",
                "AUTOMATION_INTERVAL_SECONDS": "1",
            },
            clear=False,
        ):
            controller = ChargingAutomation(
                FakeSolixClient(25), FakeAudiClient(True)
            )

        self.assertEqual(controller.status()["interval_seconds"], 60)

    async def test_start_threshold_can_be_changed_to_20_percent(self):
        controller = self.make_controller(
            FakeSolixClient(20, state=False), FakeAudiClient(True)
        )

        status = await controller.set_on_threshold(20)
        evaluated = await controller.evaluate()

        self.assertEqual(status["on_threshold_percent"], 20)
        self.assertEqual(evaluated["last_action"], "turned_on")

    async def test_thresholds_and_transition_events_are_reported(self):
        solix = FakeSolixClient(35, state=False)
        controller = self.make_controller(solix, FakeAudiClient(True))

        await controller.set_thresholds(32, 8)
        status = await controller.evaluate()

        self.assertEqual(status["on_threshold_percent"], 32)
        self.assertEqual(status["off_threshold_percent"], 8)
        self.assertTrue(status["events"])
        self.assertEqual(status["events"][-1]["reason"], "at_or_above_on_threshold")
        self.assertIs(status["events"][-1]["smartplug_state"], True)

    async def test_start_threshold_rejects_values_below_20_percent(self):
        controller = self.make_controller(
            FakeSolixClient(19, state=False), FakeAudiClient(True)
        )

        with self.assertRaises(ValueError):
            await controller.set_on_threshold(19)


if __name__ == "__main__":
    unittest.main()
