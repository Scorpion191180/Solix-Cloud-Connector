import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

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
    pointerStartY: 0,
    lastPointerX: 0,
    lastPointerY: 0,
    pointerMode: "rotate",
    pointerMoved: false,
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    yaw: 0.78,
    targetYaw: 0.78,
    pitch: 0,
    targetPitch: 0,
    panX: 0,
    targetPanX: 0,
    panY: 0,
    targetPanY: 0,
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
scene.fog = new THREE.FogExp2(0xa9c3d2, 0.015);

const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 100);
camera.position.set(14.8, 10.6, 18.5);
const cameraTarget = new THREE.Vector3(0, 2.1, 0);
const cameraBaseOffset = camera.position.clone().sub(cameraTarget);
const currentCameraTarget = cameraTarget.clone();
const cameraOffset = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraUp = new THREE.Vector3();
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
renderer.toneMappingExposure = 1.06;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const environmentGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = environmentGenerator.fromScene(new RoomEnvironment(), 0.035).texture;
environmentGenerator.dispose();

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
    textureCanvas.width = 256;
    textureCanvas.height = 256;
    const context = textureCanvas.getContext("2d");
    const random = seededNoise(background.length * 173 + mode.length * 29);
    context.fillStyle = background;
    context.fillRect(0, 0, 256, 256);
    context.strokeStyle = ink;
    context.fillStyle = ink;

    if (mode === "stucco") {
        context.globalAlpha = 0.15;
        for (let y = 3; y < 256; y += 6) {
            for (let x = (Math.floor(y / 6) % 2) * 3; x < 256; x += 8) {
                context.fillRect(x, y, 5.8 + random() * 1.2, 1.0);
                context.fillRect(x + 0.8, y + 1.8, 4.4, 0.45);
            }
        }
        context.globalAlpha = 0.09;
        for (let index = 0; index < 900; index += 1) {
            const x = random() * 256;
            const y = random() * 256;
            context.fillRect(x, y, 0.7 + random() * 1.5, 0.55);
        }
    }
    else if (mode === "tiles") {
        context.lineWidth = 2.4;
        context.globalAlpha = 0.42;
        for (let y = 0; y < 256; y += 18) {
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(256, y);
            context.stroke();
            for (let x = (Math.floor(y / 18) % 2) * 9; x < 256; x += 18) {
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(x, y + 18);
                context.stroke();
            }
        }
    }
    else if (mode === "shingles") {
        context.lineWidth = 1;
        context.globalAlpha = 0.5;
        for (let y = 0; y < 256; y += 12) {
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(256, y);
            context.stroke();
            for (let x = (y / 12 % 2) * 10; x < 256; x += 20) {
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(x, y + 12);
                context.stroke();
            }
        }
    }
    else if (mode === "grass") {
        context.globalAlpha = 0.33;
        for (let index = 0; index < 1600; index += 1)
            context.fillRect(random() * 256, random() * 256, 1, 1 + random() * 3);
    }
    else if (mode === "pavers") {
        context.globalAlpha = 0.34;
        context.lineWidth = 1;
        for (let y = 0; y < 256; y += 18) {
            context.beginPath();
            context.moveTo(0, y);
            context.lineTo(256, y);
            context.stroke();
            for (let x = (y / 18 % 2) * 16; x < 256; x += 32) {
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(x, y + 18);
                context.stroke();
            }
        }
    }
    else if (mode === "water") {
        context.globalAlpha = 0.24;
        context.lineWidth = 1.4;
        for (let row = 0; row < 18; row += 1) {
            const baseY = row * 15 + random() * 4;
            context.beginPath();
            for (let x = -12; x <= 268; x += 8) {
                const y = baseY + Math.sin(x * 0.09 + row * 0.72) * 2.2;
                if (x === -12)
                    context.moveTo(x, y);
                else
                    context.lineTo(x, y);
            }
            context.stroke();
        }
    }

    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    return texture;
}

function makeWindowReflectionTexture() {
    const reflectionCanvas = document.createElement("canvas");
    reflectionCanvas.width = 256;
    reflectionCanvas.height = 512;
    const context = reflectionCanvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, "#b9d7e8");
    gradient.addColorStop(0.42, "#6e8ea5");
    gradient.addColorStop(0.46, "#d9e1df");
    gradient.addColorStop(1, "#273640");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 512);
    context.globalAlpha = 0.22;
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.ellipse(78, 102, 92, 24, -0.10, 0, Math.PI * 2);
    context.ellipse(196, 168, 104, 31, 0.08, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.16;
    context.fillStyle = "#10191e";
    context.fillRect(0, 304, 256, 208);
    const texture = new THREE.CanvasTexture(reflectionCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    return texture;
}

function makeSkyTexture() {
    const skyCanvas = document.createElement("canvas");
    skyCanvas.width = 1024;
    skyCanvas.height = 512;
    const context = skyCanvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, "#78b5df");
    gradient.addColorStop(0.58, "#c9dfea");
    gradient.addColorStop(0.82, "#e8e4d8");
    gradient.addColorStop(1, "#a9b59b");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1024, 512);
    const random = seededNoise(7398);
    context.save();
    context.filter = "blur(16px)";
    for (let cloud = 0; cloud < 11; cloud += 1) {
        const centerX = random() * 1060 - 18;
        const centerY = 58 + random() * 205;
        const size = 62 + random() * 92;
        context.fillStyle = `rgba(255,255,255,${0.08 + random() * 0.10})`;
        for (let puff = 0; puff < 7; puff += 1) {
            const x = centerX + (random() - 0.5) * size * 1.25;
            const y = centerY + (random() - 0.5) * size * 0.28;
            context.beginPath();
            context.ellipse(x, y, size * (0.30 + random() * 0.28), size * (0.14 + random() * 0.14), random() * 0.35 - 0.18, 0, Math.PI * 2);
            context.fill();
        }
    }
    context.restore();
    const sunGlow = context.createRadialGradient(835, 74, 4, 835, 74, 150);
    sunGlow.addColorStop(0, "rgba(255,244,210,0.48)");
    sunGlow.addColorStop(0.32, "rgba(255,241,205,0.16)");
    sunGlow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = sunGlow;
    context.fillRect(675, 0, 320, 230);
    const texture = new THREE.CanvasTexture(skyCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

const textures = {
    wall: makeTexture("#e9e4d8", "#8d887e", "stucco", 5, 8),
    roof: makeTexture("#a33e2c", "#4d1d18", "tiles", 5, 14),
    shingle: makeTexture("#4a332b", "#190f0d", "shingles", 5, 9),
    grass: makeTexture("#496b38", "#9eb36a", "grass", 8, 12),
    paving: makeTexture("#777a79", "#363a3a", "pavers", 8, 12),
    water: makeTexture("#159bc5", "#d1f7ff", "water", 3, 6),
    windowReflection: makeWindowReflectionTexture()
};

scene.background = makeSkyTexture();

const materials = {
    wall: new THREE.MeshStandardMaterial({ map: textures.wall, bumpMap: textures.wall, bumpScale: 0.035, roughness: 0.93, envMapIntensity: 0.34 }),
    roof: new THREE.MeshStandardMaterial({ map: textures.roof, bumpMap: textures.roof, bumpScale: 0.07, roughness: 0.78, envMapIntensity: 0.38 }),
    shingle: new THREE.MeshStandardMaterial({ map: textures.shingle, bumpMap: textures.shingle, bumpScale: 0.045, roughness: 0.88, envMapIntensity: 0.26 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x8d1922, roughness: 0.62, envMapIntensity: 0.4 }),
    darkTrim: new THREE.MeshStandardMaterial({ color: 0x352b29, roughness: 0.72, envMapIntensity: 0.42 }),
    windowInterior: new THREE.MeshStandardMaterial({ color: 0x16212a, roughness: 0.72 }),
    glass: new THREE.MeshPhysicalMaterial({
        color: 0xa9c6d5,
        map: textures.windowReflection,
        roughness: 0.09,
        metalness: 0.12,
        transmission: 0.22,
        transparent: true,
        opacity: 0.88,
        clearcoat: 0.92,
        clearcoatRoughness: 0.08,
        thickness: 0.05,
        ior: 1.47,
        envMapIntensity: 1.15
    }),
    garageRed: new THREE.MeshStandardMaterial({ color: 0xb5141d, roughness: 0.55 }),
    grass: new THREE.MeshStandardMaterial({ map: textures.grass, bumpMap: textures.grass, bumpScale: 0.025, roughness: 1 }),
    paving: new THREE.MeshStandardMaterial({ map: textures.paving, bumpMap: textures.paving, bumpScale: 0.035, roughness: 0.91, envMapIntensity: 0.25 }),
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
        map: textures.water,
        bumpMap: textures.water,
        bumpScale: 0.035,
        metalness: 0.03,
        roughness: 0.08,
        transmission: 0.32,
        transparent: true,
        opacity: 0.84,
        clearcoat: 1
    }),
    curtain: new THREE.MeshStandardMaterial({
        color: 0xe6dfd0,
        roughness: 0.96,
        transparent: true,
        opacity: 0.34,
        depthWrite: false
    }),
    soffit: new THREE.MeshStandardMaterial({ color: 0xe5e1d8, roughness: 0.88 }),
    roofTile: new THREE.MeshStandardMaterial({
        color: 0x9d3f2f,
        roughness: 0.68,
        metalness: 0.02,
        envMapIntensity: 0.48
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

    // Tiefe Laibung, dunkler Innenraum und leicht sichtbare Vorhänge vermeiden die frühere flache Scheibenwirkung.
    addBox(group, [size[0] + 0.26, size[1] + 0.26, 0.11], materials.windowInterior, [0, 0, -0.075]);
    addBox(group, [size[0] + 0.18, size[1] + 0.18, 0.13], materials.darkTrim, [0, 0, -0.005]);
    [-1, 1].forEach((sideSign) =>
        addBox(group, [size[0] * 0.25, size[1] * 0.92, 0.018], materials.curtain,
            [sideSign * size[0] * 0.34, 0, 0.028], { castShadow: false }));
    addBox(group, [size[0], size[1], 0.075], materials.glass, [0, 0, 0.065], { castShadow: false });
    addBox(group, [0.046, size[1], 0.115], materials.darkTrim, [0, 0, 0.115]);
    addBox(group, [size[0], 0.046, 0.115], materials.darkTrim, [0, 0, 0.115]);
    addBox(group, [size[0] + 0.30, 0.10, 0.24], materials.darkTrim, [0, -size[1] / 2 - 0.11, 0.035]);
    addBox(group, [size[0] + 0.22, 0.055, 0.18], materials.soffit, [0, size[1] / 2 + 0.11, -0.02], { castShadow: false });
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

    addBox(group, [size[0] + 0.22, size[1] + 0.18, 0.15], materials.windowInterior, [0, 0, -0.055]);
    addBox(group, [size[0] + 0.16, size[1] + 0.14, 0.13], materials.darkTrim, [0, 0, 0]);
    addBox(group, [size[0], size[1], 0.085], materials.glass, [0, 0, 0.065], { castShadow: false });
    addBox(group, [size[0] * 0.07, size[1], 0.13], materials.darkTrim, [0, 0, 0.12]);
    addBox(group, [size[0], 0.065, 0.13], materials.darkTrim, [0, size[1] * 0.10, 0.12]);
    const handle = new THREE.MeshStandardMaterial({ color: 0xb9c1c5, metalness: 0.82, roughness: 0.26 });
    addMesh(group, new THREE.SphereGeometry(0.035, 10, 8), handle, size[0] * 0.34, -0.13, 0.12, { castShadow: false });
    return group;
}

// 20 × 10 m aus den Gebäudemaßen, im Modell auf 12.8 × 6.4 Einheiten skaliert.
const HOUSE_WIDTH = 6.4;
const HOUSE_LENGTH = 12.8;
const GABLE_Z = HOUSE_LENGTH / 2 + 0.08;

function createRoofTiles(parent, slope) {
    const tileGeometry = new RoundedBoxGeometry(0.34, 0.055, 0.235, 2, 0.018);
    const rows = 13;
    const columns = 58;
    const tiles = new THREE.InstancedMesh(tileGeometry, materials.roofTile, rows * columns * 2);
    tiles.castShadow = false;
    tiles.receiveShadow = true;
    const transform = new THREE.Object3D();
    const shade = new THREE.Color();
    let instance = 0;
    [-1, 1].forEach((sideSign) => {
        for (let row = 0; row < rows; row += 1) {
            const distance = 0.18 + row * 0.265;
            const x = sideSign * distance;
            const y = 7.065 - distance * (2.15 / 3.55) + 0.085;
            for (let column = 0; column < columns; column += 1) {
                const z = -6.55 + column * 0.23 + (row % 2 ? 0.115 : 0);
                if (z > 6.62)
                    continue;
                transform.position.set(x, y, z);
                transform.rotation.set(0, 0, sideSign < 0 ? slope : -slope);
                transform.scale.set(0.96 + (column % 4) * 0.008, 1, 0.96);
                transform.updateMatrix();
                tiles.setMatrixAt(instance, transform.matrix);
                shade.setHSL(0.025 + (row % 3) * 0.002, 0.53, 0.37 + (column % 5) * 0.008);
                tiles.setColorAt(instance, shade);
                instance += 1;
            }
        }
    });
    tiles.count = instance;
    tiles.instanceMatrix.needsUpdate = true;
    if (tiles.instanceColor)
        tiles.instanceColor.needsUpdate = true;
    parent.add(tiles);
}

function createRoof(parent) {
    const slope = Math.atan2(2.15, 3.55);
    const roofLength = Math.hypot(3.55, 2.15);
    addBox(parent, [roofLength, 0.20, HOUSE_LENGTH + 0.8], materials.roof, [-1.76, 5.88, 0], {
        rotation: [0, 0, slope]
    });
    addBox(parent, [roofLength, 0.20, HOUSE_LENGTH + 0.8], materials.roof, [1.76, 5.88, 0], {
        rotation: [0, 0, -slope]
    });
    createRoofTiles(parent, slope);
    addBox(parent, [0.22, 0.22, HOUSE_LENGTH + 0.9], materials.darkTrim, [0, 7.02, 0], { radius: 0.04 });
    [-3.30, 3.30].forEach((x) => {
        addBox(parent, [0.52, 0.11, HOUSE_LENGTH + 0.72], materials.soffit, [x, 4.79, 0]);
        addBox(parent, [0.16, 0.24, HOUSE_LENGTH + 0.75], materials.trim, [x, 4.94, 0]);
        addBox(parent, [0.10, 0.18, HOUSE_LENGTH + 0.78], materials.darkTrim, [x + Math.sign(x) * 0.10, 4.88, 0]);
    });

    // Feine Ziegelreihen, Traufen und Fallrohre geben dem vorhandenen Dach mehr Tiefe.
    const roofRidgeMaterial = new THREE.MeshStandardMaterial({
        color: 0x7f2e24,
        roughness: 0.72,
        envMapIntensity: 0.42
    });
    // First- und Ortgangziegel bleiben als eigene, dunklere Abschlussprofile sichtbar.
    addMesh(parent, new THREE.CylinderGeometry(0.12, 0.12, HOUSE_LENGTH + 0.88, 14),
        roofRidgeMaterial, 0, 7.11, 0, { rotation: [Math.PI / 2, 0, 0], castShadow: false });
    const gutterMaterial = new THREE.MeshStandardMaterial({
        color: 0x3f4548,
        metalness: 0.58,
        roughness: 0.38
    });
    [-3.47, 3.47].forEach((x) => {
        addMesh(parent, new THREE.CylinderGeometry(0.075, 0.075, HOUSE_LENGTH + 0.62, 14),
            gutterMaterial, x, 4.82, 0, { rotation: [Math.PI / 2, 0, 0] });
        [-6.18, 6.18].forEach((z) =>
            addMesh(parent, new THREE.CylinderGeometry(0.065, 0.065, 4.62, 12),
                gutterMaterial, x, 2.42, z));
    });
    const skylightFrame = new THREE.MeshStandardMaterial({
        color: 0x343b40,
        metalness: 0.48,
        roughness: 0.34
    });
    [
        [-1.62, -2.72, 0.58, 0.76, slope],
        [-1.48, 2.34, 0.72, 0.92, slope],
        [1.58, 4.48, 0.68, 0.86, -slope]
    ].forEach(([x, z, width, length, tilt]) => {
        const roofY = 7.06 - Math.abs(x) * (2.15 / 3.55);
        addBox(parent, [width + 0.12, 0.08, length + 0.12], skylightFrame,
            [x, roofY + 0.045, z], { rotation: [0, 0, tilt] });
        addBox(parent, [width, 0.09, length], materials.glass,
            [x - Math.sign(x) * 0.015, roofY + 0.085, z], { rotation: [0, 0, tilt], castShadow: false });
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
        { z: 3.00, length: 6.65, panelZ: PV_PANEL_Z.slice(0, 2) },
        { z: -2.15, length: 3.58, panelZ: PV_PANEL_Z.slice(2) }
    ];
    sets.forEach((set) => {
        addBox(parent, [0.82, 0.12, set.length], materials.darkTrim, [3.52, 2.08, set.z]);
        // Geländer und PV sitzen an der äußeren Balkonkante, mit Abstand zur Hauswand.
        addBox(parent, [0.18, 0.16, set.length - 0.12], railMaterial, [3.88, 2.84, set.z], { radius: 0.025 });
        addBox(parent, [0.12, 0.12, set.length - 0.18], railMaterial, [3.88, 2.06, set.z]);
        for (let offset = -set.length / 2 + 0.16; offset <= set.length / 2 - 0.16; offset += 0.27) {
            const slat = addBox(parent, [0.11, 0.78, 0.12], railMaterial,
                [3.88, 2.43, set.z + offset], { radius: 0.018 });
            slat.rotation.x = Math.sin(offset * 2.3) * 0.018;
        }
        [-set.length / 2 + 0.12, set.length / 2 - 0.12].forEach((endOffset) => {
            addBox(parent, [0.70, 0.16, 0.14], railMaterial, [3.56, 2.84, set.z + endOffset]);
            addBox(parent, [0.10, 0.96, 0.14], railMaterial, [3.88, 2.37, set.z + endOffset]);
        });
        set.panelZ.forEach((panelZ) => {
            const panel = addBox(parent, [0.10, 1.12, 1.16], materials.solar,
                [3.96, 2.36, panelZ], { radius: 0.025 });
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

function createFrontWoodDoor(parent, position) {
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.y = Math.PI / 2;
    parent.add(group);

    const doorWood = new THREE.MeshStandardMaterial({ color: 0x4c2e25, roughness: 0.84 });
    const panelWood = new THREE.MeshStandardMaterial({ color: 0x2f1d19, roughness: 0.90 });
    const hardware = new THREE.MeshStandardMaterial({ color: 0xb9c1c5, metalness: 0.82, roughness: 0.24 });
    addBox(group, [1.00, 2.10, 0.13], materials.darkTrim, [0, 0, 0]);
    const door = addBox(group, [0.84, 1.96, 0.15], doorWood, [0, -0.02, 0.025]);
    [-0.62, -0.27, 0.16, 0.52].forEach((y) =>
        addBox(door, [0.72, 0.045, 0.025], panelWood, [0, y, 0.09], { castShadow: false }));
    addBox(group, [0.46, 0.38, 0.17], materials.glass, [0, 0.56, 0.05], { castShadow: false });
    addBox(group, [0.36, 0.055, 0.035], hardware, [0, -0.18, 0.13], { castShadow: false });
    addMesh(group, new THREE.SphereGeometry(0.04, 10, 8), hardware,
        0.31, -0.08, 0.13, { castShadow: false });
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
    [4.90, 0.42, -0.55, -2.12, -5.46].forEach((z) =>
        createWindow(house, [3.275, 1.48, z], [0.74, 1.16], "side"));
    createWindow(house, [3.285, 3.66, 5.45], [1.24, 1.10], "side");
    createDoor(house, [3.285, 3.58, 4.10], [0.78, 1.86], "side");
    createWindow(house, [3.285, 3.66, 2.72], [1.24, 1.10], "side");
    createDoor(house, [3.285, 3.58, 1.45], [0.78, 1.86], "side");
    createWindow(house, [3.285, 3.66, 0.18], [0.78, 1.10], "side");
    createWindow(house, [3.285, 3.66, -1.42], [0.72, 1.10], "side");
    createDoor(house, [3.285, 3.58, -2.70], [0.78, 1.86], "side");
    createDoor(house, [3.285, 3.58, -4.06], [0.78, 1.86], "side");
    createFrontWoodDoor(house, [3.30, 1.35, -3.15]);
    createDoor(house, [3.30, 1.35, -4.30], [0.80, 1.92], "side");
    createBayWindow(house);

    // Gartenfassade aus IMG_7397: dunkler Garagenabschnitt und acht Öffnungen in Fotoreihenfolge.
    addBox(house, [0.16, 4.90, 2.45], materials.shingle, [-3.285, 2.50, 5.18]);
    [
        [-5.02, 0.68],
        [-2.12, 0.68],
        [-0.62, 0.68],
        [0.96, 0.78],
        [2.42, 1.02],
        [3.82, 0.62],
        [5.22, 1.02]
    ].forEach(([z, width]) =>
        createWindow(house, [-3.30, 3.70, z], [width, 1.08], "side-back"));
    createDoor(house, [-3.285, 3.58, -3.62], [1.18, 1.86], "side-back");
    createJulietGuard(house, -3.62);
    createWindow(house, [-3.30, 1.50, -4.92], [0.72, 1.10], "side-back");
    createDoor(house, [-3.30, 1.34, -3.55], [0.82, 1.92], "side-back");
    createWindow(house, [-3.30, 1.46, 0.18], [0.62, 1.10], "side-back");
    createWoodDoorWithCanopy(house, [-3.30, 1.34, 1.80]);
    createWindow(house, [-3.30, 1.48, 5.08], [1.24, 1.14], "side-back");

    // Weiße Heckenseite: zwei Fensterreihen; laut Foto gibt es hier keine Tür.
    // Die rechten Fenster bleiben vor der Erkerkante und schneiden nicht mehr in dessen Rückfläche.
    [-1.92, 0, 1.40].forEach((x) =>
        createWindow(house, [x, 3.68, -GABLE_Z - 0.02], [0.72, 1.08], "back"));
    [-1.90, -0.15].forEach((x) =>
        createWindow(house, [x, 1.46, -GABLE_Z - 0.02], [0.78, 1.14], "back"));
    createWindow(house, [1.25, 1.46, -GABLE_Z - 0.02], [0.78, 1.14], "back");

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

function createCarBodyShell(car, material, profile, width) {
    const shape = new THREE.Shape();
    profile.forEach(([lengthPosition, height], index) => {
        if (index === 0)
            shape.moveTo(lengthPosition, height);
        else
            shape.lineTo(lengthPosition, height);
    });
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: width,
        steps: 1,
        bevelEnabled: true,
        bevelSegments: 4,
        bevelSize: 0.055,
        bevelThickness: 0.045
    });
    geometry.translate(0, 0, -width / 2);
    return addMesh(car, geometry, material, 0, 0, 0, {
        rotation: [0, -Math.PI / 2, 0]
    });
}

function createDetailedWheel(car, x, z, tireMaterial, rimMaterial, bodySide) {
    const outerX = x + Math.sign(x) * 0.105;
    const wheel = addMesh(car, new THREE.CylinderGeometry(0.32, 0.32, 0.19, 32),
        tireMaterial, x, 0.38, z, { rotation: [0, 0, Math.PI / 2] });
    addMesh(wheel, new THREE.CylinderGeometry(0.155, 0.155, 0.195, 24),
        rimMaterial, 0, 0, 0, { castShadow: false });
    addMesh(car, new THREE.TorusGeometry(0.225, 0.036, 10, 28), rimMaterial,
        outerX, 0.38, z, { rotation: [0, Math.PI / 2, 0], castShadow: false });
    for (let spoke = 0; spoke < 5; spoke += 1)
        addBox(car, [0.026, 0.235, 0.030], rimMaterial, [outerX, 0.38, z], {
            rotation: [spoke * Math.PI / 5 + 0.16, 0, 0],
            castShadow: false
        });
    addMesh(car, new THREE.CylinderGeometry(0.050, 0.050, 0.205, 20),
        rimMaterial, outerX, 0.38, z, { rotation: [0, 0, Math.PI / 2], castShadow: false });

    // Sichtbare Radhauskante und Seitenschweller statt einer glatten Spielzeug-Karosserie.
    addMesh(car, new THREE.TorusGeometry(0.345, 0.025, 8, 28), tireMaterial,
        Math.sign(x) * (bodySide + 0.018), 0.43, z,
        { rotation: [0, Math.PI / 2, 0], castShadow: false });
}

function createCar(color, model = "generic") {
    const car = new THREE.Group();
    const isAudi = model === "audi-q3";
    const isYeti = model === "skoda-yeti";
    const isFox = model === "vw-fox";
    const paint = new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.72,
        roughness: 0.20,
        clearcoat: 1,
        clearcoatRoughness: 0.1
    });
    const black = new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.42 });
    const rim = new THREE.MeshStandardMaterial({ color: 0x85909a, metalness: 0.86, roughness: 0.25 });
    const contactShadow = new THREE.MeshBasicMaterial({
        color: 0x050708,
        transparent: true,
        opacity: 0.28,
        depthWrite: false
    });
    addMesh(car, new THREE.CircleGeometry(1.0, 36), contactShadow, 0, 0.08, 0, {
        rotation: [-Math.PI / 2, 0, 0],
        castShadow: false,
        receiveShadow: false
    }).scale.set(0.92, 1.85, 1);
    const profile = isYeti ? [
        [-1.66, 0.28], [-1.66, 0.86], [-1.46, 1.30], [-1.18, 1.48],
        [0.62, 1.48], [1.02, 1.12], [1.70, 0.84], [1.70, 0.28]
    ] : isFox ? [
        [-1.50, 0.28], [-1.50, 0.92], [-1.25, 1.26], [-0.84, 1.41],
        [0.54, 1.39], [1.00, 1.08], [1.53, 0.78], [1.53, 0.28]
    ] : [
        [-1.72, 0.28], [-1.72, 0.78], [-1.45, 1.02], [-0.92, 1.34],
        [0.62, 1.34], [1.10, 1.02], [1.74, 0.80], [1.74, 0.28]
    ];
    createCarBodyShell(car, paint, profile, isFox ? 1.58 : 1.70);
    const noseZ = isFox ? 1.55 : 1.73;
    const tailZ = isFox ? -1.53 : -1.71;
    addBox(car, [isFox ? 1.40 : 1.58, 0.18, isFox ? 0.62 : 0.82], paint,
        [0, 0.82, isFox ? 1.24 : 1.32], { radius: 0.075 });
    addBox(car, [isFox ? 1.43 : 1.60, 0.16, 0.10], black,
        [0, 0.39, noseZ], { radius: 0.035 });

    // Unterboden, Stoßfänger und Innenraum geben der Silhouette auch beim Zoomen echte Tiefe.
    addBox(car, [isFox ? 1.46 : 1.62, 0.13, isFox ? 2.42 : 2.72], black,
        [0, 0.30, -0.02], { radius: 0.045 });
    addBox(car, [isFox ? 1.40 : 1.56, 0.18, 0.26], black,
        [0, 0.43, noseZ - 0.05], { radius: 0.055 });
    addBox(car, [isFox ? 1.38 : 1.54, 0.17, 0.24], black,
        [0, 0.42, tailZ + 0.05], { radius: 0.050 });
    [-0.42, 0.34].forEach((z) => {
        addBox(car, [0.56, 0.52, 0.48], black, [0, 0.89, z], { radius: 0.09 });
        addBox(car, [0.50, 0.09, 0.40], black, [0, 1.15, z], { radius: 0.04 });
    });

    // Separate Scheibenflächen folgen den geneigten Karosserielinien und reflektieren die Umgebung.
    const cabinLength = isYeti ? 1.88 : isFox ? 1.46 : 1.72;
    const cabinY = isYeti ? 1.14 : isFox ? 1.08 : 1.04;
    [-0.84, 0.84].forEach((x) =>
        addBox(car, [0.045, isYeti ? 0.56 : 0.48, cabinLength], materials.glass,
            [x * (isFox ? 0.91 : 1), cabinY, -0.16], { radius: 0.035, castShadow: false }));
    addBox(car, [1.46, 0.50, 0.055], materials.glass, [0, cabinY, 0.82], {
        rotation: [-0.43, 0, 0], radius: 0.025, castShadow: false
    });
    addBox(car, [1.42, 0.46, 0.055], materials.glass, [0, cabinY, -0.96], {
        rotation: [0.34, 0, 0], radius: 0.025, castShadow: false
    });
    addBox(car, [isFox ? 1.30 : 1.48, 0.10, cabinLength * 0.92], paint,
        [0, cabinY + 0.34, -0.16], { radius: 0.045 });
    [-0.83, 0.83].forEach((x) =>
        addBox(car, [0.045, 0.09, cabinLength + 0.10], black,
            [x * (isFox ? 0.91 : 1), cabinY - 0.31, -0.16], { radius: 0.015 }));
    [-0.83, 0.83].forEach((x) =>
        [-0.48, 0.34].forEach((z) =>
            addBox(car, [0.050, 0.52, 0.045], black,
                [x * (isFox ? 0.91 : 1), cabinY, z], { castShadow: false })));

    // Türfugen, Griffe und Spiegel geben den Fahrzeugen auch aus der Nähe eine erkennbare Karosserie.
    const sideX = isFox ? 0.77 : 0.86;
    [-1, 1].forEach((sideSign) => {
        [-0.52, 0.38].forEach((z) =>
            addBox(car, [0.022, 0.62, 0.026], black,
                [sideSign * sideX, 0.78, z], { castShadow: false }));
        [-0.47, 0.44].forEach((z) =>
            addBox(car, [0.035, 0.035, 0.24], rim,
                [sideSign * (sideX + 0.018), 0.96, z], { radius: 0.012, castShadow: false }));
        addBox(car, [0.16, 0.12, 0.28], paint,
            [sideSign * (sideX + 0.11), cabinY + 0.02, 0.62], { radius: 0.045 });
        addBox(car, [0.025, 0.055, isFox ? 1.55 : 1.86], paint,
            [sideSign * (sideX + 0.025), 0.76, -0.04], { radius: 0.012 });
        addBox(car, [0.050, 0.11, 1.34], black,
            [sideSign * (sideX + 0.018), 0.29, -0.02], { radius: 0.025 });
    });
    [tailZ, noseZ].forEach((z) =>
        addBox(car, [1.58, 0.14, 0.10], black, [0, 0.40, z], { radius: 0.04 }));
    [-0.81, 0.81].forEach((x) =>
        addBox(car, [0.07, 0.13, 2.30], black, [x, 0.38, -0.05], { radius: 0.025 }));

    const wheelZ = isYeti ? 1.10 : isFox ? 0.98 : 1.08;
    [[-sideX, -wheelZ], [sideX, -wheelZ], [-sideX, wheelZ], [sideX, wheelZ]].forEach(([x, z]) =>
        createDetailedWheel(car, x, z, black, rim, sideX));

    const plate = new THREE.MeshStandardMaterial({ color: 0xf1efe7, roughness: 0.55 });
    addBox(car, [0.52, 0.13, 0.035], plate, [0, 0.50, tailZ - 0.07], { radius: 0.014, castShadow: false });
    addBox(car, [0.46, 0.12, 0.035], plate, [0, 0.48, noseZ + 0.07], { radius: 0.014, castShadow: false });

    const front = new THREE.MeshStandardMaterial({ color: 0xcdf3ff, emissive: 0xa8def7, emissiveIntensity: 1.8 });
    const rear = new THREE.MeshStandardMaterial({ color: 0xff263c, emissive: 0xb00016, emissiveIntensity: 1.2 });
    [-0.55, 0.55].forEach((x) => {
        addBox(car, [0.38, 0.10, 0.05], front, [x, 0.67, noseZ + 0.055], { radius: 0.025, castShadow: false });
        addBox(car, [0.38, 0.11, 0.05], rear, [x, 0.67, tailZ - 0.055], { radius: 0.025, castShadow: false });
    });

    if (isAudi) {
        // Audi Q3: breite Singleframe-Front, vier Ringe, Dachreling und kompakte SUV-Silhouette.
        addBox(car, [1.05, 0.26, 0.05], black, [0, 0.49, 1.79], { radius: 0.08 });
        [-0.34, -0.11, 0.11, 0.34].forEach((x) =>
            addMesh(car, new THREE.TorusGeometry(0.105, 0.018, 8, 18), rim, x, 0.60, 1.82, { rotation: [Math.PI / 2, 0, 0], castShadow: false }));
        [-0.67, 0.67].forEach((x) =>
            addBox(car, [0.18, 0.12, 0.28], paint, [x, 1.03, 0.48], { radius: 0.05 }));
        [-0.56, 0.56].forEach((x) =>
            addBox(car, [0.045, 0.08, 1.65], rim, [x, 1.38, -0.18], { radius: 0.015 }));
        addBox(car, [0.92, 0.035, 0.92], materials.glass, [0, 1.405, -0.25], {
            radius: 0.025,
            castShadow: false
        });
        addBox(car, [1.20, 0.10, 0.34], paint, [0, 1.28, -1.48], { radius: 0.045 });
        addBox(car, [0.48, 0.12, 0.045], new THREE.MeshStandardMaterial({ color: 0xe7e7df, roughness: 0.52 }), [0, 0.50, -1.68], { radius: 0.018, castShadow: false });
        [-0.62, 0.62].forEach((x) => {
            addBox(car, [0.28, 0.18, 0.045], black, [x, 0.42, 1.80], { radius: 0.045 });
            addBox(car, [0.34, 0.045, 0.055], front, [x, 0.76, 1.80], {
                rotation: [0, 0, x < 0 ? -0.10 : 0.10], radius: 0.018, castShadow: false
            });
            addBox(car, [0.33, 0.055, 0.050], rear, [x, 0.78, -1.75], {
                rotation: [0, 0, x < 0 ? 0.11 : -0.11], radius: 0.018, castShadow: false
            });
        });
        addBox(car, [1.28, 0.035, 0.045], rear, [0, 0.79, -1.755], { radius: 0.012, castShadow: false });
        addBox(car, [0.76, 0.025, 0.055], black, [0, 1.20, 0.80], {
            rotation: [-0.43, 0, 0], castShadow: false
        });
    }
    else if (isYeti) {
        // Skoda Yeti: hoher, kantiger Aufbau, flaches Dach und charakteristische Zusatzscheinwerfer.
        addBox(car, [1.54, 0.12, 1.92], paint, [0, 1.50, -0.34], { radius: 0.035 });
        addBox(car, [0.76, 0.30, 0.055], black, [0, 0.51, 1.80], { radius: 0.045 });
        [-0.49, 0.49].forEach((x) => {
            addMesh(car, new THREE.CylinderGeometry(0.115, 0.115, 0.05, 18), front,
                x, 0.70, 1.82, { rotation: [Math.PI / 2, 0, 0], castShadow: false });
            addMesh(car, new THREE.CylinderGeometry(0.075, 0.075, 0.055, 18), front,
                x, 0.48, 1.82, { rotation: [Math.PI / 2, 0, 0], castShadow: false });
        });
        [-0.26, -0.13, 0, 0.13, 0.26].forEach((x) =>
            addBox(car, [0.035, 0.20, 0.025], rim, [x, 0.55, 1.855], { castShadow: false }));
        [-0.55, 0.55].forEach((x) =>
            addBox(car, [0.045, 0.06, 1.72], rim, [x, 1.61, -0.28], { radius: 0.012 }));
        addBox(car, [1.32, 0.055, 0.055], rear, [0, 0.78, -1.75], { radius: 0.018, castShadow: false });
        addBox(car, [1.16, 0.08, 0.26], black, [0, 0.39, -1.71], { radius: 0.035 });
    }
    else if (isFox) {
        // VW Fox: kurzes, hohes Heck, große Frontscheibe und mittiges VW-Zeichen.
        addBox(car, [1.25, 0.10, 1.18], paint, [0, 1.40, -0.28], { radius: 0.07 });
        addBox(car, [0.82, 0.18, 0.05], black, [0, 0.49, 1.66], { radius: 0.07 });
        addMesh(car, new THREE.TorusGeometry(0.13, 0.025, 8, 22), rim,
            0, 0.58, 1.70, { rotation: [Math.PI / 2, 0, 0], castShadow: false });
        addBox(car, [0.025, 0.19, 0.025], rim, [0, 0.58, 1.73], { castShadow: false });
        addBox(car, [0.18, 0.025, 0.025], rim, [0, 0.58, 1.73], { castShadow: false });
        addBox(car, [1.08, 0.09, 0.26], paint, [0, 1.30, -1.48], { radius: 0.045 });
        addBox(car, [1.18, 0.055, 0.050], rear, [0, 0.78, -1.57], { radius: 0.018, castShadow: false });
        addBox(car, [0.72, 0.045, 0.055], black, [0, 1.12, 0.82], {
            rotation: [-0.43, 0, 0], castShadow: false
        });
    }
    return car;
}

function createVehicles() {
    const audi = createCar(0x008dc8, "audi-q3");
    audi.scale.set(1.10, 1.17, 1.08);
    audi.position.set(5.00, 0.02, 1.0);
    audi.rotation.y = Math.PI;
    world.add(audi);

    // IMG_7378: schwarzer Skoda Yeti mittig, kleiner schwarzer VW Fox ganz rechts.
    const skodaYeti = createCar(0x1b2329, "skoda-yeti");
    skodaYeti.scale.set(1.04, 1.16, 1.08);
    skodaYeti.position.set(0, 0.02, 8.72);
    world.add(skodaYeti);

    const vwFox = createCar(0x202327, "vw-fox");
    vwFox.scale.set(0.82, 0.88, 0.80);
    vwFox.position.set(2.10, 0.02, 8.45);
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
    const needles = new THREE.MeshStandardMaterial({ color: 0x1d4e33, roughness: 0.96 });
    addMesh(tree, new THREE.CylinderGeometry(0.20, 0.34, 3.6, 14), trunk, 0, 1.8, 0);
    const foliageGeometry = new THREE.IcosahedronGeometry(0.58, 1);
    const foliage = new THREE.InstancedMesh(foliageGeometry, needles, 46);
    foliage.castShadow = true;
    foliage.receiveShadow = true;
    const transform = new THREE.Object3D();
    const shade = new THREE.Color();
    const random = seededNoise(7382);
    let instance = 0;
    const tiers = [
        [1.56, 1.58, 7], [1.48, 1.98, 7], [1.34, 2.42, 7],
        [1.18, 2.88, 6], [1.02, 3.34, 6], [0.82, 3.78, 5],
        [0.60, 4.18, 4], [0.36, 4.52, 3]
    ];
    tiers.forEach(([radius, y, clusters], tierIndex) => {
        for (let cluster = 0; cluster < clusters; cluster += 1) {
            const angle = cluster / clusters * Math.PI * 2 + tierIndex * 0.44;
            const spread = radius * (0.44 + random() * 0.20);
            transform.position.set(Math.cos(angle) * spread, y + (random() - 0.5) * 0.16, Math.sin(angle) * spread);
            transform.rotation.set(random() * 0.26, angle, random() * 0.18);
            transform.scale.set(radius * (0.74 + random() * 0.22), 0.24 + radius * 0.13, radius * (0.70 + random() * 0.24));
            transform.updateMatrix();
            foliage.setMatrixAt(instance, transform.matrix);
            shade.setHSL(0.35 + random() * 0.02, 0.45 + random() * 0.10, 0.16 + random() * 0.09);
            foliage.setColorAt(instance, shade);
            instance += 1;
        }
    });
    foliage.count = instance;
    foliage.instanceMatrix.needsUpdate = true;
    if (foliage.instanceColor)
        foliage.instanceColor.needsUpdate = true;
    tree.add(foliage);
    addMesh(tree, new THREE.ConeGeometry(0.42, 1.18, 14), needles, 0, 4.78, 0, { castShadow: true });
}

function createGrassDetail() {
    const bladeGeometry = new THREE.ConeGeometry(0.020, 0.16, 3);
    const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x49763f, roughness: 1 });
    const blades = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, 520);
    blades.castShadow = false;
    blades.receiveShadow = false;
    const transform = new THREE.Object3D();
    const shade = new THREE.Color();
    const random = seededNoise(4309);
    let instance = 0;
    let attempts = 0;
    while (instance < 520 && attempts < 4000) {
        attempts += 1;
        const x = -11.2 + random() * 20.8;
        const z = -10.2 + random() * 20.0;
        const onHouse = Math.abs(x) < 3.85 && Math.abs(z) < 6.95;
        const onForecourt = z > 4.55 && x > -4.0 && x < 6.5;
        const onAudiDrive = x > 3.15 && z > -6.55 && z < 6.7;
        const aroundPool = x < -5.3 && z < -3.45;
        if (onHouse || onForecourt || onAudiDrive || aroundPool)
            continue;
        transform.position.set(x, 0.07, z);
        transform.rotation.set((random() - 0.5) * 0.22, random() * Math.PI, (random() - 0.5) * 0.22);
        const height = 0.62 + random() * 0.85;
        transform.scale.set(0.72 + random() * 0.55, height, 0.72 + random() * 0.55);
        transform.updateMatrix();
        blades.setMatrixAt(instance, transform.matrix);
        shade.setHSL(0.24 + random() * 0.08, 0.34 + random() * 0.18, 0.24 + random() * 0.16);
        blades.setColorAt(instance, shade);
        instance += 1;
    }
    blades.count = instance;
    blades.instanceMatrix.needsUpdate = true;
    if (blades.instanceColor)
        blades.instanceColor.needsUpdate = true;
    world.add(blades);
}

function createGarden() {
    addBox(world, [23.0, 0.25, 22.8], materials.grass, [-1.50, -0.14, -0.55], { castShadow: false });
    createGrassDetail();
    // Ein zusammenhängender Vorplatz: von der linken Kante der Stellplätze bis zur Audi-Zufahrt.
    addBox(world, [10.05, 0.07, 6.1], materials.paving, [1.375, 0.025, 7.7], { castShadow: false });
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

const hemisphere = new THREE.HemisphereLight(0xd9efff, 0x34452d, 1.58);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xffedcf, 3.65);
sun.position.set(-10, 15, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 45;
sun.shadow.bias = -0.00025;
sun.shadow.radius = 3.5;
sun.shadow.blurSamples = 10;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x8ebef3, 0.62);
fill.position.set(10, 8, -12);
scene.add(fill);
const warmBounce = new THREE.DirectionalLight(0xffc99a, 0.32);
warmBounce.position.set(5, 3, 11);
scene.add(warmBounce);

const flows = {};

function createCableCurve(points) {
    const path = new THREE.CurvePath();
    for (let index = 1; index < points.length; index += 1) {
        path.add(new THREE.LineCurve3(
            new THREE.Vector3(...points[index - 1]),
            new THREE.Vector3(...points[index])
        ));
    }
    return path;
}

function createFlow(id, points, color) {
    const curve = createCableCurve(points);
    const segments = Math.max(64, (points.length - 1) * 24);
    const cableMaterial = new THREE.MeshStandardMaterial({
        color: 0x26323b,
        roughness: 0.64,
        metalness: 0.18
    });
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, 0.036, 10, false), cableMaterial);
    cable.castShadow = true;
    cable.receiveShadow = true;
    world.add(cable);
    const tubeMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, 0.054, 10, false), tubeMaterial);
    tube.renderOrder = 2;
    world.add(tube);
    points.slice(1, -1).forEach((point) => {
        const sleeve = addMesh(world, new THREE.SphereGeometry(0.065, 12, 8), cableMaterial,
            point[0], point[1], point[2], { castShadow: false });
        sleeve.renderOrder = 1;
    });
    const pulseMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const pulses = [];
    for (let index = 0; index < 6; index += 1) {
        const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), pulseMaterial.clone());
        pulse.userData.offset = index / 6;
        pulse.renderOrder = 3;
        world.add(pulse);
        pulses.push(pulse);
    }
    flows[id] = { curve, cable, tube, pulses, active: false, reverse: false };
}

const pvPanelAnchors = PV_PANEL_Z.map((z, index) => ({
    id: "pv" + (index + 1),
    anchor: new THREE.Vector3(4.08, 2.74, z),
    z,
    laneX: 4.08 + index * 0.055,
    laneY: 1.82 + index * 0.085
}));
pvPanelAnchors.forEach((panel, index) => {
    const bankLaneZ = -3.06 + index * 0.055;
    createFlow(panel.id, [
        [4.01, 2.42, panel.z],
        [panel.laneX, 2.42, panel.z],
        [panel.laneX, panel.laneY, panel.z],
        [panel.laneX, panel.laneY, bankLaneZ],
        [panel.laneX, 2.72, bankLaneZ],
        [3.76, 2.72, -3.18]
    ], colors.pv);
});
createFlow("grid", [
    [6.05, 0.58, -5.20], [6.05, 0.16, -5.20], [6.05, 0.16, -3.55],
    [4.18, 0.16, -3.55], [4.02, 0.16, -3.18], [4.02, 2.72, -3.18],
    [3.76, 2.72, -3.18]
], colors.grid);
createFlow("audi", [
    [3.76, 2.72, -3.18], [4.12, 2.72, -3.18], [4.12, 0.18, -3.18],
    [4.46, 0.18, -3.18], [4.46, 0.18, 0.18], [4.82, 0.18, 0.18],
    [5.00, 0.52, 0.25]
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
    flow.tube.material.opacity = active ? 0.94 : 0.34;
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
    setFlowState(flows.audi, raw.charging && raw.audiPower != null && raw.audiPower >= 5);

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
        element.style.setProperty("--scene-label-scale", THREE.MathUtils.clamp(0.68 + state.zoom * 0.32, 0.90, 1.54));
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
        element.style.setProperty("--string-label-scale", THREE.MathUtils.clamp(0.60 + state.zoom * 0.28, 0.82, 1.34));
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
    const compactView = width < 700;
    camera.fov = compactView ? 45 : 39;
    const basePosition = new THREE.Vector3(
        compactView ? 16.8 : 12.8,
        compactView ? 12.0 : 9.1,
        compactView ? 21.4 : 16.0
    );
    cameraBaseOffset.copy(basePosition).sub(cameraTarget);
    updateCameraTransform();
    camera.updateProjectionMatrix();
}

function updateCameraTransform() {
    cameraRight.set(cameraBaseOffset.z, 0, -cameraBaseOffset.x).normalize();
    cameraOffset.copy(cameraBaseOffset)
        .applyAxisAngle(cameraRight, state.pitch)
        .multiplyScalar(1 / state.zoom);
    cameraUp.copy(cameraOffset).normalize().cross(cameraRight).normalize();
    currentCameraTarget.copy(cameraTarget)
        .addScaledVector(cameraRight, state.panX)
        .addScaledVector(cameraUp, state.panY);
    camera.position.copy(currentCameraTarget).add(cameraOffset);
    camera.lookAt(currentCameraTarget);
}

function pointerDistance() {
    const pointers = Array.from(state.pointers.values());
    if (pointers.length < 2)
        return 0;
    return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
}

let interactionHideTimer = 0;

function beginSceneInteraction() {
    window.clearTimeout(interactionHideTimer);
    stage.classList.add("is-interacting");
}

function finishSceneInteractionSoon() {
    window.clearTimeout(interactionHideTimer);
    interactionHideTimer = window.setTimeout(() =>
        stage.classList.remove("is-interacting"), 180);
}

canvas.addEventListener("pointerdown", (event) => {
    beginSceneInteraction();
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    if (state.pointers.size === 1) {
        state.pointerStartX = event.clientX;
        state.pointerStartY = event.clientY;
        state.lastPointerX = event.clientX;
        state.lastPointerY = event.clientY;
        state.pointerMode = event.pointerType === "mouse" && event.button === 2 ? "pan" : "rotate";
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
    const deltaX = event.clientX - state.lastPointerX;
    const deltaY = event.clientY - state.lastPointerY;
    if (Math.hypot(event.clientX - state.pointerStartX, event.clientY - state.pointerStartY) > 5)
        state.pointerMoved = true;
    if (state.pointerMode === "pan") {
        const panSpeed = 0.012 / Math.max(0.80, state.targetZoom);
        state.targetPanX = THREE.MathUtils.clamp(state.targetPanX - deltaX * panSpeed, -3.2, 3.2);
        state.targetPanY = THREE.MathUtils.clamp(state.targetPanY + deltaY * panSpeed, -1.8, 2.2);
    }
    else {
        state.targetYaw += deltaX * 0.009;
        state.targetPitch = THREE.MathUtils.clamp(state.targetPitch - deltaY * 0.0034, -0.14, 0.16);
    }
    state.lastPointerX = event.clientX;
    state.lastPointerY = event.clientY;
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
        state.pointerStartY = remaining.y;
        state.lastPointerX = remaining.x;
        state.lastPointerY = remaining.y;
    }
    else {
        state.pinchStartDistance = 0;
        finishSceneInteractionSoon();
    }
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    beginSceneInteraction();
    state.targetZoom = THREE.MathUtils.clamp(
        state.targetZoom * Math.exp(-event.deltaY * 0.0012),
        0.72,
        2.45
    );
    finishSceneInteractionSoon();
}, { passive: false });
canvas.addEventListener("keydown", (event) => {
    if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        beginSceneInteraction();
        state.targetZoom = Math.min(2.45, state.targetZoom + 0.16);
        finishSceneInteractionSoon();
        return;
    }
    if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        beginSceneInteraction();
        state.targetZoom = Math.max(0.72, state.targetZoom - 0.16);
        finishSceneInteractionSoon();
        return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
        return;
    event.preventDefault();
    beginSceneInteraction();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight")
        state.targetYaw += event.key === "ArrowLeft" ? -0.16 : 0.16;
    else
        state.targetPitch = THREE.MathUtils.clamp(
            state.targetPitch + (event.key === "ArrowUp" ? 0.05 : -0.05),
            -0.14,
            0.16
        );
    finishSceneInteractionSoon();
});

resetButton.addEventListener("click", () => {
    state.targetYaw = 0.78;
    state.targetPitch = 0;
    state.targetPanX = 0;
    state.targetPanY = 0;
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
    state.pitch = THREE.MathUtils.damp(state.pitch, state.targetPitch, 10, delta);
    state.panX = THREE.MathUtils.damp(state.panX, state.targetPanX, 10, delta);
    state.panY = THREE.MathUtils.damp(state.panY, state.targetPanY, 10, delta);
    state.zoom = THREE.MathUtils.damp(state.zoom, state.targetZoom, 10, delta);
    world.rotation.y = state.yaw;
    updateCameraTransform();

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
