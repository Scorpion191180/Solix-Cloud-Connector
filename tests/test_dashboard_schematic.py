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
        self.assertIn("style.css?v=20260803-8", dashboard)
        self.assertIn("house.js?v=20260803-8", dashboard)
        self.assertIn("app.js?v=20260803-8", dashboard)
        self.assertIn('type="module" src="/static/house.js', dashboard)
        self.assertIn("three@0.185.1", dashboard)

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
        self.assertIn('addEventListener("wheel"', script)
        self.assertIn("pointerDistance", script)
        self.assertIn('addEventListener("solix-dashboard-data"', script)
        self.assertIn('label: "AUDI Q3"', script)
        self.assertIn("WebGLRenderer", script)
        self.assertIn("MeshPhysicalMaterial", script)
        self.assertIn("shadowMap.enabled", script)
        self.assertNotIn('label: "SMART PLUG"', script)
        self.assertNotIn('label: "HAUSGERÄTE"', script)
        self.assertIn('solix["pv" + number]', script)
        self.assertIn('createFlow(panel.id', script)
        self.assertIn('className = "house-string-label"', script)
        self.assertIn('createDoor(house, [3.285, 3.58, 4.10]', script)
        self.assertIn('createDoor(house, [3.285, 3.58, 1.45]', script)
        self.assertIn('createDoor(house, [3.285, 3.58, -4.06]', script)
        self.assertIn('createDoor(house, [3.30, 1.35, -3.48]', script)
        self.assertIn('createDoor(house, [-3.285, 1.34, -2.72]', script)
        self.assertIn('createDoor(house, [-3.285, 3.58, -3.62]', script)
        self.assertIn("function createJulietGuard", script)
        self.assertIn("function createWoodDoorWithCanopy", script)
        self.assertIn('createWoodDoorWithCanopy(house, [-3.285, 1.34, 1.22])', script)
        self.assertIn("pool.rotation.y = -Math.PI / 3", script)
        self.assertIn("pool.position.set(-7.55, 0, -6.20)", script)
        self.assertIn("[-11.70, 0.39, z]", script)
        self.assertIn("[-3.85, 0.25, -10.65]", script)
        self.assertNotIn("const hedge =", script)
        self.assertIn("createTree(0.35, -8.65, 0.94)", script)
        self.assertNotIn("createTree(1.10, -8.55, 0.72)", script)
        self.assertIn("[3.2, 0.07, 13.2]", script)
        self.assertIn("group.position.set(6.05, 0, -5.20)", script)
        self.assertIn("new THREE.Vector3(6.05, 1.65, -5.20)", script)
        self.assertIn("[3.76, 3.70, -6.57]", script)
        self.assertIn("const HOUSE_LENGTH = 12.8", script)
        self.assertIn("function createBayWindow", script)
        self.assertNotIn("const shed = new THREE.Group()", script)
        self.assertIn("touch-action:none", stylesheet)
        self.assertIn(".house-string-label", stylesheet)
        self.assertIn(".energy-diagram", stylesheet)
        self.assertIn("min-width:0", stylesheet)
        self.assertIn(".container:not(.technical-open) .technical-panel", stylesheet)


if __name__ == "__main__":
    unittest.main()
