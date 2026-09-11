import unittest

from export_automation.policy import decide_export_output


class ExportPolicyTests(unittest.TestCase):
    def test_starts_450_w_only_when_soc_and_pv_are_high_enough(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=98,
            pv_power_w=450,
            current_output_w=0,
        )

        self.assertEqual(decision.target_w, 450)
        self.assertEqual(decision.reason, "battery_nearly_full_and_pv_available")

    def test_does_not_start_at_night_even_with_full_battery(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=100,
            pv_power_w=0,
            current_output_w=0,
        )

        self.assertIsNone(decision.target_w)
        self.assertEqual(decision.reason, "waiting_for_start_conditions")

    def test_stops_when_soc_reaches_lower_hysteresis_limit(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=95,
            pv_power_w=700,
            current_output_w=450,
        )

        self.assertEqual(decision.target_w, 0)
        self.assertEqual(decision.reason, "battery_at_or_below_stop_soc")

    def test_stops_when_pv_falls_below_lower_hysteresis_limit(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=99,
            pv_power_w=249,
            current_output_w=450,
        )

        self.assertEqual(decision.target_w, 0)
        self.assertEqual(decision.reason, "pv_below_stop_threshold")

    def test_holds_active_output_inside_hysteresis_band(self):
        decision = decide_export_output(
            enabled=True,
            battery_percent=97,
            pv_power_w=350,
            current_output_w=450,
        )

        self.assertIsNone(decision.target_w)
        self.assertEqual(decision.reason, "within_hysteresis_band")

    def test_unknown_telemetry_only_stops_an_active_output(self):
        active = decide_export_output(
            enabled=True,
            battery_percent=None,
            pv_power_w=None,
            current_output_w=450,
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


if __name__ == "__main__":
    unittest.main()
