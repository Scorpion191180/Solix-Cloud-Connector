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


class ExportControllerTests(unittest.IsolatedAsyncioTestCase):
    def make_controller(self, solix, enabled="true", dry_run="false"):
        settings = {
            "SOLAR_EXPORT_AUTOMATION_ENABLED": enabled,
            "SOLAR_EXPORT_AUTOMATION_DRY_RUN": dry_run,
            "SOLAR_EXPORT_START_SOC": "98",
            "SOLAR_EXPORT_STOP_SOC": "95",
            "SOLAR_EXPORT_POWER_W": "450",
            "SOLAR_EXPORT_START_PV_W": "450",
            "SOLAR_EXPORT_STOP_PV_W": "250",
            "SOLAR_EXPORT_INTERVAL_SECONDS": "900",
        }
        env = patch.dict(os.environ, settings, clear=False)
        env.start()
        self.addCleanup(env.stop)
        return SolarExportAutomation(solix)

    async def test_evaluation_starts_and_later_stops_output(self):
        solix = FakeSolixClient()
        controller = self.make_controller(solix)

        started = await controller.evaluate()
        solix.soc = 95
        stopped = await controller.evaluate()

        self.assertEqual(solix.commands, [450, 0])
        self.assertEqual(started["last_action"], "set_450_w")
        self.assertEqual(stopped["last_action"], "set_0_w")

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
