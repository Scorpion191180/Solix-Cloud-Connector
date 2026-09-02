import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from animal.state import AnimalStateStore


class AnimalStateStoreTests(unittest.TestCase):
    def test_resources_are_shared_and_actions_persist(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "animals.json"
            with patch("animal.state.time.time", return_value=1_000_000):
                first = AnimalStateStore(path)
                first.action("refill_hay")
                first.add_dropping("Pferd", 1.2, -3.4)

            with patch("animal.state.time.time", return_value=1_000_060):
                second = AnimalStateStore(path)
                state = second.get()

            self.assertEqual(len(state["droppings"]), 1)
            self.assertLess(state["hay_percent"], 100)
            self.assertGreater(state["hay_percent"], 99)

            cleaned = second.action("clean")
            self.assertEqual(cleaned["droppings"], [])

    def test_each_station_drains_and_refills_independently(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "animals.json"
            with patch("animal.state.time.time", return_value=1_000_000):
                store = AnimalStateStore(path)

            with patch("animal.state.time.time", return_value=1_043_200):
                drained = store.get()

            self.assertNotEqual(
                drained["hay_camel_pool"], drained["hay_camel_pergola"]
            )
            untouched = drained["hay_camel_pergola"]
            with patch("animal.state.time.time", return_value=1_043_200):
                refilled = store.action("refill_resource", "hay_camel_pool")
            self.assertEqual(refilled["hay_camel_pool"], 100)
            self.assertEqual(refilled["hay_camel_pergola"], untouched)

    def test_legacy_group_values_migrate_to_both_camel_stations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "animals.json"
            path.write_text(
                '{"hay_camels":37,"water_camels":42,"updated_at":1000000}',
                encoding="utf-8",
            )
            with patch("animal.state.time.time", return_value=1_000_000):
                state = AnimalStateStore(path).get()
            self.assertEqual(state["hay_camel_pool"], 37)
            self.assertEqual(state["hay_camel_pergola"], 37)
            self.assertEqual(state["water_camel_pool"], 42)
            self.assertEqual(state["water_camel_pergola"], 42)

    def test_unknown_action_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnimalStateStore(Path(directory) / "animals.json")
            with self.assertRaises(ValueError):
                store.action("unknown")

    def test_unknown_individual_resource_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnimalStateStore(Path(directory) / "animals.json")
            with self.assertRaises(ValueError):
                store.action("refill_resource", "water_unknown")

    def test_dog_eats_twice_daily_and_barks_hungry_until_refilled(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "animals.json"
            berlin = ZoneInfo("Europe/Berlin")
            before_breakfast = datetime(2026, 9, 2, 6, 59, tzinfo=berlin).timestamp()
            after_breakfast = datetime(2026, 9, 2, 7, 5, tzinfo=berlin).timestamp()
            after_dinner = datetime(2026, 9, 2, 18, 5, tzinfo=berlin).timestamp()
            next_breakfast = datetime(2026, 9, 3, 7, 5, tzinfo=berlin).timestamp()
            with patch("animal.state.time.time", return_value=before_breakfast):
                store = AnimalStateStore(path)
            with patch("animal.state.time.time", return_value=after_breakfast):
                breakfast = store.get()
                repeated = store.get()
            self.assertEqual(breakfast["dog_food"], 55)
            self.assertEqual(repeated["dog_food"], 55)
            self.assertFalse(breakfast["dog_hungry"])
            with patch("animal.state.time.time", return_value=after_dinner):
                dinner = store.get()
            self.assertEqual(dinner["dog_food"], 10)
            with patch("animal.state.time.time", return_value=next_breakfast):
                hungry = store.get()
            self.assertTrue(hungry["dog_hungry"])
            self.assertEqual(hungry["dog_food"], 10)
            with patch("animal.state.time.time", return_value=next_breakfast):
                refilled = store.action("refill_resource", "dog_food")
            self.assertFalse(refilled["dog_hungry"])
            self.assertEqual(refilled["dog_food"], 55)

    def test_motion_has_one_leader_and_fails_over_after_lease(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnimalStateStore(Path(directory) / "animals.json")
            pose = [{"id": "dog", "x": 1, "y": 0, "z": 2, "yaw": 0}]
            with patch("animal.state.time.time", return_value=1_000_000):
                leader = store.update_motion("browser-leader", pose)
                follower = store.update_motion("browser-follower", [])
            self.assertTrue(leader["motion_write_accepted"])
            self.assertFalse(follower["motion_write_accepted"])
            self.assertEqual(follower["motion"]["animals"][0]["id"], "dog")
            with patch("animal.state.time.time", return_value=1_000_007):
                takeover = store.update_motion("browser-follower", pose)
            self.assertTrue(takeover["motion_write_accepted"])


if __name__ == "__main__":
    unittest.main()
