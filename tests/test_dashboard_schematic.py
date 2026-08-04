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
        self.assertIn("style.css?v=20260804-20", dashboard)
        self.assertIn("house.js?v=20260804-20", dashboard)
        self.assertIn("app.js?v=20260804-20", dashboard)
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
        self.assertIn('createWindow(house, [3.285, 3.66, 0.18]', script)
        self.assertIn('createDoor(house, [3.285, 3.58, -4.06]', script)
        self.assertIn('createFrontWoodDoor(house, [3.30, 1.35, -3.15]', script)
        self.assertIn('createDoor(house, [3.30, 1.35, -4.30]', script)
        self.assertIn('createDoor(house, [-3.30, 1.34, -3.55]', script)
        self.assertIn('createDoor(house, [-3.285, 3.58, -3.62]', script)
        self.assertIn("function createJulietGuard", script)
        self.assertIn("function createWoodDoorWithCanopy", script)
        self.assertIn("function createFrontWoodDoor", script)
        self.assertIn('createWoodDoorWithCanopy(house, [-3.30, 1.34, 1.80])', script)
        self.assertIn("Gartenfassade aus IMG_7397", script)
        self.assertIn("[0.16, 4.90, 2.45]", script)
        self.assertIn("[5.22, 1.02]", script)
        self.assertIn('createWindow(house, [-3.30, 1.48, 5.08]', script)
        self.assertIn("pool.rotation.y = -Math.PI / 3", script)
        self.assertIn("pool.position.set(-7.55, 0, -6.20)", script)
        self.assertIn("[-11.70, 0.39, z]", script)
        self.assertIn("[-3.85, 0.25, -10.65]", script)
        self.assertNotIn("const hedge =", script)
        self.assertIn("createTree(0.35, -8.65, 0.94)", script)
        self.assertNotIn("createTree(1.10, -8.55, 0.72)", script)
        self.assertIn("[10.05, 0.07, 6.1]", script)
        self.assertIn("[3.2, 0.07, 13.2]", script)
        self.assertIn("yetiSlot.position.set(0, 0.02, 8.72)", script)
        self.assertIn("foxSlot.position.set(2.10, 0.02, 8.45)", script)
        self.assertIn("group.position.set(6.05, 0, -5.20)", script)
        self.assertIn('grid: flowLabelAnchor("grid", 0.30', script)
        self.assertIn("function createCableCurve", script)
        self.assertIn("new THREE.CatmullRomCurve3", script)
        self.assertIn("const pvRoutes = [", script)
        self.assertIn("panel.anchor.copy(flows[panel.id].curve.getPointAt", script)
        self.assertIn('"--string-label-angle"', script)
        self.assertIn("[6.05, 0.16, -3.55]", script)
        self.assertIn("[4.46, 0.18, 0.18]", script)
        self.assertIn("RoomEnvironment", script)
        self.assertIn("THREE.VSMShadowMap", script)
        self.assertIn("Feine Ziegelreihen, Traufen und Fallrohre", script)
        self.assertIn("const skylightFrame", script)
        self.assertIn("function createRoofTiles", script)
        self.assertIn("new THREE.InstancedMesh(tileGeometry", script)
        self.assertIn("function makeSkyTexture", script)
        self.assertIn("function createGrassDetail", script)
        self.assertIn("windowReflection", script)
        self.assertIn("[-1.62, -2.72, 0.58, 0.76, slope]", script)
        self.assertIn("[1.58, 4.48, 0.68, 0.86, -slope]", script)
        self.assertIn("[4.90, 0.42, -0.55, -2.12, -5.46]", script)
        self.assertIn("[3.88, 2.84, set.z]", script)
        self.assertIn("[3.96, 2.36, panelZ]", script)
        self.assertIn("{ z: 3.00, length: 6.65", script)
        self.assertIn('createCar(0x008dc8, "audi-q3")', script)
        self.assertIn('createCar(0x1b2329, "skoda-yeti")', script)
        self.assertIn('createCar(0x202327, "vw-fox")', script)
        self.assertIn("function createCarBodyShell", script)
        self.assertIn("function createDetailedWheel", script)
        self.assertIn("GLTFLoader", script)
        self.assertIn("MeshoptDecoder", script)
        self.assertIn("/static/models/audi-q3.glb", script)
        self.assertIn("/static/models/skoda-yeti.glb", script)
        self.assertIn("/static/models/vw-fox.glb", script)
        self.assertIn("function loadDetailedVehicles", script)
        self.assertIn("orientation: { x: -Math.PI }", script)
        self.assertIn("length: 3.95", script)
        self.assertIn("length: 3.38", script)
        self.assertIn("vehicle-credits", dashboard)
        self.assertIn('stage.classList.add("is-interacting")', script)
        self.assertIn('state.pointerMode === "pan"', script)
        self.assertIn('addEventListener("contextmenu"', script)
        self.assertIn("state.targetPitch", script)
        self.assertIn("state.targetPanX", script)
        self.assertIn("height:100svh", stylesheet)
        self.assertIn(".container > header", stylesheet)
        self.assertIn("[3.76, 3.70, -6.57]", script)
        self.assertIn("[-1.92, 0, 1.40]", script)
        self.assertIn("const HOUSE_LENGTH = 12.8", script)
        self.assertIn("function createBayWindow", script)
        self.assertNotIn("const shed = new THREE.Group()", script)
        self.assertIn("touch-action:none", stylesheet)
        self.assertIn(".house-string-label", stylesheet)
        self.assertIn("background:transparent", stylesheet)
        self.assertIn(".energy-diagram", stylesheet)
        self.assertIn("min-width:0", stylesheet)
        self.assertIn(".container:not(.technical-open) .technical-panel", stylesheet)

    def test_vehicle_assets_are_web_optimized_and_attributed(self) -> None:
        dashboard = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
        attributions = (ROOT / "static" / "models" / "ATTRIBUTIONS.md").read_text(encoding="utf-8")

        for filename in ("audi-q3.glb", "skoda-yeti.glb", "vw-fox.glb"):
            asset = ROOT / "static" / "models" / filename
            self.assertTrue(asset.exists())
            self.assertLess(asset.stat().st_size, 2_000_000)

        self.assertIn("2023 Audi Q3 40 TFSI", dashboard)
        self.assertIn("Ddiaz Design", dashboard)
        self.assertIn("CC BY-NC-SA 4.0", attributions)


if __name__ == "__main__":
    unittest.main()
