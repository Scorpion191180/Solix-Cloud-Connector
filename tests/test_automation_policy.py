import unittest

from automation.policy import decide_smartplug_state


class AutomationPolicyTests(unittest.TestCase):
    def test_turns_on_at_selected_threshold_with_connected_cable(self):
        decision = decide_smartplug_state(
            enabled=True,
            cable_connected=True,
            battery_percent=20,
            current_state=False,
            on_threshold=20,
        )
        self.assertIs(decision.desired_state, True)
        self.assertEqual(decision.reason, "at_or_above_on_threshold")

    def test_just_below_selected_threshold_holds_current_state(self):
        decision = decide_smartplug_state(
            enabled=True,
            cable_connected=True,
            battery_percent=19,
            current_state=False,
            on_threshold=20,
        )
        self.assertIsNone(decision.desired_state)
        self.assertEqual(decision.reason, "within_hysteresis_band")

    def test_turns_off_only_below_10(self):
        decision = decide_smartplug_state(
            enabled=True,
            cable_connected=True,
            battery_percent=9,
            current_state=True,
        )
        self.assertIs(decision.desired_state, False)
        self.assertEqual(decision.reason, "below_off_threshold")

    def test_exactly_10_holds_current_state(self):
        decision = decide_smartplug_state(
            enabled=True,
            cable_connected=True,
            battery_percent=10,
            current_state=True,
        )
        self.assertIsNone(decision.desired_state)

    def test_hysteresis_keeps_state_between_thresholds(self):
        decision = decide_smartplug_state(
            enabled=True,
            cable_connected=True,
            battery_percent=20,
            current_state=True,
        )
        self.assertIsNone(decision.desired_state)

    def test_disconnected_cable_forces_off(self):
        decision = decide_smartplug_state(
            enabled=True,
            cable_connected=False,
            battery_percent=80,
            current_state=True,
        )
        self.assertIs(decision.desired_state, False)
        self.assertEqual(decision.reason, "cable_not_connected")

    def test_full_audi_battery_forces_off(self):
        decision = decide_smartplug_state(
            enabled=True,
            cable_connected=True,
            battery_percent=80,
            audi_battery_percent=100,
            current_state=True,
        )
        self.assertIs(decision.desired_state, False)
        self.assertEqual(decision.reason, "audi_fully_charged")

    def test_audi_away_forces_off_even_with_cached_connected_cable(self):
        decision = decide_smartplug_state(
            enabled=True,
            cable_connected=True,
            battery_percent=80,
            audi_battery_percent=55,
            audi_at_home=False,
            home_presence_configured=True,
            current_state=True,
        )
        self.assertIs(decision.desired_state, False)
        self.assertEqual(decision.reason, "audi_away")

    def test_unknown_location_forces_off_when_home_presence_is_configured(self):
        decision = decide_smartplug_state(
            enabled=True,
            cable_connected=True,
            battery_percent=80,
            audi_battery_percent=55,
            audi_at_home=None,
            home_presence_configured=True,
            current_state=True,
        )
        self.assertIs(decision.desired_state, False)
        self.assertEqual(decision.reason, "audi_location_unknown")

    def test_unknown_cable_never_turns_on(self):
        decision = decide_smartplug_state(
            enabled=True,
            cable_connected=None,
            battery_percent=80,
            current_state=None,
        )
        self.assertIs(decision.desired_state, False)

    def test_unknown_soc_forces_off(self):
        decision = decide_smartplug_state(
            enabled=True,
            cable_connected=True,
            battery_percent=None,
            current_state=True,
        )
        self.assertIs(decision.desired_state, False)
        self.assertEqual(decision.reason, "solix_soc_unknown")

    def test_disabled_automation_never_commands(self):
        decision = decide_smartplug_state(
            enabled=False,
            cable_connected=True,
            battery_percent=90,
            current_state=False,
        )
        self.assertIsNone(decision.desired_state)
        self.assertEqual(decision.reason, "automation_disabled")


if __name__ == "__main__":
    unittest.main()
