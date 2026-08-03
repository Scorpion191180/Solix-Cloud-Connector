from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DashboardSchematicTests(unittest.TestCase):
    def test_schematic_contains_every_energy_component(self) -> None:
        dashboard = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")

        for component_id in (
            "diagramNodePv",
            "diagramNodeSolix",
            "diagramNodeGrid",
            "diagramNodeHome",
            "diagramNodeOther",
            "diagramNodePlug",
            "diagramNodeAudi",
        ):
            self.assertIn(f'id="{component_id}"', dashboard)

        self.assertIn("Energiefluss im Gesamtsystem", dashboard)
        self.assertIn("style.css?v=20260803-4", dashboard)
        self.assertIn("app.js?v=20260803-4", dashboard)

    def test_schematic_is_wired_to_live_values(self) -> None:
        script = (ROOT / "static" / "app.js").read_text(encoding="utf-8")

        for live_value in (
            "battery_discharge_power",
            "system_output_power",
            "smartPlug.power_w",
            "audi.battery_percent",
            "remaining_charging_minutes",
        ):
            self.assertIn(live_value, script)

        self.assertIn('setDiagramLink("diagramLinkAudi", charging)', script)
        self.assertNotIn('getElementById("flowPV")', script)


if __name__ == "__main__":
    unittest.main()
