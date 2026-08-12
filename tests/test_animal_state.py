import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

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

    def test_unknown_action_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnimalStateStore(Path(directory) / "animals.json")
            with self.assertRaises(ValueError):
                store.action("unknown")


if __name__ == "__main__":
    unittest.main()
