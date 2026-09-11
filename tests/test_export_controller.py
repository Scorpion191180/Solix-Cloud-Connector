import os
import unittest
from unittest.mock import patch

from export_automation.controller import SolarExportAutomation


class FakeSolixClient:
    def __init__(self, soc=98, pv=600, output=0, stale=False):
        self.soc = soc
        self.pv = pv
        self.output = output
        self.stale = stale
        self.commands = []

    async def get_live(self):
        return {
            "battery_percent": self.soc,
            "pv_total": self.pv,
            "manual_output_preset_w": self.output,
            "stale": self.stale,
        }

    async def set_solarbank_output_power(self, power_w):
        self.commands.append(power_w)
        self.output = power_w
        return {
            "model": "AE103",
            "manual_output_preset_w": power_w,
            "output_mode": 3,
        }


class FakeAudiClient:
    def __init__(self, battery=100, plugged=True, available=True, stale=False):
        self.battery = battery
        self.plugged = plugged
        self.available = available
        self.stale = stale

    async def get_live(self):
        return {
            "available": self.available,
            "battery_percent": self.battery,
            "plug_connected": self.plugged,
            "stale": self.stale,
        }


class ExportControllerTests(unittest.IsolatedAsyncioTestCase):
    def make_controller(self, solix, enabled="true", dry_run="false", audi=None):
        settings = {
            "SOLAR_EXPORT_AUTOMATION_ENABLED": enabled,
            "SOLAR_EXPORT_AUTOMATION_DRY_RUN": dry_run,
            "SOLAR_EXPORT_START_SOC": "98",
            "SOLAR_EXPORT_STOP_SOC": "90",
            "SOLAR_EXPORT_POWER_W": "450",
            "SOLAR_EXPORT_INTERVAL_SECONDS": "900",
        }
        env = patch.dict(os.environ, settings, clear=False)
        env.start()
        self.addCleanup(env.stop)
        return SolarExportAutomation(solix, audi)

    async def test_evaluation_starts_and_later_stops_output(self):
        solix = FakeSolixClient()
        controller = self.make_controller(solix)

        started = await controller.evaluate()
        solix.pv = 200
        adjusted = await controller.evaluate()
        solix.soc = 90
        stopped = await controller.evaluate()

        self.assertEqual(solix.commands, [450, 200, 0])
        self.assertEqual(started["last_action"], "set_450_w")
        self.assertEqual(adjusted["last_action"], "set_200_w")
        self.assertEqual(stopped["last_action"], "set_0_w")

    async def test_cycle_resumes_after_zero_pv_without_returning_to_98(self):
        solix = FakeSolixClient(soc=98, pv=200, output=0)
        controller = self.make_controller(solix)

        await controller.evaluate()
        solix.soc = 96
        solix.pv = 0
        await controller.evaluate()
        solix.pv = 125
        status = await controller.evaluate()

        self.assertEqual(solix.commands, [200, 0, 125])
        self.assertTrue(status["cycle_active"])

    async def test_full_bank_releases_output_when_pv_is_hidden(self):
        solix = FakeSolixClient(soc=100, pv=0, output=0)
        audi = FakeAudiClient(battery=100, plugged=True)
        controller = self.make_controller(solix, audi=audi)

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [450])
        self.assertEqual(status["reason"], "full_bank_export_released")
        self.assertFalse(status["audi_charge_priority"])

    async def test_connected_non_full_audi_blocks_export(self):
        solix = FakeSolixClient(soc=100, pv=0, output=450)
        audi = FakeAudiClient(battery=75, plugged=True)
        controller = self.make_controller(solix, audi=audi)

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [0])
        self.assertEqual(status["reason"], "audi_charging_has_priority")
        self.assertTrue(status["audi_charge_priority"])

    async def test_disconnected_non_full_audi_allows_export(self):
        solix = FakeSolixClient(soc=100, pv=0, output=0)
        audi = FakeAudiClient(battery=75, plugged=False)
        controller = self.make_controller(solix, audi=audi)

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [450])
        self.assertFalse(status["audi_charge_priority"])

    async def test_restart_recovers_nonzero_active_output_and_stops_at_90(self):
        solix = FakeSolixClient(soc=90, pv=300, output=200)
        controller = self.make_controller(solix)

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [0])
        self.assertFalse(status["cycle_active"])
        self.assertEqual(status["reason"], "battery_at_or_below_stop_soc")

    async def test_dry_run_reports_without_writing(self):
        solix = FakeSolixClient()
        controller = self.make_controller(solix, dry_run="true")

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [])
        self.assertEqual(status["last_action"], "would_set_450_w")
        self.assertTrue(status["dry_run"])

    async def test_stale_data_requests_zero_after_active_output(self):
        solix = FakeSolixClient(output=450)
        controller = self.make_controller(solix)
        await controller.evaluate()
        solix.stale = True

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [0])
        self.assertEqual(status["reason"], "solix_telemetry_unknown")

    async def test_disabled_controller_does_not_write(self):
        solix = FakeSolixClient()
        controller = self.make_controller(solix, enabled="false")

        status = await controller.evaluate()

        self.assertEqual(solix.commands, [])
        self.assertEqual(status["reason"], "automation_disabled")


if __name__ == "__main__":
    unittest.main()
