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

    def test_motion_position_survives_store_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "animals.json"
            pose = [{
                "id": "dog", "x": -5.125, "y": 0, "z": 6.25,
                "yaw": 1.234, "state": "walking", "target_x": -4.8,
                "target_y": 0, "target_z": -3.2,
            }]
            with patch("animal.state.time.time", return_value=1_000_000):
                AnimalStateStore(path).update_motion("browser-leader", pose)

            restored = AnimalStateStore(path).get()
            dog = next(item for item in restored["motion"]["animals"]
                       if item["id"] == "dog")
            self.assertEqual(dog["x"], -5.125)
            self.assertEqual(dog["z"], 6.25)
            self.assertEqual(dog["yaw"], 1.234)
            self.assertEqual(dog["state"], "walking")

    def test_builder_snapshot_is_shared_validated_and_persistent(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "animals.json"
            draft = [{
                "id": "wall-one",
                "type": "wall",
                "variant": "wall-custom-standard",
                "color": "#f1eee5",
                "level": 0,
                "x": 1.25,
                "z": -2.5,
                "rotation": 90,
                "length": 4,
                # Abgeleitete Renderdaten dürfen nicht auf dem Server landen.
                "roofExtensions": [{"height": 99}],
            }, {
                "id": "path-one",
                "type": "path",
                "variant": "path-road-sidewalk",
                "color": "#60656a",
                "level": 0,
                "x": -3.0,
                "z": 4.5,
                "rotation": 0,
                "width": 6.8,
                "depth": 4.0,
            }, {
                "id": "bad-type",
                "type": "spaceship",
                "variant": "unknown",
                "x": 0,
                "z": 0,
                "rotation": 0,
            }]
            with patch("animal.state.time.time", return_value=1_000_000):
                first = AnimalStateStore(path)
                saved = first.update_builder(draft)
                unchanged = first.update_builder(draft)

            self.assertEqual(saved["revision"], 1)
            self.assertEqual(unchanged["revision"], 1)
            self.assertEqual(len(saved["items"]), 2)
            self.assertNotIn("roofExtensions", saved["items"][0])

            with patch("animal.state.time.time", return_value=1_000_000):
                restored = AnimalStateStore(path)
                shared = restored.get_builder()
                animal = restored.get()
            self.assertEqual(shared["items"][0]["id"], "wall-one")
            self.assertEqual(shared["items"][0]["rotation"], 90)
            self.assertEqual(shared["items"][1]["id"], "path-one")
            self.assertEqual(shared["items"][1]["type"], "path")
            # Bauänderungen beeinflussen den getrennten Hundezustand nicht.
            self.assertEqual(animal["dog_food"], 55)


if __name__ == "__main__":
    unittest.main()
