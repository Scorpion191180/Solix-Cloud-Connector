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
        self.assertIn("style.css?v=20260803-5", dashboard)
        self.assertIn("house.js?v=20260803-5", dashboard)
        self.assertIn("app.js?v=20260803-5", dashboard)

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

    def test_virtual_house_is_touch_enabled_and_uses_live_data(self) -> None:
        dashboard = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "static" / "house.js").read_text(encoding="utf-8")
        stylesheet = (ROOT / "static" / "style.css").read_text(encoding="utf-8")

        self.assertIn('id="houseCanvas"', dashboard)
        self.assertIn('id="houseReset"', dashboard)
        self.assertIn('addEventListener("pointermove"', script)
        self.assertIn('addEventListener("solix-dashboard-data"', script)
        self.assertIn('label: "AUDI Q3"', script)
        self.assertNotIn('label: "SMART PLUG"', script)
        self.assertNotIn('label: "HAUSGERÄTE"', script)
        self.assertIn("touch-action:pan-y", stylesheet)
        self.assertIn(".energy-diagram", stylesheet)
        self.assertIn("min-width:0", stylesheet)
        self.assertIn(".container:not(.technical-open) .technical-panel", stylesheet)


if __name__ == "__main__":
    unittest.main()
