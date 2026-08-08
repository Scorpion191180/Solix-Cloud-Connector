import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

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
const menuToggle = document.getElementById("houseMenuToggle");
const menuPanel = document.getElementById("houseMenuPanel");
const menuClose = document.getElementById("houseMenuClose");
const menuCollapse = document.getElementById("houseMenuCollapse");
const menuPvToday = document.getElementById("menuPvToday");
const menuHousePower = document.getElementById("menuHousePower");
const menuBatterySoc = document.getElementById("menuBatterySoc");
const menuAudiSoc = document.getElementById("menuAudiSoc");
const menuStartThreshold = document.getElementById("menuStartThreshold");
const menuStopThreshold = document.getElementById("menuStopThreshold");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Diese Perspektive entspricht der am 08.08.2026 festgelegten Übersicht mit
// Garagen, Audi-Seite, Zufahrt und Pergola. Sie ist sowohl Startposition als
// auch Ziel des Reset-Knopfs.
const DEFAULT_VIEW = Object.freeze({
    yaw: 0,
    pitch: -0.02485403197490183,
    panX: 0.43,
    panY: 1.02,
    zoom: 0.85
});
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 3.10;
const MIN_PITCH = -0.28;
const MAX_PITCH = 0.32;

const state = {
    selected: "battery",
    expandedComponent: null,
    expandedPanel: null,
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
    pinchStartPanX: 0,
    pinchStartPanY: 0,
    pinchFocusX: 0,
    pinchFocusY: 0,
    pinchPanOffsetX: 0,
    pinchPanOffsetY: 0,
    pinchLastCenterX: 0,
    pinchLastCenterY: 0,
    yaw: DEFAULT_VIEW.yaw,
    targetYaw: DEFAULT_VIEW.yaw,
    pitch: DEFAULT_VIEW.pitch,
    targetPitch: DEFAULT_VIEW.pitch,
    panX: DEFAULT_VIEW.panX,
    targetPanX: DEFAULT_VIEW.panX,
    panY: DEFAULT_VIEW.panY,
    targetPanY: DEFAULT_VIEW.panY,
    zoom: DEFAULT_VIEW.zoom,
    targetZoom: DEFAULT_VIEW.zoom,
    lastTime: 0
};

const colors = {
    pv: "#facc15",
    battery: "#38bdf8",
    battery3: "#2dd4bf",
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

let exteriorHouse = null;
let interiorHouse = null;
let pergolaModel = null;
let solarBankModel = null;
let solarBankBatteryVisual = null;
let secondarySolarBankModel = null;
let secondarySolarBankBatteryVisual = null;
let balconyPanelModel = null;
let audiBatteryVisual = null;
const pondFish = [];

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

function formatEnergy(wattHours) {
    const value = numberValue(wattHours);
    if (value == null)
        return "--";
    if (Math.abs(value) >= 1000)
        return (value / 1000).toLocaleString("de-DE", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 2
        }) + " kWh";
    return Math.round(value).toLocaleString("de-DE") + " Wh";
}

function formatTimestamp(value) {
    if (!value)
        return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return String(value);
    return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
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

const textureLoader = new THREE.TextureLoader();

function loadImageTexture(path, repeatX = 1, repeatY = 1) {
    const texture = textureLoader.load(path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = repeatX === 1 ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.wrapT = repeatY === 1 ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    return texture;
}

// Die vier komprimierten Referenzfotos bleiben als echte Fotoatlanten im
// Projekt. Einzelne Fenster, Türen, Tore und Dachfenster verwenden daraus nur
// ihren jeweiligen Ausschnitt; Rahmen, Laibung und Balkone bleiben echtes 3D.
const housePhotoAtlases = {
    windowsIndividual: {
        path: "/static/textures/house/window-atlas-individual-v3.jpg",
        width: 1254,
        height: 1254
    },
    doorsIndividual: {
        path: "/static/textures/house/door-atlas-individual-v3.jpg",
        width: 1254,
        height: 1254
    },
    doorGableV4: {
        path: "/static/textures/house/door-gable-atlas-v4.jpg",
        width: 1254,
        height: 1254
    },
    garageClean: {
        path: "/static/textures/house/garage-atlas-clean-v3.jpg",
        width: 1254,
        height: 1254
    },
    windowsClean: {
        path: "/static/textures/house/window-atlas-clean-v2.jpg",
        width: 1024,
        height: 1024
    },
    doorsClean: {
        path: "/static/textures/house/door-atlas-clean-v2.jpg",
        width: 1024,
        height: 1024
    },
    front: {
        path: "/static/textures/house/front-reference.jpg",
        width: 2200,
        height: 1238
    },
    garden: {
        path: "/static/textures/house/garden-reference.jpg",
        width: 2200,
        height: 1238
    },
    garageGable: {
        path: "/static/textures/house/garage-gable-reference.jpg",
        width: 1800,
        height: 1013
    },
    sideGable: {
        path: "/static/textures/house/side-gable-reference.jpg",
        width: 1012,
        height: 1800
    }
};

function makePhotoCropTexture(spec) {
    if (!spec || !housePhotoAtlases[spec.atlas])
        return null;
    const atlas = housePhotoAtlases[spec.atlas];
    // Der Ausschnitt wird nach dem Laden in eine kleine Canvas-Textur kopiert.
    // Das vermeidet unterschiedliche Y-Achsen-Konventionen bei JPEG/WebGL und
    // reduziert den GPU-Speicher pro Fenster deutlich gegenüber einem vollen
    // 2200-Pixel-Foto mit UV-Offset.
    const cropCanvas = document.createElement("canvas");
    const targetLongEdge = 512;
    if (spec.width >= spec.height) {
        cropCanvas.width = targetLongEdge;
        cropCanvas.height = Math.max(64, Math.round(targetLongEdge * spec.height / spec.width));
    }
    else {
        cropCanvas.height = targetLongEdge;
        cropCanvas.width = Math.max(64, Math.round(targetLongEdge * spec.width / spec.height));
    }
    const context = cropCanvas.getContext("2d");
    context.fillStyle = "#30404a";
    context.fillRect(0, 0, cropCanvas.width, cropCanvas.height);
    const texture = new THREE.CanvasTexture(cropCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    textureLoader.load(atlas.path, (source) => {
        context.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
        context.drawImage(source.image,
            spec.x, spec.y, spec.width, spec.height,
            0, 0, cropCanvas.width, cropCanvas.height);
        texture.needsUpdate = true;
    });
    return texture;
}

function makePhotoMaterial(spec, options = {}) {
    const map = makePhotoCropTexture(spec);
    if (!map)
        return null;
    const cleanAsset = Boolean(spec?.cleanAsset);
    return new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map,
        roughness: cleanAsset ? 0.72 : (options.roughness ?? 0.20),
        metalness: cleanAsset ? 0 : (options.metalness ?? 0.02),
        clearcoat: cleanAsset ? 0.08 : (options.clearcoat ?? 0.72),
        clearcoatRoughness: cleanAsset ? 0.72 : 0.16,
        envMapIntensity: cleanAsset ? 0.12 : 0.66,
        side: THREE.FrontSide
    });
}

const textures = {
    wall: loadImageTexture("/static/textures/house/facade-wall.jpg", 5, 8),
    roof: loadImageTexture("/static/textures/house/roof-tiles.jpg", 2, 4),
    shingle: loadImageTexture("/static/textures/house/garage-shingles-clean-v3.jpg", 4, 8),
    grass: makeTexture("#496b38", "#9eb36a", "grass", 8, 12),
    paving: makeTexture("#777a79", "#363a3a", "pavers", 8, 12),
    water: makeTexture("#159bc5", "#d1f7ff", "water", 3, 6),
    windowReflection: makeWindowReflectionTexture()
};

scene.background = makeSkyTexture();

const materials = {
    wall: new THREE.MeshStandardMaterial({ map: textures.wall, bumpMap: textures.wall, bumpScale: 0.035, roughness: 0.93, envMapIntensity: 0.34 }),
    roof: new THREE.MeshStandardMaterial({ color: 0xd97855, map: textures.roof, bumpMap: textures.roof, bumpScale: 0.07, roughness: 0.78, envMapIntensity: 0.38 }),
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
    balconyGlass: new THREE.MeshPhysicalMaterial({
        color: 0x7895a3,
        map: textures.windowReflection,
        roughness: 0.16,
        metalness: 0.06,
        transmission: 0.10,
        transparent: true,
        opacity: 0.94,
        clearcoat: 0.84,
        clearcoatRoughness: 0.14,
        thickness: 0.04,
        ior: 1.45,
        envMapIntensity: 0.88
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
        color: 0xffffff,
        roughness: 0.68,
        metalness: 0.02,
        envMapIntensity: 0.48,
        transparent: true,
        opacity: 0.12
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

// Pixelgenaue Ausschnitte aus den vier freigegebenen Hausfotos. Die Werte
// beziehen sich auf die komprimierten Atlanten unter static/textures/house.
// Die 3D-Rahmen liegen weiterhin leicht davor und kaschieren die Fotokanten.
const PHOTO_CROPS = {
    front: {
        ground: [
            { atlas: "front", x: 302, y: 735, width: 142, height: 185 },
            { atlas: "front", x: 900, y: 733, width: 105, height: 178 },
            { atlas: "front", x: 1017, y: 728, width: 108, height: 182 },
            { atlas: "front", x: 1275, y: 726, width: 112, height: 191 },
            { atlas: "front", x: 1728, y: 720, width: 116, height: 204 }
        ],
        upper: [
            { atlas: "front", x: 624, y: 472, width: 168, height: 160 },
            { atlas: "front", x: 796, y: 458, width: 91, height: 202 },
            { atlas: "front", x: 900, y: 470, width: 150, height: 174 },
            { atlas: "front", x: 1055, y: 467, width: 91, height: 196 },
            { atlas: "front", x: 1196, y: 458, width: 103, height: 184 },
            { atlas: "front", x: 1331, y: 461, width: 96, height: 187 },
            { atlas: "front", x: 1460, y: 452, width: 94, height: 205 },
            { atlas: "front", x: 1584, y: 449, width: 93, height: 207 }
        ],
        woodDoor: { atlas: "front", x: 1390, y: 729, width: 104, height: 216 },
        glassDoor: { atlas: "front", x: 1512, y: 704, width: 118, height: 240 },
        baySide: { atlas: "front", x: 1732, y: 455, width: 91, height: 198 },
        bayCorner: { atlas: "front", x: 1814, y: 445, width: 94, height: 207 },
        bayBack: { atlas: "front", x: 1900, y: 450, width: 86, height: 200 }
    },
    garden: {
        upper: [
            { atlas: "garden", x: 368, y: 340, width: 88, height: 185 },
            { atlas: "garden", x: 690, y: 340, width: 86, height: 181 },
            { atlas: "garden", x: 848, y: 340, width: 84, height: 180 },
            { atlas: "garden", x: 1064, y: 349, width: 90, height: 170 },
            { atlas: "garden", x: 1170, y: 345, width: 98, height: 176 },
            { atlas: "garden", x: 1448, y: 343, width: 78, height: 180 },
            { atlas: "garden", x: 1724, y: 350, width: 96, height: 174 }
        ],
        julietDoor: { atlas: "garden", x: 548, y: 334, width: 108, height: 202 },
        groundLeft: { atlas: "garden", x: 365, y: 579, width: 92, height: 172 },
        groundDoor: { atlas: "garden", x: 548, y: 576, width: 105, height: 207 },
        groundMiddle: { atlas: "garden", x: 1060, y: 585, width: 91, height: 166 },
        woodDoor: { atlas: "garden", x: 1190, y: 560, width: 156, height: 225 },
        garageWindow: { atlas: "garden", x: 1724, y: 590, width: 150, height: 159 }
    },
    garage: {
        doors: [
            { atlas: "garageGable", x: 535, y: 642, width: 230, height: 263 },
            { atlas: "garageGable", x: 772, y: 640, width: 238, height: 265 },
            { atlas: "garageGable", x: 1016, y: 638, width: 238, height: 268 }
        ],
        upper: [
            { atlas: "garageGable", x: 595, y: 360, width: 91, height: 176 },
            { atlas: "garageGable", x: 756, y: 352, width: 91, height: 184 },
            { atlas: "garageGable", x: 920, y: 347, width: 92, height: 190 },
            { atlas: "garageGable", x: 1088, y: 342, width: 94, height: 195 }
        ],
        attic: [
            { atlas: "garageGable", x: 662, y: 178, width: 88, height: 112 },
            { atlas: "garageGable", x: 920, y: 156, width: 91, height: 120 }
        ]
    },
    side: {
        attic: [
            { atlas: "sideGable", x: 386, y: 404, width: 92, height: 142 },
            { atlas: "sideGable", x: 512, y: 416, width: 92, height: 143 }
        ],
        upper: [
            { atlas: "sideGable", x: 344, y: 555, width: 112, height: 208 },
            { atlas: "sideGable", x: 470, y: 505, width: 116, height: 214 },
            { atlas: "sideGable", x: 624, y: 590, width: 124, height: 226 }
        ],
        ground: [
            { atlas: "sideGable", x: 330, y: 985, width: 118, height: 236 },
            { atlas: "sideGable", x: 478, y: 855, width: 122, height: 238 },
            { atlas: "sideGable", x: 618, y: 825, width: 132, height: 260 }
        ]
    },
    roof: [
        { atlas: "front", x: 470, y: 150, width: 126, height: 82 },
        { atlas: "garden", x: 612, y: 180, width: 105, height: 76 },
        { atlas: "garden", x: 1372, y: 75, width: 126, height: 84 }
    ]
};

// Aus den freigegebenen Hausfotos abgeleitete, frontal entzerrte Bauteile.
// Die neutralen Scheiben enthalten weder Straßen-/Gartenreflexionen noch
// zufällige Bildinhalte. `cleanAsset` verhindert zusätzliche 3D-Sprossen,
// damit ausschließlich die tatsächlich vorhandene Rahmenteilung sichtbar ist.
const CLEAN_OPENINGS = {
    window: {
        single: { atlas: "windowsClean", x: 84, y: 32, width: 250, height: 440, cleanAsset: true },
        double: { atlas: "windowsClean", x: 504, y: 80, width: 476, height: 383, cleanAsset: true },
        cross: { atlas: "windowsClean", x: 73, y: 570, width: 298, height: 350, cleanAsset: true },
        narrow: { atlas: "windowsClean", x: 623, y: 548, width: 200, height: 400, cleanAsset: true }
    },
    door: {
        balcony: { atlas: "doorsClean", x: 139, y: 20, width: 210, height: 480, cleanAsset: true },
        balconyDouble: { atlas: "doorsClean", x: 564, y: 20, width: 335, height: 480, cleanAsset: true },
        entrance: { atlas: "doorsClean", x: 139, y: 522, width: 210, height: 472, cleanAsset: true },
        wood: { atlas: "doorsClean", x: 605, y: 524, width: 255, height: 478, cleanAsset: true }
    }
};

// Individuell aus den freigegebenen Fassadenfotos abgeleitete Bauteile.
// Jeder Ausschnitt besitzt bereits seinen vollständigen Originalrahmen samt
// Fensterbank. Deshalb werden dafür keine zusätzlichen Standardrahmen mehr
// vor die Fototextur gesetzt.
const INDIVIDUAL_OPENINGS = {
    window: {
        modernSingle: { atlas: "windowsIndividual", x: 77, y: 20, width: 155, height: 273, cleanAsset: true },
        modernDouble: { atlas: "windowsIndividual", x: 342, y: 30, width: 254, height: 255, cleanAsset: true },
        balconyDouble: { atlas: "windowsIndividual", x: 660, y: 16, width: 278, height: 294, cleanAsset: true },
        modernCurtain: { atlas: "windowsIndividual", x: 1018, y: 10, width: 176, height: 300, cleanAsset: true },
        modernDivided: { atlas: "windowsIndividual", x: 62, y: 337, width: 198, height: 266, cleanAsset: true },
        whiteCurtain: { atlas: "windowsIndividual", x: 370, y: 348, width: 182, height: 254, cleanAsset: true },
        brownDivided: { atlas: "windowsIndividual", x: 720, y: 349, width: 141, height: 254, cleanAsset: true },
        brownDouble: { atlas: "windowsIndividual", x: 984, y: 346, width: 224, height: 264, cleanAsset: true },
        modernTall: { atlas: "windowsIndividual", x: 84, y: 651, width: 137, height: 282, cleanAsset: true },
        brownTallCurtain: { atlas: "windowsIndividual", x: 392, y: 646, width: 155, height: 282, cleanAsset: true },
        brownDoubleCurtain: { atlas: "windowsIndividual", x: 38, y: 996, width: 235, height: 224, cleanAsset: true },
        bayThree: { atlas: "windowsIndividual", x: 342, y: 950, width: 248, height: 275, cleanAsset: true },
        brownNarrow: { atlas: "windowsIndividual", x: 711, y: 960, width: 139, height: 270, cleanAsset: true },
        brownNarrowCurtain: { atlas: "windowsIndividual", x: 1007, y: 946, width: 160, height: 282, cleanAsset: true }
    },
    door: {
        rearGlass: { atlas: "doorsIndividual", x: 170, y: 26, width: 284, height: 575, cleanAsset: true },
        balconyDouble: { atlas: "doorsIndividual", x: 719, y: 27, width: 444, height: 574, cleanAsset: true },
        modernEntrance: { atlas: "doorsIndividual", x: 186, y: 649, width: 248, height: 580, cleanAsset: true },
        rearDecorative: { atlas: "doorsIndividual", x: 677, y: 654, width: 518, height: 569, cleanAsset: true },
        // IMG_7398: Die Türen des linken Balkons besitzen braune Rahmen wie
        // die dortigen Fenster, rechts sind sie anthrazit. Beide Scheiben
        // laufen ohne den zuvor fälschlich gezeigten horizontalen Mittelsteg
        // über die komplette Türhöhe.
        balconyLeft: { atlas: "doorGableV4", x: 184, y: 20, width: 262, height: 657, cleanAsset: true },
        balconyRight: { atlas: "doorGableV4", x: 783, y: 22, width: 282, height: 657, cleanAsset: true }
    },
    garage: {
        door: { atlas: "garageClean", x: 696, y: 58, width: 487, height: 515, cleanAsset: true },
        window: { atlas: "garageClean", x: 129, y: 717, width: 362, height: 436, cleanAsset: true },
        attic: { atlas: "garageClean", x: 826, y: 768, width: 224, height: 332, cleanAsset: true },
        apex: { atlas: "doorGableV4", x: 97, y: 800, width: 429, height: 315, cleanAsset: true }
    }
};

function createWindow(parent, position, size, side = "front", photoSpec = null) {
    const group = new THREE.Group();
    group.position.set(...position);
    if (side === "side")
        group.rotation.y = Math.PI / 2;
    else if (side === "side-back")
        group.rotation.y = -Math.PI / 2;
    else if (side === "back")
        group.rotation.y = Math.PI;
    parent.add(group);

    const cleanAsset = Boolean(photoSpec?.cleanAsset);
    const glassMaterial = makePhotoMaterial(photoSpec) || materials.glass;
    if (cleanAsset) {
        // Der entzerrte Fotoausschnitt enthält bereits Laibung, Rahmen,
        // Fensterbank und Scheibe. Eine einzige flache 3D-Trägerplatte
        // verhindert doppelte Rahmen rund um die Textur.
        addBox(group, [size[0] * 0.98, size[1] * 0.98, 0.035], materials.windowInterior,
            [0, 0, -0.018], { castShadow: false });
        addBox(group, [size[0], size[1], 0.028], glassMaterial,
            [0, 0, 0.015], { castShadow: false });
    }
    else {
        // Tiefe Laibung und dunkler Innenraum für rein prozedurale Fenster.
        addBox(group, [size[0] + 0.26, size[1] + 0.26, 0.11], materials.windowInterior, [0, 0, -0.075]);
        addBox(group, [size[0] + 0.18, size[1] + 0.18, 0.13], materials.darkTrim, [0, 0, -0.005]);
        [-1, 1].forEach((sideSign) =>
            addBox(group, [size[0] * 0.25, size[1] * 0.92, 0.018], materials.curtain,
                [sideSign * size[0] * 0.34, 0, 0.028], { castShadow: false }));
        addBox(group, [size[0], size[1], 0.075], glassMaterial, [0, 0, 0.065], { castShadow: false });
        addBox(group, [0.046, size[1], 0.115], materials.darkTrim, [0, 0, 0.115]);
        addBox(group, [size[0], 0.046, 0.115], materials.darkTrim, [0, 0, 0.115]);
        addBox(group, [size[0] + 0.30, 0.10, 0.24], materials.darkTrim, [0, -size[1] / 2 - 0.11, 0.035]);
        addBox(group, [size[0] + 0.22, 0.055, 0.18], materials.soffit, [0, size[1] / 2 + 0.11, -0.02], { castShadow: false });
    }
    return group;
}

function createDoor(parent, position, size = [0.82, 1.96], side = "front", photoSpec = null) {
    const group = new THREE.Group();
    group.position.set(...position);
    if (side === "side")
        group.rotation.y = Math.PI / 2;
    else if (side === "side-back")
        group.rotation.y = -Math.PI / 2;
    else if (side === "back")
        group.rotation.y = Math.PI;
    parent.add(group);

    const cleanAsset = Boolean(photoSpec?.cleanAsset);
    const doorMaterial = makePhotoMaterial(photoSpec, { roughness: 0.26, clearcoat: 0.52 }) || materials.glass;
    if (cleanAsset) {
        addBox(group, [size[0] * 0.98, size[1] * 0.98, 0.035], materials.windowInterior,
            [0, 0, -0.018], { castShadow: false });
        addBox(group, [size[0], size[1], 0.028], doorMaterial,
            [0, 0, 0.015], { castShadow: false });
        const isBalconyDoor = photoSpec === INDIVIDUAL_OPENINGS.door.balconyLeft ||
            photoSpec === INDIVIDUAL_OPENINGS.door.balconyRight;
        if (isBalconyDoor) {
            // Die Atlas-Vorlage enthält neutrale, fast weiße Scheiben. Eine
            // exakt auf die Glasfläche begrenzte Ebene gleicht Farbe und
            // Reflexion an die übrigen Fenster an, ohne die Rahmen zu überdecken.
            addBox(group, [size[0] * 0.64, size[1] * 0.82, 0.018], materials.balconyGlass,
                [0, 0.01, 0.036], { castShadow: false });
        }
    }
    else {
        addBox(group, [size[0] + 0.22, size[1] + 0.18, 0.15], materials.windowInterior, [0, 0, -0.055]);
        addBox(group, [size[0] + 0.16, size[1] + 0.14, 0.13], materials.darkTrim, [0, 0, 0]);
        addBox(group, [size[0], size[1], 0.085], doorMaterial, [0, 0, 0.065], { castShadow: false });
        addBox(group, [size[0] * 0.07, size[1], 0.13], materials.darkTrim, [0, 0, 0.12]);
        addBox(group, [size[0], 0.065, 0.13], materials.darkTrim, [0, size[1] * 0.10, 0.12]);
        const handle = new THREE.MeshStandardMaterial({ color: 0xb9c1c5, metalness: 0.82, roughness: 0.26 });
        addMesh(group, new THREE.SphereGeometry(0.035, 10, 8), handle,
            size[0] * 0.34, -0.13, 0.12, { castShadow: false });
    }
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
    const roofGroup = new THREE.Group();
    roofGroup.userData.hideInCutaway = true;
    parent.add(roofGroup);
    parent = roofGroup;
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
    // Positionen aus dem neuen senkrechten Luftbild IMG_7436: zwei Fenster
    // auf der Gartenseite und ein Fenster im vorderen Garagenabschnitt.
    [
        [-1.56, 3.18, 0.58, 0.76, slope, PHOTO_CROPS.roof[0]],
        [-1.50, -2.86, 0.64, 0.82, slope, PHOTO_CROPS.roof[1]],
        [1.58, 4.72, 0.68, 0.86, -slope, PHOTO_CROPS.roof[2]]
    ].forEach(([x, z, width, length, tilt, photoSpec]) => {
        const roofY = 7.06 - Math.abs(x) * (2.15 / 3.55);
        addBox(parent, [width + 0.22, 0.06, length + 0.22], materials.darkTrim,
            [x + Math.sign(x) * 0.025, roofY - 0.005, z], { rotation: [0, 0, tilt] });
        addBox(parent, [width + 0.12, 0.08, length + 0.12], skylightFrame,
            [x, roofY + 0.045, z], { rotation: [0, 0, tilt] });
        const skylightPhoto = makePhotoMaterial(photoSpec, { roughness: 0.14, clearcoat: 0.88 }) || materials.glass;
        addBox(parent, [width, 0.09, length], skylightPhoto,
            [x - Math.sign(x) * 0.015, roofY + 0.085, z], { rotation: [0, 0, tilt], castShadow: false });
        addBox(parent, [width * 0.92, 0.018, 0.045], skylightFrame,
            [x - Math.sign(x) * 0.028, roofY + 0.145, z + length * 0.24], {
                rotation: [0, 0, tilt], castShadow: false
            });
    });

    const chimneyMaterial = new THREE.MeshStandardMaterial({
        color: 0xaeb6b8,
        metalness: 0.42,
        roughness: 0.52
    });
    // Ebenfalls aus der Draufsicht: zwei Kamine auf der Straßenseite und
    // einer auf der Gartenseite, jeweils deutlich außermittig entlang des Firsts.
    const chimneyPositions = [
        { x: 1.18, z: 1.55 },
        { x: 1.20, z: -4.05 },
        { x: -1.12, z: -3.92 }
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
    const garagePierMaterial = new THREE.MeshStandardMaterial({
        color: 0xb9a36d,
        roughness: 0.82,
        envMapIntensity: 0.18
    });
    [-2.08, 0, 2.08].forEach((x, index) => {
        const garagePhoto = makePhotoMaterial(INDIVIDUAL_OPENINGS.garage.door, {
            roughness: 0.36,
            clearcoat: 0.36
        });
        const door = addBox(parent, [doorWidth, 2.26, 0.15], garagePhoto || materials.garageRed,
            [x, 1.42, GABLE_Z], { radius: 0.018, castShadow: false });
        if (!garagePhoto) {
            for (let row = -4; row <= 4; row += 1)
                addBox(door, [doorWidth * 0.95, 0.018, 0.025], materials.darkTrim, [0, row * 0.205, 0.085], { castShadow: false });
            addBox(door, [doorWidth * 0.88, 0.58, 0.035], materials.glass, [0, 0.61, 0.09], { castShadow: false });
            [-0.44, 0, 0.44].forEach((offset) =>
                addBox(door, [0.028, 0.58, 0.04], materials.garageRed, [offset, 0.61, 0.115], { castShadow: false }));
        }
    });
    // Die vier schmalen Putzpfeiler entsprechen den echten Trennungen der
    // drei Tore. Die Schindelwand bleibt dazwischen vollständig sichtbar.
    [-3.12, -1.04, 1.04, 3.12].forEach((x) =>
        addBox(parent, [0.22, 2.46, 0.17], garagePierMaterial,
            [x, 1.43, GABLE_Z + 0.015], { castShadow: false }));
}

function createGable(parent) {
    // Die reale Garagenseite ist vom Sockel bis in den Giebel vollständig mit
    // den gleichen braunen Holzschindeln verkleidet.
    addBox(parent, [6.45, 4.90, 0.18], materials.shingle, [0, 2.50, GABLE_Z - 0.10]);
    const shape = new THREE.Shape();
    shape.moveTo(-3.22, 0);
    shape.lineTo(0, 2.15);
    shape.lineTo(3.22, 0);
    shape.lineTo(-3.22, 0);
    const geometry = new THREE.ShapeGeometry(shape);
    // ShapeGeometry übernimmt seine UV-Werte direkt aus den Modellkoordinaten.
    // Dadurch wurden die Schindeln im Dreieck ab dem Obergeschoss massiv
    // gestreckt. Diese UVs führen das Raster der rechteckigen Wand nahtlos in
    // gleicher Weltgröße bis zur Giebelspitze weiter.
    const gablePositions = geometry.getAttribute("position");
    const gableUvs = geometry.getAttribute("uv");
    for (let index = 0; index < gablePositions.count; index += 1) {
        const localX = gablePositions.getX(index);
        const localY = gablePositions.getY(index);
        gableUvs.setXY(index, (localX + 3.22) / 6.44, 1 + localY / 4.90);
    }
    gableUvs.needsUpdate = true;
    const triangle = addMesh(parent, geometry, materials.shingle, 0, 4.93, GABLE_Z);
    triangle.castShadow = true;

    const garageUpperWindows = [
        INDIVIDUAL_OPENINGS.garage.window,
        INDIVIDUAL_OPENINGS.window.whiteCurtain,
        INDIVIDUAL_OPENINGS.garage.window,
        INDIVIDUAL_OPENINGS.window.brownDouble
    ];
    [-2.18, -0.73, 0.73, 2.18].forEach((x, index) =>
        createWindow(parent, [x, 3.92, GABLE_Z + 0.12], [0.56, 0.78], "front",
            garageUpperWindows[index]));
    [-1.15, 1.15].forEach((x, index) =>
        createWindow(parent, [x, 5.20, GABLE_Z + 0.12], [0.58, 0.84], "front",
            INDIVIDUAL_OPENINGS.garage.attic));
    createWindow(parent, [0, 6.36, GABLE_Z + 0.12], [0.58, 0.34], "front",
        INDIVIDUAL_OPENINGS.garage.apex);

    const rearGeometry = new THREE.ShapeGeometry(shape);
    const rearTriangle = addMesh(parent, rearGeometry, materials.wall, 0, 4.93, -GABLE_Z, {
        rotation: [0, Math.PI, 0]
    });
    rearTriangle.castShadow = true;
    createWindow(parent, [-1.05, 5.25, -GABLE_Z - 0.12], [0.58, 0.82], "back",
        INDIVIDUAL_OPENINGS.window.brownNarrow);
    createWindow(parent, [1.05, 5.25, -GABLE_Z - 0.12], [0.58, 0.82], "back",
        INDIVIDUAL_OPENINGS.window.brownNarrowCurtain);
}

const PV_MODULE_LENGTH = 1.906;
const PV_MODULE_WIDTH = 1.134;
const PV_MODULE_HEIGHT = 0.030;
const PV_MODULE_VMP = 36.79;
// Der Audi-seitige Zaun steht jetzt dicht an der grauen Zufahrt. Pergola und
// Hausanschluss rücken mit, während ihre Abstände zur Zauninnenseite erhalten
// bleiben. Dadurch verschwindet der unnötig breite Grünstreifen.
const AUDI_SIDE_FENCE_X = 7.20;
// Die Pergola steht in der unteren Grundstücksecke dicht am schrägen Zaun.
// Der zusätzliche Abstand zum Haus schafft davor eine zusammenhängende Wiese.
const PERGOLA_CENTER = new THREE.Vector3(5.75, 0, -13.10);
const PERGOLA_SHIFT_X = PERGOLA_CENTER.x - 8.10;
const pergolaX = (originalX) => originalX + PERGOLA_SHIFT_X;
const PERGOLA_SHIFT_Z = PERGOLA_CENTER.z - (-8.50);
const pergolaZ = (originalZ) => originalZ + PERGOLA_SHIFT_Z;
const PERGOLA_ROOF_Y = 2.62;
const PERGOLA_ROOF_PITCH = THREE.MathUtils.degToRad(12);
const PERGOLA_PANEL_LAYOUT = [
    [-0.61, -1.00],
    [0.61, -1.00],
    [-0.61, 1.00],
    [0.61, 1.00]
];
// Die Balkonplatten liegen im freien Fassadenband zwischen Erdgeschoss und
// Obergeschoss. So stehen sie weder auf unteren Türen noch in den oberen
// Balkontüren.
const BALCONY_FLOOR_Y = 2.43;
const BALCONY_RAIL_BOTTOM_Y = BALCONY_FLOOR_Y + 0.02;
const BALCONY_RAIL_CENTER_Y = BALCONY_FLOOR_Y + 0.39;
const BALCONY_RAIL_TOP_Y = BALCONY_FLOOR_Y + 0.78;
// Die Solarbank steht auf dem rechten Balkon wandnah unter dem einzelnen
// Fenster (z = -1,42). So bleiben beide Balkontüren und das Geländer frei.
const SOLARBANK_POSITION = new THREE.Vector3(3.50, BALCONY_FLOOR_Y + 0.06, -1.42);
// Die zweite, alleinstehende Solarbank 3 sitzt auf dem langen linken Balkon
// unter dem zweiten echten Fenster von rechts (Fensterachse z = 2,72).
const SECONDARY_SOLARBANK_POSITION = new THREE.Vector3(
    3.50, BALCONY_FLOOR_Y + 0.06, 2.72
);
const BALCONY_PANEL_POSITIONS = [
    new THREE.Vector3(4.49, BALCONY_FLOOR_Y + 0.47, 4.02),
    new THREE.Vector3(4.49, BALCONY_FLOOR_Y + 0.47, 5.30)
];
// Der Hausanschluss steht am rechten Längszaun zwischen Audi-Stellplatz
// und Pergola. Die Vorderseite zeigt zur Einfahrt beziehungsweise zum Haus.
const GRID_BOX_POSITION = new THREE.Vector3(AUDI_SIDE_FENCE_X - 0.35, 0, -4.20);

function createBalconies(parent) {
    const balconyGroup = new THREE.Group();
    balconyGroup.userData.hideInCutaway = true;
    parent.add(balconyGroup);
    parent = balconyGroup;
    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x49332f, roughness: 0.8 });
    const sets = [
        { z: 3.00, length: 6.65, depth: 1.34, floorX: 3.82, railX: 4.43 },
        // Beide Balkone reichen gleich weit nach außen; auf dem rechten steht
        // die maßstäbliche Solarbank vollständig hinter dem Geländer. Seine
        // kurzen Wandgeländer sitzen in den beiden freien Fassadenspalten und
        // damit nicht mehr vor Fenster oder Balkontür.
        {
            z: -2.15,
            length: 3.58,
            depth: 1.34,
            floorX: 3.82,
            railX: 4.43,
            wallRailZ: [-3.38, -0.62]
        }
    ];
    sets.forEach((set) => {
        addBox(parent, [set.depth, 0.12, set.length], materials.darkTrim, [set.floorX, BALCONY_FLOOR_Y, set.z]);
        addBox(parent, [0.18, 0.16, set.length - 0.12], railMaterial, [set.railX, BALCONY_RAIL_TOP_Y, set.z], { radius: 0.025 });
        addBox(parent, [0.12, 0.12, set.length - 0.18], railMaterial, [set.railX, BALCONY_RAIL_BOTTOM_Y, set.z]);
        for (let offset = -set.length / 2 + 0.16; offset <= set.length / 2 - 0.16; offset += 0.27) {
            const slat = addBox(parent, [0.11, 0.78, 0.12], railMaterial,
                [set.railX, BALCONY_RAIL_CENTER_Y, set.z + offset], { radius: 0.018 });
            slat.rotation.x = Math.sin(offset * 2.3) * 0.018;
        }
        const endRailLength = set.railX - 3.24;
        const endRailX = (set.railX + 3.24) / 2;
        const wallRailZ = set.wallRailZ || [
            set.z - set.length / 2 + 0.12,
            set.z + set.length / 2 - 0.12
        ];
        wallRailZ.forEach((railZ) => {
            addBox(parent, [endRailLength, 0.16, 0.14], railMaterial,
                [endRailX, BALCONY_RAIL_TOP_Y, railZ]);
            addBox(parent, [0.10, 0.96, 0.14], railMaterial,
                [set.railX, BALCONY_RAIL_CENTER_Y, railZ]);
        });
    });
}

function createPergolaPanels() {
    const pergola = new THREE.Group();
    pergola.position.copy(PERGOLA_CENTER);
    world.add(pergola);

    const postMaterial = new THREE.MeshStandardMaterial({
        color: 0x5a3929,
        roughness: 0.88
    });
    const beamMaterial = new THREE.MeshStandardMaterial({
        color: 0x3f291f,
        roughness: 0.84
    });
    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0xc7d0d5,
        metalness: 0.74,
        roughness: 0.28
    });
    const panelWidth = PV_MODULE_WIDTH;
    const panelLength = PV_MODULE_LENGTH;
    const roofWidth = panelWidth * 2 + 0.18;
    const roofLength = panelLength * 2 + 0.18;
    const roofYAtX = (x) => PERGOLA_ROOF_Y - Math.tan(PERGOLA_ROOF_PITCH) * x;
    const rafterLength = roofWidth / Math.cos(PERGOLA_ROOF_PITCH);

    [-1, 1].forEach((xSign) => [-1, 1].forEach((zSign) => {
        const x = xSign * (roofWidth / 2 - 0.15);
        const z = zSign * (roofLength / 2 - 0.15);
        const postHeight = roofYAtX(x) - 0.06;
        addBox(pergola, [0.17, postHeight, 0.17], postMaterial,
            [x, postHeight / 2, z], { radius: 0.025 });
        addBox(pergola, [0.31, 0.12, 0.31], frameMaterial, [x, 0.06, z], { radius: 0.025 });
    }));
    [-1, 1].forEach((xSign) =>
        addBox(pergola, [0.20, 0.22, roofLength + 0.34], beamMaterial,
            [xSign * (roofWidth / 2 - 0.15),
                roofYAtX(xSign * (roofWidth / 2 - 0.15)) - 0.08,
                0], { radius: 0.025 }));
    [-roofLength / 2 + 0.15, -1.02, 0, 1.02, roofLength / 2 - 0.15].forEach((z) => {
        const rafter = addBox(pergola, [rafterLength, 0.11, 0.12], beamMaterial,
            [0, PERGOLA_ROOF_Y - 0.09, z], { radius: 0.02 });
        rafter.rotation.z = -PERGOLA_ROOF_PITCH;
    });
    const combinerMaterial = new THREE.MeshStandardMaterial({
        color: 0x222c32,
        metalness: 0.46,
        roughness: 0.42
    });
    addBox(pergola, [0.30, 0.36, 0.18], combinerMaterial,
        [-0.98, 2.48, 1.84], { radius: 0.035 });
    addBox(pergola, [0.16, 0.07, 0.025], frameMaterial,
        [-0.98, 2.50, 1.745], { radius: 0.012, castShadow: false });

    PERGOLA_PANEL_LAYOUT.forEach(([x, z], index) => {
        const panel = new THREE.Group();
        panel.position.set(x,
            PERGOLA_ROOF_Y - Math.tan(PERGOLA_ROOF_PITCH) * x + 0.035,
            z);
        panel.rotation.z = -PERGOLA_ROOF_PITCH;
        panel.userData.pvString = "pv" + (index + 1);
        pergola.add(panel);
        addBox(panel, [panelWidth + 0.06, PV_MODULE_HEIGHT + 0.035, panelLength + 0.06],
            frameMaterial, [0, 0, 0], { radius: 0.025 });
        addBox(panel, [panelWidth, PV_MODULE_HEIGHT + 0.045, panelLength],
            materials.solar, [0, 0.025, 0], { radius: 0.018 });
        for (let column = -2; column <= 2; column += 1)
            addBox(panel, [0.012, 0.010, panelLength - 0.10], frameMaterial,
                [column * panelWidth / 6, 0.055, 0], { castShadow: false });
        for (let row = -4; row <= 4; row += 1)
            addBox(panel, [panelWidth - 0.08, 0.010, 0.010], frameMaterial,
                [0, 0.055, row * panelLength / 10], { castShadow: false });
    });
    createPergolaFurniture(pergola);
    return pergola;
}

function createPergolaFurniture(pergola) {
    const furniture = new THREE.Group();
    furniture.userData.hideInCutaway = true;
    pergola.add(furniture);

    const woven = new THREE.MeshStandardMaterial({ color: 0x111417, roughness: 0.94 });
    const cushion = new THREE.MeshStandardMaterial({ color: 0x252a2e, roughness: 0.90 });
    const tabletop = new THREE.MeshStandardMaterial({
        color: 0x080a0c,
        metalness: 0.22,
        roughness: 0.62
    });

    // Schwarzer, niedriger Tisch in der Mitte der Sitzgruppe.
    addBox(furniture, [0.72, 0.09, 1.08], tabletop, [0, 0.48, 0], { radius: 0.045 });
    [-0.27, 0.27].forEach((x) => [-0.43, 0.43].forEach((z) =>
        addBox(furniture, [0.07, 0.44, 0.07], woven, [x, 0.24, z], { radius: 0.018 })));

    // Zweisitzer an der Hausseite, mit zwei getrennten Sitzpolstern.
    addBox(furniture, [0.16, 0.88, 1.76], woven, [-1.02, 0.62, 0], { radius: 0.055 });
    addBox(furniture, [0.62, 0.16, 1.62], woven, [-0.76, 0.38, 0], { radius: 0.050 });
    [-0.80, 0.80].forEach((z) =>
        addBox(furniture, [0.64, 0.58, 0.13], woven, [-0.76, 0.55, z], { radius: 0.045 }));
    [-0.39, 0.39].forEach((z) =>
        addBox(furniture, [0.54, 0.10, 0.67], cushion, [-0.73, 0.50, z], { radius: 0.060 }));

    // Einzelne Sitzbank gegenüber, ebenfalls mit beiden Armlehnen.
    addBox(furniture, [0.16, 0.88, 0.94], woven, [1.02, 0.62, 0.28], { radius: 0.055 });
    addBox(furniture, [0.62, 0.16, 0.80], woven, [0.76, 0.38, 0.28], { radius: 0.050 });
    [-0.41, 0.41].forEach((zOffset) =>
        addBox(furniture, [0.64, 0.58, 0.13], woven,
            [0.76, 0.55, 0.28 + zOffset], { radius: 0.045 }));
    addBox(furniture, [0.54, 0.10, 0.68], cushion, [0.73, 0.50, 0.28], { radius: 0.060 });
}

function createBalconySolarPanels() {
    const group = new THREE.Group();
    world.add(group);
    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0xc7d0d5,
        metalness: 0.74,
        roughness: 0.28
    });
    const panelHeight = PV_MODULE_WIDTH * 0.64;
    const panelWidth = PV_MODULE_LENGTH * 0.64;

    BALCONY_PANEL_POSITIONS.forEach((position, index) => {
        const panel = new THREE.Group();
        panel.position.copy(position);
        panel.rotation.z = THREE.MathUtils.degToRad(-7);
        panel.userData.pvString = "sb3pv" + (index + 1);
        group.add(panel);
        addBox(panel, [0.055, panelHeight + 0.06, panelWidth + 0.06],
            frameMaterial, [0, 0, 0], { radius: 0.025 });
        addBox(panel, [0.065, panelHeight, panelWidth], materials.solar,
            [0.004, 0, 0], { radius: 0.018 });
        for (let column = -2; column <= 2; column += 1)
            addBox(panel, [0.070, panelHeight - 0.06, 0.010], frameMaterial,
                [0.040, 0, column * panelWidth / 6], { castShadow: false });
        for (let row = -3; row <= 3; row += 1)
            addBox(panel, [0.070, 0.010, panelWidth - 0.06], frameMaterial,
                [0.040, row * panelHeight / 8, 0], { castShadow: false });
    });
    return group;
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

    createWindow(bay, [3.85, 3.70, -5.45], [0.72, 1.40], "side",
        INDIVIDUAL_OPENINGS.window.modernTall);
    const cornerWindow = createWindow(bay, [3.76, 3.70, -6.57], [0.80, 1.40], "front",
        INDIVIDUAL_OPENINGS.window.modernCurtain);
    cornerWindow.rotation.y = cornerAngle;
    createWindow(bay, [2.62, 3.70, -6.85], [0.72, 1.40], "back",
        INDIVIDUAL_OPENINGS.window.modernSingle);
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

function createWoodDoorWithCanopy(parent, position, photoSpec = null, size = [0.84, 1.96]) {
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.y = -Math.PI / 2;
    parent.add(group);

    const wood = new THREE.MeshStandardMaterial({ color: 0x5b3424, roughness: 0.86 });
    const canopyWood = new THREE.MeshStandardMaterial({ color: 0x3f2a20, roughness: 0.90 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9c1c5, metalness: 0.82, roughness: 0.26 });
    const cleanAsset = Boolean(photoSpec?.cleanAsset);
    const doorPhoto = makePhotoMaterial(photoSpec, { roughness: 0.32, clearcoat: 0.36 });
    if (cleanAsset && doorPhoto) {
        addBox(group, [size[0] * 0.98, size[1] * 0.98, 0.035], materials.windowInterior,
            [0, -0.02, -0.018], { castShadow: false });
        addBox(group, [size[0], size[1], 0.028], doorPhoto,
            [0, -0.02, 0.015], { castShadow: false });
    }
    else {
        addBox(group, [size[0] + 0.18, size[1] + 0.16, 0.13], materials.darkTrim, [0, 0, 0]);
        const door = addBox(group, [size[0], size[1], 0.15], wood, [0, -0.02, 0.025]);
        [-0.66, -0.30, 0.08, 0.46].forEach((y) =>
            addBox(door, [size[0] * 0.90, 0.035, 0.025], canopyWood, [0, y, 0.09], { castShadow: false }));
        addBox(group, [size[0] * 0.58, 0.42, 0.17], materials.glass, [0, 0.55, 0.05], { castShadow: false });
        addMesh(group, new THREE.SphereGeometry(0.04, 10, 8), metal,
            size[0] * 0.36, -0.12, 0.13, { castShadow: false });
    }

    const canopyWidth = Math.max(1.42, size[0] + 0.42);
    const canopy = addBox(group, [canopyWidth, 0.14, 0.92], canopyWood, [0, 1.28, 0.37]);
    canopy.rotation.x = -0.16;
    [-(canopyWidth / 2 - 0.15), canopyWidth / 2 - 0.15].forEach((x) =>
        addBox(group, [0.09, 0.72, 0.09], canopyWood, [x, 0.96, 0.56]));
}

function createFrontWoodDoor(parent, position, photoSpec = null) {
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.y = Math.PI / 2;
    parent.add(group);

    const doorWood = new THREE.MeshStandardMaterial({ color: 0x4c2e25, roughness: 0.84 });
    const panelWood = new THREE.MeshStandardMaterial({ color: 0x2f1d19, roughness: 0.90 });
    const hardware = new THREE.MeshStandardMaterial({ color: 0xb9c1c5, metalness: 0.82, roughness: 0.24 });
    const cleanAsset = Boolean(photoSpec?.cleanAsset);
    const doorPhoto = makePhotoMaterial(photoSpec, { roughness: 0.32, clearcoat: 0.36 });
    if (cleanAsset && doorPhoto) {
        addBox(group, [0.82, 1.92, 0.035], materials.windowInterior,
            [0, -0.02, -0.018], { castShadow: false });
        addBox(group, [0.84, 1.96, 0.028], doorPhoto,
            [0, -0.02, 0.015], { castShadow: false });
    }
    else {
        addBox(group, [1.00, 2.10, 0.13], materials.darkTrim, [0, 0, 0]);
        const door = addBox(group, [0.84, 1.96, 0.15], doorWood, [0, -0.02, 0.025]);
        [-0.62, -0.27, 0.16, 0.52].forEach((y) =>
            addBox(door, [0.72, 0.045, 0.025], panelWood, [0, y, 0.09], { castShadow: false }));
        addBox(group, [0.46, 0.38, 0.17], materials.glass, [0, 0.56, 0.05], { castShadow: false });
        addBox(group, [0.36, 0.055, 0.035], hardware, [0, -0.18, 0.13], { castShadow: false });
        addMesh(group, new THREE.SphereGeometry(0.04, 10, 8), hardware,
            0.31, -0.08, 0.13, { castShadow: false });
    }
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
    createWindow(house, [3.275, 1.48, 4.90], [0.76, 1.16], "side",
        INDIVIDUAL_OPENINGS.window.modernSingle);
    createWindow(house, [3.275, 1.48, 0.42], [0.88, 0.92], "side",
        INDIVIDUAL_OPENINGS.window.brownDoubleCurtain);
    createWindow(house, [3.275, 1.48, -0.55], [0.88, 0.92], "side",
        INDIVIDUAL_OPENINGS.window.brownDouble);
    createWindow(house, [3.275, 1.48, -2.12], [0.74, 1.16], "side",
        INDIVIDUAL_OPENINGS.window.modernDivided);
    createWindow(house, [3.275, 1.48, -5.46], [0.68, 1.16], "side",
        INDIVIDUAL_OPENINGS.window.modernTall);
    createWindow(house, [3.285, 3.66, 5.45], [1.24, 1.10], "side",
        INDIVIDUAL_OPENINGS.window.brownDoubleCurtain);
    createDoor(house, [3.285, 3.58, 4.10], [0.78, 1.86], "side",
        INDIVIDUAL_OPENINGS.door.balconyLeft);
    createWindow(house, [3.285, 3.66, 2.72], [1.24, 1.10], "side",
        INDIVIDUAL_OPENINGS.window.brownDouble);
    createDoor(house, [3.285, 3.58, 1.45], [0.78, 1.86], "side",
        INDIVIDUAL_OPENINGS.door.balconyLeft);
    createWindow(house, [3.285, 3.66, 0.18], [0.78, 1.10], "side",
        INDIVIDUAL_OPENINGS.window.modernDivided);
    createWindow(house, [3.285, 3.66, -1.42], [0.72, 1.10], "side",
        INDIVIDUAL_OPENINGS.window.modernCurtain);
    createDoor(house, [3.285, 3.58, -2.70], [0.78, 1.86], "side",
        INDIVIDUAL_OPENINGS.door.balconyRight);
    createDoor(house, [3.285, 3.58, -4.06], [0.78, 1.86], "side",
        INDIVIDUAL_OPENINGS.door.balconyRight);
    createFrontWoodDoor(house, [3.30, 1.35, -3.15], CLEAN_OPENINGS.door.wood);
    createDoor(house, [3.30, 1.35, -4.30], [0.80, 1.92], "side",
        INDIVIDUAL_OPENINGS.door.modernEntrance);
    createBayWindow(house);

    // Gartenfassade aus IMG_7397: dunkler Garagenabschnitt und acht Öffnungen in Fotoreihenfolge.
    addBox(house, [0.16, 4.90, 2.45], materials.shingle, [-3.285, 2.50, 5.18]);
    [
        [-5.02, 0.68, INDIVIDUAL_OPENINGS.window.modernSingle],
        [-2.12, 0.68, INDIVIDUAL_OPENINGS.window.modernDivided],
        [-0.62, 0.68, INDIVIDUAL_OPENINGS.window.modernSingle],
        [0.96, 0.78, INDIVIDUAL_OPENINGS.window.modernDivided],
        [2.42, 1.02, INDIVIDUAL_OPENINGS.window.whiteCurtain],
        [3.82, 0.62, INDIVIDUAL_OPENINGS.window.brownDivided],
        [5.22, 1.02, INDIVIDUAL_OPENINGS.window.brownDoubleCurtain]
    ].forEach(([z, width, opening]) => {
        // Das obere Fenster im braunen Schindelabschnitt braucht wegen der
        // vorgehängten Fassadenschicht eine weiter außen liegende Ebene.
        const facadeX = z > 4.5 ? -3.39 : -3.30;
        createWindow(house, [facadeX, 3.70, z], [width, 1.08], "side-back", opening);
    });
    createDoor(house, [-3.285, 3.58, -3.62], [1.18, 1.86], "side-back",
        INDIVIDUAL_OPENINGS.door.balconyDouble);
    createJulietGuard(house, -3.62);
    createWindow(house, [-3.30, 1.50, -4.92], [0.72, 1.10], "side-back",
        INDIVIDUAL_OPENINGS.window.modernCurtain);
    createDoor(house, [-3.30, 1.34, -3.55], [0.82, 1.92], "side-back",
        INDIVIDUAL_OPENINGS.door.rearGlass);
    createWindow(house, [-3.30, 1.46, 0.18], [0.62, 1.10], "side-back",
        INDIVIDUAL_OPENINGS.window.brownNarrow);
    createWoodDoorWithCanopy(house, [-3.30, 1.34, 1.80],
        INDIVIDUAL_OPENINGS.door.rearDecorative, [1.56, 1.92]);
    // Auch das untere Fenster sitzt sichtbar vor den braunen Schindeln.
    createWindow(house, [-3.39, 1.48, 5.08], [1.24, 1.14], "side-back",
        INDIVIDUAL_OPENINGS.window.brownDoubleCurtain);

    // Weiße Heckenseite: zwei Fensterreihen; laut Foto gibt es hier keine Tür.
    // Die rechten Fenster bleiben vor der Erkerkante und schneiden nicht mehr in dessen Rückfläche.
    const rearGableUpper = [
        INDIVIDUAL_OPENINGS.window.modernTall,
        INDIVIDUAL_OPENINGS.window.modernSingle,
        INDIVIDUAL_OPENINGS.window.modernCurtain
    ];
    [-1.92, 0, 1.40].forEach((x, index) =>
        createWindow(house, [x, 3.68, -GABLE_Z - 0.02], [0.72, 1.08], "back",
            rearGableUpper[index]));
    [-1.90, -0.15].forEach((x, index) =>
        createWindow(house, [x, 1.46, -GABLE_Z - 0.02], [0.78, 1.14], "back",
            index === 0 ? INDIVIDUAL_OPENINGS.window.modernDivided : INDIVIDUAL_OPENINGS.window.modernSingle));
    createWindow(house, [1.25, 1.46, -GABLE_Z - 0.02], [0.78, 1.14], "back",
        INDIVIDUAL_OPENINGS.window.modernTall);

    createBalconies(house);
    return house;
}

function createVerticalBatteryGauge(parent, position, size) {
    const gauge = new THREE.Group();
    gauge.position.set(...position);
    parent.add(gauge);
    const outlineMaterial = new THREE.MeshBasicMaterial({
        color: 0xe8fff0,
        transparent: true,
        opacity: 0.88,
        wireframe: true,
        depthTest: false,
        depthWrite: false
    });
    const backgroundMaterial = new THREE.MeshBasicMaterial({
        color: 0x06110a,
        transparent: true,
        opacity: 0.90,
        depthTest: false,
        depthWrite: false
    });
    const fillMaterial = new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        emissive: 0x16a34a,
        emissiveIntensity: 2.8,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
        depthWrite: false
    });
    const waveMaterial = new THREE.MeshStandardMaterial({
        color: 0x86efac,
        emissive: 0x22c55e,
        emissiveIntensity: 5.2,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false
    });
    const outline = addBox(gauge, size, outlineMaterial, [0, 0, 0], {
        radius: 0.018,
        castShadow: false,
        receiveShadow: false
    });
    const background = addBox(gauge, [size[0] * 0.88, size[1] * 0.88, size[2] * 0.52],
        backgroundMaterial, [0, 0, 0.003], {
            radius: 0.013,
            castShadow: false,
            receiveShadow: false
        });
    const fillHeight = size[1] * 0.82;
    const fill = addBox(gauge, [size[0] * 0.82, fillHeight, size[2] * 0.70],
        fillMaterial, [0, 0, 0], {
            radius: 0.012,
            castShadow: false,
            receiveShadow: false
        });
    const wave = addBox(gauge, [size[0] * 0.88, 0.018, size[2] * 0.82],
        waveMaterial, [0, -fillHeight / 2, 0], {
            radius: 0.008,
            castShadow: false,
            receiveShadow: false
        });
    background.renderOrder = 17;
    fill.renderOrder = 18;
    outline.renderOrder = 19;
    wave.renderOrder = 20;
    return {
        fill,
        wave,
        outline,
        background,
        fillMaterial,
        waveMaterial,
        height: fillHeight,
        bottom: -fillHeight / 2,
        levelFraction: 0
    };
}

function createAudiBatteryPack(parent) {
    // Schematisches Hochvolt-Batteriepaket an der realistischen Position:
    // flach im Unterboden zwischen Vorder- und Hinterachse.
    const pack = new THREE.Group();
    pack.position.set(0, 0.34, -0.02);
    parent.add(pack);
    const outlineMaterial = new THREE.MeshBasicMaterial({
        color: 0xc7f9ff,
        transparent: true,
        opacity: 0.76,
        wireframe: true,
        depthTest: false,
        depthWrite: false
    });
    const outline = addBox(pack, [1.38, 0.18, 1.78], outlineMaterial, [0, 0, 0], {
        radius: 0.06,
        castShadow: false,
        receiveShadow: false
    });
    outline.renderOrder = 19;
    const cells = [];
    for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) {
            const material = new THREE.MeshStandardMaterial({
                color: 0x12374b,
                emissive: 0x0ea5e9,
                emissiveIntensity: 0.16,
                transparent: true,
                opacity: 0.22,
                depthTest: false,
                depthWrite: false
            });
            const cell = addBox(pack, [0.27, 0.105, 0.34], material,
                [-0.48 + column * 0.32, 0.01, -0.61 + row * 0.41], {
                    radius: 0.028,
                    castShadow: false,
                    receiveShadow: false
                });
            cell.renderOrder = 20;
            cells.push(cell);
        }
    }
    const waveMaterial = new THREE.MeshStandardMaterial({
        color: 0x86efac,
        emissive: 0x22c55e,
        emissiveIntensity: 4.6,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false
    });
    const wave = addBox(pack, [1.31, 0.035, 0.09], waveMaterial, [0, 0.115, -0.78], {
        radius: 0.018,
        castShadow: false,
        receiveShadow: false
    });
    wave.renderOrder = 21;
    return {
        kind: "audi",
        group: pack,
        cells,
        outline,
        wave,
        waveMaterial,
        level: null,
        mode: "idle"
    };
}

function createSolarBank() {
    const bank = new THREE.Group();
    bank.position.copy(SOLARBANK_POSITION);
    bank.rotation.y = -Math.PI / 2;
    // Im exakten Hausmaßstab war die Anlage auf kleinen Displays kaum
    // erkennbar. Der zweifache Darstellungsmaßstab endet weiterhin direkt
    // unter dem Fenster und lässt alle drei Geräte klar unterscheiden.
    bank.scale.setScalar(2);
    world.add(bank);
    const shell = new THREE.MeshPhysicalMaterial({
        color: 0x8f999e,
        metalness: 0.68,
        roughness: 0.29,
        clearcoat: 0.46,
        clearcoatRoughness: 0.24
    });
    const graphite = new THREE.MeshStandardMaterial({ color: 0x252b2f, metalness: 0.38, roughness: 0.42 });
    const edge = new THREE.MeshStandardMaterial({ color: 0x080b0d, metalness: 0.28, roughness: 0.52 });
    const display = new THREE.MeshPhysicalMaterial({
        color: 0x071116,
        metalness: 0.18,
        roughness: 0.08,
        transmission: 0.06,
        clearcoat: 1
    });
    const cyan = new THREE.MeshStandardMaterial({
        color: 0x6ee7f5,
        emissive: 0x22d3ee,
        emissiveIntensity: 4.2,
        roughness: 0.25
    });

    // Hausmaßstab: 20 × 10 m entsprechen 12,8 × 6,4 Szeneneinheiten.
    // Solarbank 4: 460 × 305 × 355 mm; BP2700: 460 × 233 × 217,5 mm.
    const metre = 0.64;
    const bankWidth = 0.460 * metre;
    const bpHeight = 0.233 * metre;
    const bpDepth = 0.2175 * metre;
    const mainHeight = 0.305 * metre;
    const mainDepth = 0.355 * metre;
    const gap = 0.012;
    const batteryGauges = [];

    for (let level = 0; level < 2; level += 1) {
        const y = bpHeight / 2 + level * (bpHeight + gap);
        addBox(bank, [bankWidth, bpHeight, bpDepth], edge, [0, y, 0], { radius: 0.025 });
        addBox(bank, [bankWidth - 0.018, bpHeight - 0.018, bpDepth - 0.014], graphite,
            [0, y + 0.002, -0.004], { radius: 0.020 });
        addBox(bank, [bankWidth * 0.66, 0.010, bpDepth + 0.004], shell,
            [0, y + bpHeight * 0.18, -0.003], { castShadow: false });
        batteryGauges.push(createVerticalBatteryGauge(bank,
            [0, y, -bpDepth / 2 - 0.014],
            [bankWidth * 0.60, bpHeight * 0.62, 0.018]));
    }

    const mainY = bpHeight * 2 + gap * 2 + mainHeight / 2;
    addBox(bank, [bankWidth, mainHeight, mainDepth], edge, [0, mainY, 0], { radius: 0.028 });
    addBox(bank, [bankWidth - 0.016, mainHeight - 0.016, mainDepth - 0.016], shell,
        [0, mainY - 0.002, -0.003], { radius: 0.024 });
    addBox(bank, [bankWidth * 0.72, mainHeight * 0.30, 0.012], display,
        [0, mainY + mainHeight * 0.16, -mainDepth / 2 - 0.006], { radius: 0.012, castShadow: false });
    addBox(bank, [bankWidth * 0.38, 0.010, 0.014], cyan,
        [0, mainY + mainHeight * 0.15, -mainDepth / 2 - 0.014], { castShadow: false });
    for (let index = -3; index <= 3; index += 1)
        addBox(bank, [0.020, 0.010, mainDepth * 0.62], edge,
            [index * bankWidth / 9, mainY + mainHeight / 2 + 0.002, 0], { castShadow: false });
    // Auch der große Hauptakku zeigt seinen tatsächlichen Füllstand. Die
    // beiden kleineren Anzeigen darunter gehören zu den zwei BP2700-Paketen.
    batteryGauges.push(createVerticalBatteryGauge(bank,
        [0, mainY - mainHeight * 0.09, -mainDepth / 2 - 0.020],
        [bankWidth * 0.88, mainHeight * 0.64, 0.022]));
    solarBankBatteryVisual = {
        kind: "solarbank",
        group: bank,
        gauges: batteryGauges,
        level: null,
        mode: "idle"
    };
    return bank;
}

function createSecondarySolarBank() {
    const bank = new THREE.Group();
    bank.position.copy(SECONDARY_SOLARBANK_POSITION);
    bank.rotation.y = -Math.PI / 2;
    bank.scale.setScalar(2);
    world.add(bank);

    const shell = new THREE.MeshPhysicalMaterial({
        color: 0x737d82,
        metalness: 0.66,
        roughness: 0.30,
        clearcoat: 0.42,
        clearcoatRoughness: 0.25
    });
    const graphite = new THREE.MeshStandardMaterial({
        color: 0x171d20,
        metalness: 0.36,
        roughness: 0.45
    });
    const display = new THREE.MeshPhysicalMaterial({
        color: 0x061116,
        metalness: 0.20,
        roughness: 0.10,
        clearcoat: 1
    });
    const status = new THREE.MeshStandardMaterial({
        color: 0x5eead4,
        emissive: 0x14b8a6,
        emissiveIntensity: 4.0,
        roughness: 0.22
    });

    // Einzelgerät ohne BP2700: dieselbe Haus-Skalierung wie die Solarbank 4,
    // aber bewusst nur ein Gehäuse und eine Akkuanzeige.
    const metre = 0.64;
    const width = 0.460 * metre;
    const height = 0.300 * metre;
    const depth = 0.300 * metre;
    const centerY = height / 2;
    addBox(bank, [width, height, depth], graphite, [0, centerY, 0], { radius: 0.028 });
    addBox(bank, [width - 0.016, height - 0.016, depth - 0.016], shell,
        [0, centerY, -0.003], { radius: 0.024 });
    addBox(bank, [width * 0.72, height * 0.28, 0.012], display,
        [0, centerY + height * 0.17, -depth / 2 - 0.006], {
            radius: 0.012,
            castShadow: false
        });
    addBox(bank, [width * 0.38, 0.010, 0.014], status,
        [0, centerY + height * 0.16, -depth / 2 - 0.014], {
            castShadow: false
        });
    for (let index = -3; index <= 3; index += 1)
        addBox(bank, [0.020, 0.010, depth * 0.62], graphite,
            [index * width / 9, height + 0.002, 0], { castShadow: false });

    const gauge = createVerticalBatteryGauge(bank,
        [0, centerY - height * 0.08, -depth / 2 - 0.020],
        [width * 0.86, height * 0.64, 0.022]);
    secondarySolarBankBatteryVisual = {
        kind: "solarbank",
        group: bank,
        gauges: [gauge],
        level: null,
        mode: "idle"
    };
    return bank;
}

function createInteriorDollhouse() {
    const interior = new THREE.Group();
    interior.visible = false;
    world.add(interior);

    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xb58c64, roughness: 0.82 });
    const innerWall = new THREE.MeshStandardMaterial({ color: 0xf1eadc, roughness: 0.94 });
    const tile = new THREE.MeshStandardMaterial({ color: 0xd9e1df, roughness: 0.78 });
    const furnitureWood = new THREE.MeshStandardMaterial({ color: 0x6e422d, roughness: 0.86 });
    const textileBlue = new THREE.MeshStandardMaterial({ color: 0x345a79, roughness: 0.94 });
    const textileGreen = new THREE.MeshStandardMaterial({ color: 0x56735c, roughness: 0.94 });
    const appliance = new THREE.MeshPhysicalMaterial({
        color: 0xcbd2d4,
        metalness: 0.62,
        roughness: 0.30,
        clearcoat: 0.32
    });
    const screen = new THREE.MeshStandardMaterial({
        color: 0x07131d,
        emissive: 0x38bdf8,
        emissiveIntensity: 0,
        roughness: 0.18
    });
    const fridgeDisplay = screen.clone();
    const tvScreen = screen.clone();
    const pcScreen = screen.clone();
    const livingLamp = new THREE.MeshStandardMaterial({
        color: 0xfff3bf,
        emissive: 0xffc857,
        emissiveIntensity: 0,
        roughness: 0.32
    });
    const bedLamp = livingLamp.clone();
    const devices = [];

    // Zwei voll möblierte Etagen. Die rechte Längsfassade und das Dach werden
    // im Nahbereich ausgeblendet, sodass die Räume wie bei einem Puppenhaus
    // offen und von mehreren Kamerawinkeln einsehbar bleiben.
    [0.63, 2.82].forEach((y, index) =>
        addBox(interior, [5.92, 0.12, 11.86], index === 1 ? tile : floorMaterial,
            [0, y, 0], { castShadow: false }));
    addBox(interior, [0.14, 4.15, 11.86], innerWall, [-2.96, 2.72, 0]);
    [0, -3.35, 3.35].forEach((z) => {
        addBox(interior, [5.86, 0.82, 0.11], innerWall, [0, 1.08, z]);
        addBox(interior, [5.86, 0.78, 0.11], innerWall, [0, 3.27, z]);
    });
    addBox(interior, [0.11, 0.88, 6.65], innerWall, [0.18, 1.12, 1.68]);
    addBox(interior, [0.11, 0.82, 6.65], innerWall, [0.18, 3.30, -1.68]);

    // Die rückwärtige Dachhälfte bleibt als räumlicher Abschluss erhalten,
    // während die kameranahe Hälfte offen ist. Zusammen mit der nebelartig
    // ausgeblendeten Außenhülle entsteht der klare App-Puppenhausstil aus der
    // Referenz, ohne dass die Zimmer wie lose Möbelplatten wirken.
    const innerRoof = new THREE.MeshStandardMaterial({ color: 0xf5efe4, roughness: 0.92 });
    const roofSlope = Math.atan2(2.15, 3.55);
    const innerRoofLength = Math.hypot(3.55, 2.15);
    addBox(interior, [innerRoofLength, 0.13, HOUSE_LENGTH - 0.34], innerRoof,
        [-1.76, 5.86, 0], { rotation: [0, 0, roofSlope], castShadow: false });

    // Warmes, weiches Raumlicht macht jedes Zimmer auch auf dem iPhone klar
    // lesbar. Die Lampen gehören zur Interior-Gruppe und verschwinden deshalb
    // vollständig, sobald wieder herausgezoomt wird.
    [
        [-1.1, 2.15, 4.25], [-1.0, 2.10, 0.25], [-1.0, 2.10, -4.40],
        [-1.1, 4.35, 4.25], [-1.0, 4.32, 0.30], [-1.0, 4.30, -4.35]
    ].forEach(([x, y, z]) => {
        const roomLight = new THREE.PointLight(0xffe2ad, 0.78, 4.3, 1.55);
        roomLight.position.set(x, y, z);
        roomLight.castShadow = false;
        interior.add(roomLight);
    });

    function table(x, y, z, width = 1.15, length = 0.72) {
        addBox(interior, [width, 0.10, length], furnitureWood, [x, y + 0.72, z], { radius: 0.025 });
        [-1, 1].forEach((sx) => [-1, 1].forEach((sz) =>
            addBox(interior, [0.07, 0.70, 0.07], furnitureWood,
                [x + sx * (width / 2 - 0.08), y + 0.35, z + sz * (length / 2 - 0.08)])));
    }

    function sofa(x, y, z, rotation = 0) {
        const group = new THREE.Group();
        group.position.set(x, y, z);
        group.rotation.y = rotation;
        interior.add(group);
        addBox(group, [1.65, 0.42, 0.78], textileGreen, [0, 0.25, 0], { radius: 0.12 });
        addBox(group, [1.65, 0.72, 0.18], textileGreen, [0, 0.52, 0.30], { radius: 0.08 });
        [-0.73, 0.73].forEach((xOffset) =>
            addBox(group, [0.18, 0.56, 0.76], textileGreen, [xOffset, 0.34, 0], { radius: 0.07 }));
    }

    function bed(x, y, z, rotation = 0) {
        const group = new THREE.Group();
        group.position.set(x, y, z);
        group.rotation.y = rotation;
        interior.add(group);
        addBox(group, [1.45, 0.30, 2.05], furnitureWood, [0, 0.24, 0], { radius: 0.08 });
        addBox(group, [1.33, 0.22, 1.90], textileBlue, [0, 0.45, 0], { radius: 0.08 });
        addBox(group, [1.10, 0.18, 0.42], materials.curtain, [0, 0.60, -0.68], { radius: 0.08 });
    }

    function addSocket(id, label, position, baseWatts, schedule, deviceMaterial = null) {
        const group = new THREE.Group();
        group.position.set(...position);
        group.rotation.y = Math.PI / 2;
        interior.add(group);
        const socketFace = new THREE.MeshStandardMaterial({ color: 0xf7f5ee, roughness: 0.70 });
        const led = new THREE.MeshStandardMaterial({
            color: 0x64748b,
            emissive: 0x22c55e,
            emissiveIntensity: 0,
            roughness: 0.40
        });
        addBox(group, [0.28, 0.19, 0.055], socketFace, [0, 0, 0], { radius: 0.035, castShadow: false });
        [-0.065, 0.065].forEach((x) =>
            addMesh(group, new THREE.CircleGeometry(0.025, 12), materials.windowInterior,
                x, 0, 0.032, { castShadow: false }));
        addMesh(group, new THREE.CircleGeometry(0.018, 12), led,
            0, -0.068, 0.034, { castShadow: false });
        devices.push({
            id,
            label,
            position: new THREE.Vector3(...position),
            anchor: new THREE.Vector3(position[0] + 0.24, position[1] + 0.30, position[2]),
            baseWatts,
            schedule,
            led,
            deviceMaterial,
            active: false,
            watts: 0
        });
    }

    // Erdgeschoss: Küche, Wohnen, Hauswirtschaft und technische Grundlast.
    addBox(interior, [0.78, 1.55, 0.74], appliance, [-2.35, 1.42, 4.92], { radius: 0.055 });
    addBox(interior, [0.74, 0.035, 0.62], fridgeDisplay, [-2.34, 1.63, 4.53], { castShadow: false });
    [-1.35, -0.55, 0.25, 1.05].forEach((z) =>
        addBox(interior, [0.62, 0.88, 0.72], furnitureWood, [-2.30, 1.12, z + 2.15], { radius: 0.035 }));
    table(-0.75, 0.66, 3.95, 1.35, 0.80);
    sofa(-1.15, 0.66, -1.72, Math.PI / 2);
    addBox(interior, [1.26, 0.78, 0.12], tvScreen, [-2.82, 1.50, -1.72], { castShadow: false });
    addMesh(interior, new THREE.CylinderGeometry(0.035, 0.045, 1.15, 12), furnitureWood,
        1.70, 1.22, -2.72);
    addMesh(interior, new THREE.SphereGeometry(0.15, 18, 12), livingLamp,
        1.70, 1.82, -2.72, { castShadow: false });
    addBox(interior, [0.78, 0.88, 0.70], appliance, [-2.30, 1.12, -4.95], { radius: 0.08 });
    addMesh(interior, new THREE.TorusGeometry(0.23, 0.045, 12, 24), materials.glass,
        -1.93, 1.12, -4.94, { rotation: [0, Math.PI / 2, 0], castShadow: false });

    // Obergeschoss: Arbeitsplatz für Homeoffice, Schlafen und ein zweiter Wohnbereich.
    table(-1.75, 2.88, 4.45, 1.25, 0.66);
    addBox(interior, [0.78, 0.54, 0.08], pcScreen, [-2.00, 3.98, 4.45], {
        rotation: [0, Math.PI / 2, 0], castShadow: false
    });
    addBox(interior, [0.30, 0.52, 0.50], appliance, [-1.30, 3.26, 4.45], { radius: 0.04 });
    bed(-1.35, 2.88, 0.62, Math.PI / 2);
    addBox(interior, [0.38, 0.42, 0.38], furnitureWood, [1.62, 3.10, 0.64], { radius: 0.04 });
    addMesh(interior, new THREE.SphereGeometry(0.13, 18, 12), bedLamp,
        1.62, 3.48, 0.64, { castShadow: false });
    sofa(-1.35, 2.88, -4.65, 0);
    addBox(interior, [1.10, 0.65, 0.10], screen, [-2.82, 3.86, -4.65], { castShadow: false });

    addSocket("fridge", "Kühlschrank", [-2.82, 1.02, 4.82], 80, "always", fridgeDisplay);
    addSocket("coffee", "Kaffeemaschine", [-2.82, 1.12, 3.20], 900, "coffee");
    addSocket("tv", "Fernseher", [-2.82, 1.12, -1.72], 105, "evening", tvScreen);
    addSocket("living-light", "Wohnzimmerlicht", [-2.82, 1.72, -2.75], 24, "light", livingLamp);
    addSocket("washer", "Waschmaschine", [-2.82, 1.08, -4.95], 620, "washer");
    addSocket("office", "Arbeitsplatz · PC", [-2.82, 3.20, 4.45], 165, "office", pcScreen);
    addSocket("bed-light", "Schlafzimmerlicht", [-2.82, 3.90, 0.62], 18, "light", bedLamp);
    addSocket("router", "Router & Netzwerk", [-2.82, 3.20, -4.65], 22, "always");

    return { group: interior, devices };
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

function createDetailedWheel(car, x, z, tireMaterial, rimMaterial, bodySide, wheelScale = 1) {
    const outerX = x + Math.sign(x) * 0.105;
    const wheel = addMesh(car, new THREE.CylinderGeometry(0.32 * wheelScale, 0.32 * wheelScale, 0.19, 32),
        tireMaterial, x, 0.38, z, { rotation: [0, 0, Math.PI / 2] });
    addMesh(wheel, new THREE.CylinderGeometry(0.155 * wheelScale, 0.155 * wheelScale, 0.195, 24),
        rimMaterial, 0, 0, 0, { castShadow: false });
    addMesh(car, new THREE.TorusGeometry(0.225 * wheelScale, 0.036 * wheelScale, 10, 28), rimMaterial,
        outerX, 0.38, z, { rotation: [0, Math.PI / 2, 0], castShadow: false });
    for (let spoke = 0; spoke < 5; spoke += 1)
        addBox(car, [0.026, 0.235 * wheelScale, 0.030], rimMaterial, [outerX, 0.38, z], {
            rotation: [spoke * Math.PI / 5 + 0.16, 0, 0],
            castShadow: false
        });
    addMesh(car, new THREE.CylinderGeometry(0.050, 0.050, 0.205, 20),
        rimMaterial, outerX, 0.38, z, { rotation: [0, 0, Math.PI / 2], castShadow: false });

    // Sichtbare Radhauskante und Seitenschweller statt einer glatten Spielzeug-Karosserie.
    addMesh(car, new THREE.TorusGeometry(0.345 * wheelScale, 0.025, 8, 28), tireMaterial,
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
    const rim = new THREE.MeshStandardMaterial({ color: isAudi ? 0x06080a : 0x85909a, metalness: 0.86, roughness: 0.25 });
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
        createDetailedWheel(car, x, z, black, rim, sideX, isAudi ? 1.10 : 1));

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

function createLicensePlateTexture(text) {
    const plateCanvas = document.createElement("canvas");
    plateCanvas.width = 640;
    plateCanvas.height = 144;
    const context = plateCanvas.getContext("2d");
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, plateCanvas.width, plateCanvas.height);
    context.fillStyle = "#1559a6";
    context.fillRect(0, 0, 58, plateCanvas.height);
    context.fillStyle = "#facc15";
    for (let index = 0; index < 6; index += 1) {
        const angle = index / 6 * Math.PI * 2;
        context.beginPath();
        context.arc(29 + Math.cos(angle) * 13, 55 + Math.sin(angle) * 13, 2.7, 0, Math.PI * 2);
        context.fill();
    }
    context.fillStyle = "#101820";
    context.font = "900 70px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 350, 74);
    context.strokeStyle = "#111827";
    context.lineWidth = 8;
    context.strokeRect(4, 4, 632, 136);
    const texture = new THREE.CanvasTexture(plateCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
}

function addVehiclePlates(slot, text, placement) {
    const {
        frontDepth,
        rearDepth = frontDepth,
        frontY = 0.52,
        rearY = frontY
    } = placement;
    const material = new THREE.MeshStandardMaterial({
        map: createLicensePlateTexture(text),
        roughness: 0.48,
        side: THREE.DoubleSide
    });
    const front = addMesh(slot, new THREE.PlaneGeometry(0.70, 0.16), material,
        0, frontY, frontDepth, { castShadow: false });
    front.renderOrder = 6;
    const rear = addMesh(slot, new THREE.PlaneGeometry(0.70, 0.16), material,
        0, rearY, -rearDepth, { rotation: [0, Math.PI, 0], castShadow: false });
    rear.renderOrder = 6;
}

function createAudiBrakeLights(slot) {
    const lights = new THREE.Group();
    lights.name = "Audi brake lights";
    slot.add(lights);
    const material = new THREE.MeshStandardMaterial({
        color: 0x8b1018,
        emissive: 0xff1f2d,
        emissiveIntensity: 0.12,
        roughness: 0.30,
        metalness: 0.12,
        transparent: true,
        opacity: 0.92,
        depthWrite: false
    });
    [-0.62, 0.62].forEach((x) => {
        addBox(lights, [0.42, 0.13, 0.045], material, [x, 0.78, -2.015], {
            radius: 0.035,
            castShadow: false
        });
    });
    lights.visible = false;
    return { group: lights, material };
}

function createVehicles() {
    const audiSlot = new THREE.Group();
    audiSlot.position.set(5.00, 0.02, 1.0);
    audiSlot.rotation.y = Math.PI;
    world.add(audiSlot);
    const audiFallback = createCar(0x008dc8, "audi-q3");
    audiFallback.scale.set(1.10, 1.17, 1.08);
    audiSlot.add(audiFallback);
    const audiBattery = createAudiBatteryPack(audiSlot);
    const audiBrakeLights = createAudiBrakeLights(audiSlot);
    // Die Detailmodelle enden an der Heckklappe etwas früher als ihre
    // prozeduralen Platzhalter. Getrennte Vorder-/Heckpositionen verhindern,
    // dass das Kennzeichen sichtbar vor dem vorgesehenen Ausschnitt schwebt.
    addVehiclePlates(audiSlot, "FDS-LD-900", {
        frontDepth: 2.07, rearDepth: 1.985, frontY: 0.52, rearY: 0.82
    });

    // IMG_7378: schwarzer Skoda Yeti mittig, kleiner schwarzer VW Fox ganz rechts.
    const yetiSlot = new THREE.Group();
    yetiSlot.position.set(0, 0.02, 8.72);
    world.add(yetiSlot);
    const yetiFallback = createCar(0x1b2329, "skoda-yeti");
    yetiFallback.scale.set(1.04, 1.16, 1.08);
    yetiSlot.add(yetiFallback);
    addVehiclePlates(yetiSlot, "FDS-SL-600", {
        frontDepth: 1.94, rearDepth: 1.94
    });

    const foxSlot = new THREE.Group();
    foxSlot.position.set(2.10, 0.02, 8.45);
    // Die Garagentore liegen aus Sicht des Stellplatzes in negativer Z-Richtung.
    // Eine halbe Drehung stellt deshalb den Fox mit der Motorhaube zur Garage.
    foxSlot.rotation.y = Math.PI;
    world.add(foxSlot);
    const foxFallback = createCar(0x202327, "vw-fox");
    foxFallback.scale.set(0.82, 0.88, 0.80);
    foxSlot.add(foxFallback);
    addVehiclePlates(foxSlot, "FDS-SR-700", {
        frontDepth: 1.76, rearDepth: 1.76
    });

    // Vor dem linken Tor steht der schwarze Karoq ebenfalls mit seiner Front
    // zum Gebäude. Bis das Detailmodell geladen ist, bleibt ein gleich großer
    // prozeduraler SUV als ausfallsicherer Platzhalter sichtbar.
    const karoqSlot = new THREE.Group();
    karoqSlot.position.set(-2.10, 0.02, 8.72);
    // Das Karoq-Quellmodell definiert die Front entgegengesetzt zu den anderen
    // Fahrzeugdateien. Ohne zusätzliche Halbdrehung zeigt seine Haube zur Garage.
    karoqSlot.rotation.y = 0;
    world.add(karoqSlot);
    const karoqFallback = createCar(0x14191d, "skoda-yeti");
    karoqFallback.scale.set(1.12, 1.14, 1.14);
    karoqSlot.add(karoqFallback);
    addVehiclePlates(karoqSlot, "FDS-KS-800", {
        frontDepth: 2.03, rearDepth: 1.945, frontY: 0.52, rearY: 0.81
    });

    return {
        audi: {
            slot: audiSlot,
            fallback: audiFallback,
            battery: audiBattery,
            brakeLights: audiBrakeLights
        },
        yeti: { slot: yetiSlot, fallback: yetiFallback },
        fox: { slot: foxSlot, fallback: foxFallback },
        karoq: { slot: karoqSlot, fallback: karoqFallback }
    };
}

const vehicleLoader = new GLTFLoader();
vehicleLoader.setMeshoptDecoder(MeshoptDecoder);

function tuneVehicleMaterials(model, paintColor, options = {}) {
    model.traverse((object) => {
        if (!object.isMesh)
            return;
        object.castShadow = true;
        object.receiveShadow = true;
        const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
        const tunedMaterials = sourceMaterials.map((source) => {
            const material = source.clone();
            const name = (material.name || "").toLowerCase();
            const isGlass = name.includes("window") || name.includes("glass");
            const isPaint = name.includes("carpaint") || name === "body" ||
                name.startsWith("body.") || name === "primary";
            const objectName = (object.name || "").toLowerCase();
            const isBrightTrim = /chrome|silver|alum|trim|metal|rim|wheel/.test(name + " " + objectName);
            if (isPaint) {
                material.color.setHex(paintColor);
                material.metalness = 0.70;
                material.roughness = 0.20;
            }
            if (isGlass) {
                material.transparent = true;
                material.opacity = Math.min(material.opacity ?? 1, 0.72);
                material.depthWrite = false;
                object.castShadow = false;
            }
            if (options.blackOut && isBrightTrim && !isGlass) {
                material.color.setHex(0x07090b);
                material.metalness = 0.78;
                material.roughness = 0.24;
            }
            if (!isGlass) {
                // Einige frei verfügbare Fahrzeugdateien markieren selbst Lack,
                // Reifen und Innenraum fälschlich als transparent (z. B. 25 %).
                material.transparent = false;
                material.opacity = 1;
                material.depthWrite = true;
                material.alphaTest = 0;
            }
            if (name.includes("light") && material.color) {
                material.emissive = material.color.clone().multiplyScalar(0.32);
                material.emissiveIntensity = 0.72;
            }
            material.needsUpdate = true;
            return material;
        });
        object.material = Array.isArray(object.material) ? tunedMaterials : tunedMaterials[0];
    });
}

function normalizeVehicleModel(model, targetLength, paintColor, orientation = {}, options = {}) {
    model.updateMatrixWorld(true);
    let bounds = new THREE.Box3().setFromObject(model);
    const initialSize = bounds.getSize(new THREE.Vector3());
    const longestAxis = [
        ["x", initialSize.x],
        ["y", initialSize.y],
        ["z", initialSize.z]
    ].sort((a, b) => b[1] - a[1])[0][0];
    // Sketchfab-Dateien können ihre Fahrzeuglänge auf X, Y oder Z ablegen.
    // Die längste Achse wird deshalb zuerst zuverlässig auf unsere Z-Achse gelegt.
    if (longestAxis === "x")
        model.rotation.y += Math.PI / 2;
    else if (longestAxis === "y")
        model.rotation.x += Math.PI / 2;
    model.rotation.x += orientation.x || 0;
    model.rotation.y += orientation.y || 0;
    model.rotation.z += orientation.z || 0;
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);
    const orientedSize = bounds.getSize(new THREE.Vector3());
    const horizontalLength = Math.max(orientedSize.x, orientedSize.z);
    model.scale.multiplyScalar(targetLength / Math.max(horizontalLength, 0.001));
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.y -= bounds.min.y;
    model.position.z -= center.z;
    tuneVehicleMaterials(model, paintColor, options);
}

function loadVehicleAsset(vehicle, config) {
    vehicleLoader.load(config.url, (gltf) => {
        const model = gltf.scene;
        model.name = config.name;
        normalizeVehicleModel(model, config.length, config.paint, config.orientation, config);
        vehicle.slot.add(model);

        const shadowMaterial = new THREE.MeshBasicMaterial({
            color: 0x050708,
            transparent: true,
            opacity: 0.30,
            depthWrite: false
        });
        const shadow = addMesh(vehicle.slot, new THREE.CircleGeometry(1, 40), shadowMaterial,
            0, 0.015, 0, {
                rotation: [-Math.PI / 2, 0, 0],
                castShadow: false,
                receiveShadow: false
            });
        shadow.scale.set(config.width * 0.46, config.length * 0.46, 1);
        vehicle.slot.remove(vehicle.fallback);
        vehicle.slot.userData.assetLoaded = true;
    }, undefined, () => {
        // Bei einem Netzfehler bleibt das vorhandene prozedurale Fahrzeug sichtbar.
        vehicle.slot.userData.assetLoaded = false;
    });
}

function loadDetailedVehicles(vehicles) {
    loadVehicleAsset(vehicles.audi, {
        name: "Audi Q3",
        url: "/static/models/audi-q3.glb",
        length: 3.95,
        width: 1.84,
        paint: 0x008dc8,
        blackOut: true
    });
    loadVehicleAsset(vehicles.yeti, {
        name: "Skoda Yeti",
        url: "/static/models/skoda-yeti.glb",
        length: 3.72,
        width: 1.78,
        paint: 0x161d22,
        // Das Quellmodell definiert seine Höhe in negativer Y-Richtung.
        // Nach der automatischen Längsausrichtung dreht diese Korrektur den
        // Wagen aufrecht auf seine Räder.
        orientation: { x: -Math.PI }
    });
    loadVehicleAsset(vehicles.fox, {
        name: "Volkswagen Fox",
        url: "/static/models/vw-fox.glb",
        // Maßstab passend zum 3,72 langen Yeti: Der echte Fox ist nur
        // rund zehn Prozent kürzer, nicht ein Drittel.
        length: 3.38,
        width: 1.68,
        paint: 0x191d20
    });
    loadVehicleAsset(vehicles.karoq, {
        name: "Skoda Karoq",
        url: "/static/models/skoda-karoq.glb",
        // Gemeinsamer Szenenmaßstab: real 4,39 m gegenüber 4,22 m beim Yeti.
        // Der Karoq ist deshalb im Modell nur rund vier Prozent länger.
        length: 3.87,
        width: 1.84,
        paint: 0x12171b
    });
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

// Aus der blauen Grundstücksgrenze in IMG_7437 abgeleitete, vereinfachte
// Polygonkontur. +X zeigt zur langen Straße, +Z zur Garagenseite. Der lange
// diagonale Feldrand trifft die Straße erst deutlich hinter dem Haus; dadurch
// bleibt der Zaun am hinteren Hauseck maßstäblich rund 2,5 m entfernt.
const PROPERTY_BOUNDARY = [
    [7.20, 11.20],
    [7.20, -16.50],
    [-11.50, -1.00],
    [-9.00, 2.40],
    [-6.90, 4.40],
    [-8.70, 13.70],
    [-6.20, 15.50],
    [-1.10, 16.80],
    [4.70, 15.70]
];

function pointInPolygon(x, z, polygon) {
    let inside = false;
    for (let current = 0, previous = polygon.length - 1;
        current < polygon.length; previous = current++) {
        const [currentX, currentZ] = polygon[current];
        const [previousX, previousZ] = polygon[previous];
        const crosses = (currentZ > z) !== (previousZ > z) &&
            x < (previousX - currentX) * (z - currentZ) /
                (previousZ - currentZ || Number.EPSILON) + currentX;
        if (crosses)
            inside = !inside;
    }
    return inside;
}

function addHorizontalPolygon(parent, points, material, y = 0) {
    const shape = new THREE.Shape();
    points.forEach(([x, z], index) => {
        // ShapeGeometry liegt zunächst in XY. -Z wird nach der Drehung
        // wieder zu +Z in der horizontalen Weltkoordinate.
        if (index === 0)
            shape.moveTo(x, -z);
        else
            shape.lineTo(x, -z);
    });
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    parent.add(mesh);
    return mesh;
}

function createFencePath(points, material, height = 0.82) {
    points.slice(0, -1).forEach((start, index) => {
        const end = points[index + 1];
        const dx = end[0] - start[0];
        const dz = end[1] - start[1];
        const length = Math.hypot(dx, dz);
        const angle = -Math.atan2(dz, dx);
        const center = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
        [0.27, 0.66].forEach((railY) =>
            addBox(world, [length, 0.10, 0.10], material,
                [center[0], railY, center[1]], { rotation: [0, angle, 0] }));
        const posts = Math.max(1, Math.ceil(length / 0.70));
        for (let post = 0; post <= posts; post += 1) {
            const progress = post / posts;
            addBox(world, [0.10, height, 0.10], material, [
                THREE.MathUtils.lerp(start[0], end[0], progress),
                height / 2,
                THREE.MathUtils.lerp(start[1], end[1], progress)
            ]);
        }
    });
}

function createShrub(x, z, scale = 1, color = 0x315e34) {
    const shrub = new THREE.Group();
    shrub.position.set(x, 0, z);
    shrub.scale.setScalar(scale);
    world.add(shrub);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.98 });
    [
        [-0.34, 0.48, 0.02, 0.58],
        [0.30, 0.44, -0.08, 0.54],
        [0.02, 0.66, 0.22, 0.64],
        [0.00, 0.52, -0.32, 0.56]
    ].forEach(([offsetX, y, offsetZ, radius]) =>
        addMesh(shrub, new THREE.IcosahedronGeometry(radius, 1), material,
            offsetX, y, offsetZ, { castShadow: true }));
}

function createDeciduousTree(x, z, scale = 1) {
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);
    tree.scale.setScalar(scale);
    world.add(tree);
    const trunk = new THREE.MeshStandardMaterial({ color: 0x5c3c2b, roughness: 1 });
    const leaves = new THREE.MeshStandardMaterial({ color: 0x2f6336, roughness: 0.98 });
    addMesh(tree, new THREE.CylinderGeometry(0.18, 0.28, 2.65, 12), trunk, 0, 1.32, 0);
    [
        [-0.62, 2.75, 0.08, 1.00],
        [0.55, 2.72, -0.08, 1.05],
        [0.02, 3.35, 0.12, 1.18],
        [0.02, 2.72, 0.70, 0.88],
        [-0.06, 2.80, -0.72, 0.92]
    ].forEach(([offsetX, y, offsetZ, radius]) =>
        addMesh(tree, new THREE.IcosahedronGeometry(radius, 2), leaves,
            offsetX, y, offsetZ, { castShadow: true }));
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
        const x = -11.2 + random() * 18.2;
        const z = -10.8 + random() * 22.4;
        if (!pointInPolygon(x, z, PROPERTY_BOUNDARY))
            continue;
        const onHouse = Math.abs(x) < 3.85 && Math.abs(z) < 6.95;
        const onForecourt = z > 4.55 && z < 15.35 && x > -6.5 && x < 6.8;
        const onAudiDrive = x > 3.15 && z > -6.55 && z < 6.7;
        const onRearPatio = x < -3.10 && x > -7.10 && z > -2.10 && z < 5.90;
        const aroundPool = Math.hypot(x + 7.19, z + 5.92) < 3.10;
        const aroundPond = Math.hypot((x + 4.85) / 1.35, (z - 14.78) / 0.98) < 1.18;
        const underPergola = Math.abs(x - PERGOLA_CENTER.x) < 1.55 &&
            Math.abs(z - PERGOLA_CENTER.z) < 2.25;
        if (onHouse || onForecourt || onAudiDrive || onRearPatio || aroundPool || aroundPond || underPergola)
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

function createGoldfishPond() {
    const pond = new THREE.Group();
    // IMG_7437: Der blau eingekreiste Teich liegt dort, wo zuvor fälschlich
    // zwei Bäume standen. Diese Baumgruppe rückt im Gegenzug in die alte
    // Teichposition an der linken Grundstücksecke.
    pond.position.set(-4.85, 0.035, 14.78);
    pond.rotation.y = THREE.MathUtils.degToRad(-12);
    world.add(pond);

    const basinMaterial = new THREE.MeshStandardMaterial({ color: 0x24362f, roughness: 0.96 });
    const pondWater = materials.water.clone();
    pondWater.color.set(0x176f83);
    pondWater.opacity = 0.72;
    pondWater.transmission = 0.18;
    pondWater.depthWrite = false;
    const basin = addMesh(pond, new THREE.CircleGeometry(1.12, 48), basinMaterial,
        0, -0.02, 0, { rotation: [-Math.PI / 2, 0, 0], castShadow: false });
    basin.scale.set(1.18, 0.82, 1);
    const water = addMesh(pond, new THREE.CircleGeometry(1.04, 48), pondWater,
        0, 0.045, 0, { rotation: [-Math.PI / 2, 0, 0], castShadow: false });
    water.scale.set(1.18, 0.82, 1);
    water.renderOrder = 4;

    const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0x77766e, roughness: 0.96 });
    const stoneShade = new THREE.MeshStandardMaterial({ color: 0x99978d, roughness: 0.94 });
    for (let index = 0; index < 28; index += 1) {
        const angle = index / 28 * Math.PI * 2;
        const radiusX = 1.24 + Math.sin(index * 2.7) * 0.05;
        const radiusZ = 0.90 + Math.cos(index * 2.1) * 0.04;
        const stone = addMesh(pond, new THREE.DodecahedronGeometry(0.13 + (index % 3) * 0.018, 0),
            index % 4 === 0 ? stoneShade : stoneMaterial,
            Math.cos(angle) * radiusX, 0.09, Math.sin(angle) * radiusZ);
        stone.scale.set(1.25, 0.62, 0.90);
        stone.rotation.y = angle;
    }

    const lilyMaterial = new THREE.MeshStandardMaterial({
        color: 0x3f7d45,
        roughness: 0.88,
        side: THREE.DoubleSide
    });
    [[-0.52, -0.25, 0.15], [0.36, 0.27, 0.12], [0.66, -0.18, 0.10]].forEach(([x, z, radius]) => {
        const lily = addMesh(pond, new THREE.CircleGeometry(radius, 18), lilyMaterial,
            x, 0.075, z, { rotation: [-Math.PI / 2, 0, 0], castShadow: false });
        lily.scale.y = 0.72;
    });

    const fishColors = [0xff8a18, 0xf5b942, 0xff6b14, 0xf1eee3, 0xe65319];
    const random = seededNoise(7437);
    for (let index = 0; index < 8; index += 1) {
        const fish = new THREE.Group();
        const fishMaterial = new THREE.MeshStandardMaterial({
            color: fishColors[index % fishColors.length],
            roughness: 0.46,
            emissive: index === 3 ? 0x5b4b31 : 0x3d1503,
            emissiveIntensity: 0.12
        });
        const body = addMesh(fish, new THREE.SphereGeometry(0.10, 12, 8), fishMaterial,
            0, 0, 0, { castShadow: false });
        body.scale.set(0.70, 0.42, 1.28);
        addMesh(fish, new THREE.ConeGeometry(0.085, 0.16, 3), fishMaterial,
            0, 0, -0.16, { rotation: [Math.PI / 2, 0, 0], castShadow: false });
        fish.position.y = 0.085 + random() * 0.012;
        fish.scale.setScalar(0.78 + random() * 0.48);
        pond.add(fish);
        pondFish.push({
            group: fish,
            phase: random() * Math.PI * 2,
            speed: 0.16 + random() * 0.13,
            radiusX: 0.28 + random() * 0.54,
            radiusZ: 0.18 + random() * 0.38,
            wobble: 0.7 + random() * 0.8
        });
    }
}

function createGarden() {
    // Große Umgebungsfläche und die tatsächliche, unregelmäßige Parzelle.
    // Außerhalb der Grenze bleibt die Wiese des Luftbilds sichtbar.
    addBox(world, [46.0, 0.25, 46.0], materials.grass, [0, -0.18, 0], { castShadow: false });
    addHorizontalPolygon(world, PROPERTY_BOUNDARY, materials.grass, -0.045);

    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x555b5f, roughness: 1 });
    const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0xa4a49e, roughness: 0.96 });
    const curbMaterial = new THREE.MeshStandardMaterial({ color: 0xd7d4cb, roughness: 0.94 });
    const asphaltMaterial = new THREE.MeshStandardMaterial({ color: 0x424849, roughness: 0.98 });
    const markingMaterial = new THREE.MeshStandardMaterial({ color: 0xf1efe5, roughness: 0.82 });

    // Lange Straße an der Vorderseite und die quer anschließende Straße
    // an der Garagenseite. Beide reichen über den Bildausschnitt hinaus.
    addHorizontalPolygon(world, [
        [7.82, -18.80], [13.20, -20.20], [13.20, 22.40],
        [8.00, 21.20], [7.82, 11.20]
    ], roadMaterial, -0.025);
    addHorizontalPolygon(world, [
        [8.00, 14.10], [13.20, 15.40], [7.20, 20.20], [-1.20, 20.90],
        [-8.50, 18.20], [-10.10, 15.10], [-8.70, 13.70],
        [-6.20, 15.50], [-1.10, 16.80], [4.70, 15.70]
    ], roadMaterial, -0.022);

    // Gehwege folgen den beiden Straßenseiten der blauen Grenze.
    addHorizontalPolygon(world, [
        [7.20, -16.50], [7.82, -18.80], [7.82, 11.20], [7.20, 11.20]
    ], sidewalkMaterial, 0.006);
    addHorizontalPolygon(world, [
        [7.20, 11.20], [8.00, 14.10], [4.70, 16.45], [-1.10, 17.55],
        [-6.50, 16.25], [-9.45, 14.35], [-8.70, 13.70],
        [-6.20, 15.50], [-1.10, 16.80], [4.70, 15.70]
    ], sidewalkMaterial, 0.008);
    addBox(world, [0.12, 0.08, 27.70], curbMaterial, [7.18, 0.035, -2.65], { castShadow: false });

    // Unterbrochene Fahrbahnmarkierungen machen beide Straßenzüge auch
    // bei flacher Kameraperspektive eindeutig erkennbar.
    for (let z = -18.0; z <= 21.0; z += 2.15)
        addBox(world, [0.10, 0.025, 1.10], markingMaterial, [10.55, 0.038, z], { castShadow: false });
    for (let x = -7.2; x <= 7.0; x += 2.15)
        addBox(world, [1.10, 0.025, 0.10], markingMaterial, [x, 0.038, 18.55], { castShadow: false });

    createGrassDetail();

    // Befestigte Flächen aus der Draufsicht: Garagenvorplatz, langer
    // straßenseitiger Stellplatz und der dunklere Hof auf der Gartenseite.
    addHorizontalPolygon(world, [
        [-3.55, 5.85], [3.55, 5.85], [6.80, 7.10], [6.55, 13.95],
        [4.10, 15.15], [-1.20, 16.05], [-5.35, 14.55], [-6.35, 11.35],
        [-3.70, 9.60]
    ], materials.paving, 0.022);
    addBox(world, [3.2, 0.07, 13.2], materials.paving, [4.80, 0.03, 0.20], { castShadow: false });
    addHorizontalPolygon(world, [
        [-3.25, 5.70], [-6.55, 5.05], [-6.70, 1.65],
        [-6.15, -1.85], [-3.25, -5.30]
    ], asphaltMaterial, 0.018);

    const pool = new THREE.Group();
    // Aus dem Luftbild auf die reale Intex-Größe (ca. 5,5 × 2,7 m)
    // skaliert und parallel zur diagonalen Feldgrenze positioniert.
    // Gegenüber der letzten Vorschau einen Meter weiter von der Pergola weg.
    // Die Bewegung verläuft parallel zum Zaun; die breite Holzplattform bleibt
    // deshalb weiterhin nahezu bündig an der unteren Grundstücksgrenze.
    pool.position.set(-7.19, 0, -5.92);
    pool.rotation.y = THREE.MathUtils.degToRad(-60);
    world.add(pool);
    const poolWall = new THREE.MeshStandardMaterial({ color: 0x374552, metalness: 0.22, roughness: 0.68 });
    addBox(pool, [1.82, 0.88, 3.55], poolWall, [0, 0.43, 0], { radius: 0.10 });
    addBox(pool, [1.58, 0.10, 3.30], materials.water, [0, 0.89, 0], { radius: 0.10, castShadow: false });
    const poolRail = new THREE.MeshStandardMaterial({ color: 0xd7d9d5, roughness: 0.50 });
    [-0.86, 0.86].forEach((x) => addBox(pool, [0.07, 0.07, 3.42], poolRail, [x, 0.94, 0]));
    [-1.70, 1.70].forEach((z) => addBox(pool, [1.70, 0.07, 0.07], poolRail, [0, 0.94, z]));

    // Begehbare Holzumrandung mit einer breiten Liegefläche zum hinteren
    // Zaun. Die einzelnen Bretter behalten beim Drehen die Poolausrichtung.
    const deckWood = new THREE.MeshStandardMaterial({ color: 0x8a5d3b, roughness: 0.88 });
    const deckEdge = new THREE.MeshStandardMaterial({ color: 0x4b3024, roughness: 0.92 });
    [-1.14, 1.14].forEach((x) =>
        addBox(pool, [0.42, 0.14, 4.05], deckWood, [x, 0.91, 0], { radius: 0.025 }));
    addBox(pool, [2.70, 0.14, 0.42], deckWood, [0, 0.91, 1.98], { radius: 0.025 });
    // Breite Liegeplattform entlang der langen, zum Zaun gerichteten Seite.
    addBox(pool, [1.02, 0.15, 4.05], deckWood, [-1.82, 0.91, 0], { radius: 0.025 });
    for (let z = -1.72; z <= 1.72; z += 0.20)
        addBox(pool, [0.94, 0.022, 0.05], deckEdge, [-1.82, 1.00, z], { castShadow: false });

    const lounger = new THREE.Group();
    lounger.position.set(-1.82, 1.03, 0.08);
    lounger.scale.setScalar(0.72);
    lounger.rotation.y = -0.06;
    pool.add(lounger);
    const loungerFrame = new THREE.MeshStandardMaterial({ color: 0xd7dde0, metalness: 0.55, roughness: 0.34 });
    const loungerFabric = new THREE.MeshStandardMaterial({ color: 0xe7e4dc, roughness: 0.76 });
    addBox(lounger, [0.78, 0.08, 1.54], loungerFabric, [0, 0.18, 0.12], { radius: 0.08 });
    const back = addBox(lounger, [0.78, 0.08, 0.72], loungerFabric, [0, 0.48, -0.68], { radius: 0.08 });
    back.rotation.x = -0.72;
    [-0.32, 0.32].forEach((x) => {
        addBox(lounger, [0.055, 0.36, 0.055], loungerFrame, [x, 0.03, 0.58]);
        addBox(lounger, [0.055, 0.36, 0.055], loungerFrame, [x, 0.03, -0.48]);
    });

    createGoldfishPond();

    // Der zuvor mittig vor den Garagen stehende Baum rückt links neben den
    // Teich. Am Pool selbst gibt es laut Luftbild weiterhin keinen Baum.
    [
        [-6.82, 14.58, 0.72], [-6.65, 12.25, 0.86], [-7.65, 12.75, 0.76],
        [-8.45, 11.25, 0.70], [-8.25, 4.10, 0.60]
    ].forEach(([x, z, scale]) => createDeciduousTree(x, z, scale));
    [
        [-6.55, 10.15, 0.82], [-7.65, 6.15, 0.72], [-8.90, 2.55, 0.76],
        [-10.10, 0.35, 0.72], [-2.10, -9.25, 0.62], [-0.60, -9.75, 0.60]
    ].forEach(([x, z, scale]) => createShrub(x, z, scale));

    // Der Holzzaun folgt jetzt der eingezeichneten Feld- und Gartengrenze,
    // statt das Grundstück als unzutreffendes Rechteck einzufassen.
    const fence = new THREE.MeshStandardMaterial({ color: 0x6a5848, roughness: 1 });
    const rearFenceJunction = [-11.50, -6.42];
    // Der von der Garagenseite kommende Zaun endet exakt auf Höhe der
    // hinteren Hausecke. Der von rechts kommende Abschnitt wird bis zu diesem
    // gemeinsamen Eckpunkt verlängert, sodass kein offener Spalt bleibt.
    createFencePath([
        [-8.70, 13.70], [-6.90, 4.40], [-9.00, 2.40],
        [-11.50, -1.00], rearFenceJunction
    ], fence, 0.84);
    createFencePath([[7.20, -16.50], rearFenceJunction], fence, 0.84);
    // Der straßenseitige Zaun läuft von der Pergola bis auf Höhe des
    // Garagengiebels. Erst dahinter bleibt die Einfahrt zu den drei Autos offen.
    createFencePath([[7.20, -16.50], [7.20, 6.35]], fence, 0.88);
}

function createGridBox() {
    const group = new THREE.Group();
    group.position.copy(GRID_BOX_POSITION);
    group.rotation.y = -Math.PI / 2;
    world.add(group);
    const casing = new THREE.MeshStandardMaterial({ color: 0xd9d9d1, roughness: 0.72 });
    addBox(group, [0.58, 1.05, 0.42], casing, [0, 0.55, 0], { radius: 0.05 });
    addBox(group, [0.44, 0.33, 0.025], materials.glass, [0, 0.69, 0.225], { castShadow: false });
    return group;
}

function createAudiChargeConnection() {
    const connectorMaterial = new THREE.MeshStandardMaterial({ color: 0x172027, roughness: 0.46, metalness: 0.25 });
    const handleMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xf7fafc,
        roughness: 0.28,
        clearcoat: 0.78,
        clearcoatRoughness: 0.18
    });
    const contactMaterial = new THREE.MeshStandardMaterial({ color: 0xb8c3c8, metalness: 0.82, roughness: 0.24 });
    const pedestalMaterial = new THREE.MeshStandardMaterial({ color: 0x242b2f, metalness: 0.52, roughness: 0.38 });
    const cableMaterial = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.78 });
    const statusMaterial = new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        emissive: 0x22c55e,
        emissiveIntensity: 2.4,
        roughness: 0.32
    });

    function makePlug(position, rotation) {
        const plug = new THREE.Group();
        plug.position.set(...position);
        plug.rotation.set(...rotation);
        world.add(plug);
        addMesh(plug, new THREE.CylinderGeometry(0.12, 0.14, 0.30, 18), connectorMaterial,
            0, 0, 0, { rotation: [Math.PI / 2, 0, 0] });
        addMesh(plug, new THREE.CylinderGeometry(0.095, 0.095, 0.12, 18), contactMaterial,
            0, 0, -0.18, { rotation: [Math.PI / 2, 0, 0], castShadow: false });
        addBox(plug, [0.12, 0.32, 0.12], handleMaterial, [0, -0.18, 0.13], {
            rotation: [0.42, 0, 0], radius: 0.035
        });
        addMesh(plug, new THREE.TorusGeometry(0.145, 0.025, 10, 24), statusMaterial,
            0, 0, -0.16, { rotation: [Math.PI / 2, 0, 0], castShadow: false });
        return plug;
    }

    function makeFlexibleCable(points, radius = 0.042) {
        const curve = new THREE.CatmullRomCurve3(
            points.map((point) => new THREE.Vector3(...point)), false, "centripetal", 0.28
        );
        const cable = new THREE.Mesh(
            new THREE.TubeGeometry(curve, Math.max(48, points.length * 18), radius, 10, false),
            cableMaterial
        );
        cable.castShadow = true;
        cable.receiveShadow = true;
        world.add(cable);
        return cable;
    }

    // Schmale, anthrazitfarbene Stele mit kompakter weißer Wallbox, LED-Ring
    // und Kabelhaken. Die Proportionen orientieren sich an üblichen 16-cm-
    // Wallboxen auf rund 1,5 m hohen Standfüßen.
    const station = new THREE.Group();
    station.position.set(6.52, 0, -0.68);
    world.add(station);
    addBox(station, [0.34, 1.46, 0.28], pedestalMaterial, [0, 0.73, 0], { radius: 0.055 });
    addBox(station, [0.52, 0.10, 0.48], pedestalMaterial, [0, 0.05, 0], { radius: 0.05 });
    addBox(station, [0.46, 0.46, 0.24], handleMaterial, [-0.18, 1.22, 0], { radius: 0.12 });
    addMesh(station, new THREE.TorusGeometry(0.145, 0.022, 12, 32), statusMaterial,
        -0.18, 1.22, 0.132, { castShadow: false });
    addBox(station, [0.18, 0.05, 0.16], pedestalMaterial, [0.20, 0.94, 0.04], { radius: 0.025 });
    addBox(station, [0.18, 0.05, 0.16], pedestalMaterial, [0.20, 0.72, 0.04], { radius: 0.025 });

    const port = new THREE.Group();
    port.position.set(5.70, 0.88, -0.68);
    port.rotation.y = Math.PI / 2;
    world.add(port);
    addMesh(port, new THREE.CircleGeometry(0.20, 24), connectorMaterial,
        0, 0, 0, { castShadow: false });
    addMesh(port, new THREE.RingGeometry(0.13, 0.19, 24), contactMaterial,
        0, 0, 0.012, { castShadow: false });

    const attached = makePlug([5.80, 0.88, -0.68], [0, Math.PI / 2, 0]);
    const loose = makePlug([6.70, 0.80, -0.64], [0, -Math.PI / 2, Math.PI]);
    const attachedCable = makeFlexibleCable([
        [6.52, 1.06, -0.68], [6.50, 0.40, -0.72], [6.40, 0.10, -0.78],
        [6.08, 0.08, -0.92], [5.72, 0.08, -0.92], [5.55, 0.13, -0.78],
        [5.66, 0.45, -0.70], [5.80, 0.88, -0.68]
    ]);
    const dockedCable = makeFlexibleCable([
        [6.52, 1.06, -0.68], [6.76, 1.00, -0.66], [6.83, 0.82, -0.66],
        [6.73, 0.64, -0.66], [6.49, 0.63, -0.66], [6.39, 0.81, -0.66],
        [6.49, 0.97, -0.66], [6.70, 0.80, -0.64]
    ], 0.038);
    attached.visible = false;
    loose.visible = true;
    attachedCable.visible = false;
    dockedCable.visible = true;
    return { port, station, attached, loose, attachedCable, dockedCable, statusMaterial };
}

createGarden();
exteriorHouse = createHouse();
pergolaModel = createPergolaPanels();
balconyPanelModel = createBalconySolarPanels();
solarBankModel = createSolarBank();
secondarySolarBankModel = createSecondarySolarBank();
interiorHouse = createInteriorDollhouse();
const vehicleModels = createVehicles();
const audiModel = vehicleModels.audi.slot;
audiBatteryVisual = vehicleModels.audi.battery;
loadDetailedVehicles(vehicleModels);
const gridBoxModel = createGridBox();
const chargingConnection = createAudiChargeConnection();

const AUDI_HOME_POSE = Object.freeze({ x: 5.00, z: 1.00, yaw: Math.PI });
const AUDI_OFFSCREEN_POSE = Object.freeze({ x: 11.45, z: -18.50, yaw: Math.PI });
const AUDI_ARRIVAL_ENTRY_POSE = Object.freeze({ x: 9.45, z: -18.50, yaw: 0 });
// Der Audi setzt rechts an Fox und Ladesäule vorbei in einem weiten Bogen bis
// deutlich hinter den mittleren Yeti zurück. Erst nach einem kurzen Halt fährt
// er vorwärts aus dem Hof und ordnet sich auf der anderen Fahrbahnseite ein.
const AUDI_DEPARTURE_ROUTE = [
    { at: 0.00, pose: AUDI_HOME_POSE, motion: "hold" },
    { at: 0.06, pose: AUDI_HOME_POSE, motion: "reverse" },
    { at: 0.19, pose: { x: 5.00, z: 7.10, yaw: Math.PI }, motion: "reverse" },
    { at: 0.30, pose: { x: 5.00, z: 11.70, yaw: Math.PI }, motion: "reverse" },
    { at: 0.35, pose: { x: 4.60, z: 12.80, yaw: 2.79 }, motion: "reverse" },
    { at: 0.40, pose: { x: 3.70, z: 13.55, yaw: 2.26 }, motion: "reverse" },
    { at: 0.46, pose: { x: 2.10, z: 14.05, yaw: 1.87 }, motion: "reverse" },
    { at: 0.51, pose: { x: 0.00, z: 14.15, yaw: Math.PI / 2 }, motion: "hold" },
    { at: 0.57, pose: { x: 0.00, z: 14.15, yaw: Math.PI / 2 }, motion: "forward" },
    { at: 0.68, pose: { x: 5.20, z: 14.15, yaw: Math.PI / 2 }, motion: "forward" },
    { at: 0.74, pose: { x: 7.20, z: 13.85, yaw: 1.72 }, motion: "forward" },
    { at: 0.79, pose: { x: 8.90, z: 12.80, yaw: 2.13 }, motion: "forward" },
    { at: 0.84, pose: { x: 10.30, z: 11.00, yaw: 2.48 }, motion: "forward" },
    { at: 0.88, pose: { x: 11.45, z: 8.70, yaw: Math.PI }, motion: "forward" },
    { at: 1.00, pose: AUDI_OFFSCREEN_POSE, motion: "hold" }
];
// Bei der Rückkehr kommt das Fahrzeug vom selben Straßenende auf der
// Gegenfahrbahn zurück. Es biegt in einem weiten Linksbogen in den Hof ein,
// passiert den Fox auf dessen rechter Seite und fährt vorwärts zum Stellplatz.
const AUDI_ARRIVAL_ROUTE = [
    { at: 0.00, pose: AUDI_ARRIVAL_ENTRY_POSE, motion: "forward" },
    { at: 0.44, pose: { x: 9.45, z: 8.20, yaw: 0 }, motion: "forward" },
    { at: 0.52, pose: { x: 9.20, z: 10.50, yaw: -0.35 }, motion: "forward" },
    { at: 0.59, pose: { x: 8.30, z: 12.00, yaw: -0.82 }, motion: "forward" },
    { at: 0.66, pose: { x: 6.70, z: 13.00, yaw: -1.20 }, motion: "forward" },
    { at: 0.72, pose: { x: 5.20, z: 12.60, yaw: -1.82 }, motion: "forward" },
    { at: 0.80, pose: { x: 4.75, z: 10.30, yaw: -2.80 }, motion: "forward" },
    { at: 0.86, pose: { x: 4.80, z: 7.00, yaw: Math.PI }, motion: "forward" },
    { at: 1.00, pose: AUDI_HOME_POSE, motion: "hold" }
];
const audiPresenceMotion = {
    targetHome: null,
    phase: "idle",
    startedAt: 0,
    duration: 0
};
let audiPresenceDemoActive = false;
let audiPresenceDemoTimers = [];

function setAudiBrakeLights(active) {
    const lights = vehicleModels.audi.brakeLights;
    lights.group.visible = active && audiModel.visible && !cutawayVisible;
    lights.material.emissiveIntensity = active ? 7.2 : 0.12;
}

function setAudiPose(pose) {
    audiModel.position.set(pose.x, 0.02, pose.z);
    audiModel.rotation.y = pose.yaw;
}

function audiRouteTangent(route, index, motion) {
    const previousMotion = index > 0 ? route[index - 1].motion : null;
    const nextMotion = index < route.length - 1 ? route[index].motion : null;
    // Bei Halt, Richtungswechsel sowie Anfang und Ende einer Fahrt ist die
    // Geschwindigkeit null. Innerhalb einer Phase sorgt die zentrale
    // Ableitung für identische Ein- und Austrittsgeschwindigkeit am Wegpunkt.
    if (previousMotion !== motion || nextMotion !== motion)
        return new THREE.Vector2(0, 0);
    const before = route[index - 1];
    const after = route[index + 1];
    const timeSpan = Math.max(0.0001, after.at - before.at);
    return new THREE.Vector2(
        (after.pose.x - before.pose.x) / timeSpan,
        (after.pose.z - before.pose.z) / timeSpan
    );
}

function interpolateAudiPose(route, fromIndex, toIndex, progress) {
    const fromKeyframe = route[fromIndex];
    const toKeyframe = route[toIndex];
    const from = fromKeyframe.pose;
    const to = toKeyframe.pose;
    const motion = fromKeyframe.motion || toKeyframe.motion || "forward";
    const t = THREE.MathUtils.clamp(progress, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    const direction = motion === "reverse" ? -1 : 1;
    const segmentDuration = Math.max(0.0001, toKeyframe.at - fromKeyframe.at);
    const fromTangent = audiRouteTangent(route, fromIndex, motion).multiplyScalar(segmentDuration);
    const toTangent = audiRouteTangent(route, toIndex, motion).multiplyScalar(segmentDuration);
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const x = h00 * from.x + h10 * fromTangent.x + h01 * to.x + h11 * toTangent.x;
    const z = h00 * from.z + h10 * fromTangent.y + h01 * to.z + h11 * toTangent.y;
    audiModel.position.set(x, 0.02, z);

    // Die Fahrzeugausrichtung folgt der tatsächlichen Kurventangente. Beim
    // Rückwärtsfahren zeigt die Front entgegengesetzt zur Bewegungsrichtung.
    const dx = (6 * t2 - 6 * t) * from.x + (3 * t2 - 4 * t + 1) * fromTangent.x +
        (-6 * t2 + 6 * t) * to.x + (3 * t2 - 2 * t) * toTangent.x;
    const dz = (6 * t2 - 6 * t) * from.z + (3 * t2 - 4 * t + 1) * fromTangent.y +
        (-6 * t2 + 6 * t) * to.z + (3 * t2 - 2 * t) * toTangent.y;
    if (Math.hypot(dx, dz) > 0.0001)
        audiModel.rotation.y = Math.atan2(dx * direction, dz * direction);
    else {
        const yawDelta = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
        audiModel.rotation.y = from.yaw + yawDelta * t;
    }
}

function followAudiRoute(route, progress) {
    const clamped = THREE.MathUtils.clamp(progress, 0, 1);
    let nextIndex = route.findIndex((keyframe) => keyframe.at >= clamped);
    if (nextIndex <= 0) {
        setAudiPose(route[0].pose);
        return;
    }
    if (nextIndex < 0)
        nextIndex = route.length - 1;
    const previous = route[nextIndex - 1];
    const next = route[nextIndex];
    const span = Math.max(0.0001, next.at - previous.at);
    interpolateAudiPose(route, nextIndex - 1, nextIndex, (clamped - previous.at) / span);
}

function setAudiConnectionForPresence(mode) {
    const visible = !cutawayVisible;
    if (mode === "home") {
        const raw = componentData().raw;
        chargingConnection.port.visible = visible;
        chargingConnection.attached.visible = visible && raw.plugConnected;
        chargingConnection.loose.visible = visible && !raw.plugConnected;
        chargingConnection.attachedCable.visible = visible && raw.plugConnected;
        chargingConnection.dockedCable.visible = visible && !raw.plugConnected;
        return;
    }
    // Beim Fahren bleibt der Stecker sauber an der Ladesäule. So zieht das
    // fest im Hof verlegte Kabel nicht unnatürlich hinter dem Auto her.
    chargingConnection.port.visible = false;
    chargingConnection.attached.visible = false;
    chargingConnection.attachedCable.visible = false;
    chargingConnection.loose.visible = visible;
    chargingConnection.dockedCable.visible = visible;
}

function startAudiPresenceTransition(atHome, forceMotion = false) {
    if (typeof atHome !== "boolean")
        return;
    const previousTarget = audiPresenceMotion.targetHome;
    if (previousTarget === atHome && !forceMotion)
        return;
    audiPresenceMotion.targetHome = atHome;

    if (reduceMotion && !forceMotion) {
        audiPresenceMotion.phase = "idle";
        setAudiBrakeLights(false);
        setAudiPose(atHome ? AUDI_HOME_POSE : AUDI_OFFSCREEN_POSE);
        audiModel.visible = atHome && !cutawayVisible;
        setAudiConnectionForPresence(atHome ? "home" : "away");
        return;
    }

    // Beim ersten bekannten Auswärtsstand wird die gewünschte Abfahrt einmal
    // vollständig gezeigt. Ein erster Heimstand startet dagegen ruhig auf dem
    // echten Stellplatz und löst keine künstliche Ankunft aus.
    if (previousTarget === null && atHome) {
        setAudiPose(AUDI_HOME_POSE);
        audiModel.visible = !cutawayVisible;
        setAudiConnectionForPresence("home");
        return;
    }

    audiPresenceMotion.phase = atHome ? "arriving" : "departing";
    audiPresenceMotion.startedAt = performance.now();
    audiPresenceMotion.duration = atHome ? 13500 : 15000;
    audiModel.visible = !cutawayVisible;
    setAudiPose(atHome ? AUDI_ARRIVAL_ENTRY_POSE : AUDI_HOME_POSE);
    setAudiConnectionForPresence("driving");
}

function runAudiPresenceDemo() {
    audiPresenceDemoTimers.forEach((timer) => window.clearTimeout(timer));
    audiPresenceDemoTimers = [];
    audiPresenceDemoActive = true;
    audiPresenceMotion.phase = "idle";
    audiPresenceMotion.targetHome = true;
    setAudiBrakeLights(false);
    setAudiPose(AUDI_HOME_POSE);
    audiModel.visible = !cutawayVisible;

    audiPresenceDemoTimers.push(window.setTimeout(
        () => startAudiPresenceTransition(false, true), 900
    ));
    audiPresenceDemoTimers.push(window.setTimeout(
        () => startAudiPresenceTransition(true, true), 17300
    ));
    audiPresenceDemoTimers.push(window.setTimeout(() => {
        audiPresenceDemoActive = false;
        audiPresenceDemoTimers = [];
    }, 32100));
}

function updateAudiPresenceMotion(time) {
    const motion = audiPresenceMotion;
    if (motion.phase === "idle") {
        const parkedHere = motion.targetHome !== false;
        audiModel.visible = !cutawayVisible && parkedHere;
        setAudiBrakeLights(false);
        if (!parkedHere)
            setAudiConnectionForPresence("away");
        return;
    }

    audiModel.visible = !cutawayVisible;
    const progress = THREE.MathUtils.clamp(
        (time - motion.startedAt) / motion.duration, 0, 1
    );
    if (motion.phase === "departing") {
        followAudiRoute(AUDI_DEPARTURE_ROUTE, progress);
        setAudiBrakeLights(progress < 0.06 || (progress >= 0.51 && progress < 0.57));
    }
    else {
        followAudiRoute(AUDI_ARRIVAL_ROUTE, progress);
        setAudiBrakeLights(progress >= 0.985);
    }
    setAudiConnectionForPresence("driving");

    if (progress >= 1) {
        motion.phase = "idle";
        setAudiBrakeLights(false);
        setAudiPose(motion.targetHome ? AUDI_HOME_POSE : AUDI_OFFSCREEN_POSE);
        audiModel.visible = motion.targetHome && !cutawayVisible;
        setAudiConnectionForPresence(motion.targetHome ? "home" : "away");
    }
}

// Eigene Materialkopien erlauben einen weichen, nebelartigen Übergang zur
// Innenansicht, ohne gemeinsam genutzte Materialien von Garten, Fahrzeugen
// oder Energiekomponenten transparent zu machen.
const exteriorFadeMaterials = [];
const exteriorCutawayHiddenGroups = [];
function prepareExteriorFade(group) {
    const copies = new Map();
    const copyMaterial = (source) => {
        if (copies.has(source))
            return copies.get(source);
        const material = source.clone();
        material.userData.baseOpacity = source.opacity;
        material.userData.baseTransparent = source.transparent;
        material.userData.baseDepthWrite = source.depthWrite;
        copies.set(source, material);
        exteriorFadeMaterials.push(material);
        return material;
    };
    group.traverse((object) => {
        if (object.userData.hideInCutaway)
            exteriorCutawayHiddenGroups.push(object);
        if (!object.isMesh)
            return;
        object.material = Array.isArray(object.material) ?
            object.material.map(copyMaterial) : copyMaterial(object.material);
    });
}

function applyExteriorFade(amount) {
    exteriorCutawayHiddenGroups.forEach((group) => {
        group.visible = amount < 0.42;
    });
    exteriorFadeMaterials.forEach((material) => {
        const baseOpacity = material.userData.baseOpacity ?? 1;
        // Im fertigen Schnitt bleibt nur eine sehr feine Nebelkontur übrig.
        // Mehrere übereinanderliegende Fenster-, Balkon- und Dachmaterialien
        // addieren sich optisch; 1,8 % pro Material hält deshalb die Räume
        // frei und lässt trotzdem die ursprüngliche Hausform erkennen.
        const fadedOpacity = Math.min(baseOpacity, 0.018);
        material.opacity = THREE.MathUtils.lerp(baseOpacity, fadedOpacity, amount);
        const nextTransparent = amount > 0.01 || material.userData.baseTransparent;
        if (material.transparent !== nextTransparent) {
            material.transparent = nextTransparent;
            material.needsUpdate = true;
        }
        material.depthWrite = amount < 0.22 ? material.userData.baseDepthWrite : false;
    });
}
prepareExteriorFade(exteriorHouse);

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
    const vectors = points.map((point) => new THREE.Vector3(...point));
    for (let index = 1; index < vectors.length; index += 1)
        path.add(new THREE.LineCurve3(vectors[index - 1], vectors[index]));
    return path;
}

function createFlow(id, points, color, options = {}) {
    const curve = createCableCurve(points);
    const cableRadius = options.cableRadius || 0.048;
    const glowRadius = options.glowRadius || 0.064;
    const pulseRadius = options.pulseRadius || 0.11;
    const cableMaterial = new THREE.MeshStandardMaterial({
        color: options.interior ? 0xf4f7f8 : 0x26323b,
        roughness: options.interior ? 0.42 : 0.64,
        metalness: options.interior ? 0.06 : 0.18,
        emissive: options.interior ? 0x28343b : 0x000000,
        emissiveIntensity: options.interior ? 0.24 : 0
    });
    const tubeMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const cable = new THREE.Group();
    const tube = new THREE.Group();
    world.add(cable, tube);
    const up = new THREE.Vector3(0, 1, 0);
    for (let index = 1; index < points.length; index += 1) {
        const start = new THREE.Vector3(...points[index - 1]);
        const end = new THREE.Vector3(...points[index]);
        const direction = end.clone().sub(start);
        const length = direction.length();
        const midpoint = start.clone().add(end).multiplyScalar(0.5);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
        const cableSegment = new THREE.Mesh(new THREE.CylinderGeometry(cableRadius, cableRadius, length, 10), cableMaterial);
        cableSegment.position.copy(midpoint);
        cableSegment.quaternion.copy(quaternion);
        cableSegment.castShadow = true;
        cableSegment.receiveShadow = true;
        cable.add(cableSegment);
        const lightSegment = new THREE.Mesh(new THREE.CylinderGeometry(glowRadius, glowRadius, length, 10), tubeMaterial);
        lightSegment.position.copy(midpoint);
        lightSegment.quaternion.copy(quaternion);
        lightSegment.renderOrder = 2;
        tube.add(lightSegment);
        if (index < points.length - 1) {
            const sleeve = addMesh(cable, new THREE.SphereGeometry(0.066, 12, 8), cableMaterial,
                end.x, end.y, end.z, { castShadow: false });
            sleeve.renderOrder = 1;
        }
    }
    if (options.showCable === false)
        cable.visible = false;
    const pulseMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const pulses = [];
    for (let index = 0; index < 6; index += 1) {
        const pulse = new THREE.Mesh(new THREE.SphereGeometry(pulseRadius, 14, 10), pulseMaterial.clone());
        pulse.userData.offset = index / 6;
        pulse.renderOrder = 3;
        world.add(pulse);
        pulses.push(pulse);
    }
    flows[id] = {
        curve,
        cable,
        tube,
        tubeMaterial,
        pulses,
        active: false,
        reverse: false,
        isInterior: Boolean(options.interior),
        showCable: options.showCable !== false
    };
}

const pvPanelAnchors = PERGOLA_PANEL_LAYOUT.map(([x, z], index) => ({
    id: "pv" + (index + 1),
    anchor: new THREE.Vector3(
        PERGOLA_CENTER.x + x,
        // Nur wenige Millimeter über der Glasfläche: Die HTML-Schrift sitzt
        // optisch direkt auf dem Modul, bleibt aber als Screen-Space-Overlay
        // unabhängig von Drehung und Dachneigung immer waagerecht lesbar.
        PERGOLA_ROOF_Y - Math.tan(PERGOLA_ROOF_PITCH) * x + 0.045,
        PERGOLA_CENTER.z + z
    )
}));
const secondaryPvPanelAnchors = BALCONY_PANEL_POSITIONS.map((position, index) => ({
    id: "sb3pv" + (index + 1),
    anchor: new THREE.Vector3(position.x + 0.055, position.y, position.z)
}));

// Die vier Modulstränge verlassen die Anschlussdosen unter den Modulen. Sie
// laufen einzeln in den beiden Kreuzfugen und bleiben damit von den sichtbaren
// Modulflächen weg. Erst an der vorderen Pergola-Kante werden sie in der
// Sammelbox zusammengeführt.
const pvCombinerPoint = [pergolaX(7.12), 2.54, pergolaZ(-6.66)];
const pvUnderPanelY = (worldX) => PERGOLA_ROOF_Y -
    Math.tan(PERGOLA_ROOF_PITCH) * (worldX - PERGOLA_CENTER.x) - 0.035;
const pvRoutes = [
    [
        [pergolaX(7.49), pvUnderPanelY(pergolaX(7.49)), pergolaZ(-9.50)], [pergolaX(8.02), pvUnderPanelY(pergolaX(8.02)), pergolaZ(-9.50)],
        [pergolaX(8.02), pvUnderPanelY(pergolaX(8.02)), pergolaZ(-8.56)], [pergolaX(8.02), 2.54, pergolaZ(-6.74)], pvCombinerPoint
    ],
    [
        [pergolaX(8.71), pvUnderPanelY(pergolaX(8.71)), pergolaZ(-9.50)], [pergolaX(8.08), pvUnderPanelY(pergolaX(8.08)), pergolaZ(-9.50)],
        [pergolaX(8.08), pvUnderPanelY(pergolaX(8.08)), pergolaZ(-8.52)], [pergolaX(8.08), 2.54, pergolaZ(-6.70)], pvCombinerPoint
    ],
    [
        [pergolaX(7.49), pvUnderPanelY(pergolaX(7.49)), pergolaZ(-7.50)], [pergolaX(8.14), pvUnderPanelY(pergolaX(8.14)), pergolaZ(-7.50)],
        [pergolaX(8.14), pvUnderPanelY(pergolaX(8.14)), pergolaZ(-8.48)], [pergolaX(8.14), 2.54, pergolaZ(-6.66)], pvCombinerPoint
    ],
    [
        [pergolaX(8.71), pvUnderPanelY(pergolaX(8.71)), pergolaZ(-7.50)], [pergolaX(8.20), pvUnderPanelY(pergolaX(8.20)), pergolaZ(-7.50)],
        [pergolaX(8.20), pvUnderPanelY(pergolaX(8.20)), pergolaZ(-8.44)], [pergolaX(8.20), 2.54, pergolaZ(-6.62)], pvCombinerPoint
    ]
];
pvPanelAnchors.forEach((panel, index) => {
    createFlow(panel.id, pvRoutes[index], colors.pv);
});
// Ab der Sammelbox läuft der PV-Hauptstrang wieder im unteren Bodenkanal zur
// Fassade. Unterhalb des Solarbank-Fensters steigt er von unten an der Wand
// bis zur Balkonplatte und anschließend direkt zur Anlage. Dadurch bleibt die
// gelbe Leitung aus der Fensterzone heraus und ist vom Netzstrang getrennt.
createFlow("pvTrunk", [
    pvCombinerPoint, [pvCombinerPoint[0], 0.18, pvCombinerPoint[2]], [3.40, 0.18, pvCombinerPoint[2]],
    [3.40, 0.18, -1.33], [3.40, BALCONY_FLOOR_Y + 0.08, -1.33],
    [3.40, BALCONY_FLOOR_Y + 0.08, -1.42], [3.62, BALCONY_FLOOR_Y + 0.08, -1.42],
    [3.62, BALCONY_RAIL_CENTER_Y, -1.42]
], colors.pv, { cableRadius: 0.048, glowRadius: 0.075, pulseRadius: 0.13 });
// Die beiden Balkonmodule bleiben bis zur kleinen Sammelstelle als einzelne
// Stränge sichtbar. Danach folgt nur noch ein kurzer gemeinsamer Weg hinter
// dem Geländer zur alleinstehenden Solarbank 3.
const secondaryPvCombinerPoint = [4.47, BALCONY_FLOOR_Y + 0.12, 3.30];
secondaryPvPanelAnchors.forEach((panel, index) => {
    const panelPosition = BALCONY_PANEL_POSITIONS[index];
    createFlow(panel.id, [
        [panelPosition.x - 0.01, panelPosition.y, panelPosition.z],
        [4.47, BALCONY_FLOOR_Y + 0.12, panelPosition.z],
        secondaryPvCombinerPoint
    ], colors.pv, { cableRadius: 0.032, glowRadius: 0.050, pulseRadius: 0.085 });
});
createFlow("secondaryPvTrunk", [
    secondaryPvCombinerPoint,
    [3.64, BALCONY_FLOOR_Y + 0.12, 3.30],
    [3.64, BALCONY_FLOOR_Y + 0.12, SECONDARY_SOLARBANK_POSITION.z],
    [3.64, BALCONY_RAIL_CENTER_Y, SECONDARY_SOLARBANK_POSITION.z]
], colors.battery3, { cableRadius: 0.036, glowRadius: 0.058, pulseRadius: 0.095 });
// Der Netzstrang erreicht die Wand zwischen den beiden unteren Haustüren,
// wechselt oberhalb ihrer Rahmen in den Spalt der beiden Balkontüren und
// steigt dort bis zur Traufe. Sein Dach- und Abstiegskanal ist gegenüber PV
// sowohl in der Höhe als auch im Wandabstand versetzt. Auch er mündet von
// rechts in die Solarbank, ohne eine Öffnung oder den PV-Strang zu schneiden.
createFlow("grid", [
    [GRID_BOX_POSITION.x, 0.58, -4.20], [GRID_BOX_POSITION.x, 0.16, -4.20], [3.62, 0.16, -4.20],
    [3.62, 0.16, -3.78], [3.62, BALCONY_FLOOR_Y - 0.14, -3.78],
    [3.62, BALCONY_FLOOR_Y - 0.14, -3.38], [3.62, 4.84, -3.38],
    [3.62, 4.84, -2.15], [3.62, BALCONY_RAIL_CENTER_Y, -2.15],
    [3.62, BALCONY_RAIL_CENTER_Y, -1.10]
], colors.grid);
createFlow("audiTrunk", [
    // Von der Solarbank oben nach links bis in den Spalt der beiden Balkone.
    // Dort läuft der Strang an der Hauswand hinunter und anschließend vor
    // der Motorhaube entlang, niemals unter der Fahrzeugfläche.
    [3.62, BALCONY_RAIL_CENTER_Y, -1.42], [3.62, BALCONY_RAIL_TOP_Y + 0.10, -1.42],
    // 2,90 liegt über dem 2,84 hohen Geländer, aber unter der
    // Fensterbank: Der Strang berührt keine Glas- oder Türfläche.
    [3.50, BALCONY_RAIL_TOP_Y + 0.10, -1.42], [3.50, BALCONY_RAIL_TOP_Y + 0.10, -0.34],
    // Zwischen den Geländern geht es nur bis in das freie Fassadenband.
    // Der lange Steigstrang sitzt bei z=-1,33 im breiten Mauerstreifen
    // zwischen den unteren Fenstern bei z=-0,55 und z=-2,12. Erst oberhalb
    // ihrer Rahmen läuft er zurück zum Geländerspalt.
    [3.50, BALCONY_FLOOR_Y - 0.10, -0.34], [3.50, BALCONY_FLOOR_Y - 0.10, -1.33],
    [3.50, 0.16, -1.33], [3.50, 0.16, -1.18],
    [6.52, 0.16, -1.18], [6.52, 0.16, 0.84]
], colors.audi);
createFlow("audi", [
    [6.52, 1.06, -0.68], [6.52, 0.16, -0.68],
    [5.80, 0.16, -0.68], [5.80, 0.88, -0.68]
], colors.audi, { showCable: false });

createFlow("houseMain", [
    [3.62, 2.40, -1.42], [3.08, 2.40, -1.42], [3.08, 0.72, -1.42],
    [-2.72, 0.72, -1.42], [-2.72, 1.38, -1.42], [-2.72, 1.38, -3.18]
], "#fb923c", { interior: true, cableRadius: 0.018, glowRadius: 0.030, pulseRadius: 0.060 });
interiorHouse.devices.forEach((device) => {
    createFlow("room-" + device.id, [
        [-2.72, 1.38, -3.18],
        [-2.72, device.position.y, -3.18],
        [-2.72, device.position.y, device.position.z],
        [device.position.x, device.position.y, device.position.z]
    ], "#fb923c", { interior: true, cableRadius: 0.016, glowRadius: 0.028, pulseRadius: 0.055 });
});

function setInteriorFlowVisibility(visible) {
    ["houseMain", ...interiorHouse.devices.map((device) => "room-" + device.id)].forEach((id) => {
        const flow = flows[id];
        flow.cable.visible = visible;
        flow.tube.visible = visible;
        flow.pulses.forEach((pulse) => {
            pulse.visible = visible && flow.active;
        });
    });
}
setInteriorFlowVisibility(false);

function setExteriorFlowVisibility(visible) {
    Object.values(flows).filter((flow) => !flow.isInterior).forEach((flow) => {
        flow.cable.visible = visible && flow.showCable;
        flow.tube.visible = visible;
        flow.tubeMaterial.opacity = visible && flow.active ? 0.92 : 0;
        flow.pulses.forEach((pulse) => {
            pulse.visible = visible && flow.active;
            pulse.material.opacity = flow.active ? 1 : 0;
        });
    });
}

const labelAnchors = {
    // Die vier Übersichtskarten sitzen direkt über ihrer Komponente. Zuvor
    // lagen PV, Netz und Solarbank gemeinsam auf den Leitungen und überdeckten
    // sich in der Standardansicht.
    // Die Gesamtkarte sitzt hausnah am Kabelzulauf und verdeckt dadurch keine
    // der vier Modulanzeigen mehr.
    pv: new THREE.Vector3(3.48, 3.18, -5.55),
    // Diese Punkte markieren jeweils die Oberkante des echten 3D-Objekts.
    // Die Karte wird per CSS vollständig oberhalb dieses Punktes angeordnet,
    // statt mit ihrer Mitte halb im Gerät zu stehen.
    battery: new THREE.Vector3(3.50, 3.66, -1.42),
    battery3: new THREE.Vector3(3.50, 3.34, 2.72),
    grid: new THREE.Vector3(GRID_BOX_POSITION.x, 1.18, GRID_BOX_POSITION.z),
    audi: new THREE.Vector3(5.00, 1.72, 1.00)
};

const labelElements = {};
["pv", "battery", "battery3", "grid", "audi"].forEach((id) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "house-scene-label";
    button.dataset.component = id;
    button.addEventListener("click", () => {
        state.selected = id;
        state.expandedPanel = null;
        state.expandedComponent = state.expandedComponent === id ? null : id;
        updateLiveUi();
    });
    stage.appendChild(button);
    labelElements[id] = button;
});

const pvStringElements = {};
pvPanelAnchors.forEach((panel, index) => {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "house-string-label";
    label.dataset.string = panel.id;
    label.innerHTML = `<strong>PV${index + 1} · --</strong>` +
        '<span class="panel-mid-detail">36,8 V · -- A</span>' +
        '<span class="panel-close-detail">Anteil aktuell · --</span>' +
        '<span class="panel-expanded-detail">Tagesdaten werden aufgebaut</span>' +
        '<span class="house-string-more">Details öffnen</span>';
    label.addEventListener("click", () => {
        state.expandedComponent = null;
        state.expandedPanel = state.expandedPanel === panel.id ? null : panel.id;
        updateLiveUi();
    });
    stage.appendChild(label);
    pvStringElements[panel.id] = label;
});
secondaryPvPanelAnchors.forEach((panel, index) => {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "house-string-label house-string-label-secondary";
    label.dataset.string = panel.id;
    label.innerHTML = `<strong>SB3 PV${index + 1} · --</strong>` +
        '<span class="panel-mid-detail">36,8 V · -- A</span>' +
        '<span class="panel-close-detail">Solarbank 3 · --</span>' +
        '<span class="panel-expanded-detail">Live-Daten werden verbunden</span>' +
        '<span class="house-string-more">Details öffnen</span>';
    label.addEventListener("click", () => {
        state.expandedComponent = null;
        state.expandedPanel = state.expandedPanel === panel.id ? null : panel.id;
        updateLiveUi();
    });
    stage.appendChild(label);
    pvStringElements[panel.id] = label;
});

const objectBatteryAnchors = {
    battery: new THREE.Vector3(3.50, 3.48, -1.42),
    battery3: new THREE.Vector3(3.50, 3.20, 2.72),
    audi: new THREE.Vector3(5.00, 0.72, 1.00)
};
const objectBatteryElements = {};
Object.keys(objectBatteryAnchors).forEach((id) => {
    const indicator = document.createElement("span");
    indicator.className = "house-object-battery unknown";
    indicator.dataset.component = id;
    indicator.dataset.flow = "idle";
    indicator.setAttribute("role", "img");
    // Der animierte Akku sitzt jetzt direkt im jeweiligen 3D-Objekt. Hier
    // bleiben deshalb nur Ladestand und die beim Zoomen sichtbaren Details.
    indicator.innerHTML = '<span class="house-object-battery-copy"><strong>--</strong>' +
        '<small class="house-object-battery-detail">Bereit</small></span>';
    stage.appendChild(indicator);
    objectBatteryElements[id] = indicator;
});

function setObjectBattery(id, percent, flowMode, powerWatts = null, secondaryDetail = "") {
    const indicator = objectBatteryElements[id];
    const numericPercent = numberValue(percent);
    const known = numericPercent != null;
    const level = THREE.MathUtils.clamp(numericPercent ?? 0, 0, 100);
    indicator.style.setProperty("--object-battery-level", level.toFixed(1) + "%");
    indicator.dataset.flow = known ? flowMode : "idle";
    indicator.classList.toggle("unknown", !known);
    indicator.querySelector("strong").textContent = known ? Math.round(level) + " %" : "--";
    const power = numberValue(powerWatts);
    const direction = flowMode === "charging" ? "↓ hinein" : flowMode === "discharging" ? "↑ heraus" : "Bereit";
    const detailLines = Array.isArray(secondaryDetail) ? secondaryDetail :
        secondaryDetail ? [secondaryDetail] : [];
    indicator.querySelector(".house-object-battery-detail").innerHTML =
        `<span>${power != null && power >= 5 ? formatPower(power) + " · " + direction : direction}</span>` +
        detailLines.map((line) => `<span>${line}</span>`).join("");
    const label = id === "battery" ? "Solarbank 4" :
        id === "battery3" ? "Solarbank 3" : "Audi";
    const motion = flowMode === "charging" ? " lädt" : flowMode === "discharging" ? " entlädt" : "";
    indicator.setAttribute("aria-label", label + ": " + (known ? Math.round(level) + " Prozent" + motion : "Ladestand unbekannt"));
}

function setSchematicBatteryState(visual, percent, mode) {
    if (!visual)
        return;
    const numericPercent = numberValue(percent);
    visual.level = numericPercent == null ? null : THREE.MathUtils.clamp(numericPercent, 0, 100);
    visual.mode = numericPercent == null ? "idle" : mode;
    const fraction = Math.max(0.025, (visual.level ?? 0) / 100);
    const discharging = visual.mode === "discharging";
    // Der aktuelle SOC ist bei Solarbank und Audi immer als grüne Fläche
    // ablesbar. Laden/Entladen wird ausschließlich durch Farbe und Richtung
    // der darüberlaufenden Pulswelle unterschieden.
    const levelColor = 0x22c55e;
    const waveColor = discharging ? 0xfb7185 : 0x86efac;
    const waveEmissive = discharging ? 0xef4444 : 0x22c55e;

    if (visual.kind === "audi") {
        const activeCells = visual.level == null ? 0 :
            Math.ceil(visual.cells.length * visual.level / 100);
        visual.cells.forEach((cell, index) => {
            cell.userData.energyActive = index < activeCells;
            cell.material.color.setHex(cell.userData.energyActive ? levelColor : 0x12374b);
            cell.material.emissive.setHex(cell.userData.energyActive ? levelColor : 0x0f2734);
        });
        visual.waveMaterial.color.setHex(waveColor);
        visual.waveMaterial.emissive.setHex(waveEmissive);
    }
    else {
        visual.gauges.forEach((gauge) => {
            gauge.fill.scale.y = fraction;
            gauge.fill.position.y = gauge.bottom + gauge.height * fraction / 2;
            gauge.levelFraction = fraction;
            gauge.fillMaterial.color.setHex(levelColor);
            gauge.fillMaterial.emissive.setHex(levelColor);
            gauge.waveMaterial.color.setHex(waveColor);
            gauge.waveMaterial.emissive.setHex(waveEmissive);
        });
    }
}

function animateSchematicBattery(visual, seconds) {
    if (!visual)
        return;
    const hasLevel = visual.level != null;
    const moving = hasLevel && (visual.mode === "charging" || visual.mode === "discharging");
    const pulse = moving && !reduceMotion ? 0.76 + Math.sin(seconds * 6.2) * 0.24 : 1;
    const directionProgress = reduceMotion ? (visual.level ?? 0) / 100 : (seconds * 0.56) % 1;
    const progress = visual.mode === "discharging" ? 1 - directionProgress : directionProgress;
    const zoomStrength = THREE.MathUtils.clamp((state.zoom - 0.82) / 0.72, 0.32, 1);

    if (visual.kind === "audi") {
        visual.outline.material.opacity = (hasLevel ? 0.42 : 0.18) + zoomStrength * 0.34;
        visual.cells.forEach((cell) => {
            const active = cell.userData.energyActive;
            cell.material.opacity = (active ? 0.70 * pulse : 0.13) * zoomStrength;
            cell.material.emissiveIntensity = active ? 2.5 * pulse : 0.10;
        });
        visual.wave.visible = moving;
        visual.wave.position.z = -0.78 + progress * 1.56;
        visual.waveMaterial.opacity = moving ? 0.88 * pulse : 0;
        visual.waveMaterial.emissiveIntensity = 4.4 * pulse;
    }
    else {
        visual.gauges.forEach((gauge, index) => {
            gauge.outline.material.opacity = hasLevel ? 0.74 + zoomStrength * 0.18 : 0.22;
            gauge.background.material.opacity = hasLevel ? 0.88 : 0.42;
            // Der ruhige, kräftige Füllkörper macht den SOC bereits aus der
            // Entfernung sichtbar; nur die Welle pulsiert mit dem Energiefluss.
            gauge.fillMaterial.opacity = hasLevel ? 0.90 : 0.12;
            gauge.fillMaterial.emissiveIntensity = hasLevel ? 2.8 : 0.08;
            gauge.wave.visible = moving;
            gauge.wave.position.y = gauge.bottom +
                ((progress + index * 0.14) % 1) * gauge.height * gauge.levelFraction;
            gauge.waveMaterial.opacity = moving ? 0.98 * pulse : 0;
            gauge.waveMaterial.emissiveIntensity = 5.2 * pulse;
        });
    }
}

const interiorBadge = document.createElement("span");
interiorBadge.className = "house-cutaway-badge";
interiorBadge.textContent = "INNENANSICHT · Zwei-Personen-Profil";
stage.appendChild(interiorBadge);

const interiorDeviceElements = {};
interiorHouse.devices.forEach((device) => {
    const label = document.createElement("span");
    label.className = "house-device-label";
    label.dataset.device = device.id;
    label.innerHTML = `<strong>${device.label}</strong><span>aus</span>`;
    stage.appendChild(label);
    interiorDeviceElements[device.id] = label;
});

let currentPvStringPowers = [null, null, null, null];
let currentSecondaryPvStringPowers = [null, null];
let simulatedHouseLoad = 0;
let simulatedResidualLoad = 0;
let lastRoutineMinute = -1;

function updatePanelDetails() {
    const solix = state.data.solix || {};
    const secondary = solix.secondary_solarbank || {};
    const dailyByString = Array.isArray(solix.pv_today_wh_by_string) ?
        solix.pv_today_wh_by_string : [];
    const history = Array.isArray(solix.pv_history) ? solix.pv_history : [];
    const total = currentPvStringPowers.reduce((sum, value) => sum + (numberValue(value) ?? 0), 0);
    currentPvStringPowers.forEach((power, index) => {
        const element = pvStringElements["pv" + (index + 1)];
        const watts = numberValue(power);
        const amps = watts == null ? null : Math.max(0, watts) / PV_MODULE_VMP;
        element.querySelector("strong").textContent =
            "PV" + (index + 1) + " · " + formatPower(watts);
        element.querySelector(".panel-mid-detail").textContent =
            "36,8 V · " + (amps == null ? "-- A" : amps.toLocaleString("de-DE", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 2
            }) + " A");
        element.querySelector(".panel-close-detail").textContent =
            "Anteil aktuell · " + (watts == null || total <= 0 ? "--" :
                Math.round(watts / total * 100).toLocaleString("de-DE") + " %");
        element.querySelector(".panel-expanded-detail").innerHTML =
            '<span class="house-detail-row"><b>Heute</b><span>' +
            escapeHtml(formatEnergy(dailyByString[index])) + '</span></span>' +
            '<span class="house-detail-row"><b>Aktuell</b><span>' +
            escapeHtml(formatPower(watts)) + '</span></span>' +
            pvSparklineHtml(history, index);
        const expanded = state.expandedPanel === "pv" + (index + 1);
        element.querySelector(".house-string-more").textContent = expanded ? "Weniger" : "Details öffnen";
        element.classList.toggle("expanded", expanded);
        element.classList.toggle("active", watts != null && watts >= 5);
        element.setAttribute("aria-expanded", expanded ? "true" : "false");
        element.setAttribute("aria-label", "PV-Modul " + (index + 1) + ": " + formatPower(watts));
    });
    const secondaryTotal = currentSecondaryPvStringPowers.reduce(
        (sum, value) => sum + (numberValue(value) ?? 0), 0
    );
    currentSecondaryPvStringPowers.forEach((power, index) => {
        const id = "sb3pv" + (index + 1);
        const element = pvStringElements[id];
        const watts = numberValue(power);
        const amps = watts == null ? null : Math.max(0, watts) / PV_MODULE_VMP;
        element.querySelector("strong").textContent =
            "SB3 PV" + (index + 1) + " · " + formatPower(watts);
        element.querySelector(".panel-mid-detail").textContent =
            "36,8 V · " + (amps == null ? "-- A" : amps.toLocaleString("de-DE", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 2
            }) + " A");
        element.querySelector(".panel-close-detail").textContent =
            "Anteil SB3 · " + (watts == null || secondaryTotal <= 0 ? "--" :
                Math.round(watts / secondaryTotal * 100).toLocaleString("de-DE") + " %");
        element.querySelector(".panel-expanded-detail").innerHTML =
            '<span class="house-detail-row"><b>Aktuell</b><span>' +
            escapeHtml(formatPower(watts)) + '</span></span>' +
            '<span class="house-detail-row"><b>Ziel</b><span>Solarbank 3</span></span>' +
            '<span class="house-detail-row"><b>Stand</b><span>' +
            escapeHtml(formatTimestamp(secondary.last_update)) + '</span></span>';
        const expanded = state.expandedPanel === id;
        element.querySelector(".house-string-more").textContent = expanded ? "Weniger" : "Details öffnen";
        element.classList.toggle("expanded", expanded);
        element.classList.toggle("active", watts != null && watts >= 5);
        element.setAttribute("aria-expanded", expanded ? "true" : "false");
        element.setAttribute("aria-label", "Solarbank-3-PV-Modul " +
            (index + 1) + ": " + formatPower(watts));
    });
}

function deviceScheduled(device, now) {
    const hour = now.getHours() + now.getMinutes() / 60;
    const weekday = now.getDay() >= 1 && now.getDay() <= 5;
    const phase = Math.floor(now.getMinutes() / 7);
    if (device.schedule === "always")
        return true;
    if (device.schedule === "office")
        return weekday && hour >= 8.0 && hour < 17.7;
    if (device.schedule === "coffee")
        return ((hour >= 6.2 && hour < 8.7) || (hour >= 12.0 && hour < 14.2)) && phase % 3 === 0;
    if (device.schedule === "evening")
        return hour >= 18.3 && hour < 23.4;
    if (device.schedule === "light")
        return (hour < 7.7 || hour >= 17.2) && (phase + device.id.length) % 3 !== 0;
    if (device.schedule === "washer") {
        const plannedDay = (now.getDate() + now.getMonth()) % 3 === 0;
        const weekendRun = !weekday && hour >= 10.0 && hour < 11.4;
        return (plannedDay && hour >= 18.0 && hour < 19.5) || weekendRun;
    }
    return false;
}

function updateInteriorElectricity(totalWatts, now = new Date()) {
    const total = Math.max(0, numberValue(totalWatts) ?? 0);
    simulatedHouseLoad = total;
    const scheduled = interiorHouse.devices.filter((device) => deviceScheduled(device, now));
    const scheduledBase = scheduled.reduce((sum, device) => sum + device.baseWatts, 0);
    const scale = scheduledBase > 0 ? Math.min(1, total / scheduledBase) : 0;
    let assigned = 0;

    interiorHouse.devices.forEach((device) => {
        const active = total >= 5 && scheduled.includes(device);
        const watts = active ? Math.max(1, Math.round(device.baseWatts * scale)) : 0;
        device.active = active;
        device.watts = watts;
        assigned += watts;
        device.led.emissiveIntensity = active ? 4.4 : 0;
        device.led.color.setHex(active ? 0x86efac : 0x64748b);
        if (device.deviceMaterial)
            device.deviceMaterial.emissiveIntensity = active ? 2.8 : 0;
        setFlowState(flows["room-" + device.id], active);
        const element = interiorDeviceElements[device.id];
        element.classList.toggle("active", active);
        element.querySelector("span").textContent = active ? formatPower(watts) : "aus";
    });
    simulatedResidualLoad = Math.max(0, Math.round(total - assigned));
    setFlowState(flows.houseMain, total >= 5);
    setInteriorFlowVisibility(cutawayVisible);
    interiorBadge.textContent = "INNENANSICHT · Hauslast " + formatPower(total) +
        " · Zwei-Personen-Profil" + (simulatedResidualLoad > 0 ?
            " · sonstige Last " + formatPower(simulatedResidualLoad) : "");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function detailRowsHtml(rows) {
    return rows.filter((row) => row && row[1] !== "").map(([label, value]) =>
        '<span class="house-detail-row"><b>' + escapeHtml(label) + '</b><span>' +
        escapeHtml(value) + "</span></span>"
    ).join("");
}

function pvMinutesIntoDay(value) {
    // Die Solix-API liefert ISO-Zeitstempel mit der in APP_TIMEZONE gesetzten
    // Ortszeit. Die Uhrzeit wird direkt daraus gelesen, damit die Kurve auch
    // dann an der richtigen Stelle bleibt, wenn das Dashboard aus einer
    // anderen Browser-Zeitzone geöffnet wird.
    const match = String(value ?? "").match(/T(\d{2}):(\d{2})/);
    if (match) {
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59)
            return hours * 60 + minutes;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getHours() * 60 + parsed.getMinutes();
}

function pvSparklineHtml(history, stringIndex = null) {
    const points = Array.isArray(history) ? history
        .map((point) => ({
            time: point?.time,
            minute: pvMinutesIntoDay(point?.time),
            watts: stringIndex == null ? numberValue(point?.watts) :
                numberValue(Array.isArray(point?.strings) ? point.strings[stringIndex] : null)
        }))
        .filter((point) => point.watts != null && point.minute != null)
        .sort((left, right) => left.minute - right.minute) : [];
    if (!points.length)
        return '<span class="house-detail-row"><b>Tagesverlauf</b><span>baut sich live auf</span></span>';
    const max = Math.max(1, ...points.map((point) => point.watts));
    const coordinates = points.map((point) => {
        // Feste Achse von 00:00 bis 24:00 Uhr: Messwerte vom Vormittag bleiben
        // links, der noch nicht vergangene Teil des Tages bleibt rechts leer.
        const x = Math.max(0, Math.min(100, point.minute / 1440 * 100));
        const y = 31 - point.watts / max * 27;
        return { x, y, text: x.toFixed(1) + "," + y.toFixed(1) };
    });
    const firstX = coordinates[0].x.toFixed(1);
    const lastPoint = coordinates.at(-1);
    const area = [firstX + ",34", ...coordinates.map((point) => point.text),
        lastPoint.x.toFixed(1) + ",34"].join(" ");
    const last = formatTimestamp(points.at(-1).time).replace(" Uhr", "");
    return '<svg class="house-sparkline" viewBox="0 0 100 34" preserveAspectRatio="none" ' +
        'aria-label="PV-Tagesverlauf von 00 bis 24 Uhr">' +
        '<line class="grid" x1="25" y1="1" x2="25" y2="34"></line>' +
        '<line class="grid" x1="50" y1="1" x2="50" y2="34"></line>' +
        '<line class="grid" x1="75" y1="1" x2="75" y2="34"></line>' +
        '<polygon class="area" points="' + area + '"></polygon>' +
        '<polyline class="line" points="' + coordinates.map((point) => point.text).join(" ") + '"></polyline>' +
        '<circle class="point" cx="' + lastPoint.x.toFixed(1) + '" cy="' +
        lastPoint.y.toFixed(1) + '" r="1.6"></circle></svg>' +
        '<span class="house-sparkline-caption"><span>00:00</span><span>max ' +
        escapeHtml(formatPower(max)) + ' · Stand ' + escapeHtml(last) + '</span><span>24:00</span></span>';
}

function renderComponentDetail(component) {
    return '<span class="house-detail-grid">' + detailRowsHtml(component.rows) + '</span>' +
        '<span class="house-detail-advanced">' + detailRowsHtml(component.advancedRows) +
        (component.chart || "") + '</span>';
}

function componentData() {
    const solix = state.data.solix || {};
    const secondary = solix.secondary_solarbank || {};
    const automation = state.data.automation || {};
    const audi = state.data.audi || {};
    const smartPlug = automation.smartplug || {};
    const solixStale = solix.stale === true || automation.solix_data_stale === true;
    const pv = numberValue(solix.pv_total);
    const pvStrings = [1, 2, 3, 4].map((number) => numberValue(solix["pv" + number]));
    const batterySoc = numberValue(solix.battery_percent) ?? numberValue(automation.solix_battery_percent);
    const batteryCharge = numberValue(solix.battery_charge_power) ?? 0;
    const batteryDischarge = numberValue(solix.battery_discharge_power) ??
        Math.max(0, -(numberValue(solix.battery_power) ?? 0));
    const homeLoad = numberValue(solix.home_load);
    const output = numberValue(solix.system_output_power) ?? homeLoad;
    const grid = numberValue(solix.grid_power);
    const plugPower = numberValue(smartPlug.power_w);
    const audiPowerKw = numberValue(audi.charging_power_kw);
    const audiPower = plugPower ?? (audiPowerKw == null ? null : audiPowerKw * 1000);
    const charging = plugPower != null ? plugPower >= 20 : audi.charging === true;
    const audiAtHome = typeof audi.at_home === "boolean" ? audi.at_home : null;
    const plugConnected = audiAtHome === false ? false :
        audi.plug_connected === true || automation.audi_plug_connected === true;
    const audiStale = audi.stale === true;
    const batteryEnergyWh = numberValue(solix.battery_energy_wh);
    const interiorLoad = homeLoad == null ? output : Math.max(0, homeLoad - (plugPower ?? 0));
    const audiRange = numberValue(audi.electric_range_km);
    const audiRemaining = numberValue(audi.remaining_charging_minutes);
    const batteryCapacityWh = numberValue(solix.battery_capacity_wh);
    const pvTodayWh = numberValue(solix.pv_today_wh);
    const pvHistory = Array.isArray(solix.pv_history) ? solix.pv_history : [];
    const secondaryAvailable = secondary.available === true ||
        secondary.model != null || secondary.battery_percent != null;
    const secondaryPvStrings = [1, 2].map((number) =>
        numberValue(secondary["pv" + number]));
    const secondaryPvReported = numberValue(secondary.pv_total);
    const secondaryPv = secondaryPvReported ??
        (secondaryPvStrings.some((value) => value != null) ?
            secondaryPvStrings.reduce((sum, value) => sum + (value ?? 0), 0) : null);
    const secondarySoc = numberValue(secondary.battery_percent);
    const secondaryCharge = numberValue(secondary.battery_charge_power) ?? 0;
    const secondaryDischarge = numberValue(secondary.battery_discharge_power) ??
        Math.max(0, -(numberValue(secondary.battery_power) ?? 0));
    const secondaryEnergyWh = numberValue(secondary.battery_energy_wh);
    const secondaryCapacityWh = numberValue(secondary.battery_capacity_wh);
    const secondaryOutput = numberValue(secondary.system_output_power);
    const secondaryUpdate = formatTimestamp(secondary.last_update);
    const smartPlugVoltage = numberValue(smartPlug.voltage_v);
    const smartPlugCurrent = numberValue(smartPlug.current_a);
    const onThreshold = numberValue(automation.on_threshold_percent) ?? 30;
    const offThreshold = numberValue(automation.off_threshold_percent) ?? 10;
    const automationInterval = numberValue(automation.interval_seconds);
    const solixUpdate = formatTimestamp(solix.last_update);
    const audiUpdate = formatTimestamp(audi.last_update);

    const pvStatus = solixStale ? "LETZTER STAND" :
        pv != null && pv >= 5 ? "ERZEUGT" : pv == null ? "WIRD VERBUNDEN" : "RUHE";
    const batteryStatus = solixStale ? "LETZTER STAND" :
        batteryCharge >= 5 ? "LÄDT · " + formatPower(batteryCharge) :
            batteryDischarge >= 5 ? "LIEFERT · " + formatPower(batteryDischarge) : "BEREIT";
    const secondaryStatus = !secondaryAvailable ? "WIRD VERBUNDEN" :
        solixStale ? "LETZTER STAND" :
            secondaryCharge >= 5 ? "LÄDT · " + formatPower(secondaryCharge) :
                secondaryDischarge >= 5 ? "LIEFERT · " + formatPower(secondaryDischarge) : "BEREIT";
    const gridStatus = solixStale ? "LETZTER STAND" : grid == null ? "KEIN WERT" :
        grid > 5 ? "BEZUG" : grid < -5 ? "EINSPEISUNG" : "RUHE";
    const audiStatus = audiAtHome === false ? "UNTERWEGS" :
        audiStale ? "LETZTER STAND" : charging ? "LÄDT · " + formatPower(audiPower) :
        plugConnected ? "STECKER DRAN" : audi.plug_connected === false ? "GETRENNT" : "WIRD GEPRÜFT";

    return {
        pv: {
            id: "pv", label: "PERGOLA-PV", icon: "☀️", value: formatPower(pv), color: colors.pv,
            status: pvStatus,
            tone: solixStale || pv == null ? "muted" : pv >= 5 ? "active" : "idle",
            detail: "Heute " + formatEnergy(pvTodayWh) + " · " +
                pvStrings.map((value, index) => "PV" + (index + 1) + " " + formatPower(value)).join(" · "),
            rows: [
                ["Heute", formatEnergy(pvTodayWh)],
                ["Strings", pvStrings.map((value, index) => "PV" + (index + 1) + " " + formatPower(value)).join(" · ")]
            ],
            advancedRows: [
                ["Aktuell", formatPower(pv)],
                ["Letztes Signal", solixUpdate]
            ],
            chart: pvSparklineHtml(pvHistory),
            active: pv != null && pv >= 5
        },
        battery: {
            id: "battery", label: "SOLARBANK 4", icon: "🔋", color: colors.battery,
            value: batterySoc == null ? "--" : Math.round(batterySoc) + " %",
            status: batteryStatus,
            tone: solixStale || batterySoc == null ? "muted" :
                batteryCharge >= 5 || batteryDischarge >= 5 ? "active" : "idle",
            detail: [
                "PV " + formatPower(pv),
                batteryEnergyWh == null ? "" : Math.round(batteryEnergyWh).toLocaleString("de-DE") + " Wh gespeichert",
                "2 × BP2700"
            ].filter(Boolean).join(" · "),
            rows: [
                ["Energiefluss", batteryCharge >= 5 ? formatPower(batteryCharge) + " hinein" :
                    batteryDischarge >= 5 ? formatPower(batteryDischarge) + " heraus" : "bereit"],
                ["Gespeichert", formatEnergy(batteryEnergyWh)]
            ],
            advancedRows: [
                ["Kapazität", formatEnergy(batteryCapacityWh)],
                ["PV-Eingang", formatPower(pv)],
                ["Hausabgabe", formatPower(output)],
                ["Aufbau", "Solarbank 4 + 2 × BP2700"],
                ["Aktualisiert", solixUpdate]
            ],
            chart: "",
            active: batteryCharge >= 5 || batteryDischarge >= 5
        },
        battery3: {
            id: "battery3", label: "SOLARBANK 3", icon: "🔋", color: colors.battery3,
            value: secondarySoc == null ? "--" : Math.round(secondarySoc) + " %",
            status: secondaryStatus,
            tone: solixStale || secondarySoc == null ? "muted" :
                secondaryCharge >= 5 || secondaryDischarge >= 5 ? "active" : "idle",
            detail: [
                "Balkon-PV " + formatPower(secondaryPv),
                secondaryEnergyWh == null ? "" :
                    Math.round(secondaryEnergyWh).toLocaleString("de-DE") + " Wh gespeichert",
                "ohne Zusatzspeicher"
            ].filter(Boolean).join(" · "),
            rows: [
                ["Energiefluss", secondaryCharge >= 5 ? formatPower(secondaryCharge) + " hinein" :
                    secondaryDischarge >= 5 ? formatPower(secondaryDischarge) + " heraus" : "bereit"],
                ["Balkon-PV", secondaryPvStrings.map((value, index) =>
                    "PV" + (index + 1) + " " + formatPower(value)).join(" · ")]
            ],
            advancedRows: [
                ["Gespeichert", formatEnergy(secondaryEnergyWh)],
                ["Kapazität", formatEnergy(secondaryCapacityWh)],
                ["Hausabgabe", formatPower(secondaryOutput)],
                ["Aufbau", "Solarbank 3 · keine Zusatzakkus"],
                ["Modell", secondary.model || "--"],
                ["Aktualisiert", secondaryUpdate]
            ],
            chart: "",
            active: secondaryCharge >= 5 || secondaryDischarge >= 5
        },
        grid: {
            id: "grid", label: "STROMNETZ", icon: "🌐", color: colors.grid,
            value: formatPower(grid == null ? null : Math.abs(grid)),
            status: gridStatus,
            tone: solixStale || grid == null ? "muted" : Math.abs(grid) >= 5 ? "active" : "idle",
            detail: grid == null ? "Netzwert nicht verfügbar." :
                grid > 5 ? "Aktueller Netzbezug." :
                    grid < -5 ? "Aktuelle Netzeinspeisung." : "Aktuell kein Netzfluss.",
            rows: [
                ["Richtung", grid == null ? "unbekannt" : grid > 5 ? "Netz → Haus" :
                    grid < -5 ? "Haus → Netz" : "kein Fluss"],
                ["Hauslast", formatPower(interiorLoad)]
            ],
            advancedRows: [
                ["Spannung", smartPlugVoltage == null ? "--" : smartPlugVoltage.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " V"],
                ["Strom Audi", smartPlugCurrent == null ? "--" : smartPlugCurrent.toLocaleString("de-DE", { maximumFractionDigits: 2 }) + " A"],
                ["Smart Plug", smartPlug.state === true ? "ein" : smartPlug.state === false ? "aus" : "unbekannt"],
                ["Aktualisiert", solixUpdate]
            ],
            chart: "",
            active: grid != null && Math.abs(grid) >= 5
        },
        audi: {
            id: "audi", label: "AUDI Q3", icon: "🚙", color: colors.audi,
            value: audi.battery_percent == null ? "--" : audi.battery_percent + " %",
            status: audiStatus,
            tone: audiStale || audi.battery_percent == null ? "muted" : charging ? "active" :
                plugConnected ? "idle" : "warning",
            detail: [
                audiAtHome === false ? "Audi steht nicht am Haus" :
                    audiAtHome === true ? "Audi steht am Haus" : "Standort wird geprüft",
                plugConnected ? "Stecker verbunden" : audi.plug_connected === false ? "Stecker getrennt" : "Steckerstatus offen",
                audiRange == null ? "" : Math.round(audiRange) + " km Reichweite",
                audiRemaining == null ? "" : "noch ca. " + Math.round(audiRemaining) + " Min."
            ].filter(Boolean).join(" · "),
            rows: [
                ["Standort", audiAtHome === true ? "am Haus" : audiAtHome === false ? "unterwegs" : "wird geprüft"],
                ["Ladekabel", plugConnected ? "verbunden" : audi.plug_connected === false ? "an Säule" : "wird geprüft"],
                ["Ladeleistung", formatPower(audiPower)],
                ["Reichweite", audiRange == null ? "--" : Math.round(audiRange) + " km"]
            ],
            advancedRows: [
                ["Restzeit", audiRemaining == null ? "--" : Math.round(audiRemaining) + " Min."],
                ["Ladezustand", audi.charging_state || (charging ? "Laden aktiv" : "bereit")],
                ["Automatik", "Start " + Math.round(onThreshold) + " % · Stopp " + Math.round(offThreshold) + " %"],
                ["Prüfintervall", automationInterval == null ? "--" : Math.round(automationInterval / 60) + " Min."],
                ["Audi-Stand", audiUpdate]
            ],
            chart: "",
            active: charging
        },
        raw: {
            pv, pvStrings, batterySoc, batteryCharge, batteryDischarge, batteryEnergyWh,
            secondaryPv, secondaryPvStrings, secondarySoc, secondaryCharge,
            secondaryDischarge, secondaryEnergyWh, secondaryCapacityWh, secondaryOutput,
            output, interiorLoad, grid, audiPower, charging, plugConnected, audiAtHome, solixStale,
            pvTodayWh, batteryCapacityWh, onThreshold, offThreshold
        }
    };
}

function setFlowState(flow, active, reverse = false) {
    flow.active = active;
    flow.reverse = reverse;
    // Die Installation selbst bleibt einheitlich dunkel. Erst der tatsächliche
    // Stromfluss legt eine farbige Lichtspur und wandernde Energiepunkte darüber.
    const layerVisible = flow.isInterior ? cutawayVisible : !cutawayVisible;
    flow.tubeMaterial.opacity = active && layerVisible ? 0.92 : 0;
    flow.pulses.forEach((pulse) => {
        pulse.material.opacity = active ? 1 : 0;
        pulse.visible = active && layerVisible;
    });
}

function updateLiveUi() {
    const components = componentData();
    const raw = components.raw;
    raw.pvStrings.forEach((power, index) => {
        const id = "pv" + (index + 1);
        setFlowState(flows[id], power != null && power >= 5);
        currentPvStringPowers[index] = power;
    });
    setFlowState(flows.pvTrunk, raw.pv != null && raw.pv >= 5);
    raw.secondaryPvStrings.forEach((power, index) => {
        const id = "sb3pv" + (index + 1);
        setFlowState(flows[id], power != null && power >= 5);
        currentSecondaryPvStringPowers[index] = power;
    });
    setFlowState(flows.secondaryPvTrunk,
        raw.secondaryPv != null && raw.secondaryPv >= 5);
    updatePanelDetails();
    setFlowState(flows.grid, raw.grid != null && Math.abs(raw.grid) >= 5, raw.grid < 0);
    setFlowState(flows.audiTrunk, raw.charging && raw.audiPower != null && raw.audiPower >= 5);
    setFlowState(flows.audi, raw.charging && raw.audiPower != null && raw.audiPower >= 5);
    chargingConnection.attached.visible = !cutawayVisible && raw.plugConnected;
    chargingConnection.loose.visible = !cutawayVisible && !raw.plugConnected;
    chargingConnection.attachedCable.visible = !cutawayVisible && raw.plugConnected;
    chargingConnection.dockedCable.visible = !cutawayVisible && !raw.plugConnected;
    chargingConnection.statusMaterial.emissiveIntensity = raw.plugConnected ? 2.4 : 0.24;
    const solarBatteryMode = raw.batteryCharge >= 5 ? "charging" :
        raw.batteryDischarge >= 5 ? "discharging" : "idle";
    setSchematicBatteryState(solarBankBatteryVisual, raw.batterySoc, solarBatteryMode);
    setObjectBattery("battery", raw.batterySoc, solarBatteryMode,
        raw.batteryCharge >= 5 ? raw.batteryCharge : raw.batteryDischarge,
        ["2 × BP2700", raw.batteryEnergyWh == null ? "" :
            Math.round(raw.batteryEnergyWh).toLocaleString("de-DE") + " Wh gespeichert"].filter(Boolean));
    const secondaryBatteryMode = raw.secondaryCharge >= 5 ? "charging" :
        raw.secondaryDischarge >= 5 ? "discharging" : "idle";
    setSchematicBatteryState(secondarySolarBankBatteryVisual,
        raw.secondarySoc, secondaryBatteryMode);
    setObjectBattery("battery3", raw.secondarySoc, secondaryBatteryMode,
        raw.secondaryCharge >= 5 ? raw.secondaryCharge : raw.secondaryDischarge,
        ["ohne Zusatzspeicher", raw.secondaryEnergyWh == null ? "" :
            Math.round(raw.secondaryEnergyWh).toLocaleString("de-DE") +
            " Wh gespeichert"].filter(Boolean));
    const audiData = state.data.audi || {};
    if (!audiPresenceDemoActive)
        startAudiPresenceTransition(audiData.at_home);
    const audiRemaining = numberValue(audiData.remaining_charging_minutes);
    const audiPercent = numberValue(audiData.battery_percent);
    const audiBatteryMode = raw.charging ? "charging" : "idle";
    const audiRange = numberValue(audiData.electric_range_km);
    setSchematicBatteryState(audiBatteryVisual, audiPercent, audiBatteryMode);
    setObjectBattery("audi", audiPercent, audiBatteryMode, raw.audiPower, [
        raw.plugConnected === true ? "Stecker verbunden" :
            raw.plugConnected === false ? "Stecker getrennt" : "Steckerstatus unbekannt",
        audiRange == null ? "" : Math.round(audiRange) + " km elektrisch",
        audiRemaining == null ? "" : "noch ca. " + Math.round(audiRemaining) + " Min."
    ].filter(Boolean));
    objectBatteryElements.audi.hidden = raw.audiAtHome === false;
    updateInteriorElectricity(raw.interiorLoad, new Date());

    ["pv", "battery", "battery3", "grid", "audi"].forEach((id) => {
        const component = components[id];
        const element = labelElements[id];
        element.innerHTML =
            '<span class="house-scene-head"><i aria-hidden="true"></i>' +
            `<small>${component.label}</small></span>` +
            '<span class="house-scene-main">' +
            `<strong>${component.value}</strong><em>${component.status}</em></span>` +
            `<span class="house-scene-detail">${renderComponentDetail(component)}</span>` +
            `<span class="house-scene-more">${state.expandedComponent === id ? "Weniger" : "Details öffnen"}</span>`;
        element.classList.toggle("active", component.active);
        element.classList.toggle("selected", state.selected === id);
        element.classList.toggle("expanded", state.expandedComponent === id);
        element.style.setProperty("--scene-color", component.color);
        element.dataset.tone = component.tone;
        element.setAttribute("aria-label", component.label + ": " + component.value + ", " + component.status);
        element.setAttribute("aria-expanded", state.expandedComponent === id ? "true" : "false");
    });

    const selected = components[state.selected] || components.battery;
    inspectorIcon.textContent = selected.icon;
    inspectorLabel.textContent = selected.label;
    inspectorValue.textContent = selected.value;
    inspectorDetail.textContent = selected.detail;
    liveBadge.textContent = components.battery.value === "--" ?
        "Live wird verbunden" : raw.solixStale ?
            "LETZTER STAND · Solix " + components.battery.value :
            "LIVE · Solix " + components.battery.value;
    menuPvToday.textContent = formatEnergy(raw.pvTodayWh);
    menuHousePower.textContent = formatPower(raw.interiorLoad);
    menuBatterySoc.textContent = components.battery.value;
    menuAudiSoc.textContent = components.audi.value;
    menuStartThreshold.textContent = Math.round(raw.onThreshold) + " %";
    menuStopThreshold.textContent = Math.round(raw.offThreshold) + " %";
}

const CUTAWAY_ENTER_ZOOM = 2.34;
const CUTAWAY_EXIT_ZOOM = 2.14;
let cutawayVisible = false;
let cutawayBlend = 0;
let cutawayTarget = 0;

function setCutawayVisible(visible) {
    if (cutawayVisible === visible)
        return;
    cutawayVisible = visible;
    cutawayTarget = visible ? 1 : 0;
    stage.classList.toggle("house-cutaway", visible);
    if (visible)
        interiorHouse.group.visible = true;
    [pergolaModel, balconyPanelModel, solarBankModel, secondarySolarBankModel, gridBoxModel,
        vehicleModels.yeti.slot,
        vehicleModels.fox.slot, vehicleModels.karoq.slot].forEach((model) => {
        model.visible = !visible;
    });
    vehicleModels.audi.slot.visible = !visible &&
        (audiPresenceMotion.targetHome !== false || audiPresenceMotion.phase !== "idle");
    updateInteriorElectricity(simulatedHouseLoad, new Date());
    setExteriorFlowVisibility(!visible);

    // Außen liegende Ladekabel und Stecker würden in der offenen
    // Puppenhausansicht durch Zimmer laufen. Beim Zurückzoomen erscheinen sie
    // wieder exakt passend zum echten Steckerstatus.
    const raw = componentData().raw;
    chargingConnection.attached.visible = !visible && raw.plugConnected;
    chargingConnection.loose.visible = !visible && !raw.plugConnected;
    chargingConnection.attachedCable.visible = !visible && raw.plugConnected;
    chargingConnection.dockedCable.visible = !visible && !raw.plugConnected;
}

function updateCutawayMode(delta = 0.016) {
    const shouldShowInterior = cutawayVisible ?
        state.zoom >= CUTAWAY_EXIT_ZOOM : state.zoom >= CUTAWAY_ENTER_ZOOM;
    setCutawayVisible(shouldShowInterior);
    cutawayBlend = THREE.MathUtils.damp(cutawayBlend, cutawayTarget, 6.5, delta);
    if (Math.abs(cutawayBlend - cutawayTarget) < 0.002)
        cutawayBlend = cutawayTarget;
    applyExteriorFade(cutawayBlend);
    // Beim Herauszoomen verschwindet die helle Innen-Dachhälfte, bevor das
    // rote Außendach wieder eingeblendet wird. So gibt es keinen kurzen
    // weißen Doppel-Dachzustand während des Übergangs.
    interiorHouse.group.visible = cutawayVisible || cutawayBlend > 0.44;

    const detailLevel = cutawayVisible ? "interior" :
        state.zoom >= 1.36 ? "close" : state.zoom >= 1.08 ? "near" : "overview";
    stage.dataset.detailLevel = detailLevel;
}

function updateLabelPositions() {
    const rect = stage.getBoundingClientRect();
    const rootPosition = new THREE.Vector3();
    world.getWorldPosition(rootPosition);
    // Audi-Karte und Akkuanzeige folgen auch während der Fahranimation dem
    // Fahrzeug, statt am leeren Stellplatz zurückzubleiben.
    labelAnchors.audi.set(audiModel.position.x, 1.72, audiModel.position.z);
    objectBatteryAnchors.audi.set(audiModel.position.x, 0.72, audiModel.position.z);
    Object.entries(labelAnchors).forEach(([id, localAnchor]) => {
        const anchor = world.localToWorld(localAnchor.clone());
        const cameraSpace = anchor.clone().applyMatrix4(camera.matrixWorldInverse);
        const projected = anchor.project(camera);
        const rawX = (projected.x * 0.5 + 0.5) * rect.width;
        const rawY = (-projected.y * 0.5 + 0.5) * rect.height;
        const expanded = state.expandedComponent === id;
        const edgeMarginX = expanded ? Math.min(116, rect.width * 0.34) :
            Math.min(64, rect.width * 0.22);
        const x = THREE.MathUtils.clamp(rawX, edgeMarginX, rect.width - edgeMarginX);
        // Weil die Karte mit ihrer Unterkante am Anker sitzt, muss am oberen
        // Bildrand ihre komplette Höhe berücksichtigt werden.
        const topGuard = expanded ? Math.min(218, rect.height * 0.43) :
            Math.min(112, rect.height * 0.26);
        const y = THREE.MathUtils.clamp(rawY, topGuard, rect.height - 28);
        const element = labelElements[id];
        element.style.left = x + "px";
        element.style.top = y + "px";
        element.classList.toggle("behind", cameraSpace.z > rootPosition.z);
        element.classList.toggle("outside", rawX < -110 || rawX > rect.width + 110 || rawY < -70 || rawY > rect.height + 70);
        // In der Übersicht bleiben die Karten kompakt. Ab dem Nahzoom wächst
        // dagegen die komplette Anzeige samt Status- und Detailzeilen deutlich
        // mit, damit sie auch auf dem iPhone ohne Anstrengung lesbar ist.
        element.style.setProperty("--scene-label-scale", THREE.MathUtils.clamp(
            0.90 + Math.max(0, state.zoom - 1) * 0.20,
            0.90,
            expanded ? 1.18 : 1.34
        ));
    });

    [...pvPanelAnchors, ...secondaryPvPanelAnchors].forEach((panel) => {
        const anchor = world.localToWorld(panel.anchor.clone());
        const cameraSpace = anchor.clone().applyMatrix4(camera.matrixWorldInverse);
        const projected = anchor.project(camera);
        const rawX = (projected.x * 0.5 + 0.5) * rect.width;
        const rawY = (-projected.y * 0.5 + 0.5) * rect.height;
        const element = pvStringElements[panel.id];
        const expanded = state.expandedPanel === panel.id;
        const x = expanded ? THREE.MathUtils.clamp(rawX, 92, rect.width - 92) : rawX;
        const y = expanded ? THREE.MathUtils.clamp(rawY, 66, rect.height - 66) : rawY;
        element.style.left = x + "px";
        element.style.top = y + "px";
        // Das Overlay erhält keinerlei 3D-Winkel. Nur sein Mittelpunkt folgt
        // dem Modul; Text und Zusatzinformationen bleiben immer waagerecht.
        element.style.setProperty("--string-label-scale", THREE.MathUtils.clamp(
            0.64 + state.zoom * 0.32,
            0.82,
            expanded ? 1.14 : 1.65
        ));
        element.classList.toggle("behind", cameraSpace.z > rootPosition.z);
        element.classList.toggle("outside", rawX < -45 || rawX > rect.width + 45 || rawY < -30 || rawY > rect.height + 30);
    });

    Object.entries(objectBatteryAnchors).forEach(([id, localAnchor]) => {
        const anchor = world.localToWorld(localAnchor.clone());
        const cameraSpace = anchor.clone().applyMatrix4(camera.matrixWorldInverse);
        const projected = anchor.project(camera);
        const x = THREE.MathUtils.clamp((projected.x * 0.5 + 0.5) * rect.width, 26, rect.width - 26);
        const y = THREE.MathUtils.clamp((-projected.y * 0.5 + 0.5) * rect.height, 38, rect.height - 48);
        const element = objectBatteryElements[id];
        element.style.left = x + "px";
        element.style.top = y + "px";
        element.style.setProperty("--object-battery-scale", THREE.MathUtils.clamp(0.74 + state.zoom * 0.20, 0.94, 1.22));
        element.classList.toggle("behind", cameraSpace.z > rootPosition.z);
    });

    interiorHouse.devices.forEach((device) => {
        const anchor = world.localToWorld(device.anchor.clone());
        const cameraSpace = anchor.clone().applyMatrix4(camera.matrixWorldInverse);
        const projected = anchor.project(camera);
        const element = interiorDeviceElements[device.id];
        element.style.left = THREE.MathUtils.clamp(
            (projected.x * 0.5 + 0.5) * rect.width, 38, rect.width - 38
        ) + "px";
        element.style.top = THREE.MathUtils.clamp(
            (-projected.y * 0.5 + 0.5) * rect.height, 34, rect.height - 46
        ) + "px";
        element.style.setProperty("--device-label-scale", THREE.MathUtils.clamp(0.60 + state.zoom * 0.34, 1.02, 1.58));
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

function pointerCenter() {
    const pointers = Array.from(state.pointers.values());
    if (!pointers.length)
        return { x: 0, y: 0 };
    const total = pointers.reduce((sum, pointer) => ({
        x: sum.x + pointer.x,
        y: sum.y + pointer.y
    }), { x: 0, y: 0 });
    return { x: total.x / pointers.length, y: total.y / pointers.length };
}

function normalizedCanvasPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) / Math.max(rect.width, 1) - 0.5,
        y: (clientY - rect.top) / Math.max(rect.height, 1) - 0.5
    };
}

function applyFocalZoom(newZoom, focusX, focusY, startZoom, startPanX, startPanY,
    panOffsetX = 0, panOffsetY = 0) {
    const safeStartZoom = Math.max(MIN_ZOOM, startZoom);
    const safeNewZoom = THREE.MathUtils.clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) *
        cameraBaseOffset.length();
    const viewWidth = viewHeight * camera.aspect;
    const focalShift = 1 / safeStartZoom - 1 / safeNewZoom;
    state.targetPanX = THREE.MathUtils.clamp(
        startPanX + focusX * viewWidth * focalShift + panOffsetX,
        -6.5,
        6.5
    );
    state.targetPanY = THREE.MathUtils.clamp(
        startPanY - focusY * viewHeight * focalShift + panOffsetY,
        -4.0,
        4.5
    );
    state.targetZoom = safeNewZoom;
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
        state.pinchStartPanX = state.targetPanX;
        state.pinchStartPanY = state.targetPanY;
        state.pinchPanOffsetX = 0;
        state.pinchPanOffsetY = 0;
        const center = pointerCenter();
        const focus = normalizedCanvasPoint(center.x, center.y);
        state.pinchFocusX = focus.x;
        state.pinchFocusY = focus.y;
        state.pinchLastCenterX = center.x;
        state.pinchLastCenterY = center.y;
    }
});

canvas.addEventListener("pointermove", (event) => {
    if (!state.pointers.has(event.pointerId))
        return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size >= 2) {
        const distance = pointerDistance();
        const center = pointerCenter();
        const nextZoom = state.pinchStartDistance > 0 ?
            THREE.MathUtils.clamp(
                state.pinchStartZoom * distance / state.pinchStartDistance,
                MIN_ZOOM,
                MAX_ZOOM
            ) : state.targetZoom;
        const panSpeed = (canvas.clientWidth < 700 ? 0.018 : 0.012) /
            Math.max(0.70, nextZoom);
        state.pinchPanOffsetX -= (center.x - state.pinchLastCenterX) * panSpeed;
        state.pinchPanOffsetY += (center.y - state.pinchLastCenterY) * panSpeed;
        applyFocalZoom(
            nextZoom,
            state.pinchFocusX,
            state.pinchFocusY,
            state.pinchStartZoom,
            state.pinchStartPanX,
            state.pinchStartPanY,
            state.pinchPanOffsetX,
            state.pinchPanOffsetY
        );
        state.pinchLastCenterX = center.x;
        state.pinchLastCenterY = center.y;
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
        state.targetPitch = THREE.MathUtils.clamp(
            state.targetPitch - deltaY * 0.0034,
            MIN_PITCH,
            MAX_PITCH
        );
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
        state.pinchPanOffsetX = 0;
        state.pinchPanOffsetY = 0;
        state.pinchLastCenterX = 0;
        state.pinchLastCenterY = 0;
        finishSceneInteractionSoon();
    }
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
stage.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    beginSceneInteraction();
    const focus = normalizedCanvasPoint(event.clientX, event.clientY);
    const startZoom = state.targetZoom;
    const nextZoom = THREE.MathUtils.clamp(
        state.targetZoom * Math.exp(-event.deltaY * 0.0012),
        MIN_ZOOM,
        MAX_ZOOM
    );
    applyFocalZoom(nextZoom, focus.x, focus.y, startZoom,
        state.targetPanX, state.targetPanY);
    finishSceneInteractionSoon();
}, { passive: false });
canvas.addEventListener("keydown", (event) => {
    if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        beginSceneInteraction();
        state.targetZoom = Math.min(MAX_ZOOM, state.targetZoom + 0.16);
        finishSceneInteractionSoon();
        return;
    }
    if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        beginSceneInteraction();
        state.targetZoom = Math.max(MIN_ZOOM, state.targetZoom - 0.16);
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
            MIN_PITCH,
            MAX_PITCH
        );
    finishSceneInteractionSoon();
});

resetButton.addEventListener("click", () => {
    state.targetYaw = DEFAULT_VIEW.yaw;
    state.targetPitch = DEFAULT_VIEW.pitch;
    state.targetPanX = DEFAULT_VIEW.panX;
    state.targetPanY = DEFAULT_VIEW.panY;
    state.targetZoom = DEFAULT_VIEW.zoom;
    state.selected = "battery";
    state.expandedComponent = null;
    state.expandedPanel = null;
    updateLiveUi();
});

function setMenuOpen(open) {
    menuPanel.hidden = !open;
    menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    menuToggle.setAttribute("aria-label", open ? "Energie-Menü schließen" : "Energie-Menü öffnen");
}

menuToggle.addEventListener("click", () => setMenuOpen(menuPanel.hidden));
menuClose.addEventListener("click", () => setMenuOpen(false));
menuCollapse.addEventListener("click", () => {
    state.expandedComponent = null;
    state.expandedPanel = null;
    updateLiveUi();
    setMenuOpen(false);
});

window.addEventListener("solix-dashboard-data", (event) => {
    state.data = event.detail || state.data;
    updateLiveUi();
});
window.addEventListener("solix-audi-demo", runAudiPresenceDemo);

function animatePondFish(seconds) {
    if (reduceMotion)
        return;
    pondFish.forEach((fish, index) => {
        const angle = fish.phase + seconds * fish.speed;
        const ripple = Math.sin(seconds * fish.wobble + index * 1.7) * 0.08;
        const nextAngle = angle + 0.015;
        const x = Math.cos(angle) * (fish.radiusX + ripple);
        const z = Math.sin(angle * 1.17) * fish.radiusZ;
        const nextX = Math.cos(nextAngle) * (fish.radiusX + ripple);
        const nextZ = Math.sin(nextAngle * 1.17) * fish.radiusZ;
        fish.group.position.x = x;
        fish.group.position.z = z;
        fish.group.rotation.y = Math.atan2(nextX - x, nextZ - z);
        fish.group.rotation.z = Math.sin(seconds * 1.9 + fish.phase) * 0.06;
    });
}

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
    updateCutawayMode(delta);
    updateAudiPresenceMotion(time);

    if (Math.floor(seconds) !== Math.floor(seconds - delta))
        updatePanelDetails();
    const routineMinute = Math.floor(Date.now() / 60000);
    if (routineMinute !== lastRoutineMinute) {
        lastRoutineMinute = routineMinute;
        updateInteriorElectricity(componentData().raw.interiorLoad, new Date());
    }

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
    }

    animateSchematicBattery(solarBankBatteryVisual, seconds);
    animateSchematicBattery(secondarySolarBankBatteryVisual, seconds);
    animateSchematicBattery(audiBatteryVisual, seconds);
    animatePondFish(seconds);

    updateLabelPositions();
    renderer.render(scene, camera);
    window.requestAnimationFrame(animate);
}

resize();
updateLiveUi();
if (new URLSearchParams(window.location.search).get("audi_demo") === "1")
    window.setTimeout(runAudiPresenceDemo, 1400);
window.requestAnimationFrame(animate);
