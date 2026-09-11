import unittest

from export_automation.policy import decide_export_output


class ExportPolicyTests(unittest.TestCase):
    def test_starts_with_current_pv_when_soc_reaches_98(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=98,
            pv_power_w=200,
            current_output_w=0,
        )

        self.assertEqual(decision.target_w, 200)
        self.assertEqual(decision.reason, "export_cycle_started")
        self.assertTrue(decision.cycle_active)

    def test_caps_output_at_450_w(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=100,
            pv_power_w=700,
            current_output_w=0,
        )

        self.assertEqual(decision.target_w, 450)

    def test_full_bank_releases_450_w_when_pv_is_curtailed(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=100,
            pv_power_w=0,
            current_output_w=0,
        )

        self.assertEqual(decision.target_w, 450)
        self.assertEqual(decision.reason, "full_bank_export_released")
        self.assertTrue(decision.cycle_active)

    def test_connected_audi_with_charge_demand_has_priority(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=100,
            pv_power_w=0,
            current_output_w=450,
            audi_charge_priority=True,
            cycle_active=True,
        )

        self.assertEqual(decision.target_w, 0)
        self.assertEqual(decision.reason, "audi_charging_has_priority")
        self.assertFalse(decision.cycle_active)

    def test_disconnected_audi_does_not_block_export(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=100,
            pv_power_w=200,
            current_output_w=0,
            audi_charge_priority=False,
        )

        self.assertEqual(decision.target_w, 200)

    def test_waits_below_98_even_when_pv_is_available(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=97,
            pv_power_w=450,
            current_output_w=0,
        )

        self.assertIsNone(decision.target_w)
        self.assertFalse(decision.cycle_active)
        self.assertEqual(decision.reason, "waiting_for_start_soc")

    def test_stops_when_soc_reaches_lower_hysteresis_limit(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=90,
            pv_power_w=700,
            current_output_w=450,
            cycle_active=True,
        )

        self.assertEqual(decision.target_w, 0)
        self.assertEqual(decision.reason, "battery_at_or_below_stop_soc")
        self.assertFalse(decision.cycle_active)

    def test_active_cycle_follows_lower_pv_instead_of_stopping(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=96,
            pv_power_w=200,
            current_output_w=450,
            cycle_active=True,
        )

        self.assertEqual(decision.target_w, 200)
        self.assertEqual(decision.reason, "pv_output_adjusted")

    def test_active_cycle_survives_zero_pv_until_stop_soc(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=97,
            pv_power_w=0,
            current_output_w=200,
            cycle_active=True,
        )

        self.assertEqual(decision.target_w, 0)
        self.assertTrue(decision.cycle_active)

        resumed = decide_export_output(
            enabled=True,
            battery_percent=96,
            pv_power_w=120,
            current_output_w=0,
            cycle_active=decision.cycle_active,
        )
        self.assertEqual(resumed.target_w, 120)

    def test_unknown_telemetry_only_stops_an_active_output(self):
        active = decide_export_output(
            enabled=True,
            battery_percent=None,
            pv_power_w=None,
            current_output_w=450,
            cycle_active=True,
        )
        inactive = decide_export_output(
            enabled=True,
            battery_percent=None,
            pv_power_w=None,
            current_output_w=0,
        )

        self.assertEqual(active.target_w, 0)
        self.assertIsNone(inactive.target_w)

    def test_disabled_automation_never_changes_output(self):
        decision = decide_export_output(
            enabled=False,
            battery_percent=100,
            pv_power_w=1000,
            current_output_w=0,
        )

        self.assertIsNone(decision.target_w)
        self.assertEqual(decision.reason, "automation_disabled")
        self.assertFalse(decision.cycle_active)


if __name__ == "__main__":
    unittest.main()
