import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const canvas = document.getElementById("houseCanvas");
const stage = document.getElementById("houseStage");

if (!canvas || !stage)
    throw new Error("3D-Hausansicht konnte nicht initialisiert werden");

const inspectorIcon = document.getElementById("houseInspectorIcon");
const inspectorLabel = document.getElementById("houseInspectorLabel");
const inspectorValue = document.getElementById("houseInspectorValue");
const inspectorDetail = document.getElementById("houseInspectorDetail");
const liveBadge = document.getElementById("houseLiveBadge");
const resetButton = document.getElementById("houseReset");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
    selected: "battery",
    data: window.solixDashboardState || { solix: {}, automation: {}, audi: {} },
    pointers: new Map(),
    pointerStartX: 0,
    lastPointerX: 0,
    pointerMoved: false,
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    yaw: 0.78,
    targetYaw: 0.78,
    zoom: 1,
    targetZoom: 1,
    lastTime: 0
};

const colors = {
    pv: "#facc15",
    battery: "#38bdf8",
    grid: "#a78bfa",
    audi: "#22c55e",
    inactive: "#64748b"
};

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x9dbbd1, 0.019);

const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
camera.position.set(14.8, 10.6, 18.5);
const cameraTarget = new THREE.Vector3(0, 2.1, 0);
const cameraBaseOffset = camera.position.clone().sub(cameraTarget);
camera.lookAt(cameraTarget);

let renderer;
try {
    renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance"
    });
}
catch (error) {
    liveBadge.textContent = "3D ist auf diesem Gerät nicht verfügbar";
    throw error;
}

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const world = new THREE.Group();
world.rotation.y = state.yaw;
scene.add(world);

function numberValue(value) {
    if (value == null || typeof value === "boolean")
        return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function formatPower(watts) {
    const value = numberValue(watts);
    if (value == null)
        return "--";
    if (Math.abs(value) >= 1000)
        return (value / 1000).toLocaleString("de-DE", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 2
        }) + " kW";
    return Math.round(value).toLocaleString("de-DE") + " W";
}

function seededNoise(seed) {
    let value = seed % 2147483647;
    return () => {
        value = value * 16807 % 2147483647;
        return (value - 1) / 2147483646;
    };
}

function makeTexture(background, ink, mode, repeatX, repeatY) {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 128;
    textureCanvas.height = 128;
    const context = textureCanvas.getContext("2d");
    const random = seededNoise(background.length * 173 + mode.length * 29);
    context.fillStyle = background;
    context.fillRect(0, 0, 128, 128);
    context.strokeStyle = ink;
    context.fillStyle = ink;

    if (mode === "stucco") {
        context.globalAlpha = 0.18;
        for (let index = 0; index < 520; index += 1) {
            const x = random() * 128;
            const y = random() * 128;
            context.fillRect(x, y, 0.7 + random() * 1.5, 0.45);
        }
    }
    else if (mode === "tiles") {
        context.lineWidth = 2;
        context.globalAlpha = 0.42;
        for (let y = 0; y < 128; y += 16) {
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(128, y);
            context.stroke();
            for (let x = (y / 16 % 2) * 8; x < 128; x += 16) {
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(x, y + 16);
                context.stroke();
            }
        }
    }
    else if (mode === "shingles") {
        context.lineWidth = 1;
        context.globalAlpha = 0.5;
        for (let y = 0; y < 128; y += 12) {
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(128, y);
            context.stroke();
            for (let x = (y / 12 % 2) * 10; x < 128; x += 20) {
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(x, y + 12);
                context.stroke();
            }
        }
    }
    else if (mode === "grass") {
        context.globalAlpha = 0.33;
        for (let index = 0; index < 650; index += 1)
            context.fillRect(random() * 128, random() * 128, 1, 1 + random() * 2);
    }
    else if (mode === "pavers") {
        context.globalAlpha = 0.34;
        context.lineWidth = 1;
        for (let y = 0; y < 128; y += 18) {
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(128, y);
            context.stroke();
            for (let x = (y / 18 % 2) * 16; x < 128; x += 32) {
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(x, y + 18);
                context.stroke();
            }
        }
    }

    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
}

const textures = {
    wall: makeTexture("#e9e4d8", "#8d887e", "stucco", 5, 8),
    roof: makeTexture("#a33e2c", "#4d1d18", "tiles", 5, 14),
    shingle: makeTexture("#4a332b", "#190f0d", "shingles", 5, 9),
    grass: makeTexture("#496b38", "#9eb36a", "grass", 8, 12),
    paving: makeTexture("#777a79", "#363a3a", "pavers", 8, 12)
};

const materials = {
    wall: new THREE.MeshStandardMaterial({ map: textures.wall, roughness: 0.96 }),
    roof: new THREE.MeshStandardMaterial({ map: textures.roof, roughness: 0.84 }),
    shingle: new THREE.MeshStandardMaterial({ map: textures.shingle, roughness: 0.92 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x8d1922, roughness: 0.68 }),
    darkTrim: new THREE.MeshStandardMaterial({ color: 0x3b302f, roughness: 0.8 }),
    glass: new THREE.MeshPhysicalMaterial({
        color: 0x7997ad,
        roughness: 0.12,
        metalness: 0.12,
        transmission: 0.22,
        transparent: true,
        opacity: 0.78,
        clearcoat: 0.65
    }),
    garageRed: new THREE.MeshStandardMaterial({ color: 0xb5141d, roughness: 0.55 }),
    grass: new THREE.MeshStandardMaterial({ map: textures.grass, roughness: 1 }),
    paving: new THREE.MeshStandardMaterial({ map: textures.paving, roughness: 0.96 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x57352a, roughness: 0.9 }),
    solar: new THREE.MeshPhysicalMaterial({
        color: 0x091c31,
        metalness: 0.52,
        roughness: 0.18,
        clearcoat: 0.9,
        clearcoatRoughness: 0.12
    }),
    water: new THREE.MeshPhysicalMaterial({
        color: 0x20b8df,
        metalness: 0.03,
        roughness: 0.08,
        transmission: 0.32,
        transparent: true,
        opacity: 0.84,
        clearcoat: 1
    })
};

function addMesh(parent, geometry, material, x, y, z, options = {}) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.castShadow = options.castShadow !== false;
    object.receiveShadow = options.receiveShadow !== false;
    if (options.rotation)
        object.rotation.set(...options.rotation);
    parent.add(object);
    return object;
}

function addBox(parent, size, material, position, options = {}) {
    const radius = options.radius || 0;
    const geometry = radius > 0 ?
        new RoundedBoxGeometry(size[0], size[1], size[2], 3, radius) :
        new THREE.BoxGeometry(...size);
    return addMesh(parent, geometry, material, ...position, options);
}

function createWindow(parent, position, size, side = "front") {
    const group = new THREE.Group();
    group.position.set(...position);
    if (side === "side")
        group.rotation.y = Math.PI / 2;
    else if (side === "side-back")
        group.rotation.y = -Math.PI / 2;
    else if (side === "back")
        group.rotation.y = Math.PI;
    parent.add(group);

    addBox(group, [size[0] + 0.16, size[1] + 0.16, 0.11], materials.darkTrim, [0, 0, 0]);
    addBox(group, [size[0], size[1], 0.125], materials.glass, [0, 0, 0.015], { castShadow: false });
    addBox(group, [0.055, size[1], 0.145], materials.darkTrim, [0, 0, 0.04]);
    addBox(group, [size[0], 0.055, 0.145], materials.darkTrim, [0, 0, 0.04]);
    addBox(group, [size[0] + 0.26, 0.10, 0.20], materials.darkTrim, [0, -size[1] / 2 - 0.10, 0.02]);
    return group;
}

function createDoor(parent, position, size = [0.82, 1.96], side = "front") {
    const group = new THREE.Group();
    group.position.set(...position);
    if (side === "side")
        group.rotation.y = Math.PI / 2;
    else if (side === "side-back")
        group.rotation.y = -Math.PI / 2;
    else if (side === "back")
        group.rotation.y = Math.PI;
    parent.add(group);

    addBox(group, [size[0] + 0.18, size[1] + 0.14, 0.13], materials.darkTrim, [0, 0, 0]);
    addBox(group, [size[0], size[1], 0.145], materials.glass, [0, 0, 0.025], { castShadow: false });
    addBox(group, [size[0] * 0.08, size[1], 0.16], materials.darkTrim, [0, 0, 0.05]);
    addBox(group, [size[0], 0.075, 0.16], materials.darkTrim, [0, size[1] * 0.10, 0.05]);
    const handle = new THREE.MeshStandardMaterial({ color: 0xb9c1c5, metalness: 0.82, roughness: 0.26 });
    addMesh(group, new THREE.SphereGeometry(0.035, 10, 8), handle, size[0] * 0.34, -0.13, 0.12, { castShadow: false });
    return group;
}

// 20 × 10 m aus den Gebäudemaßen, im Modell auf 12.8 × 6.4 Einheiten skaliert.
const HOUSE_WIDTH = 6.4;
const HOUSE_LENGTH = 12.8;
const GABLE_Z = HOUSE_LENGTH / 2 + 0.08;

function createRoof(parent) {
    const slope = Math.atan2(2.15, 3.55);
    const roofLength = Math.hypot(3.55, 2.15);
    addBox(parent, [roofLength, 0.20, HOUSE_LENGTH + 0.8], materials.roof, [-1.76, 5.88, 0], {
        rotation: [0, 0, slope]
    });
    addBox(parent, [roofLength, 0.20, HOUSE_LENGTH + 0.8], materials.roof, [1.76, 5.88, 0], {
        rotation: [0, 0, -slope]
    });
    addBox(parent, [0.22, 0.22, HOUSE_LENGTH + 0.9], materials.darkTrim, [0, 7.02, 0], { radius: 0.04 });
    [-3.30, 3.30].forEach((x) => {
        addBox(parent, [0.16, 0.24, HOUSE_LENGTH + 0.75], materials.trim, [x, 4.94, 0]);
        addBox(parent, [0.10, 0.18, HOUSE_LENGTH + 0.78], materials.darkTrim, [x + Math.sign(x) * 0.10, 4.88, 0]);
    });

    const chimneyMaterial = new THREE.MeshStandardMaterial({
        color: 0xaeb6b8,
        metalness: 0.42,
        roughness: 0.52
    });
    const chimneyPositions = [
        { x: 1.10, z: -2.75 },
        { x: 1.24, z: 2.72 },
        { x: -1.16, z: 0.45 }
    ];
    chimneyPositions.forEach(({ x, z }, index) => {
        const roofSurface = 7.02 - Math.abs(x) * (2.15 / 3.55);
        const chimneyHeight = index === 1 ? 1.86 : 1.72;
        addBox(parent, [0.52, chimneyHeight, 0.68], chimneyMaterial,
            [x, roofSurface + chimneyHeight * 0.42, z]);
        addBox(parent, [0.66, 0.10, 0.82], materials.darkTrim,
            [x, roofSurface + chimneyHeight * 0.92, z]);
    });
}

function createGarageDoors(parent) {
    const doorWidth = 1.72;
    [-2.08, 0, 2.08].forEach((x) => {
        addBox(parent, [doorWidth + 0.18, 2.46, 0.12], new THREE.MeshStandardMaterial({ color: 0xc3a65e, roughness: 0.76 }), [x, 1.45, GABLE_Z - 0.105]);
        const door = addBox(parent, [doorWidth, 2.26, 0.15], materials.garageRed, [x, 1.42, GABLE_Z], { radius: 0.035 });
        for (let row = -4; row <= 4; row += 1)
            addBox(door, [doorWidth * 0.95, 0.018, 0.025], materials.darkTrim, [0, row * 0.205, 0.085], { castShadow: false });
        addBox(door, [doorWidth * 0.88, 0.58, 0.035], materials.glass, [0, 0.61, 0.09], { castShadow: false });
        [-0.44, 0, 0.44].forEach((offset) =>
            addBox(door, [0.028, 0.58, 0.04], materials.garageRed, [offset, 0.61, 0.115], { castShadow: false }));
    });
}

function createGable(parent) {
    addBox(parent, [6.45, 2.45, 0.18], materials.shingle, [0, 3.72, GABLE_Z - 0.10]);
    const shape = new THREE.Shape();
    shape.moveTo(-3.22, 0);
    shape.lineTo(0, 2.15);
    shape.lineTo(3.22, 0);
    shape.lineTo(-3.22, 0);
    const geometry = new THREE.ShapeGeometry(shape);
    const triangle = addMesh(parent, geometry, materials.shingle, 0, 4.93, GABLE_Z);
    triangle.castShadow = true;

    [-2.18, -0.73, 0.73, 2.18].forEach((x) =>
        createWindow(parent, [x, 3.92, GABLE_Z + 0.12], [0.56, 0.78]));
    [-1.15, 1.15].forEach((x) =>
        createWindow(parent, [x, 5.20, GABLE_Z + 0.12], [0.58, 0.84]));
    addBox(parent, [0.48, 0.25, 0.12], materials.darkTrim, [0, 6.36, GABLE_Z + 0.12]);

    const rearGeometry = new THREE.ShapeGeometry(shape);
    const rearTriangle = addMesh(parent, rearGeometry, materials.wall, 0, 4.93, -GABLE_Z, {
        rotation: [0, Math.PI, 0]
    });
    rearTriangle.castShadow = true;
    createWindow(parent, [-1.05, 5.25, -GABLE_Z - 0.12], [0.58, 0.82], "back");
    createWindow(parent, [1.05, 5.25, -GABLE_Z - 0.12], [0.58, 0.82], "back");
}

const PV_PANEL_Z = [2.42, 4.42, -2.85, -1.45];

function createBalconyPanels(parent) {
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x49332f, roughness: 0.8 });
    const sets = [
        { z: 3.52, length: 5.62, panelZ: PV_PANEL_Z.slice(0, 2) },
        { z: -2.15, length: 3.58, panelZ: PV_PANEL_Z.slice(2) }
    ];
    sets.forEach((set) => {
        addBox(parent, [0.82, 0.12, set.length], materials.darkTrim, [3.52, 2.08, set.z]);
        addBox(parent, [0.14, 0.14, set.length - 0.16], railMaterial, [3.45, 2.82, set.z]);
        for (let offset = -set.length / 2 + 0.20; offset <= set.length / 2 - 0.20; offset += 0.72)
            addBox(parent, [0.08, 1.05, 0.08], railMaterial, [3.45, 2.35, set.z + offset]);
        set.panelZ.forEach((panelZ) => {
            const panel = addBox(parent, [0.10, 1.12, 1.16], materials.solar,
                [3.57, 2.36, panelZ], { radius: 0.025 });
            panel.rotation.z = -0.16;
            for (let row = -1; row <= 1; row += 1)
                addBox(panel, [0.018, 0.012, 1.05], new THREE.MeshStandardMaterial({ color: 0x6688a2 }), [0.058, row * 0.31, 0], { castShadow: false });
        });
    });
}

function createBayWindow(parent) {
    const bay = new THREE.Group();
    parent.add(bay);
    const cornerAngle = Math.PI * 0.695;

    // Der Erker läuft sichtbar um die Hausecke: Seitenfläche, breite Schräge und Rückfläche.
    addBox(bay, [0.68, 2.34, 1.18], materials.wall, [3.49, 3.64, -5.45]);
    addBox(bay, [1.10, 2.34, 0.44], materials.wall, [3.51, 3.64, -6.39], {
        rotation: [0, cornerAngle, 0]
    });
    addBox(bay, [1.28, 2.34, 0.68], materials.wall, [2.62, 3.64, -6.49]);

    addBox(bay, [0.74, 0.14, 1.24], materials.darkTrim, [3.50, 4.84, -5.45]);
    addBox(bay, [1.16, 0.14, 0.50], materials.darkTrim, [3.51, 4.84, -6.39], {
        rotation: [0, cornerAngle, 0]
    });
    addBox(bay, [1.34, 0.14, 0.74], materials.darkTrim, [2.62, 4.84, -6.50]);

    createWindow(bay, [3.85, 3.70, -5.45], [0.72, 1.40], "side");
    const cornerWindow = createWindow(bay, [3.76, 3.70, -6.57], [0.80, 1.40]);
    cornerWindow.rotation.y = cornerAngle;
    createWindow(bay, [2.62, 3.70, -6.85], [0.72, 1.40], "back");
}

function createJulietGuard(parent, z) {
    const rail = new THREE.MeshStandardMaterial({ color: 0x747d82, metalness: 0.72, roughness: 0.30 });
    addBox(parent, [0.07, 0.82, 1.30], materials.glass, [-3.57, 3.02, z], {
        castShadow: false
    });
    addBox(parent, [0.10, 0.08, 1.46], rail, [-3.60, 3.45, z]);
    [-0.68, 0.68].forEach((offset) =>
        addBox(parent, [0.10, 0.92, 0.10], rail, [-3.60, 3.00, z + offset]));
}

function createWoodDoorWithCanopy(parent, position) {
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.y = -Math.PI / 2;
    parent.add(group);

    const wood = new THREE.MeshStandardMaterial({ color: 0x5b3424, roughness: 0.86 });
    const canopyWood = new THREE.MeshStandardMaterial({ color: 0x3f2a20, roughness: 0.90 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9c1c5, metalness: 0.82, roughness: 0.26 });
    addBox(group, [1.02, 2.12, 0.13], materials.darkTrim, [0, 0, 0]);
    const door = addBox(group, [0.84, 1.96, 0.15], wood, [0, -0.02, 0.025]);
    [-0.66, -0.30, 0.08, 0.46].forEach((y) =>
        addBox(door, [0.76, 0.035, 0.025], canopyWood, [0, y, 0.09], { castShadow: false }));
    addBox(group, [0.48, 0.42, 0.17], materials.glass, [0, 0.55, 0.05], { castShadow: false });
    addMesh(group, new THREE.SphereGeometry(0.04, 10, 8), metal, 0.31, -0.12, 0.13, { castShadow: false });

    const canopy = addBox(group, [1.42, 0.14, 0.92], canopyWood, [0, 1.28, 0.37]);
    canopy.rotation.x = -0.16;
    [-0.56, 0.56].forEach((x) =>
        addBox(group, [0.09, 0.72, 0.09], canopyWood, [x, 0.96, 0.56]));
}

function createHouse() {
    const house = new THREE.Group();
    world.add(house);

    addBox(house, [HOUSE_WIDTH, 4.9, HOUSE_LENGTH], materials.wall, [0, 2.50, 0]);
    addBox(house, [HOUSE_WIDTH + 0.15, 0.62, HOUSE_LENGTH + 0.12], new THREE.MeshStandardMaterial({ color: 0x89755d, roughness: 0.94 }), [0, 0.31, 0]);
    createRoof(house);
    createGarageDoors(house);
    createGable(house);

    // Lange Balkonfassade aus IMG_7376/7377: Fenstergruppen und je eine Balkontür.
    [5.30, 3.20, 1.00, -0.55, -5.25].forEach((z) =>
        createWindow(house, [3.275, 1.48, z], [0.74, 1.16], "side"));
    createWindow(house, [3.285, 3.66, 5.45], [1.24, 1.10], "side");
    createDoor(house, [3.285, 3.58, 4.10], [0.78, 1.86], "side");
    createWindow(house, [3.285, 3.66, 2.72], [1.24, 1.10], "side");
    createDoor(house, [3.285, 3.58, 1.45], [0.78, 1.86], "side");
    createWindow(house, [3.285, 3.66, -1.42], [0.72, 1.10], "side");
    createDoor(house, [3.285, 3.58, -2.70], [0.78, 1.86], "side");
    createDoor(house, [3.285, 3.58, -4.06], [0.78, 1.86], "side");
    createDoor(house, [3.30, 1.35, -3.48], [0.80, 1.92], "side");
    createBayWindow(house);

    // Gartenfassade aus IMG_7380/7381: unregelmäßige, tatsächlich sichtbare Öffnungen.
    [5.22, 3.82, 2.42, 0.96, -0.62, -2.12, -5.02].forEach((z) =>
        createWindow(house, [-3.275, 3.70, z], [z === 3.82 ? 0.92 : 0.72, 1.08], "side-back"));
    createDoor(house, [-3.285, 3.58, -3.62], [1.18, 1.86], "side-back");
    createJulietGuard(house, -3.62);
    [5.12, 3.25, -0.35].forEach((z) =>
        createWindow(house, [-3.275, 1.46, z], [0.78, 1.14], "side-back"));
    createWoodDoorWithCanopy(house, [-3.285, 1.34, 1.22]);
    createDoor(house, [-3.285, 1.34, -2.72], [0.82, 1.92], "side-back");
    createWindow(house, [-3.275, 1.50, -4.78], [0.62, 0.92], "side-back");

    // Weiße Heckenseite: zwei Fensterreihen; laut Foto gibt es hier keine Tür.
    [-1.92, 0, 1.92].forEach((x) =>
        createWindow(house, [x, 3.68, -GABLE_Z - 0.02], [0.72, 1.08], "back"));
    [-1.90, -0.15].forEach((x) =>
        createWindow(house, [x, 1.46, -GABLE_Z - 0.02], [0.78, 1.14], "back"));
    createWindow(house, [1.66, 1.46, -GABLE_Z - 0.02], [0.78, 1.14], "back");

    createBalconyPanels(house);
    return house;
}

function createSolarBank() {
    const bank = new THREE.Group();
    bank.position.set(3.75, 2.08, -3.18);
    world.add(bank);
    const body = new THREE.MeshStandardMaterial({ color: 0x263a45, metalness: 0.38, roughness: 0.38 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x0c1820, roughness: 0.5 });
    for (let level = 0; level < 3; level += 1) {
        addBox(bank, [0.62, 0.58, 0.72], edge, [0, 0.42 + level * 0.58, 0], { radius: 0.10 });
        addBox(bank, [0.55, 0.48, 0.64], body, [0.04, 0.43 + level * 0.58, 0], { radius: 0.08 });
    }
    const light = new THREE.MeshStandardMaterial({ color: 0x5eead4, emissive: 0x2dd4bf, emissiveIntensity: 4 });
    addMesh(bank, new THREE.SphereGeometry(0.045, 12, 8), light, 0.36, 1.47, 0.22, { castShadow: false });
    return bank;
}

function createCar(color, detailed = false) {
    const car = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.72,
        roughness: 0.20,
        clearcoat: 1,
        clearcoatRoughness: 0.1
    });
    const black = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.42 });
    const rim = new THREE.MeshStandardMaterial({ color: 0x85909a, metalness: 0.86, roughness: 0.25 });
    addBox(car, [1.72, 0.48, 3.25], paint, [0, 0.54, 0], { radius: 0.18 });
    addBox(car, [1.48, 0.56, 1.74], materials.glass, [0, 0.94, -0.16], { radius: 0.16, castShadow: false });
    addBox(car, [1.30, 0.13, 1.50], paint, [0, 1.22, -0.18], { radius: 0.06 });

    [[-0.82, -0.98], [0.82, -0.98], [-0.82, 0.98], [0.82, 0.98]].forEach(([x, z]) => {
        const wheel = addMesh(car, new THREE.CylinderGeometry(0.31, 0.31, 0.18, 24), black, x, 0.38, z, { rotation: [0, 0, Math.PI / 2] });
        addMesh(wheel, new THREE.CylinderGeometry(0.15, 0.15, 0.185, 16), rim, 0, 0, 0, { rotation: [0, 0, 0], castShadow: false });
    });

    const front = new THREE.MeshStandardMaterial({ color: 0xcdf3ff, emissive: 0xa8def7, emissiveIntensity: 1.8 });
    const rear = new THREE.MeshStandardMaterial({ color: 0xff263c, emissive: 0xb00016, emissiveIntensity: 1.2 });
    [-0.55, 0.55].forEach((x) => {
        addBox(car, [0.38, 0.10, 0.05], front, [x, 0.67, 1.64], { radius: 0.025, castShadow: false });
        addBox(car, [0.38, 0.11, 0.05], rear, [x, 0.67, -1.64], { radius: 0.025, castShadow: false });
    });

    if (detailed) {
        addBox(car, [1.05, 0.26, 0.05], black, [0, 0.49, 1.65], { radius: 0.08 });
        [-0.34, -0.11, 0.11, 0.34].forEach((x) =>
            addMesh(car, new THREE.TorusGeometry(0.105, 0.018, 8, 18), rim, x, 0.60, 1.69, { rotation: [Math.PI / 2, 0, 0], castShadow: false }));
        [-0.67, 0.67].forEach((x) =>
            addBox(car, [0.18, 0.12, 0.28], paint, [x, 1.03, 0.48], { radius: 0.05 }));
        [-0.56, 0.56].forEach((x) =>
            addBox(car, [0.045, 0.08, 1.65], rim, [x, 1.38, -0.18], { radius: 0.015 }));
        addBox(car, [1.20, 0.10, 0.34], paint, [0, 1.28, -1.48], { radius: 0.045 });
        addBox(car, [0.48, 0.12, 0.045], new THREE.MeshStandardMaterial({ color: 0xe7e7df, roughness: 0.52 }), [0, 0.50, -1.68], { radius: 0.018, castShadow: false });
    }
    return car;
}

function createVehicles() {
    const audi = createCar(0x008dc8, true);
    audi.scale.set(1.10, 1.17, 1.08);
    audi.position.set(5.00, 0.02, 1.0);
    audi.rotation.y = Math.PI;
    world.add(audi);

    // IMG_7378: schwarzer Skoda Yeti mittig, kleiner schwarzer VW Fox ganz rechts.
    const skodaYeti = createCar(0x11151a);
    skodaYeti.scale.set(1.04, 1.16, 1.08);
    skodaYeti.position.set(0, 0.02, 7.72);
    world.add(skodaYeti);

    const vwFox = createCar(0x15171b);
    vwFox.scale.set(0.82, 0.88, 0.80);
    vwFox.position.set(2.10, 0.02, 7.48);
    vwFox.rotation.y = -0.05;
    world.add(vwFox);
    return audi;
}

function createTree(x, z, scale = 1) {
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);
    tree.scale.setScalar(scale);
    world.add(tree);
    const trunk = new THREE.MeshStandardMaterial({ color: 0x583728, roughness: 1 });
    const needles = [0x1d4e33, 0x235b39, 0x17432c].map((color) =>
        new THREE.MeshStandardMaterial({ color, roughness: 0.98 }));
    addMesh(tree, new THREE.CylinderGeometry(0.22, 0.34, 3.4, 10), trunk, 0, 1.7, 0);
    [1.8, 2.55, 3.35, 4.05].forEach((y, index) =>
        addMesh(tree, new THREE.ConeGeometry(1.55 - index * 0.19, 2.3, 11), needles[index % needles.length], 0, y, 0));
}

function createGarden() {
    addBox(world, [23.0, 0.25, 22.8], materials.grass, [-1.50, -0.14, -0.55], { castShadow: false });
    addBox(world, [7.3, 0.06, 5.3], materials.paving, [0, 0.02, 7.3], { castShadow: false });
    addBox(world, [3.2, 0.07, 13.2], materials.paving, [4.80, 0.03, 0.20], { castShadow: false });

    const road = new THREE.MeshStandardMaterial({ color: 0x54595d, roughness: 1 });
    addBox(world, [15.8, 0.12, 2.3], road, [0, -0.02, 10.6], { castShadow: false });

    const pool = new THREE.Group();
    pool.position.set(-7.55, 0, -6.20);
    pool.rotation.y = -Math.PI / 3;
    world.add(pool);
    const poolWall = new THREE.MeshStandardMaterial({ color: 0x374552, metalness: 0.22, roughness: 0.68 });
    addBox(pool, [3.20, 1.02, 5.00], poolWall, [0, 0.50, 0], { radius: 0.12 });
    addBox(pool, [2.84, 0.12, 4.64], materials.water, [0, 1.03, 0], { radius: 0.12, castShadow: false });
    const poolRail = new THREE.MeshStandardMaterial({ color: 0xd7d9d5, roughness: 0.50 });
    [-1.52, 1.52].forEach((x) => addBox(pool, [0.08, 0.08, 4.86], poolRail, [x, 1.08, 0]));
    [-2.42, 2.42].forEach((z) => addBox(pool, [3.04, 0.08, 0.08], poolRail, [0, 1.08, z]));

    // Die große Fichte steht laut Fotoreihe auf der gegenüberliegenden Gartenseite.
    createTree(0.35, -8.65, 0.94);

    // Vor Garage und Autos bleibt die Einfahrt offen; hinten und an der Pool-Längsseite steht Holzzaun.
    const fence = new THREE.MeshStandardMaterial({ color: 0x6a5848, roughness: 1 });
    for (let x = -11.70; x <= 4.0; x += 0.70)
        addBox(world, [0.10, 0.82, 0.10], fence, [x, 0.39, -10.65]);
    addBox(world, [15.70, 0.10, 0.10], fence, [-3.85, 0.25, -10.65]);
    addBox(world, [15.70, 0.10, 0.10], fence, [-3.85, 0.64, -10.65]);
    for (let z = -10.0; z <= 9.0; z += 0.70)
        addBox(world, [0.10, 0.82, 0.10], fence, [-11.70, 0.39, z]);
    addBox(world, [0.10, 0.10, 19.2], fence, [-11.70, 0.25, -0.50]);
    addBox(world, [0.10, 0.10, 19.2], fence, [-11.70, 0.64, -0.50]);
}

function createGridBox() {
    const group = new THREE.Group();
    group.position.set(6.05, 0, -5.20);
    world.add(group);
    const casing = new THREE.MeshStandardMaterial({ color: 0xd9d9d1, roughness: 0.72 });
    addBox(group, [0.58, 1.05, 0.42], casing, [0, 0.55, 0], { radius: 0.05 });
    addBox(group, [0.44, 0.33, 0.025], materials.glass, [0, 0.69, 0.225], { castShadow: false });
    return group;
}

createGarden();
createHouse();
createSolarBank();
const audiModel = createVehicles();
createGridBox();

const hemisphere = new THREE.HemisphereLight(0xd8efff, 0x314129, 2.25);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xfff0d2, 4.7);
sun.position.set(-9, 15, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 45;
sun.shadow.bias = -0.00025;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x84b8ff, 1.15);
fill.position.set(10, 8, -12);
scene.add(fill);

const flows = {};

function createFlow(id, points, color) {
    const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), false, "catmullrom", 0.08);
    const tubeMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.20,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, 0.035, 8, false), tubeMaterial);
    world.add(tube);
    const pulseMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const pulses = [];
    for (let index = 0; index < 4; index += 1) {
        const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 8), pulseMaterial.clone());
        pulse.userData.offset = index / 4;
        world.add(pulse);
        pulses.push(pulse);
    }
    flows[id] = { curve, tube, pulses, active: false, reverse: false };
}

const pvPanelAnchors = PV_PANEL_Z.map((z, index) => ({
    id: "pv" + (index + 1),
    anchor: new THREE.Vector3(3.72, 2.74, z),
    z,
    laneY: 2.10 + index * 0.09
}));
pvPanelAnchors.forEach((panel) => {
    createFlow(panel.id, [
        [3.64, 2.42, panel.z],
        [3.82, 2.42, panel.z],
        [3.84, panel.laneY, -3.08],
        [3.76, 2.72, -3.18]
    ], colors.pv);
});
createFlow("grid", [
    [6.05, 0.25, -5.20], [5.70, 0.12, -5.20], [4.45, 0.12, -5.20],
    [4.00, 0.12, -4.30], [3.82, 0.16, -3.18], [3.76, 2.72, -3.18]
], colors.grid);
createFlow("audi", [
    [3.76, 2.72, -3.18], [3.94, 2.40, -3.18], [3.94, 0.22, -3.18],
    [4.52, 0.22, -0.45], [5.00, 0.52, 0.25]
], colors.audi);

const labelAnchors = {
    pv: new THREE.Vector3(3.78, 3.34, 1.0),
    battery: new THREE.Vector3(3.78, 4.12, -3.18),
    grid: new THREE.Vector3(6.05, 1.65, -5.20),
    audi: new THREE.Vector3(5.00, 1.80, 1.0)
};

const labelElements = {};
["pv", "battery", "grid", "audi"].forEach((id) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "house-scene-label";
    button.dataset.component = id;
    button.addEventListener("click", () => {
        state.selected = id;
        updateLiveUi();
    });
    stage.appendChild(button);
    labelElements[id] = button;
});

const pvStringElements = {};
pvPanelAnchors.forEach((panel, index) => {
    const label = document.createElement("span");
    label.className = "house-string-label";
    label.dataset.string = panel.id;
    label.textContent = "PV" + (index + 1) + " --";
    stage.appendChild(label);
    pvStringElements[panel.id] = label;
});

function componentData() {
    const solix = state.data.solix || {};
    const automation = state.data.automation || {};
    const audi = state.data.audi || {};
    const smartPlug = automation.smartplug || {};
    const pv = numberValue(solix.pv_total);
    const pvStrings = [1, 2, 3, 4].map((number) => numberValue(solix["pv" + number]));
    const batterySoc = numberValue(solix.battery_percent) ?? numberValue(automation.solix_battery_percent);
    const batteryCharge = numberValue(solix.battery_charge_power) ?? 0;
    const batteryDischarge = numberValue(solix.battery_discharge_power) ??
        Math.max(0, -(numberValue(solix.battery_power) ?? 0));
    const output = numberValue(solix.system_output_power) ?? numberValue(solix.home_load);
    const grid = numberValue(solix.grid_power);
    const plugPower = numberValue(smartPlug.power_w);
    const audiPowerKw = numberValue(audi.charging_power_kw);
    const audiPower = plugPower ?? (audiPowerKw == null ? null : audiPowerKw * 1000);
    const charging = plugPower != null ? plugPower >= 20 : audi.charging === true;

    return {
        pv: {
            id: "pv", label: "BALKON-PV", icon: "☀️", value: formatPower(pv), color: colors.pv,
            detail: pvStrings.map((value, index) => "PV" + (index + 1) + " " + formatPower(value)).join(" · "),
            active: pv != null && pv >= 5
        },
        battery: {
            id: "battery", label: "SOLARBANK 4", icon: "🔋", color: colors.battery,
            value: batterySoc == null ? "--" : Math.round(batterySoc) + " %",
            detail: "PV-Eingang " + formatPower(pv) + " · " + (
                batteryCharge >= 5 ? "Akku lädt mit " + formatPower(batteryCharge) + "." :
                    batteryDischarge >= 5 ? "Akku liefert " + formatPower(batteryDischarge) + "." :
                        "Akku ist im Bereitschaftsmodus."
            ),
            active: batteryCharge >= 5 || batteryDischarge >= 5
        },
        grid: {
            id: "grid", label: "STROMNETZ", icon: "🌐", color: colors.grid,
            value: formatPower(grid == null ? null : Math.abs(grid)),
            detail: grid == null ? "Netzwert nicht verfügbar." :
                grid > 5 ? "Aktueller Netzbezug." :
                    grid < -5 ? "Aktuelle Netzeinspeisung." : "Aktuell kein Netzfluss.",
            active: grid != null && Math.abs(grid) >= 5
        },
        audi: {
            id: "audi", label: "AUDI Q3", icon: "🚙", color: colors.audi,
            value: audi.battery_percent == null ? "--" : audi.battery_percent + " %",
            detail: charging ? "Der blaue Q3 lädt mit " + formatPower(audiPower) + "." :
                audi.plug_connected === true ? "Ladestecker verbunden · wartet." :
                    audi.plug_connected === false ? "Ladestecker ist getrennt." : "Audi-Status wird geprüft.",
            active: charging
        },
        raw: { pv, pvStrings, batterySoc, batteryCharge, batteryDischarge, output, grid, audiPower, charging }
    };
}

function setFlowState(flow, active, reverse = false) {
    flow.active = active;
    flow.reverse = reverse;
    flow.tube.material.opacity = active ? 0.72 : 0.14;
    flow.pulses.forEach((pulse) => {
        pulse.material.opacity = active ? 1 : 0;
        pulse.visible = active;
    });
}

function updateLiveUi() {
    const components = componentData();
    const raw = components.raw;
    raw.pvStrings.forEach((power, index) => {
        const id = "pv" + (index + 1);
        setFlowState(flows[id], power != null && power >= 5);
        const label = pvStringElements[id];
        label.textContent = "PV" + (index + 1) + " " + formatPower(power);
        label.classList.toggle("active", power != null && power >= 5);
    });
    setFlowState(flows.grid, raw.grid != null && Math.abs(raw.grid) >= 5, raw.grid < 0);
    setFlowState(flows.audi, raw.charging && raw.output != null && raw.output >= 5);

    ["pv", "battery", "grid", "audi"].forEach((id) => {
        const component = components[id];
        const element = labelElements[id];
        element.innerHTML = `<small>${component.icon} ${component.label}</small><strong>${component.value}</strong>`;
        element.classList.toggle("active", component.active);
        element.classList.toggle("selected", state.selected === id);
        element.style.setProperty("--scene-color", component.color);
        element.setAttribute("aria-label", component.label + ": " + component.value);
    });

    const selected = components[state.selected] || components.battery;
    inspectorIcon.textContent = selected.icon;
    inspectorLabel.textContent = selected.label;
    inspectorValue.textContent = selected.value;
    inspectorDetail.textContent = selected.detail;
    liveBadge.textContent = components.battery.value === "--" ?
        "Live wird verbunden" : "LIVE · Solix " + components.battery.value;
}

function updateLabelPositions() {
    const rect = stage.getBoundingClientRect();
    const rootPosition = new THREE.Vector3();
    world.getWorldPosition(rootPosition);
    Object.entries(labelAnchors).forEach(([id, localAnchor]) => {
        const anchor = world.localToWorld(localAnchor.clone());
        const cameraSpace = anchor.clone().applyMatrix4(camera.matrixWorldInverse);
        const projected = anchor.project(camera);
        const x = THREE.MathUtils.clamp(
            (projected.x * 0.5 + 0.5) * rect.width,
            rect.width < 520 ? 34 : 44,
            rect.width - (rect.width < 520 ? 34 : 44)
        );
        const y = THREE.MathUtils.clamp(
            (-projected.y * 0.5 + 0.5) * rect.height,
            28,
            rect.height - 48
        );
        const element = labelElements[id];
        element.style.left = x + "px";
        element.style.top = y + "px";
        element.classList.toggle("behind", cameraSpace.z > rootPosition.z);
        element.style.setProperty("--scene-label-scale", THREE.MathUtils.clamp(0.36 + state.zoom * 0.24, 0.56, 1.04));
    });

    pvPanelAnchors.forEach((panel) => {
        const anchor = world.localToWorld(panel.anchor.clone());
        const cameraSpace = anchor.clone().applyMatrix4(camera.matrixWorldInverse);
        const projected = anchor.project(camera);
        const x = THREE.MathUtils.clamp((projected.x * 0.5 + 0.5) * rect.width, 30, rect.width - 30);
        const y = THREE.MathUtils.clamp((-projected.y * 0.5 + 0.5) * rect.height, 24, rect.height - 42);
        const element = pvStringElements[panel.id];
        element.style.left = x + "px";
        element.style.top = y + "px";
        element.style.setProperty("--string-label-scale", THREE.MathUtils.clamp(0.34 + state.zoom * 0.22, 0.52, 1.02));
        element.classList.toggle("behind", cameraSpace.z > rootPosition.z);
    });
}

function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = width < 520 ? 46 : 39;
    const basePosition = new THREE.Vector3(
        width < 520 ? 14.6 : 12.8,
        width < 520 ? 10.7 : 9.1,
        width < 520 ? 18.6 : 16.0
    );
    cameraBaseOffset.copy(basePosition).sub(cameraTarget);
    camera.position.copy(cameraTarget).addScaledVector(cameraBaseOffset, 1 / state.zoom);
    camera.lookAt(cameraTarget);
    camera.updateProjectionMatrix();
}

function pointerDistance() {
    const pointers = Array.from(state.pointers.values());
    if (pointers.length < 2)
        return 0;
    return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
}

canvas.addEventListener("pointerdown", (event) => {
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    if (state.pointers.size === 1) {
        state.pointerStartX = event.clientX;
        state.lastPointerX = event.clientX;
        state.pointerMoved = false;
    }
    else if (state.pointers.size === 2) {
        state.pinchStartDistance = pointerDistance();
        state.pinchStartZoom = state.targetZoom;
    }
});

canvas.addEventListener("pointermove", (event) => {
    if (!state.pointers.has(event.pointerId))
        return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size >= 2) {
        const distance = pointerDistance();
        if (state.pinchStartDistance > 0)
            state.targetZoom = THREE.MathUtils.clamp(
                state.pinchStartZoom * distance / state.pinchStartDistance,
                0.72,
                2.45
            );
        state.pointerMoved = true;
        return;
    }
    const delta = event.clientX - state.lastPointerX;
    if (Math.abs(event.clientX - state.pointerStartX) > 5)
        state.pointerMoved = true;
    state.targetYaw += delta * 0.009;
    state.lastPointerX = event.clientX;
});

function finishPointer(event) {
    if (!state.pointers.has(event.pointerId))
        return;
    if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
    state.pointers.delete(event.pointerId);
    if (state.pointers.size === 1) {
        const remaining = Array.from(state.pointers.values())[0];
        state.pointerStartX = remaining.x;
        state.lastPointerX = remaining.x;
    }
    else {
        state.pinchStartDistance = 0;
    }
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    state.targetZoom = THREE.MathUtils.clamp(
        state.targetZoom * Math.exp(-event.deltaY * 0.0012),
        0.72,
        2.45
    );
}, { passive: false });
canvas.addEventListener("keydown", (event) => {
    if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        state.targetZoom = Math.min(2.45, state.targetZoom + 0.16);
        return;
    }
    if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        state.targetZoom = Math.max(0.72, state.targetZoom - 0.16);
        return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
        return;
    event.preventDefault();
    state.targetYaw += event.key === "ArrowLeft" ? -0.16 : 0.16;
});

resetButton.addEventListener("click", () => {
    state.targetYaw = 0.78;
    state.targetZoom = 1;
    state.selected = "battery";
    updateLiveUi();
});

window.addEventListener("solix-dashboard-data", (event) => {
    state.data = event.detail || state.data;
    updateLiveUi();
});

if (window.ResizeObserver) {
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
}
else {
    window.addEventListener("resize", resize);
}

function animate(time) {
    const seconds = time * 0.001;
    const delta = Math.min(0.05, (time - state.lastTime) * 0.001 || 0.016);
    state.lastTime = time;
    state.yaw = THREE.MathUtils.damp(state.yaw, state.targetYaw, 10, delta);
    state.zoom = THREE.MathUtils.damp(state.zoom, state.targetZoom, 10, delta);
    world.rotation.y = state.yaw;
    camera.position.copy(cameraTarget).addScaledVector(cameraBaseOffset, 1 / state.zoom);
    camera.lookAt(cameraTarget);

    if (!reduceMotion) {
        Object.values(flows).forEach((flow) => {
            if (!flow.active)
                return;
            flow.pulses.forEach((pulse) => {
                let progress = (seconds * 0.24 + pulse.userData.offset) % 1;
                if (flow.reverse)
                    progress = 1 - progress;
                pulse.position.copy(flow.curve.getPointAt(progress));
                const glow = 0.78 + Math.sin(seconds * 5 + progress * 12) * 0.20;
                pulse.scale.setScalar(glow);
            });
        });
        materials.water.color.setHSL(0.53 + Math.sin(seconds * 0.7) * 0.008, 0.76, 0.48);
        audiModel.position.y = 0.02;
    }

    updateLabelPositions();
    renderer.render(scene, camera);
    window.requestAnimationFrame(animate);
}

resize();
updateLiveUi();
window.requestAnimationFrame(animate);
