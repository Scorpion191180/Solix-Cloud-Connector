import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

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
const animalSoundToggle = document.getElementById("animalSoundToggle");
const renderQualitySelect = document.getElementById("renderQualitySelect");
const renderQualityStatus = document.getElementById("renderQualityStatus");
const builderOpenButton = document.getElementById("houseBuilderOpen");
const builderPanel = document.getElementById("houseBuilderPanel");
const builderCloseButton = document.getElementById("houseBuilderClose");
const builderPanelToggle = document.getElementById("builderPanelToggle");
const builderPointerMode = document.getElementById("builderPointerMode");
const builderPartType = document.getElementById("builderPartType");
const builderVariant = document.getElementById("builderVariant");
const builderVariantLabel = document.getElementById("builderVariantLabel");
const builderWallLengthRow = document.getElementById("builderWallLengthRow");
const builderWallLength = document.getElementById("builderWallLength");
const builderWallLengthValue = document.getElementById("builderWallLengthValue");
const builderColor = document.getElementById("builderColor");
const builderSwatches = document.getElementById("builderSwatches");
const builderRotateLeft = document.getElementById("builderRotateLeft");
const builderRotateRight = document.getElementById("builderRotateRight");
const builderRotation = document.getElementById("builderRotation");
const builderNew = document.getElementById("builderNew");
const builderDelete = document.getElementById("builderDelete");
const builderUndo = document.getElementById("builderUndo");
const builderClear = document.getElementById("builderClear");
const builderStatus = document.getElementById("builderStatus");
const builderSelectionTools = document.getElementById("builderSelectionTools");
const builderSelectionRotateLeft = document.getElementById("builderSelectionRotateLeft");
const builderSelectionRotateRight = document.getElementById("builderSelectionRotateRight");
const builderSelectionDelete = document.getElementById("builderSelectionDelete");
const builderTouchBuild = document.getElementById("builderTouchBuild");
const builderTouchCamera = document.getElementById("builderTouchCamera");
const houseInstructions = document.getElementById("houseInstructions");
const menuCleanStatus = document.getElementById("houseCleanStatus");
const menuCareStatus = document.getElementById("houseCareStatus");
const menuPvToday = document.getElementById("menuPvToday");
const menuHousePower = document.getElementById("menuHousePower");
const menuBatterySoc = document.getElementById("menuBatterySoc");
const menuAudiSoc = document.getElementById("menuAudiSoc");
const menuStartThreshold = document.getElementById("menuStartThreshold");
const menuStopThreshold = document.getElementById("menuStopThreshold");
const weatherPanel = document.getElementById("houseWeather");
const weatherIcon = document.getElementById("houseWeatherIcon");
const weatherTemp = document.getElementById("houseWeatherTemp");
const weatherText = document.getElementById("houseWeatherText");
const sceneLoader = document.getElementById("sceneLoader");
const sceneLoaderBar = document.getElementById("sceneLoaderBar");
const sceneLoaderStatus = document.getElementById("sceneLoaderStatus");
const sceneLoaderPercent = document.getElementById("sceneLoaderPercent");
const sceneLoaderVersion = document.getElementById("sceneLoaderVersion");
const APP_BUILD_VERSION = "120";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const INTERIOR_VIEW_ENABLED = false;

if (sceneLoaderVersion)
    sceneLoaderVersion.textContent = `Version ${APP_BUILD_VERSION}`;

let initialSceneAssetsReady = false;
let sceneLoaderGeneration = 0;
let sceneLoaderHideTimer = null;
let sceneLoaderValue = 0;
let sceneWasHidden = false;
const sceneLoaderErrors = new Set();

function setSceneLoaderProgress(percent, message = "") {
    if (!sceneLoader)
        return;
    sceneLoaderValue = THREE.MathUtils.clamp(Math.round(percent), 0, 100);
    if (sceneLoaderBar)
        sceneLoaderBar.style.width = `${sceneLoaderValue}%`;
    if (sceneLoaderPercent)
        sceneLoaderPercent.textContent = `${sceneLoaderValue} %`;
    if (message && sceneLoaderStatus)
        sceneLoaderStatus.textContent = message;
}

function showSceneLoader(message, initialPercent = 8) {
    if (!sceneLoader)
        return 0;
    sceneLoaderGeneration += 1;
    if (sceneLoaderHideTimer)
        window.clearTimeout(sceneLoaderHideTimer);
    sceneLoader.hidden = false;
    sceneLoader.classList.remove("is-ready");
    sceneLoaderValue = 0;
    setSceneLoaderProgress(initialPercent, message);
    return sceneLoaderGeneration;
}

function warmAndHideSceneLoader(message, startPercent = 72) {
    const generation = sceneLoaderGeneration || showSceneLoader(message, startPercent);
    const startedAt = performance.now();
    let renderedWarmupFrames = 0;
    const warmFrame = (now) => {
        if (generation !== sceneLoaderGeneration || !sceneLoader)
            return;
        renderedWarmupFrames += 1;
        const frameProgress = renderedWarmupFrames / 10;
        const timeProgress = (now - startedAt) / 520;
        const progress = Math.min(1, frameProgress, timeProgress);
        setSceneLoaderProgress(startPercent + progress * (99 - startPercent), message);
        if (progress < 1) {
            window.requestAnimationFrame(warmFrame);
            return;
        }
        setSceneLoaderProgress(100, message);
        stage.dataset.sceneReady = "true";
        sceneLoader.classList.add("is-ready");
        sceneLoaderHideTimer = window.setTimeout(() => {
            if (generation === sceneLoaderGeneration) {
                sceneLoader.hidden = true;
                sceneLoader.classList.remove("is-ready");
            }
        }, 360);
    };
    window.requestAnimationFrame(warmFrame);
}

function finishInitialSceneLoading() {
    if (initialSceneAssetsReady)
        return;
    initialSceneAssetsReady = true;
    const message = sceneLoaderErrors.size ?
        "Szene bereit – einzelne nicht verfügbare Details wurden übersprungen." :
        "Alle 3D-Objekte sind bereit.";
    warmAndHideSceneLoader(message, Math.max(72, sceneLoaderValue));
}

function resumeSceneWithLoader() {
    if (!initialSceneAssetsReady || document.hidden)
        return;
    showSceneLoader("Animationen werden flüssig fortgesetzt …", 18);
    stage.dataset.sceneReady = "warming";
    state.lastTime = performance.now();
    lastRenderedAt = 0;
    renderer.shadowMap.needsUpdate = true;
    warmAndHideSceneLoader("Animationen sind bereit.", 18);
}

const sceneLoadingManager = new THREE.LoadingManager();
sceneLoadingManager.onStart = (url, loaded, total) => {
    stage.dataset.sceneLoadingUrl = url;
    stage.dataset.sceneLoadedItems = String(loaded);
    stage.dataset.sceneTotalItems = String(total);
    const progress = total > 0 ? 8 + loaded / total * 82 : 8;
    setSceneLoaderProgress(Math.max(sceneLoaderValue, progress),
        "Haus, Texturen und 3D-Modelle werden geladen …");
};
sceneLoadingManager.onProgress = (url, loaded, total) => {
    stage.dataset.sceneLoadingUrl = url;
    stage.dataset.sceneLoadedItems = String(loaded);
    stage.dataset.sceneTotalItems = String(total);
    const progress = total > 0 ? 8 + loaded / total * 84 : 88;
    setSceneLoaderProgress(Math.max(sceneLoaderValue, Math.min(92, progress)),
        "3D-Objekte werden zusammengesetzt …");
};
sceneLoadingManager.onError = (url) => {
    sceneLoaderErrors.add(url);
    setSceneLoaderProgress(sceneLoaderValue, "Ein Detail konnte nicht geladen werden – Aufbau läuft weiter …");
};
sceneLoadingManager.onLoad = finishInitialSceneLoading;
// Keep the manager open until the complete synchronous scene setup has
// registered every texture and model. Otherwise a fast cached asset can end
// the first loading batch before later objects have even been requested.
const SCENE_BOOTSTRAP_ITEM = "solix-scene-bootstrap";
sceneLoadingManager.itemStart(SCENE_BOOTSTRAP_ITEM);

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        sceneWasHidden = true;
        return;
    }
    if (sceneWasHidden) {
        sceneWasHidden = false;
        resumeSceneWithLoader();
    }
});
window.addEventListener("pagehide", () => {
    sceneWasHidden = true;
});
window.addEventListener("pageshow", (event) => {
    if (event.persisted || sceneWasHidden) {
        sceneWasHidden = false;
        resumeSceneWithLoader();
    }
});
window.setTimeout(() => {
    if (!initialSceneAssetsReady) {
        stage.dataset.sceneLoaderTimeout = "true";
        sceneLoaderErrors.add("scene-load-timeout");
        finishInitialSceneLoading();
    }
}, 45000);

function storedRenderQuality() {
    try {
        const stored = localStorage.getItem("solix-render-quality");
        return ["auto", "eco", "full"].includes(stored) ? stored : "auto";
    }
    catch (_error) {
        return "auto";
    }
}

const renderQualityPreference = storedRenderQuality();
const mobilePointer = window.matchMedia("(pointer: coarse)").matches;
const mobileUserAgent = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "") ||
    navigator.userAgentData?.mobile === true;
const compactGpuDevice = mobileUserAgent || (mobilePointer && Math.min(
    window.screen?.width || window.innerWidth,
    window.screen?.height || window.innerHeight
) <= 900);
const renderProfileName = renderQualityPreference === "eco" ? "eco" :
    renderQualityPreference === "full" ? "full" : compactGpuDevice ? "mobile" : "desktop";
const RENDER_PROFILES = Object.freeze({
    eco: {
        targetFps: 24, pixelRatio: 1, antialias: false,
        sunShadowSize: 512, moonShadows: false, shadowInterval: 8,
        labelInterval: 3, weatherInterval: 3, ecologyInterval: 4,
        activeBirds: 5, cloudCount: 4, rainCount: 130, snowCount: 90,
        minorShadows: false
    },
    mobile: {
        targetFps: 30, pixelRatio: 1.15, antialias: false,
        sunShadowSize: 1024, moonShadows: false, shadowInterval: 6,
        labelInterval: 2, weatherInterval: 2, ecologyInterval: 3,
        activeBirds: 8, cloudCount: 6, rainCount: 190, snowCount: 130,
        minorShadows: false
    },
    desktop: {
        targetFps: 60, pixelRatio: 1.75, antialias: true,
        sunShadowSize: 2048, moonShadows: true, shadowInterval: 1,
        labelInterval: 1, weatherInterval: 1, ecologyInterval: 1,
        activeBirds: 20, cloudCount: 9, rainCount: 320, snowCount: 230,
        minorShadows: true
    },
    full: {
        targetFps: 60, pixelRatio: 2, antialias: true,
        sunShadowSize: 2048, moonShadows: true, shadowInterval: 1,
        labelInterval: 1, weatherInterval: 1, ecologyInterval: 1,
        activeBirds: 20, cloudCount: 9, rainCount: 320, snowCount: 230,
        minorShadows: true
    }
});
const renderProfile = RENDER_PROFILES[renderProfileName];
stage.dataset.renderProfile = renderProfileName;
stage.dataset.targetFps = String(renderProfile.targetFps);
stage.dataset.pixelRatioCap = String(renderProfile.pixelRatio);

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
// Die geneigte Flächennormale der Pergola-Paneele zeigt im Modell nach +X.
// Laut Vorgabe entspricht diese Richtung Süd-Südost (157,5°).
const PANEL_AZIMUTH_FALLBACK_DEGREES = 157.5;

const state = {
    selected: "battery",
    expandedComponent: null,
    expandedPanel: null,
    data: window.solixDashboardState || { solix: {}, automation: {}, audi: {}, weather: {} },
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
        antialias: renderProfile.antialias,
        stencil: false,
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
// PCF keeps the soft solar shadows visibly darker than VSM, which tended to
// wash them out on the bright house surfaces, especially on mobile displays.
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = renderProfile.shadowInterval === 1;

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
let audiModel = null;
const pondFish = [];
let horse = null;
let dog = null;
const horseDroppings = [];
const camelHerd = [];
const animalDroppings = [];
const urinePatches = [];
const animalDemoMode = new URLSearchParams(window.location.search).get("animal_demo") === "1";
const animalFocusMode = new URLSearchParams(window.location.search).get("animal_focus");
let nextCamelHerdRestAt = animalDemoMode ? 10 : 160;
let camelHerdRestSerial = 0;
let camelHerdRestDeadline = 0;
let camelHerdRestDuration = 0;
let camelHerdRestStarted = false;
if (animalDemoMode)
    stage.dataset.animalDemo = "true";
const iconCaptureMode = new URLSearchParams(window.location.search).get("icon_capture") === "1";
if (iconCaptureMode)
    stage.classList.add("icon-capture");
const animalSoundSources = {
    horse: new Audio("/static/sounds/horse-neigh.ogg?v=94"),
    camel: new Audio("/static/sounds/camel-call.ogg?v=94"),
    dog: new Audio("/static/sounds/rottweiler-barking.ogg?v=108"),
    bird: new Audio("/static/sounds/bird-singing-clear.ogg?v=108")
};
let animalSoundsEnabled = true;
try {
    animalSoundsEnabled = localStorage.getItem("solix-animal-sounds") !== "off";
} catch (_error) {
    // Bleibt auch in eingeschraenkten Safari-/Privatmodi nutzbar.
}
let animalSoundsUnlocked = false;
let animalSoundUnlockPending = false;
const animalSoundLastPlayed = {
    horse: -Infinity,
    camel: -Infinity,
    dog: -Infinity,
    bird: -Infinity
};
const animalSoundStopTimers = {};
let birdAudioContext = null;
let birdAudioWasRunning = false;
let birdSongPlayCount = 0;

Object.values(animalSoundSources).forEach((audio) => {
    audio.preload = "auto";
    audio.playsInline = true;
});

function updateAnimalSoundButton() {
    if (!animalSoundToggle)
        return;
    animalSoundToggle.textContent = animalSoundsEnabled ? "🔊 Tierlaute: an" : "🔇 Tierlaute: aus";
    animalSoundToggle.setAttribute("aria-pressed", animalSoundsEnabled ? "true" : "false");
}

function unlockAnimalSounds() {
    if (animalSoundsEnabled && !birdAudioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            try {
                birdAudioContext = new AudioContextClass();
                birdAudioContext.resume().catch(() => {});
            }
            catch (_error) {
                birdAudioContext = null;
            }
        }
    }
    else if (animalSoundsEnabled && birdAudioContext?.state === "suspended")
        birdAudioContext.resume().catch(() => {});
    if (animalSoundsUnlocked || animalSoundUnlockPending || !animalSoundsEnabled)
        return;
    animalSoundUnlockPending = true;
    // Safari/iOS verlangt einen ersten, direkt durch eine Berührung ausgelösten
    // Start. Lautstärke null macht diesen Freischaltvorgang unhörbar.
    const attempts = Object.values(animalSoundSources).map((audio) => {
        audio.volume = 0;
        const start = audio.play();
        if (start?.then)
            return start.then(() => {
                audio.pause();
                audio.currentTime = 0;
                return true;
            }).catch(() => false);
        return Promise.resolve(false);
    });
    // Ein einzelner fehlgeschlagener Start darf einen bereits erfolgreichen
    // zweiten Ton nicht wieder sperren (Race Condition auf iOS/Safari).
    Promise.all(attempts).then((results) => {
        animalSoundsUnlocked = results.some(Boolean);
        animalSoundUnlockPending = false;
    });
}

function playAnimalSound(kind, volume = 0.55) {
    if (!animalSoundsEnabled || !animalSoundsUnlocked || !animalSoundSources[kind])
        return false;
    const now = performance.now() * 0.001;
    const cooldown = kind === "camel" ? 34 : kind === "horse" ? 22 :
        kind === "dog" ? 4.1 : 6.5;
    if (now - animalSoundLastPlayed[kind] < cooldown)
        return false;
    animalSoundLastPlayed[kind] = now;
    // Das bereits per Nutzerberuehrung entsperrte Element wiederverwenden. Das
    // ist auf iOS zuverlaessiger als ein erst spaeter erzeugter Audio-Klon.
    const audio = animalSoundSources[kind];
    if (animalSoundStopTimers[kind])
        window.clearTimeout(animalSoundStopTimers[kind]);
    audio.pause();
    // Der klare Vogelruf beginnt direkt am Anfang der Aufnahme. Zufällige
    // Sprünge in die frühere lange Gartenaufnahme landeten auf Mobilgeräten
    // häufig in leisen Pausen und wirkten deshalb wie stumm.
    if (kind === "bird" && Number.isFinite(audio.duration) && audio.duration > 12)
        audio.currentTime = Math.min(audio.duration - 7, Math.random() * 1.8);
    else
        audio.currentTime = 0;
    audio.volume = THREE.MathUtils.clamp(volume, 0, 1);
    audio.playbackRate = kind === "camel" ? 0.94 + Math.random() * 0.10 :
        kind === "bird" ? 0.98 + Math.random() * 0.04 : 0.97 + Math.random() * 0.06;
    const playback = audio.play();
    playback?.then(() => {
        const audibleMilliseconds = kind === "bird" ? 6800 : kind === "dog" ? 3600 : 0;
        if (audibleMilliseconds > 0)
            animalSoundStopTimers[kind] = window.setTimeout(() => {
                audio.pause();
                animalSoundStopTimers[kind] = null;
            }, audibleMilliseconds);
    }).catch(() => {
        animalSoundsUnlocked = false;
    });
    return true;
}

window.addEventListener("pointerdown", unlockAnimalSounds, { passive: true });
// iOS/Safari akzeptiert das Freischalten je nach Version erst am Ende der
// Beruehrung. Die zusaetzlichen echten Nutzerereignisse machen auch den
// synthetisierten Vogelgesang nach der ersten Bedienung zuverlaessig hoerbar.
window.addEventListener("pointerup", unlockAnimalSounds, { passive: true });
window.addEventListener("touchend", unlockAnimalSounds, { passive: true });
window.addEventListener("click", unlockAnimalSounds, { passive: true });
window.addEventListener("keydown", unlockAnimalSounds, { passive: true });
animalSoundToggle?.addEventListener("click", () => {
    animalSoundsEnabled = !animalSoundsEnabled;
    try {
        localStorage.setItem("solix-animal-sounds", animalSoundsEnabled ? "on" : "off");
    } catch (_error) {
        // Die Einstellung gilt dann nur fuer die aktuelle Sitzung.
    }
    updateAnimalSoundButton();
    if (animalSoundsEnabled)
        unlockAnimalSounds();
});
updateAnimalSoundButton();
const grassCells = [];
const grassBladeFields = [];
const gardenBirds = [];
const animalResourceVisuals = [];
const troughWaterSurfaces = [];
const seasonalVisuals = {
    current: null,
    deciduous: [],
    shrubs: [],
    evergreens: [],
    grassMaterials: [],
    spring: new THREE.Group(),
    autumn: new THREE.Group(),
    winter: new THREE.Group()
};
world.add(seasonalVisuals.spring, seasonalVisuals.autumn, seasonalVisuals.winter);
const animalResourceLabelAnchors = {};
const animalResourceLabelElements = {};
const ANIMAL_RESOURCE_API_KEYS = Object.freeze({
    hayHorse: "hay_horse",
    hayCamelPool: "hay_camel_pool",
    hayCamelPergola: "hay_camel_pergola",
    waterHorse: "water_horse",
    waterCamelPool: "water_camel_pool",
    waterCamelPergola: "water_camel_pergola",
    dogFood: "dog_food",
    dogWater: "dog_water"
});

function registerAnimalResourceLabel(id, icon, label, resourceKey, anchorObject, offsetY,
    buttonLabel = "Auffüllen") {
    if (animalResourceLabelElements[id])
        return;
    const element = document.createElement("div");
    element.className = "animal-resource-label healthy";
    element.dataset.resource = resourceKey;
    if (resourceKey === "dogFood" || resourceKey === "dogWater")
        element.classList.add("dog-care");
    element.innerHTML = `<span>${icon} ${label}</span><strong>100 %</strong>` +
        '<i><b style="width:100%"></b></i>' +
        `<button type="button" data-animal-action="refill_resource" ` +
        `data-animal-resource="${ANIMAL_RESOURCE_API_KEYS[resourceKey]}" ` +
        `aria-label="${buttonLabel}: ${label}">${buttonLabel}</button>`;
    stage.appendChild(element);
    animalResourceLabelElements[id] = element;
    animalResourceLabelAnchors[id] = {
        object: anchorObject,
        offset: new THREE.Vector3(0, offsetY, 0),
        resourceKey
    };
}
const animalCleanLabel = document.createElement("div");
animalCleanLabel.className = "animal-clean-label outside";
animalCleanLabel.innerHTML = '<span>🧹 HINTERLASSENSCHAFTEN</span>' +
    '<strong>Grundstück sauber</strong>' +
    '<button type="button" data-animal-action="clean">Reinigen</button>';
stage.appendChild(animalCleanLabel);
const houseWindowLights = [];
let streetLampLight = null;
let streetLampBulb = null;

function defaultAnimalResources() {
    return {
        hayHorse: 100,
        hayCamelPool: 100,
        hayCamelPergola: 100,
        waterHorse: 100,
        waterCamelPool: 100,
        waterCamelPergola: 100,
        dogFood: 100,
        dogWater: 100,
        dogHungry: false,
        dogLastMealKey: null,
        droppings: [],
        grassLevels: [],
        grassFertility: [],
        updatedAt: Date.now()
    };
}

const animalResources = defaultAnimalResources();
let animalStateReady = false;
let animalSyncBusy = false;
let lastAnimalRevision = 0;
const animalMotionClientId = globalThis.crypto?.randomUUID?.() ||
    `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let animalMotionRole = "unknown";
let animalMotionSyncBusy = false;
let animalMotionServerOffset = 0;
let animalMotionSampledAt = 0;
let animalMotionReceivedAt = -Infinity;
let lastAnimalMotionSync = -Infinity;
const animalMotionTargets = new Map();
const animalMotionPreviousSamples = new Map();
let lastEcologyUpdate = performance.now();
let lastEcologySave = performance.now();
let lastGrassVisualUpdate = performance.now();
let lastAnimalResourceVisualUpdate = performance.now();

function applySharedAnimalState(shared, restoreDroppings = false) {
    if (!shared || shared.available !== true)
        return;
    animalResources.hayHorse = numberValue(shared.hay_horse) ?? animalResources.hayHorse;
    animalResources.hayCamelPool = numberValue(shared.hay_camel_pool) ??
        numberValue(shared.hay_camels) ?? animalResources.hayCamelPool;
    animalResources.hayCamelPergola = numberValue(shared.hay_camel_pergola) ??
        numberValue(shared.hay_camels) ?? animalResources.hayCamelPergola;
    animalResources.waterHorse = numberValue(shared.water_horse) ?? animalResources.waterHorse;
    animalResources.waterCamelPool = numberValue(shared.water_camel_pool) ??
        numberValue(shared.water_camels) ?? animalResources.waterCamelPool;
    animalResources.waterCamelPergola = numberValue(shared.water_camel_pergola) ??
        numberValue(shared.water_camels) ?? animalResources.waterCamelPergola;
    animalResources.dogFood = numberValue(shared.dog_food) ?? animalResources.dogFood;
    animalResources.dogWater = numberValue(shared.dog_water) ?? animalResources.dogWater;
    animalResources.dogHungry = shared.dog_hungry === true;
    const previousDogMeal = animalResources.dogLastMealKey;
    animalResources.dogLastMealKey = shared.dog_last_meal_key || previousDogMeal;
    if (dog && animalResources.dogLastMealKey &&
        animalResources.dogLastMealKey !== previousDogMeal)
        dog.pendingMeal = true;
    animalResources.droppings = Array.isArray(shared.droppings) ? shared.droppings : [];
    const revision = numberValue(shared.revision) ?? lastAnimalRevision;
    if (restoreDroppings || revision !== lastAnimalRevision)
        restoreAnimalDroppings(true);
    lastAnimalRevision = revision;
    animalStateReady = true;
    if (numberValue(shared.server_time) != null)
        animalMotionServerOffset = Number(shared.server_time) - Date.now() / 1000;
    if (shared.motion && animalMotionRole !== "leader") {
        if (animalMotionRole === "unknown" && shared.motion.leader_active)
            animalMotionRole = "follower";
        applySharedAnimalMotion(shared.motion);
    }
    updateAnimalResourceVisuals();
}

function safeMotionNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function animalMotionPose(id, group, stateName = "", animationName = "", target = null,
    stateRemaining = 0, visible = true) {
    const now = performance.now() / 1000;
    const position = group.position;
    const previous = animalMotionPreviousSamples.get(id);
    const elapsed = previous ? Math.max(0.05, now - previous.time) : 0;
    const velocity = previous ? {
        x: THREE.MathUtils.clamp((position.x - previous.x) / elapsed, -12, 12),
        y: THREE.MathUtils.clamp((position.y - previous.y) / elapsed, -12, 12),
        z: THREE.MathUtils.clamp((position.z - previous.z) / elapsed, -12, 12)
    } : { x: 0, y: 0, z: 0 };
    animalMotionPreviousSamples.set(id, {
        time: now, x: position.x, y: position.y, z: position.z
    });
    const destination = target?.isVector3 ? target : position;
    return {
        id,
        x: safeMotionNumber(position.x),
        y: safeMotionNumber(position.y),
        z: safeMotionNumber(position.z),
        yaw: Math.atan2(Math.sin(group.rotation.y), Math.cos(group.rotation.y)),
        vx: velocity.x,
        vy: velocity.y,
        vz: velocity.z,
        visible: Boolean(visible),
        state: String(stateName || "").slice(0, 48),
        animation: String(animationName || "").slice(0, 64),
        target_x: safeMotionNumber(destination.x, position.x),
        target_y: safeMotionNumber(destination.y, position.y),
        target_z: safeMotionNumber(destination.z, position.z),
        state_remaining: THREE.MathUtils.clamp(safeMotionNumber(stateRemaining), 0, 180)
    };
}

function collectAnimalMotionSnapshot() {
    const animals = [];
    if (dog) {
        animals.push(animalMotionPose("dog", dog.group, dog.mode,
            dog.mode, dog.target,
            safeMotionNumber(dog.modeUntil) - safeMotionNumber(dog.elapsedSeconds)));
    }
    if (horse) {
        animals.push(animalMotionPose("horse", horse.group, horse.mode,
            horse.currentActionName, horse.target,
            safeMotionNumber(horse.modeUntil) - safeMotionNumber(horse.elapsedSeconds)));
    }
    camelHerd.forEach((camel, index) => {
        animals.push(animalMotionPose(`camel-${index}`, camel.group, camel.mode,
            camel.mode, camel.target,
            safeMotionNumber(camel.modeUntil) - safeMotionNumber(camel.elapsedSeconds)));
    });
    gardenBirds.forEach((bird, index) => {
        animals.push(animalMotionPose(`bird-${index}`, bird.group, bird.state,
            bird.currentActionName, bird.target,
            safeMotionNumber(bird.stateUntil) - performance.now() / 1000,
            bird.group.visible));
    });
    pondFish.forEach((fish, index) => {
        animals.push(animalMotionPose(`fish-${index}`, fish.group, "swimming",
            "swimming", null, 0, fish.group.visible));
    });
    return animals.slice(0, 56);
}

function applySharedAnimalMotion(motion) {
    if (!motion || !Array.isArray(motion.animals) || !motion.animals.length)
        return;
    animalMotionSampledAt = safeMotionNumber(motion.sampled_at);
    animalMotionReceivedAt = performance.now();
    const incomingIds = new Set();
    motion.animals.forEach((pose) => {
        if (!pose?.id)
            return;
        incomingIds.add(pose.id);
        const previous = animalMotionTargets.get(pose.id);
        animalMotionTargets.set(pose.id, {
            ...pose,
            snap: !previous
        });
    });
    for (const id of animalMotionTargets.keys()) {
        if (!incomingIds.has(id))
            animalMotionTargets.delete(id);
    }
}

function motionObjectForId(id) {
    if (id === "dog")
        return dog ? { kind: "dog", value: dog, group: dog.group } : null;
    if (id === "horse")
        return horse ? { kind: "horse", value: horse, group: horse.group } : null;
    if (id.startsWith("camel-")) {
        const camel = camelHerd[Number(id.slice(6))];
        return camel ? { kind: "camel", value: camel, group: camel.group } : null;
    }
    if (id.startsWith("bird-")) {
        const bird = gardenBirds[Number(id.slice(5))];
        return bird ? { kind: "bird", value: bird, group: bird.group } : null;
    }
    if (id.startsWith("fish-")) {
        const fish = pondFish[Number(id.slice(5))];
        return fish ? { kind: "fish", value: fish, group: fish.group } : null;
    }
    return null;
}

function reconcileSharedAnimalMotion(delta) {
    if (animalMotionRole !== "follower" ||
        performance.now() - animalMotionReceivedAt > 7000)
        return;
    const serverNow = Date.now() / 1000 + animalMotionServerOffset;
    const sampleAge = THREE.MathUtils.clamp(serverNow - animalMotionSampledAt, 0, 2.4);
    animalMotionTargets.forEach((pose, id) => {
        const animal = motionObjectForId(id);
        if (!animal)
            return;
        const desiredX = safeMotionNumber(pose.x) + safeMotionNumber(pose.vx) * sampleAge;
        const desiredY = safeMotionNumber(pose.y) + safeMotionNumber(pose.vy) * sampleAge;
        const desiredZ = safeMotionNumber(pose.z) + safeMotionNumber(pose.vz) * sampleAge;
        if (pose.snap) {
            animal.group.position.set(desiredX, desiredY, desiredZ);
            pose.snap = false;
        }
        else {
            const blend = 1 - Math.exp(-delta * 9.5);
            animal.group.position.x = THREE.MathUtils.lerp(animal.group.position.x, desiredX, blend);
            animal.group.position.y = THREE.MathUtils.lerp(animal.group.position.y, desiredY, blend);
            animal.group.position.z = THREE.MathUtils.lerp(animal.group.position.z, desiredZ, blend);
        }
        const targetYaw = safeMotionNumber(pose.yaw);
        const yawDelta = Math.atan2(Math.sin(targetYaw - animal.group.rotation.y),
            Math.cos(targetYaw - animal.group.rotation.y));
        animal.group.rotation.y += yawDelta * Math.min(1, delta * 10);
        if (animal.kind === "bird") {
            animal.group.visible = Boolean(pose.visible);
            if (pose.state)
                animal.value.state = String(pose.state);
            if (pose.target_x != null)
                animal.value.target.set(
                    safeMotionNumber(pose.target_x),
                    safeMotionNumber(pose.target_y),
                    safeMotionNumber(pose.target_z)
                );
            if (pose.animation)
                setBirdAnimation(animal.value, pose.animation, 0.16);
        }
        else if (animal.kind === "dog" && pose.state) {
            animal.value.mode = String(pose.state);
            animal.value.modeUntil = performance.now() / 1000 +
                Math.max(0, safeMotionNumber(pose.state_remaining));
            if (pose.target_x != null)
                animal.value.target.set(
                    safeMotionNumber(pose.target_x), 0,
                    safeMotionNumber(pose.target_z)
                );
        }
    });
}

async function syncAnimalMotion() {
    if (animalMotionSyncBusy || document.hidden)
        return;
    animalMotionSyncBusy = true;
    try {
        const response = await fetch("/api/animals/motion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: animalMotionClientId,
                animals: collectAnimalMotionSnapshot()
            })
        });
        if (!response.ok)
            throw new Error("Tierbewegung konnte nicht synchronisiert werden");
        const shared = await response.json();
        animalMotionRole = shared.motion_write_accepted === true ? "leader" : "follower";
        if (animalMotionRole === "leader")
            animalMotionTargets.clear();
        applySharedAnimalState(shared);
    }
    catch (_error) {
        // Bei einer kurzen Netzunterbrechung läuft die lokale Bewegung weiter.
        // Nach der nächsten erfolgreichen Anfrage gleitet sie wieder auf die
        // gemeinsame Position, ohne die 3D-Szene einzufrieren.
    }
    finally {
        animalMotionSyncBusy = false;
    }
}

async function syncAnimalState() {
    if (animalSyncBusy)
        return;
    animalSyncBusy = true;
    try {
        const response = await fetch("/api/animals", { cache: "no-store" });
        if (!response.ok)
            throw new Error("Tierzustand konnte nicht geladen werden");
        applySharedAnimalState(await response.json(), !animalStateReady);
    }
    catch (_error) {
        menuCleanStatus.textContent = "Gemeinsamer Tierzustand wird erneut verbunden …";
    }
    finally {
        animalSyncBusy = false;
    }
}

async function runAnimalAction(action, resource = null) {
    try {
        const response = await fetch("/api/animals/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, resource })
        });
        if (!response.ok)
            throw new Error("Aktion konnte nicht gespeichert werden");
        applySharedAnimalState(await response.json(), true);
        menuCleanStatus.textContent = action === "clean" ? "Grundstück ist sauber." :
            resource === "dog_food" ? "Der Rottweiler wurde gefüttert." :
                resource === "dog_water" ? "Der Wassernapf ist wieder voll." :
            action === "refill_resource" ? "Diese Futter- oder Wasserstelle ist wieder voll." :
                action === "refill_hay" ? "Alle Heuraufen sind wieder voll." :
                    "Alle Wassertränken sind wieder voll.";
        return true;
    }
    catch (error) {
        menuCleanStatus.textContent = error.message;
        return false;
    }
}

stage.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-animal-action]"))
        event.stopPropagation();
});

stage.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-animal-action]");
    if (!actionButton)
        return;
    event.stopPropagation();
    if (actionButton.disabled)
        return;
    const originalLabel = actionButton.textContent;
    actionButton.disabled = true;
    actionButton.setAttribute("aria-busy", "true");
    actionButton.textContent = "Bitte warten …";
    const success = await runAnimalAction(actionButton.dataset.animalAction,
        actionButton.dataset.animalResource || null);
    actionButton.textContent = success ? "Erledigt ✓" : "Erneut versuchen";
    window.setTimeout(() => {
        actionButton.textContent = originalLabel;
        actionButton.disabled = false;
        actionButton.removeAttribute("aria-busy");
    }, success ? 1300 : 2200);
});

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

const textureLoader = new THREE.TextureLoader(sceneLoadingManager);

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

function registerExteriorRoomLight(group, position, size, frontZ = 0.045) {
    const material = new THREE.MeshBasicMaterial({
        color: 0xffc96b,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false
    });
    const glow = addBox(group, [size[0] * 0.70, size[1] * 0.73, 0.009], material,
        [0, 0, frontZ], { castShadow: false, receiveShadow: false });
    glow.renderOrder = 8;
    const upperFloor = position[1] > 2.55;
    const zone = position[2] > 2.4 ? "north" : position[2] < -2.4 ? "south" : "middle";
    const kind = upperFloor ?
        (zone === "north" ? "office" : zone === "middle" ? "bedroom" : "bath") :
        (zone === "north" ? "kitchen" : zone === "middle" ? "living" : "utility");
    const seed = Math.abs(Math.round(position[0] * 37 + position[1] * 53 + position[2] * 71));
    houseWindowLights.push({ material, kind, seed, opacity: 0 });
}

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
    registerExteriorRoomLight(group, position, size, cleanAsset ? 0.035 : 0.125);
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
    // Verglaste Haus- und Balkontüren geben das simulierte Raumlicht genauso
    // wie die Fenster nach außen ab. Die Ebene bleibt innerhalb des Rahmens.
    if (photoSpec !== INDIVIDUAL_OPENINGS.door.rearDecorative)
        registerExteriorRoomLight(group, position, size, cleanAsset ? 0.040 : 0.135);
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

function createHorseStableDoor(parent, position) {
    const stable = new THREE.Group();
    stable.position.set(...position);
    // Die Tiefe des Stalls zeigt in das Haus. Mit der entgegengesetzten
    // Drehung lag die komplette 3D-Laibung außen und wirkte wie ein Tunnel.
    stable.rotation.y = Math.PI / 2;
    parent.add(stable);

    const frameWood = new THREE.MeshStandardMaterial({ color: 0x4a2e20, roughness: 0.94 });
    const doorWood = new THREE.MeshStandardMaterial({ color: 0x6a4028, roughness: 0.92 });
    const darkInterior = new THREE.MeshStandardMaterial({
        color: 0x5a3b24, emissive: 0x3f2412, emissiveIntensity: 0.18, roughness: 1
    });
    const straw = new THREE.MeshStandardMaterial({ color: 0xc79a43, roughness: 1 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x363636, metalness: 0.70, roughness: 0.45 });

    // Kurze, flache Holzrampe vom Hofniveau auf den leicht erhöhten
    // Stallboden. Sie liegt vollständig vor/in der Öffnung und bleibt breit
    // genug, damit das Pferd ohne sichtbaren Sprung hineinlaufen kann.
    const ramp = new THREE.Group();
    ramp.position.set(0, -1.24, -0.65);
    ramp.rotation.x = -0.14;
    stable.add(ramp);
    addBox(ramp, [1.50, 0.11, 1.50], doorWood, [0, 0, 0], {
        radius: 0.025,
        castShadow: false
    });
    for (let treadZ = -0.60; treadZ <= 0.60; treadZ += 0.24)
        addBox(ramp, [1.40, 0.028, 0.045], frameWood,
            [0, 0.067, treadZ], { radius: 0.01, castShadow: false });
    [-0.73, 0.73].forEach((edgeX) =>
        addBox(ramp, [0.045, 0.035, 1.42], frameWood,
            [edgeX, 0.065, 0], { radius: 0.01, castShadow: false }));

    // Alle Raumflächen beginnen hinter der Fassadenebene (lokales z=0).
    // So ist außen nur die bündige Öffnung sichtbar, niemals ein Tunnel.
    // Die warme Rückwand gibt dem Blick von außen eine klar erkennbare Tiefe.
    addBox(stable, [1.62, 2.34, 0.10], darkInterior, [0, 0, 3.28], { castShadow: false });
    // Sichtbare Holzbretter an der Rückwand machen schon von außen klar,
    // dass hinter der Öffnung ein echter Raum liegt und keine dunkle Maske.
    for (let plank = -0.56; plank <= 0.56; plank += 0.28)
        addBox(stable, [0.025, 2.16, 0.018], frameWood,
            [plank, -0.04, 3.215], { castShadow: false });
    [-0.86, 0.86].forEach((x) =>
        addBox(stable, [0.13, 2.52, 0.18], frameWood, [x, 0.02, 0.11]));
    addBox(stable, [1.84, 0.16, 0.22], frameWood, [0, 1.26, 0.11]);
    addBox(stable, [0.10, 2.30, 3.16], frameWood, [-0.81, -0.02, 1.68]);
    addBox(stable, [0.10, 2.30, 3.16], frameWood, [0.81, -0.02, 1.68]);
    addBox(stable, [1.62, 0.10, 3.16], frameWood, [0, 1.13, 1.68]);
    addBox(stable, [1.60, 0.08, 3.12], straw, [0, -1.15, 1.68], { castShadow: false });
    for (let index = 0; index < 32; index += 1) {
        const tuft = addMesh(stable, new THREE.ConeGeometry(0.022, 0.26, 5), straw,
            -0.58 + (index % 8) * 0.17, -1.00,
            0.20 + Math.floor(index / 8) * 0.72,
            { castShadow: false });
        tuft.rotation.z = (index % 3 - 1) * 0.20;
    }
    // Zwei helle Strohballen stehen bewusst im mittleren Raumbereich. Sie
    // bleiben auch aus schrägem Blickwinkel hinter der offenen Tür sichtbar.
    const baleWood = new THREE.MeshStandardMaterial({ color: 0xd6a84d, roughness: 1 });
    const rearBale = addBox(stable, [0.62, 0.42, 0.46], baleWood,
        [-0.38, -0.88, 2.30], { radius: 0.055, castShadow: false });
    const upperBale = addBox(stable, [0.48, 0.34, 0.40], baleWood,
        [-0.38, -0.50, 2.32], { radius: 0.05, castShadow: false });
    [rearBale, upperBale].forEach((bale) => {
        [-0.17, 0.17].forEach((x) =>
            addBox(bale, [0.025, 1.02, 0.025], frameWood,
                [x, 0, 0.25], { rotation: [0, 0, Math.PI / 2], castShadow: false }));
    });
    // Die breite Holztuer ist dauerhaft nach außen aufgeklappt und lässt den
    // Blick auf Stroh, Holzboden und Futterraufe frei.
    const leafHinge = new THREE.Group();
    leafHinge.position.set(-0.81, 0, 0.22);
    // Ganz an die linke Innenwand geklappt: Die Tür bleibt sichtbar, nimmt
    // dem Blick von außen aber keinen Zentimeter der Stallöffnung mehr.
    leafHinge.rotation.y = -Math.PI / 2;
    stable.add(leafHinge);
    const leaf = addBox(leafHinge, [1.52, 2.26, 0.11], doorWood, [0.76, 0, 0], { radius: 0.025 });
    [-0.76, -0.25, 0.25, 0.76].forEach((y) =>
        addBox(leaf, [1.36, 0.07, 0.025], frameWood, [0, y, 0.07], { castShadow: false }));
    [0.55, -0.55].forEach((x) =>
        addBox(leaf, [0.08, 2.05, 0.025], frameWood, [x, 0, 0.07], { castShadow: false }));
    addMesh(leaf, new THREE.TorusGeometry(0.07, 0.018, 8, 16), metal,
        0.45, 0, 0.09, { rotation: [Math.PI / 2, 0, 0], castShadow: false });
    addBox(stable, [0.82, 0.72, 0.18], frameWood, [0, -0.44, 2.86], { castShadow: false });
    for (let slat = -0.30; slat <= 0.30; slat += 0.15)
        addBox(stable, [0.06, 0.58, 0.08], metal, [slat, -0.42, 2.75], { castShadow: false });
    // Die Pferdetränke steht vollständig im Stall. Ihr Wasserstand ist mit
    // derselben persistenten Ressource wie die Menüanzeige verbunden; außen
    // auf der Pferdeseite gibt es deshalb keine zweite Tränke mehr.
    const trough = addBox(stable, [0.66, 0.34, 0.54], metal,
        [0.36, -0.76, 1.74], { radius: 0.07 });
    const stableRecess = new THREE.MeshStandardMaterial({
        color: 0x20272a, metalness: 0.48, roughness: 0.30
    });
    addBox(trough, [0.57, 0.035, 0.44], stableRecess,
        [0, 0.175, 0], { radius: 0.04, castShadow: false });
    createTroughWater(trough, "waterHorse", 0.53, 0.40, 0.196, 0.115);
    registerAnimalResourceLabel("horse-water", "💧", "PFERDETRÄNKE",
        "waterHorse", trough, 0.90);
    const stableLampMaterial = new THREE.MeshBasicMaterial({ color: 0xffc66d, toneMapped: false });
    addMesh(stable, new THREE.SphereGeometry(0.075, 12, 8), stableLampMaterial,
        0.44, 0.76, 2.70, { castShadow: false });
    const stableLight = new THREE.PointLight(0xffc26b, 1.35, 5.2, 1.55);
    stableLight.position.set(0.44, 0.72, 2.62);
    stable.add(stableLight);
}

function createHouse() {
    const house = new THREE.Group();
    world.add(house);

    // Die linke Längswand wird aus dem großen Hauskörper entfernt und danach
    // mit einer echten Aussparung für die Stalltür wieder aufgebaut.
    const houseShellGeometry = new THREE.BoxGeometry(HOUSE_WIDTH, 4.9, HOUSE_LENGTH);
    houseShellGeometry.groups = houseShellGeometry.groups.filter((group) => group.materialIndex !== 1);
    // Eine Materialliste ist hier zwingend: Mit nur einem Material ignoriert
    // Three.js die Geometriegruppen und zeichnet trotz gelöschter Gruppe die
    // komplette linke Wand. Erst das Array macht die Stalltür physisch offen.
    const houseShellMaterials = Array.from({ length: 6 }, () => materials.wall);
    addMesh(house, houseShellGeometry, houseShellMaterials, 0, 2.50, 0);
    const stableOpeningCenterZ = -1.58;
    const stableOpeningWidth = 1.62;
    const openingMinZ = stableOpeningCenterZ - stableOpeningWidth / 2;
    const openingMaxZ = stableOpeningCenterZ + stableOpeningWidth / 2;
    addBox(house, [0.10, 4.9, openingMinZ + HOUSE_LENGTH / 2], materials.wall,
        [-HOUSE_WIDTH / 2, 2.50, (-HOUSE_LENGTH / 2 + openingMinZ) / 2]);
    addBox(house, [0.10, 4.9, HOUSE_LENGTH / 2 - openingMaxZ], materials.wall,
        [-HOUSE_WIDTH / 2, 2.50, (openingMaxZ + HOUSE_LENGTH / 2) / 2]);
    addBox(house, [0.10, 2.42, stableOpeningWidth], materials.wall,
        [-HOUSE_WIDTH / 2, 3.74, stableOpeningCenterZ]);
    addBox(house, [0.10, 0.14, stableOpeningWidth], materials.wall,
        [-HOUSE_WIDTH / 2, 0.12, stableOpeningCenterZ]);
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
    createHorseStableDoor(house, [-3.34, 1.36, -1.58]);
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
    audiSlot.userData.assetLoaded = false;
    world.add(audiSlot);
    const audiBattery = createAudiBatteryPack(audiSlot);
    const audiBrakeLights = createAudiBrakeLights(audiSlot);

    // IMG_7378: schwarzer Skoda Yeti mittig, kleiner schwarzer VW Fox ganz rechts.
    const yetiSlot = new THREE.Group();
    yetiSlot.position.set(0, 0.02, 8.72);
    yetiSlot.userData.assetLoaded = false;
    world.add(yetiSlot);

    const foxSlot = new THREE.Group();
    foxSlot.position.set(2.10, 0.02, 8.45);
    // Die Garagentore liegen aus Sicht des Stellplatzes in negativer Z-Richtung.
    // Eine halbe Drehung stellt deshalb den Fox mit der Motorhaube zur Garage.
    foxSlot.rotation.y = Math.PI;
    foxSlot.userData.assetLoaded = false;
    world.add(foxSlot);

    // Vor dem linken Tor steht der schwarze Karoq ebenfalls mit seiner Front
    // zum Gebäude. Die Slots bleiben bis zum GLB-Download bewusst leer, damit
    // keine alten prozeduralen Autos mehr erzeugt und anschließend ersetzt werden.
    const karoqSlot = new THREE.Group();
    karoqSlot.position.set(-2.10, 0.02, 8.72);
    // Das Karoq-Quellmodell definiert die Front entgegengesetzt zu den anderen
    // Fahrzeugdateien. Ohne zusätzliche Halbdrehung zeigt seine Haube zur Garage.
    karoqSlot.rotation.y = 0;
    karoqSlot.userData.assetLoaded = false;
    world.add(karoqSlot);

    return {
        audi: {
            slot: audiSlot,
            battery: audiBattery,
            brakeLights: audiBrakeLights,
            wheels: []
        },
        yeti: { slot: yetiSlot },
        fox: { slot: foxSlot },
        karoq: { slot: karoqSlot }
    };
}

const vehicleLoader = new GLTFLoader(sceneLoadingManager);
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
        // Das Audi-GLB fasst alle vier Reifen und teilweise weitere schwarze
        // Fahrzeugteile in gemeinsamen Meshes zusammen. Eine nachträgliche
        // geometrische Trennung erzeugt deshalb riesige schwarze Dreiecke und
        // unsichtbare Räder. Das Originalmodell bleibt vollständig intakt.
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
        vehicle.slot.userData.assetLoaded = true;
    }, undefined, () => {
        // Kein zweites Altmodell nachladen: Bei einem Netzfehler bleibt der Slot
        // leer und der nächste Seitenaufruf versucht das Detailmodell erneut.
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
    seasonalVisuals.evergreens.push({ tree, material: needles });
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

// Die Kamelweide liegt hinter dem Poolzaun und reicht bewusst weit über die
// zuvor verwendete kleine Rechteckfläche hinaus. Die unregelmäßige Kontur
// hält die Tiere dennoch auf der Wiese und von Straße und Haus fern.
const CAMEL_PASTURE_BOUNDARY = [
    [7.02, -19.20],
    [7.02, -15.55],
    [-11.48, -10.85],
    [-11.42, 4.30],
    [-13.10, 13.10],
    [-20.05, 11.25],
    [-20.30, -8.10],
    [-18.70, -16.20]
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
    const clusters = [];
    [
        [-0.34, 0.48, 0.02, 0.58],
        [0.30, 0.44, -0.08, 0.54],
        [0.02, 0.66, 0.22, 0.64],
        [0.00, 0.52, -0.32, 0.56]
    ].forEach(([offsetX, y, offsetZ, radius]) => {
        const cluster = addMesh(shrub, new THREE.IcosahedronGeometry(radius, 1), material,
            offsetX, y, offsetZ, { castShadow: true });
        clusters.push(cluster);
    });
    seasonalVisuals.shrubs.push({ shrub, material, clusters });
}

function createDeciduousTree(x, z, scale = 1) {
    const tree = new THREE.Group();
    tree.position.set(x, 0, z);
    tree.scale.setScalar(scale);
    world.add(tree);
    const trunk = new THREE.MeshStandardMaterial({ color: 0x5c3c2b, roughness: 1 });
    const leaves = new THREE.MeshStandardMaterial({ color: 0x2f6336, roughness: 0.98 });
    const clusters = [];
    addMesh(tree, new THREE.CylinderGeometry(0.18, 0.28, 2.65, 12), trunk, 0, 1.32, 0);
    [
        [-0.62, 2.75, 0.08, 1.00],
        [0.55, 2.72, -0.08, 1.05],
        [0.02, 3.35, 0.12, 1.18],
        [0.02, 2.72, 0.70, 0.88],
        [-0.06, 2.80, -0.72, 0.92]
    ].forEach(([offsetX, y, offsetZ, radius]) => {
        const cluster = addMesh(tree, new THREE.IcosahedronGeometry(radius, 2), leaves,
            offsetX, y, offsetZ, { castShadow: true });
        clusters.push(cluster);
    });
    seasonalVisuals.deciduous.push({ tree, material: leaves, clusters });
}

function isGardenGrassSurface(x, z) {
    if (!pointInPolygon(x, z, PROPERTY_BOUNDARY))
        return false;
    const onHouse = Math.abs(x) < 3.85 && Math.abs(z) < 6.95;
    const onForecourt = z > 4.55 && z < 15.35 && x > -6.5 && x < 6.8;
    const onAudiDrive = x > 3.15 && z > -6.55 && z < 6.7;
    const onRearPatio = x < -3.10 && x > -7.10 && z > -2.10 && z < 5.90;
    const aroundPool = Math.hypot(x + 7.19, z + 5.92) < 3.10;
    const aroundPond = Math.hypot((x + 4.85) / 1.35, (z - 14.78) / 0.98) < 1.18;
    const underPergola = Math.abs(x - PERGOLA_CENTER.x) < 1.55 &&
        Math.abs(z - PERGOLA_CENTER.z) < 2.25;
    return !(onHouse || onForecourt || onAudiDrive || onRearPatio ||
        aroundPool || aroundPond || underPergola);
}

function createGrassEcology() {
    const random = seededNoise(743900);
    const savedLevels = Array.isArray(animalResources.grassLevels) ? animalResources.grassLevels : [];
    const savedFertility = Array.isArray(animalResources.grassFertility) ? animalResources.grassFertility : [];
    const createCell = (x, z, pasture) => {
        const index = grassCells.length;
        const patchMaterial = new THREE.MeshStandardMaterial({
            color: 0x4b5a2d,
            transparent: true,
            opacity: 0,
            roughness: 1,
            depthWrite: false
        });
        seasonalVisuals.grassMaterials.push(patchMaterial);
        const patch = addMesh(world, new THREE.CircleGeometry(0.96, 24), patchMaterial,
            x, 0.028, z, { rotation: [-Math.PI / 2, 0, 0], castShadow: false });
        patch.scale.set(1.15, 0.82, 1);
        const herb = new THREE.Group();
        herb.position.set(x, 0.035, z);
        world.add(herb);
        const leaf = new THREE.MeshStandardMaterial({ color: 0x27613c, roughness: 0.92 });
        const bloom = new THREE.MeshStandardMaterial({ color: 0xe9d66e, roughness: 0.82 });
        for (let sprig = 0; sprig < 5; sprig += 1) {
            const angle = sprig / 5 * Math.PI * 2;
            addMesh(herb, new THREE.ConeGeometry(0.035, 0.22, 5), leaf,
                Math.cos(angle) * 0.22, 0.11, Math.sin(angle) * 0.22,
                { rotation: [0, 0, Math.sin(angle) * 0.30], castShadow: false });
            addMesh(herb, new THREE.SphereGeometry(0.025, 8, 6), bloom,
                Math.cos(angle) * 0.22, 0.23, Math.sin(angle) * 0.22,
                { castShadow: false });
        }
        grassCells.push({
            x,
            z,
            pasture,
            level: THREE.MathUtils.clamp(numberValue(savedLevels[index]) ?? 3, 0, 3),
            fertility: THREE.MathUtils.clamp(numberValue(savedFertility[index]) ?? 0, 0, 1),
            herbAmount: 0,
            patch,
            herb,
            growthRate: 0.00012 + random() * 0.00025
        });
    };
    let attempts = 0;
    while (grassCells.filter((cell) => !cell.pasture).length < 58 && attempts < 3000) {
        attempts += 1;
        const x = -10.8 + random() * 17.4;
        const z = -10.7 + random() * 25.6;
        if (!isGardenGrassSurface(x, z) || grassCells.some((cell) => Math.hypot(cell.x - x, cell.z - z) < 1.35))
            continue;
        createCell(x, z, false);
    }
    attempts = 0;
    while (grassCells.filter((cell) => cell.pasture).length < 48 && attempts < 3200) {
        attempts += 1;
        const x = -19.2 + random() * 7.35;
        const z = -11.7 + random() * 23.5;
        if (!pointInPolygon(x, z, CAMEL_PASTURE_BOUNDARY))
            continue;
        if (grassCells.some((cell) => Math.hypot(cell.x - x, cell.z - z) < 1.25))
            continue;
        createCell(x, z, true);
    }
    updateGrassEcologyVisuals();
}

function nearestGrassCell(x, z, pasture = null) {
    let nearest = null;
    let distance = Infinity;
    grassCells.forEach((cell) => {
        if (pasture != null && cell.pasture !== pasture)
            return;
        const candidateDistance = Math.hypot(cell.x - x, cell.z - z);
        if (candidateDistance < distance) {
            distance = candidateDistance;
            nearest = cell;
        }
    });
    return distance <= 2.25 ? nearest : null;
}

function updateGrassEcologyVisuals() {
    const season = seasonalVisuals.current || seasonForDate();
    const palettes = {
        spring: [0x7d7448, 0x6d803f, 0x598b43, 0x3f793e],
        summer: [0x766b43, 0x5d6736, 0x477039, 0x315f35],
        autumn: [0x806f46, 0x786b3c, 0x6f7339, 0x586a38],
        winter: [0xa7a18a, 0x96977e, 0x88937b, 0x7b8d78]
    };
    grassCells.forEach((cell) => {
        const stage = THREE.MathUtils.clamp(Math.round(cell.level), 0, 3);
        const colorsByStage = palettes[season];
        cell.patch.material.color.setHex(colorsByStage[stage]);
        cell.patch.material.opacity = stage === 3 ? 0.04 : 0.18 + (3 - stage) * 0.09;
        cell.patch.material.needsUpdate = true;
        cell.herb.visible = season !== "winter" && cell.herbAmount > 0.18;
        cell.herb.scale.setScalar(0.55 + cell.herbAmount * 0.60);
    });
    grassBladeFields.forEach((field) => {
        const transform = new THREE.Object3D();
        field.records.forEach((record, index) => {
            const level = record.cell ? record.cell.level : 3;
            const heightScale = 0.18 + level * 0.34;
            transform.position.set(record.x, 0.018 + 0.15 * heightScale, record.z);
            transform.rotation.copy(record.rotation);
            transform.scale.set(record.scaleX, record.baseHeight * heightScale, record.scaleZ);
            transform.updateMatrix();
            field.mesh.setMatrixAt(index, transform.matrix);
        });
        field.mesh.instanceMatrix.needsUpdate = true;
    });
}

function grazeAt(x, z, pasture, amount = 0.16) {
    const cell = nearestGrassCell(x, z, pasture);
    if (!cell)
        return false;
    if (cell.herbAmount > 0.04) {
        cell.herbAmount = Math.max(0, cell.herbAmount - amount * 1.5);
        return true;
    }
    cell.level = Math.max(0, cell.level - amount);
    return cell.level > 0;
}

function fertilizeGrassAt(x, z, pasture) {
    const cell = nearestGrassCell(x, z, pasture);
    if (!cell)
        return;
    cell.fertility = Math.min(1, cell.fertility + 0.55);
    cell.level = Math.min(3, cell.level + 0.18);
}

function createGrassDetail() {
    // Die Halme sind absichtlich deutlich höher als die alte 16-cm-Geometrie.
    // Damit sind die vier Stufen (abgefressen bis hoch) auch am Handy sichtbar.
    const bladeGeometry = new THREE.ConeGeometry(0.022, 0.30, 3);
    const bladeMaterial = new THREE.MeshStandardMaterial({ color: 0x49763f, roughness: 1 });
    seasonalVisuals.grassMaterials.push(bladeMaterial);
    const blades = new THREE.InstancedMesh(bladeGeometry, bladeMaterial, 760);
    blades.castShadow = false;
    blades.receiveShadow = false;
    const transform = new THREE.Object3D();
    const shade = new THREE.Color();
    const random = seededNoise(4309);
    let instance = 0;
    let attempts = 0;
    while (instance < 760 && attempts < 6200) {
        attempts += 1;
        const x = -11.2 + random() * 18.2;
        const z = -10.8 + random() * 22.4;
        if (!isGardenGrassSurface(x, z))
            continue;
        const cell = nearestGrassCell(x, z, false);
        const level = cell?.level ?? 3;
        const heightScale = 0.18 + level * 0.34;
        transform.position.set(x, 0.018 + 0.15 * heightScale, z);
        transform.rotation.set((random() - 0.5) * 0.22, random() * Math.PI, (random() - 0.5) * 0.22);
        const height = 0.62 + random() * 0.85;
        const scaleX = 0.72 + random() * 0.55;
        const scaleZ = 0.72 + random() * 0.55;
        transform.scale.set(scaleX, height * heightScale, scaleZ);
        transform.updateMatrix();
        blades.setMatrixAt(instance, transform.matrix);
        shade.setHSL(0.24 + random() * 0.08, 0.34 + random() * 0.18, 0.24 + random() * 0.16);
        blades.setColorAt(instance, shade);
        if (!blades.userData.records)
            blades.userData.records = [];
        blades.userData.records.push({
            x,
            z,
            rotation: transform.rotation.clone(),
            scaleX,
            scaleZ,
            baseHeight: height,
            cell
        });
        instance += 1;
    }
    blades.count = instance;
    blades.instanceMatrix.needsUpdate = true;
    if (blades.instanceColor)
        blades.instanceColor.needsUpdate = true;
    world.add(blades);
    grassBladeFields.push({ mesh: blades, records: blades.userData.records || [] });
}

const SEASON_LABELS = Object.freeze({
    spring: "Frühling",
    summer: "Sommer",
    autumn: "Herbst",
    winter: "Winter"
});

function seasonForDate(date = new Date()) {
    const month = date.getMonth() + 1;
    if (month >= 3 && month <= 5)
        return "spring";
    if (month >= 6 && month <= 8)
        return "summer";
    if (month >= 9 && month <= 11)
        return "autumn";
    return "winter";
}

function makeSeasonPointCloud(group, count, palette, heightRange, size, seed) {
    const random = seededNoise(seed);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const color = new THREE.Color();
    let written = 0;
    let attempts = 0;
    while (written < count && attempts < count * 80) {
        attempts += 1;
        const x = -19.1 + random() * 25.6;
        const z = -11.4 + random() * 27.1;
        const garden = isGardenGrassSurface(x, z);
        const pasture = pointInPolygon(x, z, CAMEL_PASTURE_BOUNDARY);
        if (!garden && !pasture)
            continue;
        positions[written * 3] = x;
        positions[written * 3 + 1] = heightRange[0] + random() * (heightRange[1] - heightRange[0]);
        positions[written * 3 + 2] = z;
        color.setHex(palette[Math.floor(random() * palette.length)]);
        colors[written * 3] = color.r;
        colors[written * 3 + 1] = color.g;
        colors[written * 3 + 2] = color.b;
        written += 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
        size,
        vertexColors: true,
        transparent: true,
        opacity: 0.90,
        depthWrite: false,
        sizeAttenuation: true
    }));
    points.userData.basePositions = positions.slice();
    group.add(points);
    return points;
}

function createSeasonalAccents() {
    seasonalVisuals.spring.userData.petals = makeSeasonPointCloud(
        seasonalVisuals.spring, 150,
        [0xffffff, 0xfff1a8, 0xf7a8c4, 0xa9d7ff, 0xd3b5ff],
        [0.10, 0.23], 0.075, 3103
    );
    seasonalVisuals.autumn.userData.leaves = makeSeasonPointCloud(
        seasonalVisuals.autumn, 210,
        [0xe5a52f, 0xce6d28, 0x9f3f23, 0x7d5124, 0xf0c04a],
        [0.08, 1.10], 0.105, 9109
    );

    const frostMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xeaf5f6,
        roughness: 0.72,
        metalness: 0,
        transmission: 0.05,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const frostGeometry = new THREE.CircleGeometry(0.86, 18);
    const frost = new THREE.InstancedMesh(frostGeometry, frostMaterial, grassCells.length);
    const transform = new THREE.Object3D();
    grassCells.forEach((cell, index) => {
        transform.position.set(cell.x, 0.056, cell.z);
        transform.rotation.set(-Math.PI / 2, 0, (index * 1.73) % Math.PI);
        transform.scale.set(1.08 + (index % 4) * 0.08, 0.72 + (index % 3) * 0.07, 1);
        transform.updateMatrix();
        frost.setMatrixAt(index, transform.matrix);
    });
    frost.instanceMatrix.needsUpdate = true;
    frost.renderOrder = 2;
    seasonalVisuals.winter.add(frost);

    // Dünne Schnee-/Reifauflage auf beiden Dachflächen. Sie bleibt bewusst
    // halbtransparent: Ob tatsächlich Schnee fällt, entscheidet weiterhin das
    // Live-Wetter; im Winter wirkt das Dach aber auch an trockenen Tagen kalt.
    const roofFrost = new THREE.MeshPhysicalMaterial({
        color: 0xf4f8f8,
        roughness: 0.84,
        transparent: true,
        opacity: 0.34,
        depthWrite: false
    });
    const roofSlope = Math.atan2(2.15, 3.55);
    const roofLength = Math.hypot(3.55, 2.15);
    [-1, 1].forEach((side) =>
        addBox(seasonalVisuals.winter,
            [roofLength - 0.16, 0.035, HOUSE_LENGTH + 0.48], roofFrost,
            [side * 1.76, 5.99, 0], {
                rotation: [0, 0, side < 0 ? roofSlope : -roofSlope],
                castShadow: false
            }));
}

function updateSeasonalScene(force = false) {
    const season = seasonForDate();
    if (!force && seasonalVisuals.current === season)
        return;
    seasonalVisuals.current = season;
    seasonalVisuals.spring.visible = season === "spring";
    seasonalVisuals.autumn.visible = season === "autumn";
    seasonalVisuals.winter.visible = season === "winter";

    const grassTint = {
        spring: 0xdff3c8,
        summer: 0xffffff,
        autumn: 0xc8b779,
        winter: 0xcbd3cf
    }[season];
    materials.grass.color.setHex(grassTint);
    const foliageColor = {
        spring: 0x72a94b,
        summer: 0x2f6336,
        autumn: 0xc26a2d,
        winter: 0x72543c
    }[season];
    const shrubColor = {
        spring: 0x5e913e,
        summer: 0x315e34,
        autumn: 0x9a5c2d,
        winter: 0x5e5545
    }[season];
    seasonalVisuals.deciduous.forEach(({ material, clusters }) => {
        material.color.setHex(foliageColor);
        clusters.forEach((cluster) => {
            cluster.visible = season !== "winter";
            const scale = season === "spring" ? 0.82 : season === "autumn" ? 0.90 : 1;
            cluster.scale.setScalar(scale);
        });
    });
    seasonalVisuals.shrubs.forEach(({ material, clusters }) => {
        material.color.setHex(shrubColor);
        clusters.forEach((cluster) => {
            cluster.visible = true;
            const scale = season === "winter" ? 0.72 : season === "spring" ? 0.88 : 1;
            cluster.scale.setScalar(scale);
        });
    });
    seasonalVisuals.evergreens.forEach(({ material }) =>
        material.color.setHex(season === "winter" ? 0x244c3b :
            season === "spring" ? 0x2b6842 : 0x1d4e33));
    updateGrassEcologyVisuals();
}

function animateSeasonalAccents(seconds) {
    if (seasonalVisuals.current !== "autumn" || reduceMotion)
        return;
    const leaves = seasonalVisuals.autumn.userData.leaves;
    if (!leaves)
        return;
    const positions = leaves.geometry.attributes.position.array;
    const base = leaves.userData.basePositions;
    for (let index = 0; index < positions.length; index += 3) {
        positions[index] = base[index] + Math.sin(seconds * 0.9 + index) * 0.025;
        positions[index + 1] = Math.max(0.08,
            base[index + 1] + Math.sin(seconds * 1.6 + index * 0.17) * 0.035);
    }
    leaves.geometry.attributes.position.needsUpdate = true;
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

function horseCanStandAt(x, z) {
    if (!pointInPolygon(x, z, PROPERTY_BOUNDARY))
        return false;
    const inStablePassage = x > -4.45 && x < -0.32 && Math.abs(z + 1.58) < 0.78;
    const onHouse = Math.abs(x) < 4.05 && Math.abs(z) < 7.00 && !inStablePassage;
    // Passgenaue, mit dem Pool gedrehte Sicherheitszone statt der früheren
    // übergroßen Ellipse. Der echte Durchgang zwischen Pool und Haus bleibt
    // damit breit genug für das Pferd.
    const poolDeltaX = x + 7.19;
    const poolDeltaZ = z + 5.92;
    const poolAngle = THREE.MathUtils.degToRad(60);
    const poolLocalX = poolDeltaX * Math.cos(poolAngle) - poolDeltaZ * Math.sin(poolAngle);
    const poolLocalZ = poolDeltaX * Math.sin(poolAngle) + poolDeltaZ * Math.cos(poolAngle);
    const atPool = poolLocalX > -2.84 && poolLocalX < 1.76 && Math.abs(poolLocalZ) < 2.49;
    const atPond = Math.hypot((x + 4.85) / 1.55, (z - 14.78) / 1.25) < 1;
    const atPergola = Math.abs(x - PERGOLA_CENTER.x) < 1.75 &&
        Math.abs(z - PERGOLA_CENTER.z) < 2.55;
    // Der Stellplatz bleibt auch bei einer Abwesenheit des Audis frei. Wenn
    // der Wagen faehrt, wandert die Sperrflaeche mit ihm mit. So kann das
    // Pferd weder durch den Wagen laufen noch dessen Rueckkehrweg blockieren.
    let atAudi = Math.abs(x - 5.00) < 1.55 && Math.abs(z - 1.00) < 2.62;
    if (audiModel) {
        const deltaX = x - audiModel.position.x;
        const deltaZ = z - audiModel.position.z;
        const cos = Math.cos(-audiModel.rotation.y);
        const sin = Math.sin(-audiModel.rotation.y);
        const localX = deltaX * cos - deltaZ * sin;
        const localZ = deltaX * sin + deltaZ * cos;
        atAudi ||= Math.abs(localX) < 1.55 && Math.abs(localZ) < 2.62;
    }
    const atParkedCars = z > 7.0 && z < 13.8 && x > -4.6 && x < 3.6;
    const landscapeObstacles = [
        [-6.82, 14.58, 1.05], [-6.65, 12.25, 1.22], [-7.65, 12.75, 1.12],
        [-8.45, 11.25, 1.02], [-8.25, 4.10, 0.92],
        [-6.55, 10.15, 0.90], [-7.65, 6.15, 0.82], [-8.90, 2.55, 0.86],
        [-10.10, 0.35, 0.82], [6.60, 7.55, 0.62], [6.60, 8.48, 0.62],
        [6.60, 9.41, 0.62]
    ];
    const atLandscape = landscapeObstacles.some(([obstacleX, obstacleZ, radius]) =>
        Math.hypot(x - obstacleX, z - obstacleZ) < radius + 0.72);
    const atCareStation = animalCareStationBlocksAnimal(x, z, 0.42, true);
    return !(onHouse || atPool || atPond || atPergola || atAudi || atParkedCars ||
        atLandscape || atCareStation);
}

function horseIsOnGrass(x, z) {
    if (!horseCanStandAt(x, z))
        return false;
    if (x > -4.45 && x < -0.32 && Math.abs(z + 1.58) < 0.64)
        return false;
    const onForecourt = z > 4.55 && z < 15.35 && x > -6.5 && x < 6.8;
    const onAudiDrive = x > 3.15 && z > -6.55 && z < 6.7;
    const onRearPatio = x < -3.10 && x > -7.10 && z > -2.10 && z < 5.90;
    return !(onForecourt || onAudiDrive || onRearPatio);
}

function horsePathIsClear(startX, startZ, endX, endZ) {
    const distance = Math.hypot(endX - startX, endZ - startZ);
    const steps = Math.max(1, Math.ceil(distance / 0.28));
    for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps;
        if (!horseCanStandAt(
            THREE.MathUtils.lerp(startX, endX, progress),
            THREE.MathUtils.lerp(startZ, endZ, progress)
        ))
            return false;
    }
    return true;
}

function findHorsePath(start, destination) {
    if (horsePathIsClear(start.x, start.z, destination.x, destination.z))
        return [destination.clone()];

    const step = 0.52;
    const minX = -11.25;
    const maxX = 7.00;
    const minZ = -16.20;
    const maxZ = 15.65;
    const columns = Math.floor((maxX - minX) / step) + 1;
    const rows = Math.floor((maxZ - minZ) / step) + 1;
    const key = (xIndex, zIndex) => zIndex * columns + xIndex;
    const point = (xIndex, zIndex) => new THREE.Vector3(
        minX + xIndex * step, 0, minZ + zIndex * step
    );
    const nearestWalkable = (position) => {
        const baseX = THREE.MathUtils.clamp(Math.round((position.x - minX) / step), 0, columns - 1);
        const baseZ = THREE.MathUtils.clamp(Math.round((position.z - minZ) / step), 0, rows - 1);
        for (let radius = 0; radius <= 5; radius += 1) {
            for (let zOffset = -radius; zOffset <= radius; zOffset += 1) {
                for (let xOffset = -radius; xOffset <= radius; xOffset += 1) {
                    if (radius > 0 && Math.abs(xOffset) !== radius && Math.abs(zOffset) !== radius)
                        continue;
                    const xIndex = baseX + xOffset;
                    const zIndex = baseZ + zOffset;
                    if (xIndex < 0 || xIndex >= columns || zIndex < 0 || zIndex >= rows)
                        continue;
                    const candidate = point(xIndex, zIndex);
                    if (horseCanStandAt(candidate.x, candidate.z))
                        return { xIndex, zIndex, point: candidate };
                }
            }
        }
        return null;
    };

    const startNode = nearestWalkable(start);
    const goalNode = nearestWalkable(destination);
    if (!startNode || !goalNode)
        return null;

    const open = [{
        xIndex: startNode.xIndex,
        zIndex: startNode.zIndex,
        g: 0,
        f: startNode.point.distanceTo(goalNode.point)
    }];
    const scores = new Map([[key(startNode.xIndex, startNode.zIndex), 0]]);
    const parents = new Map();
    const closed = new Set();
    const directions = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [-1, 1], [1, -1], [1, 1]
    ];
    const goalKey = key(goalNode.xIndex, goalNode.zIndex);
    let reached = false;

    while (open.length && closed.size < 5200) {
        open.sort((left, right) => left.f - right.f);
        const current = open.shift();
        const currentKey = key(current.xIndex, current.zIndex);
        if (closed.has(currentKey))
            continue;
        if (currentKey === goalKey) {
            reached = true;
            break;
        }
        closed.add(currentKey);
        for (const [xDirection, zDirection] of directions) {
            const xIndex = current.xIndex + xDirection;
            const zIndex = current.zIndex + zDirection;
            if (xIndex < 0 || xIndex >= columns || zIndex < 0 || zIndex >= rows)
                continue;
            const nextPoint = point(xIndex, zIndex);
            if (!horseCanStandAt(nextPoint.x, nextPoint.z))
                continue;
            if (xDirection && zDirection) {
                const sideA = point(current.xIndex + xDirection, current.zIndex);
                const sideB = point(current.xIndex, current.zIndex + zDirection);
                if (!horseCanStandAt(sideA.x, sideA.z) || !horseCanStandAt(sideB.x, sideB.z))
                    continue;
            }
            const nextKey = key(xIndex, zIndex);
            if (closed.has(nextKey))
                continue;
            const travel = Math.hypot(xDirection, zDirection) * step;
            const nextScore = current.g + travel;
            if (nextScore >= (scores.get(nextKey) ?? Infinity))
                continue;
            scores.set(nextKey, nextScore);
            parents.set(nextKey, currentKey);
            open.push({
                xIndex,
                zIndex,
                g: nextScore,
                f: nextScore + nextPoint.distanceTo(goalNode.point)
            });
        }
    }
    if (!reached)
        return null;

    const raw = [];
    let cursor = goalKey;
    while (cursor !== key(startNode.xIndex, startNode.zIndex)) {
        const xIndex = cursor % columns;
        const zIndex = Math.floor(cursor / columns);
        raw.push(point(xIndex, zIndex));
        cursor = parents.get(cursor);
        if (cursor == null)
            return null;
    }
    raw.reverse();
    if (!raw.length || horsePathIsClear(raw.at(-1).x, raw.at(-1).z, destination.x, destination.z))
        raw.push(destination.clone());

    // Entfernt unnötige Rasterknicke, behält aber alle Umfahrungen von Pool,
    // Pergola, Bäumen und Fahrzeugen. Dadurch läuft das Pferd in weichen,
    // nachvollziehbaren Etappen statt sichtbar auf einem Schachbrett.
    const simplified = [];
    let anchor = start;
    for (let index = 0; index < raw.length;) {
        let furthest = index;
        for (let candidate = index; candidate < raw.length; candidate += 1) {
            if (!horsePathIsClear(anchor.x, anchor.z, raw[candidate].x, raw[candidate].z))
                break;
            furthest = candidate;
        }
        const waypoint = raw[furthest].clone();
        simplified.push(waypoint);
        anchor = waypoint;
        index = Math.max(index + 1, furthest + 1);
    }
    return simplified;
}

function setHorseRoute(horseState, destination) {
    const route = findHorsePath(horseState.group.position, destination);
    if (!route?.length)
        return false;
    horseState.path = route;
    horseState.target = horseState.path.shift();
    return true;
}

function chooseHorseTarget(random, origin = null) {
    // Rund 94 % der freien Ziele liegen auf bewachsenem Grund. Das Pferd darf
    // weiterhin Hof und Wege überqueren, verbringt seine Zeit aber überwiegend
    // dort, wo es tatsächlich grasen kann – statt ständig beim Audi zu stehen.
    if (random() < 0.94) {
        const grassyCandidates = grassCells.filter((cell) =>
            !cell.pasture && cell.level > 0.38 && horseCanStandAt(cell.x, cell.z));
        for (let attempt = 0; attempt < 80 && grassyCandidates.length; attempt += 1) {
            const cell = grassyCandidates[Math.floor(random() * grassyCandidates.length)];
            const x = cell.x + (random() - 0.5) * 0.72;
            const z = cell.z + (random() - 0.5) * 0.72;
            if (horseCanStandAt(x, z))
                return new THREE.Vector3(x, 0, z);
        }
    }
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const x = -10.8 + random() * 17.4;
        const z = -15.8 + random() * 31.1;
        if (horseCanStandAt(x, z))
            return new THREE.Vector3(x, 0, z);
    }
    // Wenn ein entfernter Punkt nur durch ein Hindernis erreichbar waere,
    // sucht das Pferd zuerst einen kurzen sicheren Zwischenweg. Das ist die
    // eigentliche Anti-Festhaeng-Logik fuer Buesche, Baeume, Autos und Pool.
    if (origin) {
        for (let attempt = 0; attempt < 80; attempt += 1) {
            const angle = random() * Math.PI * 2;
            const radius = 1.3 + random() * 4.2;
            const x = origin.x + Math.sin(angle) * radius;
            const z = origin.z + Math.cos(angle) * radius;
            if (horseCanStandAt(x, z) && horsePathIsClear(origin.x, origin.z, x, z))
                return new THREE.Vector3(x, 0, z);
        }
        return new THREE.Vector3(origin.x, 0, origin.z);
    }
    return new THREE.Vector3(0.50, 0, -8.20);
}

function setHorseAnimation(horseState, name, fadeSeconds = 0.30) {
    if (!horseState?.actions || horseState.currentActionName === name)
        return;
    const next = horseState.actions[name] || horseState.actions.Idle;
    if (!next)
        return;
    if (horseState.currentAction && horseState.currentAction !== next)
        horseState.currentAction.fadeOut(fadeSeconds);
    next.reset().setEffectiveWeight(1).fadeIn(fadeSeconds).play();
    horseState.currentAction = next;
    horseState.currentActionName = name;
}

function loadAnimatedHorse(horseState) {
    vehicleLoader.load("/static/models/horse-animated.glb?v=80", (gltf) => {
        const model = gltf.scene;
        model.name = "Kastanienbraunes Gartenpferd";
        // Das CC0-Modell blickt in seiner Quelldatei nach -Z. In der Szene
        // entspricht +Z der Laufrichtung, daher diese einmalige Ausrichtung.
        model.rotation.y = 0;
        model.updateMatrixWorld(true);
        let bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        model.scale.setScalar(1.64 / Math.max(size.y, 0.001));
        model.updateMatrixWorld(true);
        bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -bounds.min.y, -center.z);

        model.traverse((object) => {
            if (!object.isMesh)
                return;
            object.castShadow = renderProfile.minorShadows;
            object.receiveShadow = true;
            const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
            const tuned = sourceMaterials.map((source) => {
                const material = source.clone();
                // Die Modellpalette liefert bereits die Schattierung. Dieser
                // warme Grundfilter ergibt zusammen mit ihr das leuchtende
                // Kastanienbraun aus IMG_3402, ohne Mähne, Schweif und die
                // dunklen Beine rot einzufärben.
                material.color.setHex(0xe8a866);
                material.metalness = 0;
                material.roughness = 0.48;
                material.clearcoat = 0.28;
                material.clearcoatRoughness = 0.48;
                material.needsUpdate = true;
                return material;
            });
            object.material = Array.isArray(object.material) ? tuned : tuned[0];
        });

        // Eine helle Blesse wird am animierten Kopfknochen befestigt und
        // bewegt sich deshalb natuerlich bei Gehen, Grasen und Rennen mit.
        const headBone = model.getObjectByName("head");
        if (headBone) {
            const blazeMaterial = new THREE.MeshStandardMaterial({
                color: 0xf4ecdc,
                roughness: 0.90,
                side: THREE.DoubleSide
            });
            [
                { name: "Blesse Stirn", position: [0, 0.235, 0.064], scale: [0.48, 1.38, 0.18] },
                { name: "Blesse Nase", position: [-0.004, 0.105, 0.086], scale: [0.58, 1.30, 0.17] },
                { name: "Helle Schnauze", position: [0.004, -0.010, 0.108], scale: [0.76, 0.82, 0.17] }
            ].forEach((marking) => {
                const patch = new THREE.Mesh(new THREE.SphereGeometry(0.085, 18, 14), blazeMaterial);
                patch.name = marking.name;
                patch.position.set(...marking.position);
                patch.scale.set(...marking.scale);
                patch.castShadow = false;
                headBone.add(patch);
            });
        }

        // Auf dem Referenzfoto trägt das linke Vorderbein einen deutlich
        // höheren weißen Socken. Als Kind des Sprunggelenks folgt er jeder
        // Geh-, Renn- und Ruheanimation des vorhandenen Skeletts.
        const sockBone = model.getObjectByName("front_leg_ankle_l");
        if (sockBone) {
            const sock = new THREE.Mesh(
                new THREE.CylinderGeometry(0.078, 0.066, 0.205, 16, 1),
                new THREE.MeshStandardMaterial({ color: 0xf1ead9, roughness: 0.84 })
            );
            sock.name = "Weisser Vorderbeinsocken";
            sock.position.set(0, 0.075, 0);
            sock.scale.z = 0.88;
            sock.castShadow = true;
            sockBone.add(sock);
        }

        horseState.group.add(model);
        horseState.modelRoot = model;
        horseState.headBone = headBone;
        horseState.neckBones = [
            model.getObjectByName("spine_5"),
            model.getObjectByName("spine_6")
        ].filter(Boolean);
        horseState.eliminationRig = ["tail_1", "tail_2", "tail_3", "tail_4"].map((name, index) => {
            const joint = model.getObjectByName(name);
            return joint ? { joint, rest: joint.quaternion.clone(), index } : null;
        }).filter(Boolean);
        horseState.group.userData.assetLoaded = true;
        horseState.mixer = new THREE.AnimationMixer(model);
        horseState.actions = {};
        gltf.animations.forEach((clip) => {
            const action = horseState.mixer.clipAction(clip);
            if (["lay_to_idle", "Rear"].includes(clip.name)) {
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
            }
            else {
                action.setLoop(THREE.LoopRepeat, Infinity);
            }
            horseState.actions[clip.name] = action;
        });
        setHorseAnimation(horseState, "Walk", 0);
    }, undefined, () => {
        // Keine alte Ersatzgeometrie mehr aufbauen. Der nächste Seitenaufruf
        // versucht das einzige, detaillierte Pferdemodell erneut zu laden.
        horseState.group.userData.assetLoaded = false;
    });
}

function startHorseJourney(horseState, origin, forceGarden = false) {
    const stableEntry = new THREE.Vector3(-4.24, 0, -1.58);
    const careChoice = horseState.random();
    // Zum Trinken geht das Pferd jetzt immer durch die offene Stalltür zur
    // Tränke im Raum. Die etwas höhere Auswahlwahrscheinlichkeit macht diese
    // Besuche in der Live-Szene regelmäßig sichtbar.
    if (!forceGarden && (animalResources.waterHorse < 72 || careChoice < 0.32) &&
        setHorseRoute(horseState, stableEntry)) {
        horseState.navigation = "stable-water-entry";
        horseState.mode = "walking";
        return;
    }
    if (!forceGarden && horseState.elapsedSeconds >= horseState.nextStableAt &&
        setHorseRoute(horseState, stableEntry)) {
        horseState.navigation = "stable-entry";
        horseState.mode = "walking";
        return;
    }
    if (!forceGarden && (animalResources.hayHorse < 55 || careChoice < 0.40) &&
        setHorseRoute(horseState, new THREE.Vector3(-9.48, 0, -2.26))) {
        horseState.navigation = "horse-hay";
        horseState.mode = "walking";
        return;
    }
    const destination = chooseHorseTarget(horseState.random, origin);
    if (!setHorseRoute(horseState, destination)) {
        horseState.target = chooseHorseTarget(horseState.random, origin);
        horseState.path = [];
    }
    const distance = Math.hypot(
        horseState.target.x - origin.x,
        horseState.target.z - origin.z
    );
    // Nur laengere freie Strecken werden gelegentlich im Galopp genommen.
    // Auf kurzen Wegen und in der Naehe der Hindernisse bleibt es beim Schritt.
    horseState.mode = distance > 4.5 && horseState.random() < 0.20 ? "running" : "walking";
    horseState.navigation = null;
}

function createHorse() {
    const group = new THREE.Group();
    group.position.set(0.50, 0, -8.20);
    group.userData.assetLoaded = false;
    world.add(group);
    const loadingRig = new THREE.Group();
    loadingRig.name = "Unsichtbares Pferde-Lade-Rig";
    group.add(loadingRig);

    // Nur leere Transform-Gruppen bleiben für die Bewegungslogik erhalten.
    // Sichtbar wird ausschließlich das animierte GLB-Modell nach seinem Download.
    const headRig = new THREE.Group();
    headRig.position.set(0, 1.54, 0.52);
    loadingRig.add(headRig);

    const legs = [];
    const tailRig = new THREE.Group();
    tailRig.position.set(0, 1.48, -0.64);
    loadingRig.add(tailRig);

    const random = seededNoise(191180);
    const horseState = {
        group,
        headRig,
        tailRig,
        legs,
        random,
        target: chooseHorseTarget(random, group.position),
        path: [],
        mode: "walking",
        modeUntil: 0,
        // Die erste Aktion ist schon in einer normalen Sitzung sichtbar;
        // danach bleibt es beim ungefaehr stuendlichen Rhythmus.
        nextDroppingAt: animalDemoMode ? 5 : 240 + random() * 240,
        nextUrinationAt: animalDemoMode ? 14 : 180 + random() * 300,
        travelled: 0,
        stuckFor: 0,
        modelRoot: null,
        mixer: null,
        actions: null,
        currentAction: null,
        currentActionName: null,
        headBone: null,
        neckBones: [],
        eliminationRig: [],
        elimination: null,
        nextRestAt: 120 + random() * 180,
        nextNeighAt: animalDemoMode ? 7 : 18 + random() * 32,
        nextStableAt: 28 + random() * 52,
        elapsedSeconds: 0,
        navigation: null
    };
    loadAnimatedHorse(horseState);
    return horseState;
}

async function rememberDropping(kind, position) {
    // Nur der kurzlebige Bewegungs-Leader schreibt gemeinsame Zufallsereignisse.
    // Sonst würde derselbe Haufen bei drei offenen Geräten dreimal entstehen.
    if (animalMotionRole === "follower")
        return;
    animalResources.droppings.push({
        kind,
        x: Number(position.x.toFixed(3)),
        z: Number(position.z.toFixed(3)),
        createdAt: Date.now()
    });
    animalResources.droppings = animalResources.droppings.slice(-360);
    try {
        const response = await fetch("/api/animals/droppings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, x: position.x, z: position.z })
        });
        if (response.ok)
            applySharedAnimalState(await response.json());
    }
    catch (_error) {
        // Beim nächsten regelmäßigen Abgleich wird der Serverzustand erneut
        // geladen; die laufende Animation bleibt währenddessen sichtbar.
    }
}

function addHorseDropping(position = horse?.group?.position, persist = true) {
    if (!position || horseDroppings.length + animalDroppings.length >= 360)
        return;
    const dropping = new THREE.Group();
    dropping.position.set(position.x, 0.055, position.z - 0.42);
    world.add(dropping);
    const material = new THREE.MeshStandardMaterial({ color: 0x34251b, roughness: 1 });
    [[-0.10, 0.04, 0.02, 0.10], [0.04, 0.06, -0.03, 0.12], [0.13, 0.035, 0.06, 0.08],
        [-0.01, 0.10, 0.05, 0.09]].forEach(([x, y, z, radius]) =>
        addMesh(dropping, new THREE.DodecahedronGeometry(radius, 0), material,
            x, y, z, { castShadow: true }));
    horseDroppings.push(dropping);
    if (persist)
        rememberDropping("Pferd", position);
    menuCleanStatus.textContent = (horseDroppings.length + animalDroppings.length) +
        " Hinterlassenschaften auf dem Grundstück.";
}

function addAnimalDropping(position, kind = "Kamel", persist = true) {
    if (animalDroppings.length + horseDroppings.length >= 360)
        return;
    const dropping = new THREE.Group();
    dropping.position.set(position.x, 0.045, position.z - 0.34);
    world.add(dropping);
    const material = new THREE.MeshStandardMaterial({
        color: kind === "Kamel" ? 0x3d3021 : 0x34251b,
        roughness: 1
    });
    for (let index = 0; index < (kind === "Kamel" ? 7 : 4); index += 1) {
        const angle = index / 7 * Math.PI * 2;
        addMesh(dropping, new THREE.DodecahedronGeometry(0.07 + (index % 2) * 0.015, 0), material,
            Math.cos(angle) * 0.14, 0.05 + (index % 3) * 0.018,
            Math.sin(angle) * 0.11, { castShadow: true });
    }
    animalDroppings.push(dropping);
    if (persist)
        rememberDropping(kind, position);
    menuCleanStatus.textContent = (horseDroppings.length + animalDroppings.length) +
        " Hinterlassenschaften auf dem Grundstück.";
}

function restoreAnimalDroppings(replaceExisting = false) {
    if (replaceExisting) {
        [...horseDroppings.splice(0), ...animalDroppings.splice(0)].forEach((dropping) => {
            world.remove(dropping);
            dropping.traverse((object) => {
                if (object.geometry)
                    object.geometry.dispose();
                if (object.material)
                    object.material.dispose();
            });
        });
    }
    animalResources.droppings.forEach((item) => {
        const position = new THREE.Vector3(numberValue(item.x) ?? 0, 0, numberValue(item.z) ?? 0);
        if (item.kind === "Pferd")
            addHorseDropping(position, false);
        else
            addAnimalDropping(position, item.kind || "Kamel", false);
    });
    const count = horseDroppings.length + animalDroppings.length;
    menuCleanStatus.textContent = count ?
        `${count} Hinterlassenschaften auf dem Grundstück.` : "Grundstück ist sauber.";
    animalCleanLabel.querySelector("strong").textContent = count ?
        `${count} zu reinigen` : "Grundstück sauber";
    animalCleanLabel.classList.toggle("outside", count === 0);
}

function addUrinePatch(position, pasture) {
    const material = new THREE.MeshPhysicalMaterial({
        color: 0x596528,
        transparent: true,
        opacity: 0.58,
        roughness: 0.10,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        depthWrite: false
    });
    const sheenMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xd8df8f,
        transparent: true,
        opacity: 0.22,
        roughness: 0.04,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        depthWrite: false
    });
    const patch = new THREE.Group();
    patch.position.set(position.x, 0.032, position.z);
    world.add(patch);
    const wetGround = addMesh(patch, new THREE.CircleGeometry(0.34, 24), material,
        0, 0, 0, { rotation: [-Math.PI / 2, 0, 0], castShadow: false });
    wetGround.scale.set(1.25, 0.72, 1);
    const sheen = addMesh(patch, new THREE.CircleGeometry(0.19, 20), sheenMaterial,
        -0.05, 0.003, 0.04, { rotation: [-Math.PI / 2, 0, 0], castShadow: false });
    sheen.scale.set(1.38, 0.52, 1);
    urinePatches.push({
        mesh: patch,
        materials: [material, sheenMaterial],
        createdAt: performance.now(),
        lifetime: 150000 + Math.random() * 150000,
        startOpacities: [material.opacity, sheenMaterial.opacity]
    });
    fertilizeGrassAt(position.x, position.z, pasture);
}

function updateUrinePatches(time) {
    for (let index = urinePatches.length - 1; index >= 0; index -= 1) {
        const patch = urinePatches[index];
        const progress = THREE.MathUtils.clamp(
            (time - patch.createdAt) / patch.lifetime, 0, 1
        );
        patch.materials.forEach((material, materialIndex) => {
            material.opacity = patch.startOpacities[materialIndex] * (1 - progress);
        });
        patch.mesh.scale.multiplyScalar(1 + Math.max(0, progress - (patch.lastProgress || 0)) * 0.10);
        patch.lastProgress = progress;
        if (progress < 1)
            continue;
        world.remove(patch.mesh);
        patch.mesh.traverse((object) => object.geometry?.dispose());
        patch.materials.forEach((material) => material.dispose());
        urinePatches.splice(index, 1);
    }
}

function animalRearPosition(animal, species) {
    const distance = species === "Kamel" ? 0.82 : 0.66;
    return new THREE.Vector3(
        animal.group.position.x - Math.sin(animal.group.rotation.y) * distance,
        0,
        animal.group.position.z - Math.cos(animal.group.rotation.y) * distance
    );
}

function createAnimalEliminationEffect(animal, type, species, seconds) {
    if (animal.elimination)
        return false;
    const visual = new THREE.Group();
    const camel = species === "Kamel";
    visual.position.set(0, camel ? 0.78 : 0.70, camel ? -0.84 : -0.68);
    animal.group.add(visual);
    const duration = type === "urinating" ? 6.2 : 5.4;
    const parts = [];
    let material = null;
    if (type === "urinating") {
        material = new THREE.MeshPhysicalMaterial({
            color: 0xe6c54a,
            emissive: 0x5a4108,
            emissiveIntensity: 0.30,
            transparent: true,
            opacity: 0,
            roughness: 0.08,
            clearcoat: 1,
            clearcoatRoughness: 0.03,
            depthWrite: false
        });
        const stream = addMesh(visual,
            new THREE.CylinderGeometry(0.018, 0.032, 0.72, 10), material,
            0, -0.34, -0.10, { rotation: [0.18, 0, 0], castShadow: false });
        stream.scale.y = 0.01;
        parts.push(stream);
        for (let index = 0; index < 5; index += 1) {
            const droplet = addMesh(visual, new THREE.SphereGeometry(0.025, 9, 7), material,
                0, -0.04, -0.10, { castShadow: false });
            droplet.userData.offset = index / 5;
            parts.push(droplet);
        }
    }
    else {
        material = new THREE.MeshStandardMaterial({
            color: camel ? 0x3d3021 : 0x34251b,
            roughness: 1
        });
        for (let index = 0; index < (camel ? 7 : 5); index += 1) {
            const pellet = addMesh(visual,
                new THREE.DodecahedronGeometry(camel ? 0.07 : 0.09, 0), material,
                (index % 3 - 1) * 0.055, 0, (index % 2) * 0.045,
                { castShadow: true });
            pellet.visible = false;
            pellet.userData.delay = index * 0.48;
            parts.push(pellet);
        }
    }
    animal.elimination = {
        type,
        species,
        start: seconds,
        duration,
        visual,
        material,
        parts,
        groundPosition: animalRearPosition(animal, species)
    };
    animal.mode = type;
    animal.modeUntil = seconds + duration;
    return true;
}

function updateAnimalEliminationEffect(animal, seconds) {
    const effect = animal.elimination;
    if (!effect)
        return false;
    const elapsed = seconds - effect.start;
    const progress = THREE.MathUtils.clamp(elapsed / effect.duration, 0, 1);
    const envelope = Math.sin(progress * Math.PI);
    if (effect.type === "urinating") {
        effect.material.opacity = 0.78 * Math.min(1, envelope * 2.4);
        effect.parts[0].scale.y = Math.max(0.01, Math.min(1, envelope * 2.8));
        effect.parts.slice(1).forEach((droplet) => {
            const fall = (progress * 5.4 + droplet.userData.offset) % 1;
            droplet.position.y = -0.04 - fall * 0.68;
            droplet.position.z = -0.10 - fall * 0.10;
            droplet.visible = progress > 0.06 && progress < 0.94;
        });
    }
    else {
        effect.parts.forEach((pellet) => {
            const localTime = elapsed - pellet.userData.delay;
            pellet.visible = localTime >= 0;
            const fall = THREE.MathUtils.clamp(localTime / 0.72, 0, 1);
            pellet.position.y = -0.68 * fall * fall;
            pellet.rotation.x += 0.08;
            pellet.rotation.z += 0.05;
        });
    }
    if (progress < 1)
        return false;
    animal.group.remove(effect.visual);
    effect.visual.traverse((object) => object.geometry?.dispose());
    effect.material.dispose();
    if (effect.type === "urinating")
        addUrinePatch(effect.groundPosition, effect.species === "Kamel");
    else if (effect.species === "Kamel")
        addAnimalDropping(effect.groundPosition, "Kamel");
    else
        addHorseDropping(effect.groundPosition);
    animal.elimination = null;
    return true;
}

function cleanHorseDroppings() {
    [...horseDroppings.splice(0), ...animalDroppings.splice(0)].forEach((dropping) => {
        world.remove(dropping);
        dropping.traverse((object) => {
            if (object.geometry)
                object.geometry.dispose();
            if (object.material)
                object.material.dispose();
        });
    });
    urinePatches.splice(0).forEach((patch) => {
        world.remove(patch.mesh);
        patch.mesh.traverse((object) => object.geometry?.dispose());
        patch.materials.forEach((material) => material.dispose());
    });
    animalResources.droppings = [];
    animalCleanLabel.classList.add("outside");
    menuCleanStatus.textContent = "Grundstück ist sauber.";
}

function createTroughWater(parent, resourceKey, width, depth, topY, maxDepth = 0.14) {
    const texture = textures.water.clone();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.4, 1.5);
    texture.needsUpdate = true;
    const material = new THREE.MeshPhysicalMaterial({
        color: 0x58d5ef,
        map: texture,
        bumpMap: texture,
        bumpScale: 0.024,
        roughness: 0.055,
        metalness: 0.02,
        transmission: 0.46,
        transparent: true,
        opacity: 0.82,
        clearcoat: 1,
        clearcoatRoughness: 0.035,
        thickness: 0.12,
        ior: 1.333,
        envMapIntensity: 1.15,
        depthWrite: false
    });
    const volumeMaterial = material.clone();
    volumeMaterial.map = null;
    volumeMaterial.bumpMap = null;
    volumeMaterial.opacity = 0.38;
    volumeMaterial.roughness = 0.16;
    const volume = addBox(parent, [width, maxDepth, depth], volumeMaterial,
        [0, topY - maxDepth / 2, 0], { radius: 0.035, castShadow: false });
    const surface = addMesh(parent, new THREE.PlaneGeometry(width, depth, 18, 8), material,
        0, topY + 0.006, 0, { rotation: [-Math.PI / 2, 0, 0], castShadow: false });
    surface.renderOrder = 5;
    const rippleMaterial = new THREE.MeshBasicMaterial({
        color: 0xd5fbff,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
    });
    const ripples = [0, 0.54].map((phase) => {
        const ripple = addMesh(parent, new THREE.RingGeometry(0.035, 0.052, 24),
            rippleMaterial.clone(), 0, topY + 0.014, 0,
            { rotation: [-Math.PI / 2, 0, 0], castShadow: false });
        ripple.userData.phase = phase;
        ripple.renderOrder = 6;
        return ripple;
    });
    const visual = {
        kind: "water",
        resourceKey,
        surface,
        volume,
        material,
        texture,
        ripples,
        topY,
        maxDepth,
        phase: troughWaterSurfaces.length * 0.37,
        currentSurfaceY: topY
    };
    animalResourceVisuals.push(visual);
    troughWaterSurfaces.push(visual);
    return visual;
}

function animateTroughWater(seconds) {
    troughWaterSurfaces.forEach((visual) => {
        if (!visual.surface.visible)
            return;
        visual.texture.offset.set(
            (seconds * 0.018 + visual.phase) % 1,
            (seconds * -0.012 + visual.phase * 0.6) % 1
        );
        visual.surface.position.y = visual.currentSurfaceY +
            Math.sin(seconds * 1.45 + visual.phase * 8) * 0.004;
        visual.ripples.forEach((ripple, index) => {
            const progress = (seconds * 0.20 + ripple.userData.phase + visual.phase) % 1;
            const scale = 0.45 + progress * 4.8;
            ripple.scale.set(scale, scale * 0.58, 1);
            ripple.position.y = visual.surface.position.y + 0.008 + index * 0.001;
            ripple.material.opacity = (1 - progress) * 0.32;
        });
    });
}

function createAnimalTrough(position, resourceKey, rotation = 0, stationId = "") {
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.y = rotation;
    group.name = stationId || `${resourceKey}-trough`;
    group.userData.animalCareStation = stationId || resourceKey;
    world.add(group);
    const metal = new THREE.MeshStandardMaterial({ color: 0x667078, metalness: 0.62, roughness: 0.40 });
    addBox(group, [1.18, 0.40, 0.58], metal, [0, 0.31, 0], { radius: 0.10 });
    const recess = new THREE.MeshStandardMaterial({ color: 0x242b2f, metalness: 0.42, roughness: 0.28 });
    addBox(group, [1.06, 0.055, 0.47], recess, [0, 0.515, 0], {
        radius: 0.075, castShadow: false
    });
    createTroughWater(group, resourceKey, 1.00, 0.415, 0.552, 0.15);
    const location = stationId.includes("pergola") ? "PERGOLA" :
        resourceKey === "waterHorse" ? "PFERD" : "POOL";
    registerAnimalResourceLabel(stationId || resourceKey, "💧", `${location} · TRÄNKE`,
        resourceKey, group, 1.18);
}

function createHayRack(position, resourceKey, rotation = 0, stationId = "") {
    const group = new THREE.Group();
    group.position.set(...position);
    group.rotation.y = rotation;
    group.name = stationId || `${resourceKey}-rack`;
    group.userData.animalCareStation = stationId || resourceKey;
    world.add(group);
    const frame = new THREE.MeshStandardMaterial({ color: 0x4d5152, metalness: 0.64, roughness: 0.46 });
    const hay = new THREE.MeshStandardMaterial({ color: 0xc6a13d, roughness: 1 });
    [-0.56, 0.56].forEach((x) => {
        addBox(group, [0.08, 1.05, 0.08], frame, [x, 0.53, 0]);
        addBox(group, [0.08, 1.05, 0.08], frame, [x, 0.53, 0.52]);
    });
    for (let x = -0.48; x <= 0.48; x += 0.19)
        addBox(group, [0.045, 0.82, 0.045], frame, [x, 0.54, 0.26], {
            rotation: [0.34, 0, 0], castShadow: false
        });
    const fill = addBox(group, [0.96, 0.68, 0.44], hay, [0, 0.50, 0.27], { radius: 0.05 });
    animalResourceVisuals.push({ kind: "hay", resourceKey, fill });
    const location = stationId.includes("pergola") ? "PERGOLA" :
        resourceKey === "hayHorse" ? "PFERD" : "POOL";
    registerAnimalResourceLabel(stationId || resourceKey, "🌾", `${location} · HEU`,
        resourceKey, group, 1.45);
}

const DOG_CARE_STATIONS = Object.freeze({
    // Direkt neben der braunen Haustür auf der Pool-/Hofseite.
    food: [-4.02, 0, 0.92],
    water: [-4.02, 0, 2.74],
    foodTarget: [-5.02, 0, 0.92],
    waterTarget: [-5.02, 0, 2.74]
});

function createDogBowl(position, resourceKey, stationId, food = false) {
    const bowl = new THREE.Group();
    bowl.position.set(...position);
    bowl.name = stationId;
    bowl.userData.animalCareStation = stationId;
    world.add(bowl);
    const steel = new THREE.MeshStandardMaterial({
        color: 0xb7bdc2, metalness: 0.84, roughness: 0.24
    });
    const darkSteel = new THREE.MeshStandardMaterial({
        color: 0x343a3e, metalness: 0.58, roughness: 0.34
    });
    addMesh(bowl, new THREE.CylinderGeometry(0.34, 0.27, 0.15, 32), steel,
        0, 0.085, 0, { castShadow: true });
    addMesh(bowl, new THREE.CylinderGeometry(0.275, 0.245, 0.035, 32), darkSteel,
        0, 0.17, 0, { castShadow: false });
    if (food) {
        const fill = new THREE.Group();
        bowl.add(fill);
        const kibble = new THREE.MeshStandardMaterial({ color: 0x5a321d, roughness: 0.96 });
        for (let index = 0; index < 26; index += 1) {
            const angle = index * 2.39996;
            const radius = 0.03 + (index % 6) * 0.035;
            addMesh(fill, new THREE.DodecahedronGeometry(0.033 + (index % 3) * 0.004, 0),
                kibble, Math.cos(angle) * radius, 0.19 + (index % 4) * 0.013,
                Math.sin(angle) * radius, { castShadow: false });
        }
        animalResourceVisuals.push({ kind: "dog-food", resourceKey, fill });
        registerAnimalResourceLabel(stationId, "🐕", "HUND · FUTTER",
            resourceKey, bowl, 0.90, "Jetzt füttern");
    }
    else {
        createTroughWater(bowl, resourceKey, 0.47, 0.47, 0.188, 0.10);
        registerAnimalResourceLabel(stationId, "💧", "HUND · WASSER",
            resourceKey, bowl, 0.90, "Wasser auffüllen");
    }
    return bowl;
}

function updateAnimalResourceVisuals() {
    animalResourceVisuals.forEach((visual) => {
        const level = THREE.MathUtils.clamp((numberValue(animalResources[visual.resourceKey]) ?? 0) / 100, 0.02, 1);
        if (visual.kind === "hay") {
            visual.fill.scale.y = level;
            visual.fill.position.y = 0.16 + 0.34 * level;
        }
        else if (visual.kind === "dog-food") {
            visual.fill.visible = level > 0.025;
            visual.fill.scale.setScalar(0.45 + level * 0.55);
            visual.fill.position.y = -0.045 * (1 - level);
        }
        else {
            const waterLevel = THREE.MathUtils.clamp((numberValue(animalResources[visual.resourceKey]) ?? 0) / 100, 0, 1);
            visual.currentSurfaceY = visual.topY - (1 - waterLevel) * visual.maxDepth;
            visual.surface.position.y = visual.currentSurfaceY;
            visual.surface.visible = waterLevel > 0.015;
            visual.volume.visible = waterLevel > 0.015;
            visual.volume.scale.y = Math.max(0.02, waterLevel);
            visual.volume.position.y = visual.topY - visual.maxDepth +
                visual.maxDepth * Math.max(0.02, waterLevel) / 2;
            visual.material.opacity = 0.60 + waterLevel * 0.24;
            visual.ripples.forEach((ripple) => ripple.visible = waterLevel > 0.08);
        }
    });
    if (menuCareStatus) {
        const hay = Math.round((animalResources.hayHorse + animalResources.hayCamelPool +
            animalResources.hayCamelPergola) / 3);
        const water = Math.round((animalResources.waterHorse + animalResources.waterCamelPool +
            animalResources.waterCamelPergola) / 3);
        const dogStatus = animalResources.dogHungry ? " · Hund hungrig" : "";
        menuCareStatus.textContent = `Heu ${hay} % · Wasser ${water} %${dogStatus}`;
    }
    // Die Bedienung der Näpfe und Raufen darf nicht davon abhängen, ob das
    // optionale Menü gerade im DOM sichtbar ist. Jede Station wird direkt aus
    // dem gemeinsamen Serverzustand aktualisiert.
    Object.entries(animalResourceLabelAnchors).forEach(([id, anchor]) => {
        const element = animalResourceLabelElements[id];
        const value = Math.round(numberValue(animalResources[anchor.resourceKey]) ?? 0);
        const hungryDog = anchor.resourceKey === "dogFood" && animalResources.dogHungry;
        element.querySelector("strong").textContent = hungryDog ? `${value} % · HUNGRIG` : `${value} %`;
        element.querySelector("b").style.width = `${value}%`;
        element.dataset.hungry = hungryDog ? "true" : "false";
        element.classList.toggle("healthy", value > 50 && !hungryDog);
        element.classList.toggle("refill", value <= 50 && value > 20 && !hungryDog);
        element.classList.toggle("warning", (value <= 20 && value > 10) || hungryDog);
        element.classList.toggle("critical", value <= 10);
    });
}

// Je eine Kamelstation liegt hinter dem Pool und an der Pergola. Jede physische
// Raufe und Tränke besitzt einen eigenen Serverwert und einen eigenen Button.
const CAMEL_CARE_STATIONS = {
    water: [
        {
            id: "pool-camel-water",
            resourceKey: "waterCamelPool",
            model: [-12.28, 0, -3.92],
            target: [-13.38, -3.92],
            rotation: 0,
            slotAxis: [0, 1]
        },
        {
            id: "pergola-camel-water",
            resourceKey: "waterCamelPergola",
            model: [5.18, 0, -17.52],
            // Die Standplätze liegen parallel zum schrägen Zaun, aber mit
            // ausreichend Abstand auf der Weideseite. Der frühere diagonale
            // Versatz setzte das linke Tier praktisch auf die Zaunkante.
            target: [4.40, -16.90],
            rotation: 0.49,
            slotAxis: [1, 0]
        }
    ],
    hay: [
        {
            id: "pool-camel-hay",
            resourceKey: "hayCamelPool",
            model: [-12.32, 0, -2.26],
            target: [-13.42, -2.26],
            rotation: -Math.PI / 2,
            slotAxis: [0, 1]
        },
        {
            id: "pergola-camel-hay",
            resourceKey: "hayCamelPergola",
            model: [3.62, 0, -16.72],
            target: [3.06, -17.56],
            rotation: 0.49,
            slotAxis: [1, 0]
        }
    ]
};
// 2,40 m Abstand verhindert auch bei den beiden größten Tieren sichtbare
// Überschneidungen von Körper, Hals und Höckern an derselben Station.
const CAMEL_CARE_SLOT_SPACING = 2.40;
const CAMEL_HERD_SIZE = 5;

function pointInRotatedStation(x, z, position, rotation, clearance = 0) {
    const deltaX = x - position[0];
    const deltaZ = z - position[2];
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);
    const localX = deltaX * cos - deltaZ * sin;
    const localZ = deltaX * sin + deltaZ * cos;
    return Math.abs(localX) < 0.72 + clearance && Math.abs(localZ) < 0.56 + clearance;
}

function animalCareStationBlocksAnimal(x, z, clearance = 0, includeHorseStations = false) {
    const camelStation = [...CAMEL_CARE_STATIONS.water, ...CAMEL_CARE_STATIONS.hay]
        .some((station) => pointInRotatedStation(x, z, station.model, station.rotation, clearance));
    if (camelStation)
        return true;
    const dogStation = [DOG_CARE_STATIONS.food, DOG_CARE_STATIONS.water]
        .some((station) => Math.hypot(x - station[0], z - station[2]) < 0.38 + clearance);
    if (dogStation)
        return true;
    if (!includeHorseStations)
        return false;
    // Pferderaufe im Garten und Tränke im Stall. Beide bleiben physische
    // Hindernisse; die Tiere stellen sich mit genügend Abstand davor.
    if (pointInRotatedStation(x, z, [-10.66, 0, -2.26], Math.PI / 2, clearance))
        return true;
    return Math.abs(x + 1.60) < 0.48 + clearance &&
        Math.abs(z + 1.94) < 0.42 + clearance;
}

function createAnimalCareStations() {
    // Die Pferdetränke ist Teil des 3D-Stalls. Hinter dem Poolzaun verbleiben
    // zwei miteinander gekoppelte Kamelstationen sowie die Pferde-Heuraufe.
    CAMEL_CARE_STATIONS.water.forEach((station) =>
        createAnimalTrough(station.model, station.resourceKey, station.rotation, station.id));
    createHayRack([-10.66, 0, -2.26], "hayHorse", Math.PI / 2, "horse-hay");
    CAMEL_CARE_STATIONS.hay.forEach((station) =>
        createHayRack(station.model, station.resourceKey, station.rotation, station.id));
    createDogBowl(DOG_CARE_STATIONS.food, "dogFood", "dog-food", true);
    createDogBowl(DOG_CARE_STATIONS.water, "dogWater", "dog-water");
    updateAnimalResourceVisuals();
}

const DOG_PATROL_POINTS = [
    [-4.80, -3.25], [-5.10, 4.85], [-6.05, 6.25], [-6.55, 10.25],
    [-9.20, 8.25], [-10.25, 2.10], [-9.55, -6.80], [-5.15, -8.10]
];
let dogBarkPlayCount = 0;

function playDogBark(hungry = false) {
    if (!animalSoundsEnabled || !dog)
        return false;
    const seconds = performance.now() / 1000;
    const cooldown = hungry ? 4.6 : 20;
    if (seconds - dog.lastAudibleBarkAt < cooldown)
        return false;
    dog.lastAudibleBarkAt = seconds;
    // Eine echte Rottweiler-Aufnahme ist auf Telefonlautsprechern erheblich
    // klarer als der bisherige tiefe Oszillator. Der synthetische Ton bleibt
    // nur als Offline-/Codec-Fallback erhalten.
    if (playAnimalSound("dog", hungry ? 0.94 : 0.84)) {
        dogBarkPlayCount += 1;
        return true;
    }
    if (!birdAudioContext || birdAudioContext.state !== "running")
        return false;
    const now = birdAudioContext.currentTime;
    const master = birdAudioContext.createGain();
    const filter = birdAudioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = hungry ? 820 : 720;
    filter.Q.value = 0.9;
    master.gain.setValueAtTime(0.0001, now);
    master.connect(filter).connect(birdAudioContext.destination);
    const barks = hungry ? 3 : 2;
    for (let index = 0; index < barks; index += 1) {
        const start = now + index * 0.31;
        const oscillator = birdAudioContext.createOscillator();
        const gain = birdAudioContext.createGain();
        oscillator.type = index % 2 ? "square" : "sawtooth";
        oscillator.frequency.setValueAtTime(155 + index * 8, start);
        oscillator.frequency.exponentialRampToValueAtTime(72, start + 0.18);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(hungry ? 0.075 : 0.062, start + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
        oscillator.connect(gain).connect(master);
        oscillator.start(start);
        oscillator.stop(start + 0.24);
    }
    dogBarkPlayCount += 1;
    return true;
}

function createRottweilerLeg(parent, x, z, phase, black, tan) {
    const rig = new THREE.Group();
    rig.position.set(x, 0.49, z);
    parent.add(rig);
    const upper = addMesh(rig, new THREE.CylinderGeometry(0.085, 0.075, 0.28, 14),
        black, 0, -0.14, 0);
    const lowerRig = new THREE.Group();
    lowerRig.position.set(0, -0.27, 0);
    rig.add(lowerRig);
    addMesh(lowerRig, new THREE.CylinderGeometry(0.064, 0.052, 0.24, 14),
        tan, 0, -0.11, 0);
    const paw = addMesh(lowerRig, new THREE.SphereGeometry(0.075, 14, 9), tan,
        0, -0.23, 0.035);
    paw.scale.set(0.90, 0.55, 1.34);
    return { rig, lowerRig, upper, paw, phase };
}

function tuneRottweilerMaterials(model) {
    const palette = {
        "material": 0x171312,
        "dark": 0x050505,
        "nose": 0x020202,
        "pads": 0x24130f,
        "light": 0xa95227,
        "material.001": 0x171515,
        "material.002": 0x9d4d24,
        "material.003": 0x030303,
        "material.004": 0xeee8dc,
        "material.005": 0xb33b42,
        "fell": 0xffffff,
        "schnauze": 0xffffff,
        "hair2": 0xffffff,
        "ear": 0xffffff
    };
    model.traverse((object) => {
        if (!object.isMesh)
            return;
        object.castShadow = renderProfile.minorShadows;
        object.receiveShadow = true;
        const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
        const tuned = sourceMaterials.map((source) => {
            const material = source.clone();
            const name = (material.name || "").toLowerCase();
            if (palette[name] != null)
                material.color.setHex(palette[name]);
            material.metalness = 0;
            material.roughness = name === "material.003" ? 0.28 :
                name === "material.005" ? 0.64 :
                    ["fell", "hair2"].includes(name) ? 0.56 :
                        ["schnauze", "ear"].includes(name) ? 0.66 : 0.76;
            material.transparent = false;
            material.opacity = 1;
            material.depthWrite = true;
            material.needsUpdate = true;
            return material;
        });
        object.material = Array.isArray(object.material) ? tuned : tuned[0];
    });
}

function dogClipByWords(animations, words) {
    const loweredWords = words.map((word) => word.toLowerCase());
    return animations.find((clip) => {
        const name = (clip.name || "").toLowerCase();
        return loweredWords.some((word) => name === word || name.includes(word));
    }) || null;
}

function createDogActions(mixer, animations) {
    if (!mixer || !animations?.length)
        return {};
    const clips = {
        idle: dogClipByWords(animations, ["idle1", "idle ear", "idle"]),
        walk: dogClipByWords(animations, ["walkcycle", "walk", "run"]),
        run: dogClipByWords(animations, ["runcycle", "run"]),
        sleep: dogClipByWords(animations, ["idle liedown", "laydown", "lie", "die"]),
        bark: dogClipByWords(animations, ["bark", "attack"]),
        jump: dogClipByWords(animations, ["jump", "attack2"]),
        flinch: dogClipByWords(animations, ["flinch"])
    };
    const actions = {};
    Object.entries(clips).forEach(([name, sourceClip]) => {
        if (!sourceClip)
            return;
        // Benny besitzt nur einen Laufclip. Für das Gehen wird deshalb eine
        // eigene, langsam abgespielte Kopie verwendet, damit ein Wechsel zum
        // Rennen nicht dieselbe AnimationAction mit falschem Tempo wiederverwendet.
        const clip = name === "walk" && sourceClip === clips.run ? sourceClip.clone() : sourceClip;
        if (clip !== sourceClip)
            clip.name = `${sourceClip.name}-walk`;
        const action = mixer.clipAction(clip);
        if (["sleep", "jump"].includes(name)) {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
        }
        actions[name] = action;
    });
    return actions;
}

function setDogAnimation(dogState, name, fadeSeconds = 0.22) {
    const next = dogState.actions?.[name] || dogState.actions?.idle;
    if (!next || dogState.currentAction === next)
        return;
    if (dogState.currentAction)
        dogState.currentAction.fadeOut(fadeSeconds);
    const timeScale = name === "walk" ? 0.56 : name === "run" ? 1.12 :
        name === "sleep" ? 0.74 : name === "jump" ? 0.92 : 1;
    next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1)
        .fadeIn(fadeSeconds).play();
    dogState.currentAction = next;
    dogState.currentActionName = name;
}

function installDetailedRottweiler(dogState, gltf, assetKind) {
    const model = gltf.scene;
    model.name = "Rottweiler-Detailmodell";
    model.updateMatrixWorld(true);
    let bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const horizontalLength = Math.max(size.x, size.z, 0.001);
    // Etwa 1,24 m von Rute bis Schnauze: kräftig, aber weiterhin im
    // korrekten Verhältnis zu Audi, Pferd und Futterstation.
    model.scale.setScalar(1.24 / horizontalLength);
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    const scaledSize = bounds.getSize(new THREE.Vector3());
    const bodyPivotY = scaledSize.y * 0.43;
    model.position.x -= center.x;
    model.position.y -= bounds.min.y + bodyPivotY;
    model.position.z -= center.z;
    tuneRottweilerMaterials(model);
    // Das neue Ausgangsmodell ist bereits ein echter, kompakter Rottweiler.
    // Seine Proportionen bleiben deshalb unangetastet; nur die Gesamtlänge
    // wird an Grundstück, Fahrzeuge und Futterstationen angeglichen.
    dogState.detailedRig.position.y = bodyPivotY;
    dogState.detailedRig.userData.standY = bodyPivotY;
    dogState.detailedRig.add(model);
    dogState.bodyRig.visible = false;
    dogState.detailedModel = model;
    dogState.assetKind = assetKind;
    dogState.mixer = gltf.animations?.length ? new THREE.AnimationMixer(model) : null;
    dogState.actions = createDogActions(dogState.mixer, gltf.animations || []);
    dogState.detailedBones = {};
    model.traverse((object) => {
        if (!object.isBone)
            return;
        const name = object.name?.toLowerCase() || "";
        if (name === "head" || name === "hals" || name === "kiefer" || name.startsWith("tail"))
            dogState.detailedBones[name] = object;
    });
    dogState.assetLoaded = true;
    setDogAnimation(dogState, "idle", 0);
}

function loadDetailedRottweilerFallback(dogState) {
    vehicleLoader.load("/static/models/rottweiler/scene.gltf?v=108", (gltf) => {
        installDetailedRottweiler(dogState, gltf, "static-fallback");
    }, undefined, () => {
        // Das geometrische Laufzeitmodell bleibt bei einem weiteren Ladefehler
        // vollständig animiert sichtbar.
        dogState.assetLoaded = false;
    });
}

function loadDetailedRottweiler(dogState) {
    vehicleLoader.load(
        "/static/models/rottweiler-benny/rottweiler-animated.glb?v=112",
        (gltf) => installDetailedRottweiler(dogState, gltf, "benny-rigged"),
        undefined,
        () => loadDetailedRottweilerFallback(dogState)
    );
}

function createRottweiler() {
    const group = new THREE.Group();
    group.name = "Animierter Rottweiler";
    group.position.set(-5.25, 0, -3.25);
    world.add(group);

    const visualRoot = new THREE.Group();
    group.add(visualRoot);
    const detailedRig = new THREE.Group();
    visualRoot.add(detailedRig);
    const bodyRig = new THREE.Group();
    visualRoot.add(bodyRig);
    const black = new THREE.MeshStandardMaterial({
        color: 0x11100f, roughness: 0.72, metalness: 0.02
    });
    const blackGloss = new THREE.MeshStandardMaterial({
        color: 0x090909, roughness: 0.48, metalness: 0.03
    });
    const tan = new THREE.MeshStandardMaterial({ color: 0x9a4f25, roughness: 0.80 });
    const tanLight = new THREE.MeshStandardMaterial({ color: 0xb66834, roughness: 0.78 });
    const nose = new THREE.MeshStandardMaterial({ color: 0x020202, roughness: 0.26 });
    const eye = new THREE.MeshPhysicalMaterial({
        color: 0x241006, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04
    });

    const body = addMesh(bodyRig, new THREE.SphereGeometry(0.50, 28, 18), black,
        0, 0.61, -0.05);
    body.scale.set(0.72, 0.68, 1.24);
    const chest = addMesh(bodyRig, new THREE.SphereGeometry(0.31, 24, 16), blackGloss,
        0, 0.64, 0.35);
    chest.scale.set(1.04, 1.08, 0.85);
    const chestMark = addMesh(bodyRig, new THREE.SphereGeometry(0.18, 18, 12), tan,
        0, 0.55, 0.53, { castShadow: false });
    chestMark.scale.set(0.76, 0.92, 0.32);

    const headRig = new THREE.Group();
    headRig.position.set(0, 0.78, 0.48);
    bodyRig.add(headRig);
    const neck = addMesh(headRig, new THREE.SphereGeometry(0.29, 22, 15), black,
        0, -0.08, 0.02);
    neck.scale.set(1.00, 1.18, 0.86);
    const skull = addMesh(headRig, new THREE.SphereGeometry(0.28, 24, 16), blackGloss,
        0, 0.08, 0.25);
    skull.scale.set(1.00, 0.92, 1.04);
    const muzzle = addMesh(headRig, new THREE.SphereGeometry(0.20, 22, 14), tanLight,
        0, -0.02, 0.48);
    muzzle.scale.set(1.05, 0.70, 1.12);
    const noseMesh = addMesh(headRig, new THREE.SphereGeometry(0.095, 18, 12), nose,
        0, 0.01, 0.67);
    noseMesh.scale.set(1.18, 0.78, 0.72);
    [-1, 1].forEach((side) => {
        const ear = addMesh(headRig, new THREE.ConeGeometry(0.105, 0.25, 4), black,
            side * 0.19, 0.27, 0.18, { rotation: [0.16, 0, side * -0.22] });
        ear.scale.z = 0.72;
        addMesh(headRig, new THREE.SphereGeometry(0.033, 12, 8), eye,
            side * 0.105, 0.13, 0.49, { castShadow: false });
        const brow = addMesh(headRig, new THREE.SphereGeometry(0.047, 12, 8), tan,
            side * 0.105, 0.20, 0.46, { castShadow: false });
        brow.scale.set(1.35, 0.50, 0.42);
    });
    const jawRig = new THREE.Group();
    jawRig.position.set(0, -0.10, 0.45);
    headRig.add(jawRig);
    const jaw = addMesh(jawRig, new THREE.SphereGeometry(0.16, 18, 10), tan,
        0, 0, 0.05);
    jaw.scale.set(0.96, 0.42, 1.06);
    const tongue = addBox(jawRig, [0.08, 0.018, 0.15],
        new THREE.MeshStandardMaterial({ color: 0xb23b45, roughness: 0.72 }),
        [0, -0.04, 0.13], { radius: 0.015, castShadow: false });
    tongue.visible = false;

    const legs = [
        createRottweilerLeg(bodyRig, -0.23, 0.34, 0, black, tan),
        createRottweilerLeg(bodyRig, 0.23, 0.34, Math.PI, black, tan),
        createRottweilerLeg(bodyRig, -0.23, -0.38, Math.PI, black, tan),
        createRottweilerLeg(bodyRig, 0.23, -0.38, 0, black, tan)
    ];
    const tailRig = new THREE.Group();
    tailRig.position.set(0, 0.72, -0.55);
    bodyRig.add(tailRig);
    const tail = addMesh(tailRig, new THREE.ConeGeometry(0.08, 0.52, 14), black,
        0, 0, -0.22, { rotation: [Math.PI / 2, 0, 0] });
    tail.scale.z = 0.82;
    const collar = addMesh(headRig, new THREE.TorusGeometry(0.265, 0.026, 8, 28),
        new THREE.MeshStandardMaterial({ color: 0x8d1010, roughness: 0.48 }),
        0, -0.11, 0.03, { rotation: [Math.PI / 2, 0, 0] });
    collar.scale.y = 0.88;

    const random = seededNoise(20260902);
    const dogState = {
        group, visualRoot, detailedRig, detailedModel: null,
        bodyRig, body, chest, headRig, jawRig, tongue,
        legs, tailRig, random,
        target: new THREE.Vector3(-4.80, 0, -3.25),
        path: [],
        mode: "walking",
        modeUntil: 0,
        elapsedSeconds: 0,
        navigation: "patrol",
        travelled: 0,
        pendingMeal: false,
        nextDrinkAt: animalDemoMode ? 14 : 65 + random() * 80,
        nextSleepAt: animalDemoMode ? 24 : 160 + random() * 220,
        nextCasualBarkAt: animalDemoMode ? 7 : 14 + random() * 20,
        nextChaseAt: animalDemoMode ? 12 : 32 + random() * 55,
        nextJumpAt: animalDemoMode ? 18 : 55 + random() * 90,
        lastHungryBarkAt: -Infinity,
        lastAudibleBarkAt: -Infinity,
        chaseBird: null,
        patrolIndex: 0,
        assetLoaded: false,
        assetKind: "procedural-fallback",
        mixer: null,
        actions: {},
        currentAction: null,
        currentActionName: "loading",
        detailedBones: {}
    };
    setDogRoute(dogState, dogState.target, "patrol", false);
    loadDetailedRottweiler(dogState);
    return dogState;
}

function dogCanStandAt(x, z, allowCareTarget = false) {
    if (!horseCanStandAt(x, z))
        return false;
    if (!allowCareTarget && [DOG_CARE_STATIONS.food, DOG_CARE_STATIONS.water]
        .some((station) => Math.hypot(x - station[0], z - station[2]) < 0.58))
        return false;
    return true;
}

function dogPathIsClear(start, destination) {
    const distance = start.distanceTo(destination);
    const steps = Math.max(1, Math.ceil(distance / 0.22));
    for (let index = 1; index <= steps; index += 1) {
        const point = start.clone().lerp(destination, index / steps);
        if (!dogCanStandAt(point.x, point.z, true))
            return false;
    }
    return true;
}

function setDogRoute(dogState, destination, navigation, running = false) {
    let route = null;
    if (dogPathIsClear(dogState.group.position, destination))
        route = [destination.clone()];
    else
        route = findHorsePath(dogState.group.position, destination);
    if (!route?.length)
        return false;
    dogState.path = route;
    dogState.target = dogState.path.shift();
    dogState.navigation = navigation;
    dogState.mode = running ? "running" : "walking";
    return true;
}

function chooseDogPatrolTarget(dogState) {
    for (let attempt = 0; attempt < DOG_PATROL_POINTS.length; attempt += 1) {
        dogState.patrolIndex = (dogState.patrolIndex + 1 +
            Math.floor(dogState.random() * 3)) % DOG_PATROL_POINTS.length;
        const point = DOG_PATROL_POINTS[dogState.patrolIndex];
        if (dogCanStandAt(point[0], point[1], true))
            return new THREE.Vector3(point[0], 0, point[1]);
    }
    return dogState.group.position.clone();
}

function groundedBirdForDog(dogState) {
    const candidates = gardenBirds.filter((bird) => bird.group.visible &&
        !bird.state.startsWith("flying") &&
        !["taking-off", "landing", "away"].includes(bird.state) &&
        dogCanStandAt(bird.group.position.x, bird.group.position.z, true) &&
        dogState.group.position.distanceTo(bird.group.position) < 9.5);
    candidates.sort((left, right) =>
        dogState.group.position.distanceTo(left.group.position) -
        dogState.group.position.distanceTo(right.group.position));
    return candidates[0] || null;
}

function startNextDogActivity(dogState, seconds) {
    dogState.chaseBird = null;
    if (animalResources.dogHungry || dogState.pendingMeal) {
        setDogRoute(dogState, new THREE.Vector3(...DOG_CARE_STATIONS.foodTarget),
            "dog-food", false);
        return;
    }
    if (seconds >= dogState.nextDrinkAt) {
        dogState.nextDrinkAt = seconds + 95 + dogState.random() * 145;
        setDogRoute(dogState, new THREE.Vector3(...DOG_CARE_STATIONS.waterTarget),
            "dog-water", false);
        return;
    }
    if (seconds >= dogState.nextChaseAt) {
        dogState.nextChaseAt = seconds + 35 + dogState.random() * 75;
        const bird = groundedBirdForDog(dogState);
        if (bird && setDogRoute(dogState, bird.group.position.clone(), "chase", true)) {
            dogState.chaseBird = bird;
            return;
        }
    }
    if (seconds >= dogState.nextJumpAt && dogState.random() < 0.34) {
        dogState.nextJumpAt = seconds + 70 + dogState.random() * 120;
        dogState.mode = "jumping";
        dogState.modeUntil = seconds + 1.15;
        dogState.navigation = null;
        return;
    }
    const hour = new Date().getHours();
    if (seconds >= dogState.nextSleepAt && dogState.random() < (hour >= 22 || hour < 6 ? 0.76 : 0.34)) {
        dogState.mode = "sleeping";
        dogState.modeUntil = seconds + (hour >= 22 || hour < 6 ? 48 : 18) + dogState.random() * 35;
        dogState.nextSleepAt = seconds + 210 + dogState.random() * 300;
        dogState.navigation = null;
        return;
    }
    setDogRoute(dogState, chooseDogPatrolTarget(dogState), "patrol",
        dogState.random() < 0.16);
}

function animateRottweilerPose(dogState, seconds, delta, moving, running) {
    const sleeping = dogState.mode === "sleeping";
    const jumping = dogState.mode === "jumping";
    const loweringHead = ["eating", "drinking", "waiting-food"].includes(dogState.mode);
    const barking = dogState.mode === "barking" ||
        (dogState.mode === "waiting-food" && seconds - dogState.lastHungryBarkAt < 1.15);
    const jumpProgress = jumping ? THREE.MathUtils.clamp(
        1 - Math.max(0, dogState.modeUntil - seconds) / 1.15, 0, 1
    ) : 0;
    const jumpLift = jumping ? Math.sin(jumpProgress * Math.PI) * 0.24 : 0;
    const bodyY = sleeping ? (dogState.detailedModel ? 0.015 : -0.27) :
        jumping ? jumpLift :
        moving ? Math.abs(Math.sin(dogState.travelled * 8.2)) * (running ? 0.034 : 0.022) : 0;
    dogState.visualRoot.position.y = THREE.MathUtils.damp(
        dogState.visualRoot.position.y, bodyY, 7, delta);

    if (dogState.detailedModel) {
        const standY = dogState.detailedRig.userData.standY || 0.30;
        const gait = moving ? Math.sin(dogState.travelled * (running ? 12.2 : 8.6)) : 0;
        const rigged = dogState.assetKind === "benny-rigged" && dogState.mixer;
        if (rigged) {
            setDogAnimation(dogState, sleeping ? "sleep" : jumping ? "jump" :
                barking ? "bark" : moving ? (running ? "run" : "walk") : "idle");
            dogState.mixer.update(delta);
            const head = dogState.detailedBones.head;
            const neck = dogState.detailedBones.hals;
            const jaw = dogState.detailedBones.kiefer;
            if (loweringHead) {
                if (neck)
                    neck.rotation.x += 0.52;
                if (head)
                    head.rotation.x += 0.46 + Math.sin(seconds * 4.8) * 0.05;
                if (jaw)
                    jaw.rotation.x += 0.08 + Math.max(0, Math.sin(seconds * 5.6)) * 0.07;
            }
        }
        dogState.detailedRig.position.y = THREE.MathUtils.damp(
            dogState.detailedRig.position.y,
            standY + (sleeping ? -0.035 : loweringHead ? -0.020 : 0), 8, delta);
        dogState.detailedRig.rotation.z = THREE.MathUtils.damp(
            dogState.detailedRig.rotation.z,
            rigged ? 0 : sleeping ? -1.32 : gait * (running ? 0.052 : 0.032), 8, delta);
        dogState.detailedRig.rotation.x = THREE.MathUtils.damp(
            dogState.detailedRig.rotation.x,
            rigged ? (loweringHead ? 0.10 : barking ? -0.035 : jumping ? -0.08 : 0) :
                sleeping ? 0.06 : loweringHead ? 0.22 : barking ? -0.08 :
                moving ? gait * 0.018 : 0, 9, delta);
        const breathing = sleeping ? Math.sin(seconds * 2.1) * 0.012 :
            barking ? Math.max(0, Math.sin(seconds * 16)) * 0.018 : 0;
        dogState.detailedRig.scale.y = THREE.MathUtils.damp(
            dogState.detailedRig.scale.y, 1 + breathing, 10, delta);
        dogState.detailedRig.scale.x = THREE.MathUtils.damp(
            dogState.detailedRig.scale.x, 1 - breathing * 0.35, 10, delta);
        dogState.detailedRig.scale.z = THREE.MathUtils.damp(
            dogState.detailedRig.scale.z, 1 + breathing * 0.20, 10, delta);
    }
    dogState.bodyRig.rotation.z = THREE.MathUtils.damp(
        dogState.bodyRig.rotation.z, sleeping ? 0.20 : 0, 7, delta);
    dogState.headRig.rotation.x = THREE.MathUtils.damp(dogState.headRig.rotation.x,
        loweringHead ? 0.98 : barking ? -0.22 : sleeping ? 0.16 : 0, 8, delta);
    dogState.headRig.rotation.z = THREE.MathUtils.damp(dogState.headRig.rotation.z,
        sleeping ? -0.28 : 0, 7, delta);
    dogState.jawRig.rotation.x = THREE.MathUtils.damp(dogState.jawRig.rotation.x,
        barking ? 0.34 + Math.max(0, Math.sin(seconds * 22)) * 0.18 :
            loweringHead ? 0.10 + Math.max(0, Math.sin(seconds * 5.5)) * 0.08 : 0,
        13, delta);
    dogState.tongue.visible = dogState.mode === "drinking";
    dogState.tailRig.rotation.z = sleeping ? 0.12 :
        Math.sin(seconds * (running ? 10 : 7.2)) * (barking ? 0.56 : 0.34);
    dogState.legs.forEach((leg, index) => {
        const stride = moving ? Math.sin(dogState.travelled * (running ? 11.5 : 8.4) + leg.phase) *
            (running ? 0.70 : 0.46) : 0;
        const folded = sleeping ? (index < 2 ? 1.14 : -1.02) : 0;
        leg.rig.rotation.x = THREE.MathUtils.damp(leg.rig.rotation.x,
            sleeping ? folded : stride, 12, delta);
        leg.lowerRig.rotation.x = THREE.MathUtils.damp(leg.lowerRig.rotation.x,
            sleeping ? -0.82 : moving ? Math.max(0, -stride) * 0.55 : 0, 12, delta);
    });
}

function animateDog(seconds, delta) {
    if (!dog)
        return;
    dog.elapsedSeconds = seconds;
    if (reduceMotion) {
        animateRottweilerPose(dog, seconds, delta, false, false);
        return;
    }
    if (animalResources.dogHungry && !["walking", "running", "waiting-food", "eating"]
        .includes(dog.mode))
        setDogRoute(dog, new THREE.Vector3(...DOG_CARE_STATIONS.foodTarget), "dog-food");
    if (dog.mode === "waiting-food") {
        if (!animalResources.dogHungry) {
            dog.pendingMeal = false;
            dog.mode = "eating";
            dog.modeUntil = seconds + 8.5;
        }
        else if (seconds - dog.lastHungryBarkAt >= 5.2) {
            dog.lastHungryBarkAt = seconds;
            playDogBark(true);
        }
    }
    if (dog.mode === "sleeping" || dog.mode === "jumping" ||
        dog.mode === "eating" || dog.mode === "drinking" ||
        dog.mode === "barking" || dog.mode === "idle" || dog.mode === "waiting-food") {
        animateRottweilerPose(dog, seconds, delta, false, false);
        if (!["waiting-food"].includes(dog.mode) && seconds >= dog.modeUntil)
            startNextDogActivity(dog, seconds);
        return;
    }

    const running = dog.mode === "running";
    if (dog.navigation === "chase" && dog.chaseBird) {
        const bird = dog.chaseBird;
        if (!bird.group.visible || bird.state.startsWith("flying") || bird.state === "away") {
            dog.mode = "barking";
            dog.modeUntil = seconds + 1.4;
            playDogBark(false);
            animateRottweilerPose(dog, seconds, delta, false, false);
            return;
        }
        const birdDistance = dog.group.position.distanceTo(bird.group.position);
        if (birdDistance < 1.55) {
            startBirdDeparture(bird, seconds);
            dog.mode = "barking";
            dog.modeUntil = seconds + 1.6;
            playDogBark(false);
            animateRottweilerPose(dog, seconds, delta, false, false);
            return;
        }
    }
    const dx = dog.target.x - dog.group.position.x;
    const dz = dog.target.z - dog.group.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.18) {
        if (dog.path.length) {
            dog.target = dog.path.shift();
        }
        else if (dog.navigation === "dog-food") {
            dog.group.rotation.y = Math.PI / 2;
            dog.mode = animalResources.dogHungry ? "waiting-food" : "eating";
            dog.modeUntil = seconds + 8.5;
            dog.pendingMeal = false;
        }
        else if (dog.navigation === "dog-water") {
            dog.group.rotation.y = Math.PI / 2;
            dog.mode = "drinking";
            dog.modeUntil = seconds + 7.5;
        }
        else {
            dog.mode = "idle";
            dog.modeUntil = seconds + 2.5 + dog.random() * 4.5;
        }
        animateRottweilerPose(dog, seconds, delta, false, false);
        return;
    }
    const targetYaw = Math.atan2(dx, dz);
    const yawDelta = Math.atan2(Math.sin(targetYaw - dog.group.rotation.y),
        Math.cos(targetYaw - dog.group.rotation.y));
    dog.group.rotation.y += yawDelta * Math.min(1, delta * (running ? 5.0 : 3.5));
    const speed = running ? 2.05 : 0.82;
    const nextX = dog.group.position.x + Math.sin(dog.group.rotation.y) * speed * delta;
    const nextZ = dog.group.position.z + Math.cos(dog.group.rotation.y) * speed * delta;
    if (dogCanStandAt(nextX, nextZ, true)) {
        dog.group.position.x = nextX;
        dog.group.position.z = nextZ;
        dog.travelled += speed * delta;
    }
    else {
        startNextDogActivity(dog, seconds);
    }
    if (seconds >= dog.nextCasualBarkAt && dog.navigation === "patrol") {
        dog.nextCasualBarkAt = seconds + 42 + dog.random() * 34;
        dog.mode = "barking";
        dog.modeUntil = seconds + 1.6;
        playDogBark(false);
    }
    animateRottweilerPose(dog, seconds, delta, true, running);
}

function distanceToPastureBoundary(x, z) {
    let nearest = Infinity;
    CAMEL_PASTURE_BOUNDARY.forEach((start, index) => {
        const end = CAMEL_PASTURE_BOUNDARY[(index + 1) % CAMEL_PASTURE_BOUNDARY.length];
        const dx = end[0] - start[0];
        const dz = end[1] - start[1];
        const lengthSquared = dx * dx + dz * dz;
        const progress = lengthSquared > 0 ? THREE.MathUtils.clamp(
            ((x - start[0]) * dx + (z - start[1]) * dz) / lengthSquared, 0, 1
        ) : 0;
        nearest = Math.min(nearest, Math.hypot(
            x - (start[0] + dx * progress),
            z - (start[1] + dz * progress)
        ));
    });
    return nearest;
}

function camelCanStandAt(x, z, clearance = 0) {
    return pointInPolygon(x, z, CAMEL_PASTURE_BOUNDARY) &&
        distanceToPastureBoundary(x, z) >= clearance &&
        !animalCareStationBlocksAnimal(x, z, 0.36);
}

function camelPathIsClear(startX, startZ, endX, endZ, clearance = 0.30) {
    const distance = Math.hypot(endX - startX, endZ - startZ);
    const steps = Math.max(1, Math.ceil(distance / 0.28));
    for (let step = 1; step <= steps; step += 1) {
        const progress = step / steps;
        if (!camelCanStandAt(
            THREE.MathUtils.lerp(startX, endX, progress),
            THREE.MathUtils.lerp(startZ, endZ, progress),
            clearance
        ))
            return false;
    }
    return true;
}

function chooseCamelRescuePoint(camel) {
    const origin = camel.group.position;
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const angle = camel.random() * Math.PI * 2;
        const radius = 1.6 + camel.random() * 4.4;
        const x = origin.x + Math.sin(angle) * radius;
        const z = origin.z + Math.cos(angle) * radius;
        if (camelCanStandAt(x, z, 0.70) &&
            camelPathIsClear(origin.x, origin.z, x, z, 0.22))
            return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(-15.2, 0, -5.0);
}

function camelCareTarget(kind, camel) {
    const stations = CAMEL_CARE_STATIONS[kind];
    // Gerade/ungerade Tiernummern erhalten eine feste Stationszuordnung.
    // Dadurch wechseln nicht alle Kamele gleichzeitig zur selben Raufe.
    const stationIndex = (camel.index ?? 0) % stations.length;
    const station = stations[stationIndex];
    // Die Soll-Herdengröße wird auch während des schrittweisen Erzeugens der
    // Modelle verwendet. Dadurch sind schon die allerersten Ziele korrekt
    // verteilt und kein Tier startet vorübergehend auf demselben Standplatz.
    const groupMembers = Array.from({ length: CAMEL_HERD_SIZE }, (_, index) => ({ index }))
        .filter((member) => member.index % stations.length === stationIndex);
    const memberIndex = Math.max(0,
        groupMembers.findIndex((member) => member.index === (camel.index ?? 0)));
    const centeredSlot = memberIndex - (groupMembers.length - 1) / 2;
    const slotOffset = centeredSlot * CAMEL_CARE_SLOT_SPACING;
    return {
        point: new THREE.Vector3(
            station.target[0] + station.slotAxis[0] * slotOffset,
            0,
            station.target[1] + station.slotAxis[1] * slotOffset
        ),
        // Am Ziel schaut das Kamel wirklich zur Raufe bzw. Tränke. Erst diese
        // eindeutige Ausrichtung macht die Fress-/Trinkpose gut erkennbar.
        facingPoint: new THREE.Vector3(station.model[0], 0, station.model[2]),
        resourceKey: station.resourceKey
    };
}

function chooseCamelTarget(camel) {
    const random = camel.random;
    const careChoice = random();
    const waterTarget = camelCareTarget("water", camel);
    const hayTarget = camelCareTarget("hay", camel);
    // Auch bei gefuellten Vorraeten fuehrt deutlich mehr als die Haelfte der
    // Wege an eine echte Versorgungsstation; bei knappen Vorraeten noch mehr.
    const waterUrgency = animalResources[waterTarget.resourceKey] < 28 ? 0.62 : 0.34;
    const hayUrgency = animalResources[hayTarget.resourceKey] < 28 ? 0.91 : 0.68;
    if (careChoice < waterUrgency) {
        return { ...waterTarget, intent: "drinking" };
    }
    if (careChoice < hayUrgency) {
        return { ...hayTarget, intent: "feeding" };
    }
    if (horse && random() < 0.12) {
        return {
            point: new THREE.Vector3(-12.38, 0, THREE.MathUtils.clamp(horse.group.position.z, -5.5, 0.6)),
            intent: "meeting"
        };
    }
    // Ein großer Teil der freien Wege führt bis hinter die Pergola an die
    // Straßenseite. Dadurch verteilt sich die Herde über die komplette Weide
    // und steht nicht gesammelt an Tränke und Heuraufe.
    if (random() < 0.56) {
        for (let attempt = 0; attempt < 60; attempt += 1) {
            const x = -19.70 + random() * 26.35;
            const z = -18.75 + random() * 7.70;
            if (camelCanStandAt(x, z, 0.70))
                return {
                    point: new THREE.Vector3(x, 0, z),
                    intent: random() < 0.82 ? "grazing" : "idle"
                };
        }
    }
    for (let attempt = 0; attempt < 90; attempt += 1) {
        const x = -20.00 + random() * 26.75;
        const z = -18.85 + random() * 31.55;
        if (camelCanStandAt(x, z, 0.70)) {
            return {
                point: new THREE.Vector3(x, 0, z),
                intent: random() < 0.76 ? "grazing" : "idle"
            };
        }
    }
    return { point: new THREE.Vector3(-15.2, 0, 0), intent: "grazing" };
}

function createBactrianCamel(index) {
    const random = seededNoise(8800 + index * 401);
    const group = new THREE.Group();
    group.position.set(-15.8 + (index % 3) * 1.45, 0, -7.4 + Math.floor(index / 3) * 3.0 + random());
    const scale = [0.82, 0.96, 1.08, 0.90, 1.14][index];
    group.scale.setScalar(scale);
    group.userData.assetLoaded = false;
    world.add(group);
    const loadingRig = new THREE.Group();
    loadingRig.name = "Unsichtbares Kamel-Lade-Rig";
    group.add(loadingRig);

    // Die alten, aus Kugeln und Zylindern gebauten Kamele werden nicht mehr
    // erzeugt. Diese leeren Gruppen halten lediglich die Animationszustände
    // stabil, bis das einzige sichtbare GLB-Modell geladen ist.
    const body = new THREE.Group();
    loadingRig.add(body);
    const neckRig = new THREE.Group();
    neckRig.position.set(0, 1.52, 0.82);
    loadingRig.add(neckRig);
    const legs = [];
    const tail = new THREE.Group();
    tail.position.set(0, 1.46, -0.92);
    loadingRig.add(tail);
    // Schon kurz nach dem Laden sind Tiere an beiden Stationstypen zu sehen:
    // zwei starten zur Raufe, zwei zur Tränke, nur das fünfte streift frei.
    let firstTarget;
    if (index < 4) {
        const kind = index % 2 === 0 ? "hay" : "water";
        const careTarget = camelCareTarget(kind, { random, index });
        firstTarget = {
            ...careTarget,
            intent: kind === "hay" ? "feeding" : "drinking"
        };
    }
    else
        firstTarget = chooseCamelTarget({ random, index });
    return {
        index,
        group,
        body,
        neckRig,
        legs,
        tail,
        random,
        // Jedes Tier frisst und trinkt sichtbar unterschiedlich lange. Die
        // persistenten Stationsraten auf dem Server berücksichtigen dieselbe
        // feste Verteilung (drei Tiere am Pool, zwei an der Pergola).
        hayAppetite: [1.16, 0.82, 0.94, 1.08, 1.28][index],
        waterAppetite: [0.86, 1.22, 1.04, 0.92, 1.17][index],
        target: firstTarget.point,
        intent: firstTarget.intent,
        resourceKey: firstTarget.resourceKey || null,
        mode: "walking",
        modeUntil: 0,
        travelled: 0,
        // Die erste sichtbare Tieraktion erfolgt schon waehrend einer normalen
        // Sitzung; danach bleibt es beim ungefaehr stuendlichen Rhythmus.
        nextDroppingAt: animalDemoMode ? 6 + index * 4 : 300 + index * 130 + random() * 160,
        nextUrinationAt: animalDemoMode ? 16 + index * 4 : 210 + index * 95 + random() * 180,
        nextCallAt: animalDemoMode ? 10 + index * 5 : 75 + index * 58 + random() * 260,
        nextRestAt: animalDemoMode ? 14 + index * 4 : 90 + index * 52 + random() * 120,
        callingUntil: 0,
        restBlend: 0,
        restTransitionStarted: 0,
        restEndsAt: 0,
        herdRestId: 0,
        restGroundDrop: 1.19 * scale,
        elapsedSeconds: 0,
        modelRoot: null,
        mixer: null,
        idleAction: null,
        walkRig: [],
        gaitBlend: 0,
        detailedTailRig: [],
        feedingRig: [],
        facingPoint: firstTarget.facingPoint || null,
        elimination: null,
        stuckFor: 0,
        lastProgressPosition: group.position.clone()
    };
}

function tuneCamelMaterials(model, camelIndex) {
    const coatTints = [0xb08b65, 0xc4a176, 0x8c694d, 0xd0b486, 0x9f7654];
    model.traverse((object) => {
        if (!object.isMesh)
            return;
        object.castShadow = renderProfile.minorShadows;
        object.receiveShadow = true;
        const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
        const tuned = sourceMaterials.map((source) => {
            const material = source.clone();
            // Die Originaltextur bleibt vollständig sichtbar; eine leichte
            // Tönung unterscheidet die fünf Tiere wie in einer echten Herde.
            material.color.multiply(new THREE.Color(coatTints[camelIndex]));
            material.roughness = Math.max(0.68, material.roughness ?? 0.72);
            material.metalness = 0;
            material.needsUpdate = true;
            return material;
        });
        object.material = Array.isArray(object.material) ? tuned : tuned[0];
    });
}

function createCamelWalkRig(model) {
    // Kamele laufen im Passgang: Vorder- und Hinterbein derselben Seite
    // schwingen gemeinsam, die gegenüberliegende Seite folgt eine halbe
    // Schrittphase später. Das Quellmodell enthält alle benötigten Knochen,
    // aber nur eine Standanimation – deshalb wird der Gang hier ergänzt.
    const limbDefinitions = [
        {
            phase: 0,
            mirrorSign: 1,
            front: true,
            upper: "Shoulder_L_31",
            lower: "Elbow_L_30",
            foot: "Wrist_L_29",
            upperScale: 1,
        },
        {
            phase: 0,
            mirrorSign: 1,
            front: false,
            upper: "Hip_L_49",
            lower: "Knee_L_48",
            foot: "Ankle_L_47",
            upperScale: 0.88,
        },
        {
            phase: Math.PI,
            mirrorSign: -1,
            front: true,
            upper: "Shoulder_R_39",
            lower: "Elbow_R_38",
            foot: "Wrist_R_37",
            upperScale: 1,
        },
        {
            phase: Math.PI,
            mirrorSign: -1,
            front: false,
            upper: "Hip_R_8",
            lower: "Knee_R_7",
            foot: "Ankle_R_6",
            upperScale: 0.88,
        },
    ];
    return limbDefinitions.map((definition) => {
        const upper = model.getObjectByName(definition.upper);
        const lower = model.getObjectByName(definition.lower);
        const foot = model.getObjectByName(definition.foot);
        if (!upper || !lower || !foot)
            return null;
        return {
            ...definition,
            upper,
            lower,
            foot,
            upperRest: upper.quaternion.clone(),
            lowerRest: lower.quaternion.clone(),
            footRest: foot.quaternion.clone(),
        };
    }).filter(Boolean);
}

function createCamelTailRig(model) {
    // Das geladene Modell besitzt eine siebenknochige Schwanzkette. Wir
    // speichern die Grundpose, damit jedes Tier unabhängig und ohne Drift
    // wedeln kann. Der prozedurale Platzhalter nutzt seinen eigenen Tail-Rig.
    return ["Tail0_M_56", "Tail1_M_55", "Tail2_M_54", "Tail3_M_53",
        "Tail4_M_52", "Tail5_M_51", "Tail6_M_50"].map((name, index) => {
        const joint = model.getObjectByName(name);
        return joint ? { joint, rest: joint.quaternion.clone(), index } : null;
    }).filter(Boolean);
}

function createCamelFeedingRig(model) {
    const bend = [0.52, 0.44, 0.36, 0.27, 0.16, -0.12];
    return ["Neck_M_24", "Neck1_M_23", "Neck2_M_22", "Neck3_M_21",
        "Neck4_M_20", "Head_M_19"].map((name, index) => {
        const joint = model.getObjectByName(name);
        return joint ? { joint, rest: joint.quaternion.clone(), bend: bend[index] } : null;
    }).filter(Boolean);
}

function poseDetailedCamelHead(camel, mode, seconds) {
    if (!camel.feedingRig?.length)
        return;
    const intensity = mode === "grazing" ? 1.16 :
        mode === "drinking" ? 1.00 : mode === "feeding" ? 0.82 :
            mode === "calling" ? -0.22 : 0;
    const nibble = intensity !== 0 ? Math.sin(seconds * (mode === "calling" ? 4.4 : 2.1) + camel.index) *
        (mode === "calling" ? 0.065 : 0.035) : 0;
    camel.feedingRig.forEach((segment, index) => {
        camelTailRotation.setFromAxisAngle(camelTailAxis,
            segment.bend * intensity + nibble * (1 - index / 10));
        segment.joint.quaternion.copy(segment.rest).multiply(camelTailRotation);
    });
}

const camelGaitAxis = new THREE.Vector3(0, 0, 1);
const camelGaitRotation = new THREE.Quaternion();

function poseCamelJoint(joint, restQuaternion, angle) {
    camelGaitRotation.setFromAxisAngle(camelGaitAxis, angle);
    joint.quaternion.copy(restQuaternion).multiply(camelGaitRotation);
}

function animateDetailedCamelGait(camel, moving, running, delta) {
    if (!camel.walkRig?.length)
        return;
    camel.gaitBlend = THREE.MathUtils.damp(
        camel.gaitBlend || 0,
        moving ? 1 : 0,
        moving ? 7 : 4,
        delta
    );
    const phase = camel.travelled * (running ? 8.6 : 7.2) + camel.index * 0.18;
    const stride = (running ? 0.42 : 0.27) * camel.gaitBlend;
    camel.walkRig.forEach((limb) => {
        const cycle = phase + limb.phase;
        const swing = Math.sin(cycle);
        // Das untere Gelenk beugt hauptsächlich beim nach vorn geführten Bein;
        // der Fuß gleicht die Beugung aus und bleibt optisch am Boden.
        const lift = Math.max(0, Math.cos(cycle));
        // Die Gelenkachsen der rechten Körperseite sind im GLB gespiegelt.
        // Ohne dieses Vorzeichen hebt die Achsenspiegelung den Phasenversatz
        // wieder auf und Vorder- bzw. Hinterbeine bewegen sich fälschlich paarweise.
        const jointSign = limb.mirrorSign;
        poseCamelJoint(limb.upper, limb.upperRest,
            swing * stride * limb.upperScale * jointSign);
        poseCamelJoint(limb.lower, limb.lowerRest,
            -lift * stride * (running ? 0.92 : 0.72) * jointSign);
        poseCamelJoint(limb.foot, limb.footRest,
            lift * stride * (running ? 0.62 : 0.48) * jointSign);
    });
    const bob = Math.abs(Math.sin(phase * 2)) * (running ? 0.035 : 0.014) *
        camel.gaitBlend;
    camel.group.position.y = THREE.MathUtils.damp(camel.group.position.y, bob, 10, delta);
}

function camelRestStep(progress, start, end) {
    const normalized = THREE.MathUtils.clamp((progress - start) / Math.max(0.001, end - start), 0, 1);
    return normalized * normalized * (3 - 2 * normalized);
}

function animateCamelRestPose(camel, phase, seconds, delta) {
    const duration = phase === "rising" ? 4.8 : 5.2;
    const elapsed = Math.max(0, seconds - (camel.restTransitionStarted || seconds));
    const progress = THREE.MathUtils.clamp(elapsed / duration, 0, 1);
    let leftFront;
    let rightFront;
    let hind;
    let bodyDrop;
    if (phase === "resting") {
        leftFront = rightFront = hind = bodyDrop = 1;
    }
    else if (phase === "rising") {
        // Beim Aufstehen hebt das Kamel zuerst die Hinterhand. Die Vorderbeine
        // bleiben noch gefaltet, bis der Rumpf bereits deutlich oben ist.
        hind = 1 - camelRestStep(progress, 0.00, 0.34);
        bodyDrop = 1 - camelRestStep(progress, 0.04, 0.48);
        rightFront = 1 - camelRestStep(progress, 0.42, 0.88);
        leftFront = 1 - camelRestStep(progress, 0.52, 1.00);
    }
    else {
        // Hinlegen in natürlicher Reihenfolge: erst ein Vorderknie, leicht
        // versetzt das zweite, dann Hinterbeine und zuletzt Brust/Bauch.
        leftFront = camelRestStep(progress, 0.02, 0.32);
        rightFront = camelRestStep(progress, 0.10, 0.40);
        hind = camelRestStep(progress, 0.28, 0.68);
        bodyDrop = camelRestStep(progress, 0.36, 0.90);
    }
    camel.restBlend = bodyDrop;
    // Der Rumpf wird so weit abgesenkt, dass Brust und Bauch auf dem Boden
    // aufliegen. Dieser Wert ist pro Tier skaliert und verhindert sowohl
    // Schweben als auch Einsinken der verschieden großen Kamele.
    camel.group.position.y = THREE.MathUtils.damp(
        camel.group.position.y,
        -camel.restGroundDrop * bodyDrop,
        7.5,
        delta
    );
    if (!camel.modelRoot) {
        camel.legs.forEach((leg, index) => {
            const front = index < 2;
            const side = index % 2 ? -1 : 1;
            const fold = front ? (index % 2 ? rightFront : leftFront) : hind;
            leg.rotation.x = THREE.MathUtils.damp(
                leg.rotation.x,
                (front ? 1.08 : -1.02) * side * fold,
                5,
                delta
            );
        });
        camel.body.rotation.x = THREE.MathUtils.damp(camel.body.rotation.x, 0.06 * bodyDrop, 4, delta);
        camel.neckRig.rotation.x = THREE.MathUtils.damp(camel.neckRig.rotation.x, 0.22 * bodyDrop, 4, delta);
        return;
    }
    camel.gaitBlend = THREE.MathUtils.damp(camel.gaitBlend || 0, 0, 5, delta);
    camel.walkRig.forEach((limb) => {
        const sign = limb.mirrorSign;
        const fold = limb.front ? (sign > 0 ? leftFront : rightFront) : hind;
        // Vorderbeine werden unter die Brust, Hinterbeine unter den Bauch
        // gefaltet. Beide Vorderknie folgen bewusst leicht zeitversetzt.
        const upper = (limb.front ? 1.34 : -1.50) * sign * fold;
        const lower = (limb.front ? -2.28 : 2.42) * sign * fold;
        const foot = (limb.front ? 1.12 : -1.24) * sign * fold;
        poseCamelJoint(limb.upper, limb.upperRest, upper);
        poseCamelJoint(limb.lower, limb.lowerRest, lower);
        poseCamelJoint(limb.foot, limb.footRest, foot);
    });
    // Im Liegen bleibt der lange Hals aufrecht; die Fresspose wuerde den Kopf
    // unnatuerlich bis zum Boden ziehen.
    poseDetailedCamelHead(camel, "idle", camel.elapsedSeconds);
}

const camelTailAxis = new THREE.Vector3(0, 0, 1);
const camelTailRotation = new THREE.Quaternion();

function animateCamelTail(camel, seconds) {
    // Unterschiedliche Phasen verhindern synchrones, mechanisches Wedeln.
    // Beim Laufen ist der Ausschlag etwas kräftiger; im Stand sorgen zwei
    // überlagerte Frequenzen für die typischen unregelmäßigen Fliegen-Schläge.
    const moving = camel.mode === "walking" || camel.mode === "running";
    const phase = seconds * (moving ? 5.8 : 3.4) + camel.index * 1.37;
    const flyFlick = Math.pow(Math.max(0, Math.sin(seconds * 1.08 + camel.index * 2.11)), 10);
    const swing = Math.sin(phase) * (moving ? 0.20 : 0.13) +
        Math.sin(phase * 2.31 + camel.index) * 0.045 + flyFlick * 0.22;
    const eliminationLift = camel.mode === "defecating" ? 0.48 :
        camel.mode === "urinating" ? 0.34 : 0;
    if (!camel.modelRoot) {
        camel.tail.rotation.z = swing;
        camel.tail.rotation.x = -eliminationLift;
        return;
    }
    camel.detailedTailRig.forEach((segment) => {
        const segmentSwing = swing * (0.42 + segment.index * 0.10) +
            Math.sin(phase - segment.index * 0.34) * 0.025 * segment.index +
            eliminationLift * Math.max(0.24, 1 - segment.index * 0.10);
        camelTailRotation.setFromAxisAngle(camelTailAxis, segmentSwing);
        segment.joint.quaternion.copy(segment.rest).multiply(camelTailRotation);
    });
}

function loadDetailedCamels() {
    vehicleLoader.load("/static/models/bactrian-camel.glb?v=82", (gltf) => {
        const source = gltf.scene;
        // Das Sketchfab-Modell blickt bereits entlang der positiven lokalen
        // Z-Achse. Die frühere 180-Grad-Drehung ließ es rückwärts laufen.
        source.rotation.y = 0;
        source.updateMatrixWorld(true);
        let bounds = new THREE.Box3().setFromObject(source);
        const size = bounds.getSize(new THREE.Vector3());
        source.scale.setScalar(2.16 / Math.max(size.y, 0.001));
        source.updateMatrixWorld(true);
        bounds = new THREE.Box3().setFromObject(source);
        const center = bounds.getCenter(new THREE.Vector3());
        source.position.set(-center.x, -bounds.min.y, -center.z);

        camelHerd.forEach((camel) => {
            const model = cloneSkeleton(source);
            model.name = `Bactrian Camel ${camel.index + 1}`;
            tuneCamelMaterials(model, camel.index);
            camel.group.add(model);
            camel.modelRoot = model;
            camel.group.userData.assetLoaded = true;
            camel.walkRig = createCamelWalkRig(model);
            camel.detailedTailRig = createCamelTailRig(model);
            camel.feedingRig = createCamelFeedingRig(model);
            camel.mixer = new THREE.AnimationMixer(model);
            const idleClip = gltf.animations.find((clip) => clip.name === "Bactrian_Camel_Idle") ||
                gltf.animations[0];
            if (idleClip) {
                camel.idleAction = camel.mixer.clipAction(idleClip);
                camel.idleAction.setLoop(THREE.LoopRepeat, Infinity).play();
            }
        });
    }, undefined, () => {
        camelHerd.forEach((camel) => {
            // Kein altes Ersatzkamel erzeugen. Beim nächsten Laden wird nur das
            // detaillierte Herdenmodell erneut angefordert.
            camel.group.userData.assetLoaded = false;
        });
    });
}

function createCamelPasture() {
    for (let index = 0; index < CAMEL_HERD_SIZE; index += 1)
        camelHerd.push(createBactrianCamel(index));
    loadDetailedCamels();
}

// 22 klar unterscheidbare Arten, davon 20 heimische Garten-/Feldvögel. Das
// sehr leichte Tauben-Rig ist vom Autor ausdrücklich zum Skalieren und
// Neutexturieren für weitere Arten vorgesehen und besitzt Start, Schlagflug,
// Gleitflug, Landung und Stand. Wasservögel nutzen ihr eigenes Lauf-/Flug-Rig.
// So bleibt die Artenvielfalt auch auf dem iPhone performant, ohne gleitende
// Bodenmodelle oder fliegende Standposen.
const BIRD_VISITOR_CONFIGS = [
    { name: "Haussperling", model: "sparrow", length: 0.15, tint: 0x8b7259, tintStrength: 0.46,
        morph: [0.84, 0.78], accent: 0x5d4536, feedBias: 0.94, poolBias: 0.12, pastureBias: 0.34,
        voice: "chirp", song: [2650, 2920, 2520, 3150] },
    { name: "Feldsperling", model: "sparrow", length: 0.14, tint: 0x9a7652, tintStrength: 0.48,
        morph: [0.82, 0.77], accent: 0x5a3328, feedBias: 0.94, poolBias: 0.10, pastureBias: 0.62,
        voice: "chirp", song: [2780, 3180, 2860, 3350] },
    { name: "Rotkehlchen", model: "pigeon", length: 0.14, tint: 0x75685c, tintStrength: 0.55,
        morph: [0.80, 0.75], accent: 0xd96835, feedBias: 0.90, poolBias: 0.14, pastureBias: 0.30,
        voice: "warble", song: [2350, 3100, 3850, 2980, 4200] },
    { name: "Kohlmeise", model: "pigeon", length: 0.14, tint: 0x85863f, tintStrength: 0.64,
        morph: [0.78, 0.72], accent: 0xe0c94f, feedBias: 0.92, poolBias: 0.12, pastureBias: 0.22,
        voice: "double", song: [3050, 2470, 3050, 2470] },
    { name: "Blaumeise", model: "pigeon", length: 0.12, tint: 0x6f8ba0, tintStrength: 0.64,
        morph: [0.76, 0.70], accent: 0xe6d16b, feedBias: 0.90, poolBias: 0.10, pastureBias: 0.18,
        voice: "trill", song: [3600, 4100, 4550, 4300, 4700] },
    { name: "Buchfink", model: "pigeon", length: 0.15, tint: 0xa36d59, tintStrength: 0.60,
        morph: [0.82, 0.80], accent: 0x6d8796, feedBias: 0.92, poolBias: 0.12, pastureBias: 0.44,
        voice: "cascade", song: [3100, 2950, 2700, 2450, 2200] },
    { name: "Grünfink", model: "pigeon", length: 0.15, tint: 0x7d8b42, tintStrength: 0.68,
        morph: [0.86, 0.82], accent: 0xc7b943, feedBias: 0.94, poolBias: 0.11, pastureBias: 0.48,
        voice: "trill", song: [2750, 2920, 3100, 2800] },
    { name: "Stieglitz", model: "pigeon", length: 0.13, tint: 0xc6ad5a, tintStrength: 0.62,
        morph: [0.78, 0.75], accent: 0xb8322d, feedBias: 0.96, poolBias: 0.10, pastureBias: 0.58,
        voice: "trill", song: [3500, 3900, 3700, 4300, 4100] },
    { name: "Star", model: "pigeon", length: 0.22, tint: 0x273d3e, tintStrength: 0.78,
        morph: [0.78, 0.92], accent: 0x577966, feedBias: 0.90, poolBias: 0.14, pastureBias: 0.56,
        voice: "mimic", song: [1850, 2600, 3350, 2250, 3700], seasons: ["spring", "summer", "autumn"] },
    { name: "Amsel", model: "pigeon", length: 0.25, tint: 0x202326, tintStrength: 0.82,
        morph: [0.82, 1.04], accent: 0xe0a128, feedBias: 0.88, poolBias: 0.14, pastureBias: 0.28,
        voice: "flute", song: [1650, 1950, 2300, 1820, 2500] },
    { name: "Singdrossel", model: "pigeon", length: 0.23, tint: 0x806a54, tintStrength: 0.63,
        morph: [0.82, 1.00], accent: 0xc6aa80, feedBias: 0.90, poolBias: 0.13, pastureBias: 0.36,
        voice: "repeat", song: [1950, 2400, 1950, 2700, 2400] },
    { name: "Bachstelze", model: "pigeon", length: 0.19, tint: 0x6d7478, tintStrength: 0.68,
        morph: [0.70, 1.18], accent: 0xe4e5e1, feedBias: 0.86, poolBias: 0.28, pastureBias: 0.62,
        voice: "chirp", song: [2800, 3300, 2920] },
    { name: "Hausrotschwanz", model: "pigeon", length: 0.15, tint: 0x5b5654, tintStrength: 0.72,
        morph: [0.76, 0.94], accent: 0xb85b35, feedBias: 0.84, poolBias: 0.11, pastureBias: 0.26,
        voice: "scratch", song: [2300, 2850, 2050, 3100], seasons: ["spring", "summer", "autumn"] },
    { name: "Zaunkönig", model: "sparrow", length: 0.10, tint: 0x765039, tintStrength: 0.60,
        morph: [0.92, 0.62], accent: 0x9f724c, feedBias: 0.94, poolBias: 0.09, pastureBias: 0.18,
        voice: "trill", song: [4100, 4550, 4300, 4800, 4450] },
    { name: "Elster", model: "pigeon", length: 0.45, tint: 0x222f34, tintStrength: 0.80,
        morph: [0.74, 1.42], accent: 0xe8e9e2, feedBias: 0.82, poolBias: 0.12, pastureBias: 0.52,
        voice: "chatter", song: [1250, 1480, 1120, 1580] },
    { name: "Rabenkrähe", model: "pigeon", length: 0.48, tint: 0x171b20, tintStrength: 0.88,
        morph: [0.92, 1.24], accent: 0x2c333b, feedBias: 0.84, poolBias: 0.12, pastureBias: 0.58,
        voice: "caw", song: [620, 560, 610] },
    { name: "Eichelhäher", model: "pigeon", length: 0.34, tint: 0x9c765e, tintStrength: 0.62,
        morph: [0.86, 1.08], accent: 0x4d87b4, feedBias: 0.86, poolBias: 0.10, pastureBias: 0.50,
        voice: "rasp", song: [980, 1260, 920, 1180] },
    { name: "Buntspecht", model: "pigeon", length: 0.23, tint: 0x33363a, tintStrength: 0.78,
        morph: [0.72, 1.06], accent: 0xb92d2b, feedBias: 0.74, poolBias: 0.08, pastureBias: 0.18,
        voice: "drum", song: [2050, 2250, 2450, 2700, 2920] },
    // Das gemeinsame Tauben-Rig wirkt durch seinen breiten Rumpf optisch
    // groesser als seine reine Laengenangabe. Deshalb etwas kleiner als das
    // Naturmass skalieren, damit es neben Pferd, Kamelen und Autos stimmig ist.
    { name: "Ringeltaube", model: "pigeon", length: 0.36, tint: 0x707982, tintStrength: 0.52,
        morph: [1.04, 1.02], accent: 0xdadccf, feedBias: 0.82, poolBias: 0.14, pastureBias: 0.46,
        voice: "coo", song: [510, 440, 480, 420] },
    { name: "Türkentaube", model: "pigeon", length: 0.28, tint: 0xb4aa99, tintStrength: 0.56,
        morph: [0.90, 0.96], accent: 0x524f4c, feedBias: 0.84, poolBias: 0.18, pastureBias: 0.28,
        voice: "coo", song: [580, 500, 550] },
    { name: "Teichhuhn", model: "swamphen", length: 0.35, tint: 0x414b4b, tintStrength: 0.38,
        morph: [0.90, 0.92], accent: 0xb43b2e, feedBias: 0.74, poolBias: 0.82, pastureBias: 0.66,
        voice: "rail", song: [1050, 880, 1180, 960] },
    { name: "Purpurhuhn", model: "swamphen", length: 0.49, tint: 0x435f82, tintStrength: 0.34,
        morph: [1.02, 1.02], accent: 0xc34731, feedBias: 0.68, poolBias: 0.86, pastureBias: 0.76,
        voice: "rail", song: [820, 960, 740, 1080] }
];

const BIRD_MODEL_FILES = Object.freeze({
    pigeon: "/static/models/bird-pigeon-animated.glb?v=100",
    sparrow: "/static/models/bird-sparrow-quirky.glb?v=106",
    swamphen: "/static/models/bird-swamphen.glb?v=100"
});

function tuneBirdModel(model, config) {
    const tint = new THREE.Color(config.tint);
    model.traverse((object) => {
        if (!object.isMesh)
            return;
        object.castShadow = renderProfile.minorShadows;
        object.receiveShadow = renderProfile.minorShadows;
        const sources = Array.isArray(object.material) ? object.material : [object.material];
        const materials = sources.map((source) => {
            const material = source.clone();
            material.color.lerp(tint, config.tintStrength ??
                (config.model === "pigeon" ? 0.52 : 0.24));
            material.roughness = Math.max(0.62, material.roughness ?? 0.68);
            material.metalness = 0;
            material.needsUpdate = true;
            return material;
        });
        object.material = Array.isArray(object.material) ? materials : materials[0];
    });
}

function createBirdPlumageDetails(group, config, renderedSize) {
    if (config.accent == null)
        return;
    const length = config.length;
    const height = Math.max(length * 0.62, renderedSize?.y || 0);
    const accent = new THREE.MeshStandardMaterial({
        color: config.accent,
        roughness: 0.86,
        transparent: true,
        opacity: 0.92,
        depthWrite: true
    });
    const chest = addMesh(group, new THREE.SphereGeometry(1, 12, 8), accent,
        0, height * 0.55, length * 0.20, { castShadow: false });
    chest.scale.set(length * 0.17, height * 0.19, length * 0.065);
    if (config.model !== "pigeon")
        return;
    const cap = addMesh(group, new THREE.SphereGeometry(1, 10, 7), accent,
        0, height * 0.77, length * 0.18, { castShadow: false });
    cap.scale.set(length * 0.15, height * 0.085, length * 0.10);
    [-1, 1].forEach((side) => {
        const wingPatch = addMesh(group, new THREE.SphereGeometry(1, 10, 7), accent,
            side * length * 0.19, height * 0.53, -length * 0.015,
            { castShadow: false });
        wingPatch.scale.set(length * 0.045, height * 0.105, length * 0.18);
        wingPatch.rotation.z = side * 0.16;
    });
}

function birdPoolTarget(bird) {
    const localChoices = [
        [-0.72, 0.98, -1.82], [0.66, 0.98, -1.78],
        [-0.78, 0.98, 1.80], [0.74, 0.98, 1.78]
    ];
    const local = localChoices[Math.floor(bird.random() * localChoices.length)];
    const point = new THREE.Vector3(...local);
    point.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(-60));
    point.add(new THREE.Vector3(-7.19, 0, -5.92));
    return { point, activity: "drinking-pool", pasture: false };
}

function birdTroughTarget(bird) {
    const stations = CAMEL_CARE_STATIONS.water;
    const station = stations[Math.floor(bird.random() * stations.length)];
    const side = bird.random() < 0.5 ? -1 : 1;
    return {
        point: new THREE.Vector3(
            station.model[0] + Math.cos(station.rotation) * side * 0.38,
            0.58,
            station.model[2] - Math.sin(station.rotation) * side * 0.38
        ),
        activity: "drinking-trough",
        pasture: true,
        resourceKey: station.resourceKey
    };
}

function birdGrassTarget(bird) {
    let choices = grassCells.filter((cell) =>
        cell.pasture === (bird.random() < bird.config.pastureBias));
    if (!choices.length)
        choices = grassCells;
    const cell = choices[Math.floor(bird.random() * choices.length)];
    if (!cell)
        return { point: new THREE.Vector3(-9, 0.04, -8), activity: "feeding", pasture: false };
    return {
        point: new THREE.Vector3(
            cell.x + (bird.random() - 0.5) * 0.55,
            0.045,
            cell.z + (bird.random() - 0.5) * 0.55
        ),
        activity: "feeding",
        pasture: cell.pasture
    };
}

function chooseBirdActivityTarget(bird) {
    if (bird.random() < bird.config.feedBias)
        return birdGrassTarget(bird);
    return bird.random() < bird.config.poolBias ? birdPoolTarget(bird) : birdTroughTarget(bird);
}

function birdSkyPoint(bird, opposite = false) {
    const side = (bird.index % 4 + (opposite ? 2 : 0)) % 4;
    const spread = (bird.random() - 0.5) * 13;
    const height = 6.5 + bird.random() * 5.5;
    if (side === 0)
        return new THREE.Vector3(-22, height, spread);
    if (side === 1)
        return new THREE.Vector3(22, height, spread);
    if (side === 2)
        return new THREE.Vector3(spread, height, -22);
    return new THREE.Vector3(spread, height, 22);
}

function playBirdSong(bird) {
    if (!animalSoundsEnabled)
        return 0;
    // Kurze Ausschnitte einer echten Gartenaufnahme sind auf iOS gut hörbar
    // und klingen natürlicher als reine Sinus-/Rechteck-Oszillatoren.
    if (playAnimalSound("bird", 0.72)) {
        birdSongPlayCount += 1;
        return 6.2;
    }
    // Während der echte Ausschnitt läuft, keinen zweiten synthetischen Vogel
    // darüberlegen. Nach Ablauf darf der bisherige Generator als Fallback
    // weiterhin die unterschiedlichen Artenstimmen andeuten.
    if (animalSoundsUnlocked && performance.now() * 0.001 - animalSoundLastPlayed.bird < 7.4)
        return 0;
    if (!birdAudioContext || birdAudioContext.state !== "running")
        return 0;
    const now = birdAudioContext.currentTime;
    const notes = bird.config.song;
    const voice = bird.config.voice || "chirp";
    const profiles = {
        coo: { type: "sine", spacing: 0.24, note: 0.28, volume: 0.034, glide: 0.92 },
        caw: { type: "sawtooth", spacing: 0.28, note: 0.24, volume: 0.030, glide: 0.74 },
        rasp: { type: "square", spacing: 0.19, note: 0.16, volume: 0.021, glide: 0.82 },
        rail: { type: "square", spacing: 0.15, note: 0.13, volume: 0.021, glide: 1.16 },
        drum: { type: "triangle", spacing: 0.055, note: 0.05, volume: 0.024, glide: 0.98 },
        trill: { type: "sine", spacing: 0.075, note: 0.07, volume: 0.026, glide: 1.08 },
        chatter: { type: "square", spacing: 0.09, note: 0.075, volume: 0.021, glide: 0.88 },
        flute: { type: "sine", spacing: 0.22, note: 0.19, volume: 0.030, glide: 1.12 },
        warble: { type: "sine", spacing: 0.13, note: 0.115, volume: 0.027, glide: 1.18 },
        cascade: { type: "triangle", spacing: 0.10, note: 0.09, volume: 0.026, glide: 0.91 },
        repeat: { type: "sine", spacing: 0.16, note: 0.14, volume: 0.026, glide: 1.06 },
        mimic: { type: "triangle", spacing: 0.12, note: 0.10, volume: 0.024, glide: 1.20 },
        scratch: { type: "sawtooth", spacing: 0.14, note: 0.11, volume: 0.020, glide: 0.80 },
        double: { type: "sine", spacing: 0.18, note: 0.13, volume: 0.028, glide: 1.04 },
        chirp: { type: "sine", spacing: 0.13, note: 0.11, volume: 0.027, glide: 1.12 }
    };
    const profile = profiles[voice] || profiles.chirp;
    const repeats = ["drum", "trill", "chatter"].includes(voice) ? 2 : 1;
    const eventCount = notes.length * repeats;
    const totalDuration = Math.max(0.45, eventCount * profile.spacing + profile.note + 0.08);
    const master = birdAudioContext.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(profile.volume, now + 0.025);
    master.gain.exponentialRampToValueAtTime(0.0001, now + totalDuration);
    const filter = birdAudioContext.createBiquadFilter();
    filter.type = voice === "caw" || voice === "coo" ? "lowpass" : "bandpass";
    filter.frequency.value = voice === "caw" || voice === "coo" ? 2200 : 3400;
    filter.Q.value = voice === "caw" ? 0.7 : 1.3;
    master.connect(filter).connect(birdAudioContext.destination);
    Array.from({ length: eventCount }).forEach((_, eventIndex) => {
        const frequency = notes[eventIndex % notes.length];
        const oscillator = birdAudioContext.createOscillator();
        const gain = birdAudioContext.createGain();
        const start = now + eventIndex * profile.spacing;
        oscillator.type = profile.type;
        oscillator.frequency.setValueAtTime(frequency * (0.96 + bird.random() * 0.08), start);
        oscillator.frequency.exponentialRampToValueAtTime(
            Math.max(80, frequency * profile.glide), start + profile.note);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.72, start + Math.min(0.018, profile.note * 0.28));
        gain.gain.exponentialRampToValueAtTime(0.0001, start + profile.note);
        oscillator.connect(gain).connect(master);
        oscillator.start(start);
        oscillator.stop(start + profile.note + 0.01);
    });
    birdSongPlayCount += 1;
    return totalDuration;
}

function birdClipByWords(animations, words) {
    return animations.find((clip) => {
        const name = clip.name.toLowerCase();
        return words.some((word) => name.includes(word));
    }) || null;
}

function createBirdActions(mixer, animations) {
    const clips = {
        fly: birdClipByWords(animations, ["flapping", "_fly", "flying", "fly"]),
        glide: birdClipByWords(animations, ["gliding", "glide"]),
        landing: birdClipByWords(animations, ["landing", "land"]),
        idle: birdClipByWords(animations, ["standing idle", "_pose", "idle"]),
        walking: birdClipByWords(animations, ["_walk", "walking", "walk"]),
        eat: birdClipByWords(animations, ["_eat", "eating", "eat"]),
        takeoff: birdClipByWords(animations, ["takeoff", "take_off"])
    };
    if (!clips.fly)
        clips.fly = animations[0] || null;
    if (!clips.idle)
        clips.idle = clips.walking || animations[0] || null;
    return Object.fromEntries(Object.entries(clips).map(([name, clip]) => {
        if (!clip)
            return [name, null];
        const action = mixer.clipAction(clip);
        if (["landing", "takeoff"].includes(name)) {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
        }
        else
            action.setLoop(THREE.LoopRepeat, Infinity);
        return [name, action];
    }));
}

function setBirdAnimation(bird, name, fade = 0.20) {
    const next = bird.actions[name] || bird.actions.idle || bird.actions.fly;
    if (!next || (bird.currentAction === next && next.isRunning()))
        return;
    if (bird.currentAction && bird.currentAction !== next)
        bird.currentAction.fadeOut(fade);
    next.enabled = true;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).fadeIn(fade).play();
    bird.currentAction = next;
    bird.currentActionName = name;
}

function birdAnimationDuration(bird, name) {
    const action = bird.actions[name];
    return action?.getClip()?.duration || 0.8;
}

function createGardenBird(config, index, gltf) {
    const random = seededNoise(12000 + index * 719);
    const group = new THREE.Group();
    group.name = config.name;
    group.visible = false;
    world.add(group);
    const model = cloneSkeleton(gltf.scene);
    tuneBirdModel(model, config);
    // Beide eingesetzten GLB-Rigs blicken im Ursprungsmodell entlang -Z. Die
    // Bewegungslogik richtet +Z zum Ziel aus; ohne diese Korrektur flogen vor
    // allem die dunklen Arten sichtbar mit dem Schwanz voraus.
    model.rotation.y = Math.PI;
    model.updateMatrixWorld(true);
    let bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const morph = config.morph || [1, 1];
    // Die Artenwerte sind reale Koerperlaengen (10 cm Zaunkoenig bis 49 cm
    // Purpurhuhn). An der laengsten waagerechten Modellachse zu skalieren ist
    // wesentlich stabiler als an der Hoehe und haelt Auto, Pferd und Kamele im
    // richtigen Groessenverhaeltnis.
    const modelLength = Math.max(size.x * morph[0], size.z * morph[1], 0.001);
    const baseScale = config.length / modelLength;
    model.scale.set(baseScale * morph[0], baseScale, baseScale * morph[1]);
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -bounds.min.y, -center.z);
    group.add(model);
    const renderedSize = bounds.getSize(new THREE.Vector3());
    createBirdPlumageDetails(group, config, renderedSize);
    const mixer = new THREE.AnimationMixer(model);
    const actions = createBirdActions(mixer, gltf.animations);
    const headRig = model.getObjectByName("DEF-head_08") ||
        model.getObjectByName("head") || model.getObjectByName("Head");
    const beakTop = model.getObjectByName("DEF-beak.001.T_0132") ||
        model.getObjectByName("DEF-beak.002.T_0133");
    const beakBottom = model.getObjectByName("DEF-beak_001.B_0134") ||
        model.getObjectByName("DEF-beak.002.B_0135");
    const bird = {
        index, config, random, group, model, mixer, actions,
        state: "away", target: new THREE.Vector3(), activity: "feeding",
        pasture: false, resourceKey: null, stateUntil: 0,
        // Die Besucher kommen weiterhin nacheinander, aber alle Arten koennen
        // innerhalb der ersten Minute sichtbar werden. Zuvor dauerte das bei
        // den hinteren Listeneintraegen ueber zweieinhalb Minuten.
        nextVisitAt: 2 + index * 1.8 + random() * 4,
        // In der lokalen Animationsvorschau erklingt der erste Ruf frueher,
        // damit Gesang und Schnabelbewegung ohne langes Warten pruefbar sind.
        nextSongAt: animalDemoMode ? 8 + index * 0.9 : 12 + index * 4 + random() * 24,
        visitsRemaining: 0, travelled: 0,
        currentAction: null, currentActionName: "",
        headRig,
        baseHeadRotationX: headRig?.rotation.x || 0,
        beakTop,
        beakBottom,
        manualHeadOffset: 0,
        manualBeakTopOffset: 0,
        manualBeakBottomOffset: 0,
        singingUntil: 0,
        pendingFlightState: null,
        pendingTarget: new THREE.Vector3(),
        renderedLength: Math.max(renderedSize.x, renderedSize.z),
        renderedHeight: renderedSize.y,
        forwardVector: new THREE.Vector3(),
        worldQuaternion: new THREE.Quaternion(),
        flightAlignment: null
    };
    setBirdAnimation(bird, "idle", 0);
    gardenBirds.push(bird);
    return bird;
}

// Bis zu 20 gleichzeitig sichtbare Besucher wie vom Nutzer gewuenscht. Die
// Szene definiert 22 Arten; zwei bleiben als wechselnde Besucher in Reserve,
// sodass es trotz des hoeheren Limits weiterhin An- und Abfluege gibt.
const MAX_ACTIVE_BIRD_VISITORS = 20;
const activeBirdVisitorLimit = Math.min(MAX_ACTIVE_BIRD_VISITORS, renderProfile.activeBirds);

function birdVisitsThisSeason(bird) {
    return !Array.isArray(bird.config.seasons) ||
        bird.config.seasons.includes(seasonalVisuals.current || seasonForDate());
}

function startBirdVisit(bird, seconds) {
    const activity = chooseBirdActivityTarget(bird);
    bird.group.position.copy(birdSkyPoint(bird));
    bird.group.visible = true;
    bird.target.copy(activity.point);
    bird.activity = activity.activity;
    bird.pasture = activity.pasture;
    bird.resourceKey = activity.resourceKey || null;
    bird.visitsRemaining = 1 + Math.floor(bird.random() * 3);
    bird.state = "flying-in";
    bird.stateUntil = seconds + 48;
    setBirdAnimation(bird, "fly", 0.12);
}

function beginBirdTakeoff(bird, flightState, target, seconds) {
    bird.pendingFlightState = flightState;
    bird.pendingTarget.copy(target);
    if (bird.actions.takeoff) {
        bird.state = "taking-off";
        bird.stateUntil = seconds + birdAnimationDuration(bird, "takeoff");
        setBirdAnimation(bird, "takeoff", 0.12);
    }
    else {
        bird.state = flightState;
        bird.target.copy(target);
        bird.stateUntil = seconds + 42;
        setBirdAnimation(bird, "fly", 0.12);
    }
}

function startBirdDeparture(bird, seconds) {
    beginBirdTakeoff(bird, "flying-out", birdSkyPoint(bird, true), seconds);
}

function finishBirdLanding(bird, seconds) {
    bird.state = bird.activity;
    bird.stateUntil = seconds + 7 + bird.index * 0.75 + bird.random() * 13;
    setBirdAnimation(bird, bird.activity === "feeding" ? "eat" : "idle", 0.16);
}

function startNextBirdActivity(bird, seconds) {
    if (bird.visitsRemaining <= 0 || bird.random() < 0.24) {
        startBirdDeparture(bird, seconds);
        return;
    }
    bird.visitsRemaining -= 1;
    const activity = chooseBirdActivityTarget(bird);
    bird.target.copy(activity.point);
    bird.activity = activity.activity;
    bird.pasture = activity.pasture;
    bird.resourceKey = activity.resourceKey || null;
    const distance = bird.group.position.distanceTo(activity.point);
    if (bird.actions.walking && distance < 4.7) {
        bird.state = "walking-between";
        bird.stateUntil = seconds + 34;
        setBirdAnimation(bird, "walking", 0.18);
    }
    else
        beginBirdTakeoff(bird, "flying-between", activity.point, seconds);
}

function animateGardenBirds(seconds, delta) {
    if (reduceMotion)
        return;
    const birdAudioRunning = Boolean(animalSoundsEnabled && birdAudioContext?.state === "running");
    if (birdAudioRunning && !birdAudioWasRunning) {
        // Direkt nach der ersten Beruehrung zeitversetzt erste Stimmen planen.
        // So bestaetigt die Szene auf iPhone/Safari hoerbar, dass Audio aktiv ist,
        // ohne dass alle Tiere gleichzeitig einsetzen.
        gardenBirds.filter((bird) => bird.state !== "away").forEach((bird, index) => {
            bird.nextSongAt = Math.min(bird.nextSongAt, seconds + 0.7 + index * 0.55);
        });
    }
    birdAudioWasRunning = birdAudioRunning;
    let activeBirds = gardenBirds.filter((bird) => bird.state !== "away").length;
    gardenBirds.forEach((bird) => {
        if (bird.state === "away") {
            if (seconds >= bird.nextVisitAt && activeBirds < activeBirdVisitorLimit &&
                birdVisitsThisSeason(bird)) {
                startBirdVisit(bird, seconds);
                activeBirds += 1;
            }
            else if (seconds >= bird.nextVisitAt && !birdVisitsThisSeason(bird))
                bird.nextVisitAt = seconds + 90 + bird.random() * 150;
            return;
        }
        let flying = bird.state.startsWith("flying");
        bird.mixer.timeScale = 1;
        if (bird.headRig)
            bird.headRig.rotation.x -= bird.manualHeadOffset;
        if (bird.beakTop)
            bird.beakTop.rotation.x -= bird.manualBeakTopOffset;
        if (bird.beakBottom)
            bird.beakBottom.rotation.x -= bird.manualBeakBottomOffset;
        bird.manualHeadOffset = 0;
        bird.manualBeakTopOffset = 0;
        bird.manualBeakBottomOffset = 0;
        bird.mixer.update(delta);
        if (bird.state === "taking-off" && seconds >= bird.stateUntil) {
            bird.state = bird.pendingFlightState;
            bird.target.copy(bird.pendingTarget);
            bird.stateUntil = seconds + 42;
            setBirdAnimation(bird, "fly", 0.12);
            // Der neue Flugzustand muss noch in demselben Frame gelten. Sonst
            // wuerde der Bodenpfad das Tier fuer einen Frame auf die Zielhoehe
            // versetzen und ein sichtbarer Sprung entstuende.
            flying = true;
        }
        if (bird.state === "landing" && seconds >= bird.stateUntil)
            finishBirdLanding(bird, seconds);
        if (seconds >= bird.nextSongAt && !flying &&
            !["taking-off", "landing"].includes(bird.state)) {
            const duration = playBirdSong(bird);
            bird.singingUntil = seconds + duration;
            // Vor der ersten Beruehrung blockieren Browser Audio. Dann bereits
            // nach wenigen Sekunden erneut versuchen, statt den Vogel fuer bis
            // zu einer Minute stumm zu schalten.
            bird.nextSongAt = duration > 0 ?
                seconds + 14 + bird.index * 1.1 + bird.random() * 38 :
                seconds + 4 + bird.random() * 5;
        }
        if (flying) {
            const flightAction = bird.actions.glide &&
                Math.sin(seconds * 0.72 + bird.index * 1.9) > 0.46 ? "glide" : "fly";
            setBirdAnimation(bird, flightAction, 0.24);
            const direction = bird.target.clone().sub(bird.group.position);
            const distance = direction.length();
            if (distance < (bird.state === "flying-out" ? 0.75 : 0.20)) {
                if (bird.state === "flying-out") {
                    bird.group.visible = false;
                    bird.state = "away";
                    bird.nextVisitAt = seconds + 38 + bird.index * 4 + bird.random() * 95;
                }
                else {
                    bird.group.position.copy(bird.target);
                    if (bird.actions.landing) {
                        bird.state = "landing";
                        bird.stateUntil = seconds + birdAnimationDuration(bird, "landing");
                        setBirdAnimation(bird, "landing", 0.10);
                    }
                    else
                        finishBirdLanding(bird, seconds);
                }
                return;
            }
            direction.normalize();
            const targetYaw = Math.atan2(direction.x, direction.z);
            const yawDelta = Math.atan2(Math.sin(targetYaw - bird.group.rotation.y),
                Math.cos(targetYaw - bird.group.rotation.y));
            bird.group.rotation.y += yawDelta * Math.min(1, delta * 5.2);
            bird.model.getWorldQuaternion(bird.worldQuaternion);
            bird.forwardVector.set(0, 0, -1).applyQuaternion(bird.worldQuaternion).normalize();
            bird.flightAlignment = bird.forwardVector.dot(direction);
            const speed = (bird.config.model === "pigeon" ? 4.2 : 3.25) * delta;
            bird.group.position.addScaledVector(direction, Math.min(speed, distance));
            bird.group.position.y += Math.sin(seconds * 7 + bird.index) * delta * 0.035;
            bird.travelled += speed;
            if (seconds >= bird.stateUntil)
                startBirdDeparture(bird, seconds);
            return;
        }
        if (bird.state === "walking-between") {
            const direction = bird.target.clone().sub(bird.group.position);
            direction.y = 0;
            const distance = direction.length();
            if (distance < 0.08) {
                bird.group.position.copy(bird.target);
                finishBirdLanding(bird, seconds);
                return;
            }
            direction.normalize();
            const targetYaw = Math.atan2(direction.x, direction.z);
            const yawDelta = Math.atan2(Math.sin(targetYaw - bird.group.rotation.y),
                Math.cos(targetYaw - bird.group.rotation.y));
            bird.group.rotation.y += yawDelta * Math.min(1, delta * 5.4);
            bird.group.position.addScaledVector(direction, Math.min(0.36 * delta, distance));
            if (seconds >= bird.stateUntil)
                startBirdDeparture(bird, seconds);
            return;
        }
        if (["taking-off", "landing"].includes(bird.state))
            return;
        const pecking = bird.state === "feeding" || bird.state.startsWith("drinking");
        const peck = pecking ? Math.max(0, Math.sin(seconds * 4.8 + bird.index)) * 0.42 : 0;
        const singing = seconds < bird.singingUntil;
        // Nur der Kopf senkt sich. Das ganze Tier bleibt korrekt auf seinen
        // Beinen stehen – besonders wichtig bei den langbeinigen Wasservoegeln.
        bird.manualHeadOffset = peck +
            (singing ? Math.sin(seconds * 14 + bird.index) * 0.055 : 0);
        bird.manualBeakTopOffset = singing ? -Math.max(0, Math.sin(seconds * 24)) * 0.10 : 0;
        bird.manualBeakBottomOffset = singing ? Math.max(0, Math.sin(seconds * 24)) * 0.11 : 0;
        if (bird.headRig)
            bird.headRig.rotation.x += bird.manualHeadOffset;
        if (bird.beakTop)
            bird.beakTop.rotation.x += bird.manualBeakTopOffset;
        if (bird.beakBottom)
            bird.beakBottom.rotation.x += bird.manualBeakBottomOffset;
        bird.group.position.y = bird.target.y;
        if (bird.state === "feeding")
            grazeAt(bird.group.position.x, bird.group.position.z, bird.pasture, delta * 0.008);
        if (seconds >= bird.stateUntil)
            startNextBirdActivity(bird, seconds);
    });
}

function createGardenBirds() {
    Object.entries(BIRD_MODEL_FILES).forEach(([modelType, url]) => {
        vehicleLoader.load(url, (gltf) => {
            BIRD_VISITOR_CONFIGS.forEach((config, index) => {
                if (config.model === modelType)
                    createGardenBird(config, index, gltf);
            });
        }, undefined, () => {
            // Kein geometrischer Platzhalter: bei einem seltenen Ladefehler
            // bleibt die jeweilige Art unsichtbar und wird beim Neuladen erneut geladen.
        });
    });
}

function camelHerdRestLayout() {
    const offsets = [
        [-3.0, -1.12], [0, -1.20], [3.0, -1.08],
        [-1.52, 1.28], [1.52, 1.34]
    ];
    const candidates = grassCells.filter((cell) => cell.pasture);
    for (let attempt = 0; attempt < Math.min(220, candidates.length); attempt += 1) {
        const cell = candidates[(attempt * 37 + camelHerdRestSerial * 19) % candidates.length];
        if (offsets.every(([dx, dz]) => camelCanStandAt(cell.x + dx, cell.z + dz, 0.72)))
            return offsets.map(([dx, dz]) => new THREE.Vector3(cell.x + dx, 0, cell.z + dz));
    }
    return [
        new THREE.Vector3(-18.2, 0, -7.4), new THREE.Vector3(-15.2, 0, -7.5),
        new THREE.Vector3(-12.2, 0, -7.3), new THREE.Vector3(-16.7, 0, -5.0),
        new THREE.Vector3(-13.7, 0, -4.9)
    ];
}

function scheduleCamelHerdRest(seconds) {
    if ((animalDemoMode && animalFocusMode === "camel") || seconds < nextCamelHerdRestAt || camelHerd.some((camel) =>
        ["couching", "resting", "rising", "herd-waiting"].includes(camel.mode)))
        return;
    camelHerdRestSerial += 1;
    camelHerdRestDeadline = seconds + 65;
    camelHerdRestDuration = (new Date().getHours() >= 22 || new Date().getHours() < 6) ? 85 : 56;
    camelHerdRestStarted = false;
    const layout = camelHerdRestLayout();
    camelHerd.forEach((camel, index) => {
        camel.herdRestId = camelHerdRestSerial;
        camel.target.copy(layout[index]);
        camel.intent = "herd-rest";
        camel.resourceKey = null;
        camel.facingPoint = null;
        camel.mode = "walking";
        camel.stuckFor = 0;
        camel.lastProgressPosition.copy(camel.group.position);
    });
    nextCamelHerdRestAt = seconds + (animalDemoMode ? 105 : 300 + Math.random() * 190);
}

function beginCamelCouching(camel, seconds) {
    camel.mode = "couching";
    camel.restTransitionStarted = seconds;
    camel.restEndsAt = seconds + camelHerdRestDuration;
    camel.modeUntil = seconds + 5.2;
}

function coordinateCamelHerdRest(seconds) {
    if (!camelHerdRestSerial || camelHerdRestStarted)
        return;
    const members = camelHerd.filter((camel) => camel.herdRestId === camelHerdRestSerial);
    if (!members.length)
        return;
    const waiting = members.filter((camel) => camel.mode === "herd-waiting");
    if (waiting.length === members.length || (seconds >= camelHerdRestDeadline && waiting.length >= 3)) {
        camelHerdRestStarted = true;
        waiting.forEach((camel) => beginCamelCouching(camel, seconds));
    }
}

function chooseCamelRestTarget(camel) {
    const candidates = grassCells
        .filter((cell) => cell.pasture && camelCanStandAt(cell.x, cell.z, 0.70))
        .sort((left, right) =>
            Math.hypot(left.x - camel.group.position.x, left.z - camel.group.position.z) -
            Math.hypot(right.x - camel.group.position.x, right.z - camel.group.position.z));
    // Einer der nahen Plätze verhindert unnötige Märsche quer über die ganze
    // Weide, variiert die Liegeorte aber weiterhin sichtbar.
    const nearby = candidates.slice(0, Math.min(8, candidates.length));
    const cell = nearby[Math.floor(camel.random() * nearby.length)];
    if (!cell)
        return chooseCamelTarget(camel);
    return {
        point: new THREE.Vector3(cell.x, 0, cell.z),
        intent: "idle"
    };
}

function startCamelJourney(camel) {
    const restingCamels = camelHerd.filter((other) =>
        ["couching", "resting", "rising"].includes(other.mode)).length;
    const restDue = camel.elapsedSeconds >= camel.nextRestAt && restingCamels < 4;
    const target = restDue ? chooseCamelRestTarget(camel) : chooseCamelTarget(camel);
    camel.target = target.point;
    camel.intent = target.intent;
    camel.resourceKey = target.resourceKey || null;
    camel.facingPoint = target.facingPoint || null;
    camel.herdRestId = 0;
    camel.mode = camel.random() < 0.10 ? "running" : "walking";
    camel.stuckFor = 0;
    camel.lastProgressPosition.copy(camel.group.position);
}

function rescueStuckCamel(camel) {
    const rescue = chooseCamelRescuePoint(camel);
    camel.target.copy(rescue);
    camel.intent = camel.random() < 0.78 ? "grazing" : "idle";
    camel.facingPoint = null;
    camel.mode = "walking";
    camel.stuckFor = 0;
    camel.lastProgressPosition.copy(camel.group.position);
}

function animateCamels(seconds, delta) {
    if (reduceMotion)
        return;
    scheduleCamelHerdRest(seconds);
    coordinateCamelHerdRest(seconds);
    camelHerd.forEach((camel) => {
        camel.elapsedSeconds = seconds;
        if (camel.mixer) {
            camel.idleAction?.setEffectiveTimeScale(
                camel.mode === "running" ? 1.65 : camel.mode === "walking" ? 1.20 : 0.72
            );
            camel.mixer.update(delta);
        }
        animateCamelTail(camel, seconds);
        const stationaryMode = ["grazing", "drinking", "feeding", "meeting", "idle"].includes(camel.mode);
        if (stationaryMode && seconds >= camel.nextCallAt) {
            camel.callingUntil = seconds + 5.4;
            camel.nextCallAt = seconds + 420 + camel.random() * 900;
            playAnimalSound("camel", 0.42 + camel.index * 0.025);
        }
        const camelCalling = seconds < camel.callingUntil;
        if (camel.mode === "couching") {
            animateCamelRestPose(camel, "couching", seconds, delta);
            if (seconds >= camel.modeUntil) {
                camel.mode = "resting";
                camel.modeUntil = camel.restEndsAt;
            }
        }
        else if (camel.mode === "resting") {
            animateCamelRestPose(camel, "resting", seconds, delta);
            if (seconds >= camel.modeUntil) {
                camel.mode = "rising";
                camel.restTransitionStarted = seconds;
                camel.modeUntil = seconds + 4.8;
            }
        }
        else if (camel.mode === "rising") {
            animateCamelRestPose(camel, "rising", seconds, delta);
            if (seconds >= camel.modeUntil || camel.restBlend < 0.025)
                startCamelJourney(camel);
        }
        else if (["urinating", "defecating"].includes(camel.mode)) {
            if (!camel.modelRoot)
                camel.neckRig.rotation.x = THREE.MathUtils.damp(camel.neckRig.rotation.x, 0, 5, delta);
            else {
                animateDetailedCamelGait(camel, false, false, delta);
                poseDetailedCamelHead(camel, "idle", seconds);
            }
            if (updateAnimalEliminationEffect(camel, seconds))
                startCamelJourney(camel);
        }
        else if (["grazing", "drinking", "feeding", "meeting", "idle"].includes(camel.mode)) {
            const eating = camel.mode === "grazing" || camel.mode === "drinking" || camel.mode === "feeding";
            if (camel.facingPoint && (camel.mode === "drinking" || camel.mode === "feeding")) {
                const facingX = camel.facingPoint.x - camel.group.position.x;
                const facingZ = camel.facingPoint.z - camel.group.position.z;
                const targetYaw = Math.atan2(facingX, facingZ);
                const yawDelta = Math.atan2(Math.sin(targetYaw - camel.group.rotation.y),
                    Math.cos(targetYaw - camel.group.rotation.y));
                camel.group.rotation.y += yawDelta * Math.min(1, delta * 3.2);
            }
            if (!camel.modelRoot) {
                camel.neckRig.rotation.x = THREE.MathUtils.damp(camel.neckRig.rotation.x,
                    camelCalling ? -0.18 : eating ? 0.78 : 0, 4, delta);
            }
            else {
                animateDetailedCamelGait(camel, false, false, delta);
                poseDetailedCamelHead(camel, camelCalling ? "calling" : camel.mode, seconds);
            }
            if (camel.mode === "grazing")
                grazeAt(camel.group.position.x, camel.group.position.z, true, delta * 0.12);
            if (seconds >= camel.modeUntil)
                startCamelJourney(camel);
        }
        else {
            if (!camel.modelRoot)
                camel.neckRig.rotation.x = THREE.MathUtils.damp(camel.neckRig.rotation.x, 0, 4, delta);
            else
                poseDetailedCamelHead(camel, "idle", seconds);
            const dx = camel.target.x - camel.group.position.x;
            const dz = camel.target.z - camel.group.position.z;
            const distance = Math.hypot(dx, dz);
            if (distance < 0.30) {
                const hour = new Date().getHours();
                const night = hour >= 22 || hour < 6;
                const restingCamels = camelHerd.filter((other) =>
                    ["couching", "resting", "rising"].includes(other.mode)).length;
                // Ist der persönliche Zeitpunkt erreicht, legt sich das Tier
                // am nächsten geeigneten Gras-/Ruheplatz sicher hin. Die alte
                // zusätzliche Zufallsprüfung konnte die Aktion unbegrenzt
                // verschieben und machte sie in der Praxis kaum sichtbar.
                const canRest = ["grazing", "idle"].includes(camel.intent) &&
                    seconds >= camel.nextRestAt && restingCamels < 4;
                if (camel.intent === "herd-rest") {
                    camel.mode = "herd-waiting";
                    if (camelHerdRestStarted)
                        beginCamelCouching(camel, seconds);
                }
                else if (canRest) {
                    camelHerdRestDuration = night ? 50 + camel.random() * 40 : 28 + camel.random() * 22;
                    beginCamelCouching(camel, seconds);
                    camel.nextRestAt = seconds + (night ? 260 + camel.random() * 220 : 420 + camel.random() * 300);
                }
                else {
                    camel.mode = camel.intent;
                    // Raufe und Tränke bleiben lange genug belegt, damit der
                    // Nutzer die Aktion auch beim zufälligen Kameraschwenk sieht.
                    const appetite = camel.intent === "feeding" ? camel.hayAppetite :
                        camel.intent === "drinking" ? camel.waterAppetite : 1;
                    camel.modeUntil = seconds +
                        (["feeding", "drinking"].includes(camel.intent) ?
                            (20 + camel.random() * 16) * appetite : 10 + camel.random() * 14);
                }
            }
            else {
                let directionX = dx / Math.max(distance, 0.001);
                let directionZ = dz / Math.max(distance, 0.001);
                // Die fünf Tiere weichen einander aus, statt an Tränke oder
                // Heuraufe sichtbar ineinander zu stehen.
                camelHerd.forEach((other) => {
                    if (other === camel)
                        return;
                    const separationX = camel.group.position.x - other.group.position.x;
                    const separationZ = camel.group.position.z - other.group.position.z;
                    const separation = Math.hypot(separationX, separationZ);
                    const personalSpace = 1.12 * (camel.group.scale.x + other.group.scale.x);
                    if (separation > 0.01 && separation < personalSpace) {
                        const strength = (personalSpace - separation) / personalSpace * 1.85;
                        directionX += separationX / separation * strength;
                        directionZ += separationZ / separation * strength;
                    }
                });
                const directionLength = Math.max(0.001, Math.hypot(directionX, directionZ));
                directionX /= directionLength;
                directionZ /= directionLength;
                const targetYaw = Math.atan2(directionX, directionZ);
                const yawDelta = Math.atan2(Math.sin(targetYaw - camel.group.rotation.y),
                    Math.cos(targetYaw - camel.group.rotation.y));
                camel.group.rotation.y += yawDelta * Math.min(1, delta * 2.0);
                const speed = camel.mode === "running" ? 0.92 : 0.30;
                const nextX = camel.group.position.x + Math.sin(camel.group.rotation.y) * speed * delta;
                const nextZ = camel.group.position.z + Math.cos(camel.group.rotation.y) * speed * delta;
                if (camelCanStandAt(nextX, nextZ, 0.18)) {
                    camel.group.position.x = nextX;
                    camel.group.position.z = nextZ;
                    camel.travelled += speed * delta;
                }
                else {
                    camel.stuckFor += delta * 2.2;
                }
                const progress = camel.group.position.distanceTo(camel.lastProgressPosition);
                if (progress >= 0.24) {
                    camel.stuckFor = 0;
                    camel.lastProgressPosition.copy(camel.group.position);
                }
                else
                    camel.stuckFor += delta;
                // Wenn Ausweichbewegungen oder ein Ziel an einer schrägen
                // Zaunkante keinen echten Fortschritt mehr zulassen, erhält
                // das Tier einen sicher erreichbaren Punkt im Weideinneren.
                // Damit endet auch das sichtbare Links-rechts-Zucken.
                if (camel.stuckFor > 2.4)
                    rescueStuckCamel(camel);
                if (!camel.modelRoot) {
                    camel.legs.forEach((leg) => {
                        leg.rotation.x = Math.sin(camel.travelled * 7.0 + leg.userData.offset) *
                            (camel.mode === "running" ? 0.48 : 0.28);
                    });
                }
                else {
                    animateDetailedCamelGait(camel, true, camel.mode === "running", delta);
                }
            }
        }
        if (!camel.elimination && seconds >= camel.nextDroppingAt &&
            createAnimalEliminationEffect(camel, "defecating", "Kamel", seconds)) {
            camel.nextDroppingAt = seconds + 2800 + camel.random() * 1900;
        }
        else if (!camel.elimination && seconds >= camel.nextUrinationAt &&
            createAnimalEliminationEffect(camel, "urinating", "Kamel", seconds)) {
            camel.nextUrinationAt = seconds + 1100 + camel.random() * 1800;
        }
    });
}

function saveAnimalResources() {
    // Gras und Kräuter bleiben rein visuelle, gerätespezifische Details. Heu,
    // Wasser und Hinterlassenschaften kommen dagegen ausschließlich vom
    // gemeinsamen Serverzustand und werden nie mehr lokal gespeichert.
    animalResources.grassLevels = grassCells.map((cell) => Number(cell.level.toFixed(3)));
    animalResources.grassFertility = grassCells.map((cell) => Number(cell.fertility.toFixed(3)));
    try {
        localStorage.setItem("solix-animal-ecology-v2", JSON.stringify({
            grassLevels: animalResources.grassLevels,
            grassFertility: animalResources.grassFertility
        }));
    }
    catch (_error) {
        // Safari im privaten Modus kann lokalen Speicher sperren; die laufende
        // Simulation bleibt trotzdem vollständig aktiv.
    }
}

function updateAnimalEcology(time, delta) {
    const elapsed = Math.min(5, Math.max(delta, (time - lastEcologyUpdate) / 1000));
    lastEcologyUpdate = time;
    const temperature = numberValue(state.data.weather?.temperature_c) ?? 18;
    const heatFactor = 1 + THREE.MathUtils.clamp((temperature - 22) / 14, 0, 1.8);
    const gardenAverage = grassCells.filter((cell) => !cell.pasture)
        .reduce((sum, cell) => sum + cell.level, 0) / Math.max(1, grassCells.filter((cell) => !cell.pasture).length);
    const pastureAverage = grassCells.filter((cell) => cell.pasture)
        .reduce((sum, cell) => sum + cell.level, 0) / Math.max(1, grassCells.filter((cell) => cell.pasture).length);
    // Der gemeinsame Server berechnet den Tagesverbrauch genau einmal. Das
    // verhindert, dass mehrere gleichzeitig geöffnete Browser die Vorräte
    // mehrfach oder unterschiedlich schnell leeren.
    grassCells.forEach((cell) => {
        const rain = numberValue(state.data.weather?.rain_mm) ?? numberValue(state.data.weather?.precipitation_mm) ?? 0;
        const moisture = 1 + Math.min(1.2, rain * 0.18);
        cell.level = Math.min(3, cell.level + elapsed * cell.growthRate * moisture * (1 + cell.fertility * 3.2));
        if (cell.fertility > 0.24 && cell.herbAmount < 1 && Math.random() < elapsed * 0.0025)
            cell.herbAmount = Math.min(1, cell.herbAmount + 0.12 + cell.fertility * 0.12);
        cell.fertility = Math.max(0, cell.fertility - elapsed * 0.00005);
    });
    updateUrinePatches(time);
    if (time - lastGrassVisualUpdate > 1400) {
        updateGrassEcologyVisuals();
        lastGrassVisualUpdate = time;
    }
    if (time - lastAnimalResourceVisualUpdate > 1000) {
        updateAnimalResourceVisuals();
        lastAnimalResourceVisualUpdate = time;
    }
    if (time - lastAnimalMotionSync > 1800) {
        lastAnimalMotionSync = time;
        syncAnimalMotion();
    }
    if (time - lastEcologySave > 15000) {
        updateAnimalResourceVisuals();
        saveAnimalResources();
        syncAnimalState();
        lastEcologySave = time;
    }
}

function createStreetLamp() {
    const lamp = new THREE.Group();
    // Straßenseitig direkt am Zaun, längs bis auf Höhe des mittleren Yeti
    // versetzt. Dort bleibt die komplette Garagenzufahrt frei.
    lamp.position.set(AUDI_SIDE_FENCE_X - 0.34, 0, 8.72);
    world.add(lamp);
    const metal = new THREE.MeshStandardMaterial({
        color: 0xb8c0c5, metalness: 0.78, roughness: 0.32
    });
    const glass = new THREE.MeshPhysicalMaterial({
        color: 0xffe2ae, emissive: 0xffb45a, emissiveIntensity: 0,
        transparent: true, opacity: 0.88, roughness: 0.16, transmission: 0.16
    });
    addMesh(lamp, new THREE.CylinderGeometry(0.105, 0.14, 3.75, 18), metal,
        0, 1.88, 0);
    addMesh(lamp, new THREE.CylinderGeometry(0.31, 0.37, 0.12, 20), metal,
        0, 0.06, 0);
    addBox(lamp, [0.68, 0.11, 0.11], metal, [0.26, 3.70, 0], { radius: 0.045 });
    addBox(lamp, [0.46, 0.16, 0.34], metal, [0.58, 3.62, 0], { radius: 0.07 });
    streetLampBulb = addBox(lamp, [0.34, 0.07, 0.24], glass,
        [0.58, 3.52, 0], { radius: 0.025, castShadow: false });

    streetLampLight = new THREE.SpotLight(0xffca80, 0, 16, Math.PI / 3.15, 0.48, 1.35);
    streetLampLight.position.set(0.58, 3.48, 0);
    streetLampLight.castShadow = true;
    streetLampLight.shadow.mapSize.set(1024, 1024);
    streetLampLight.shadow.bias = -0.0008;
    streetLampLight.shadow.normalBias = 0.035;
    streetLampLight.target.position.set(0.70, 0, 1.30);
    lamp.add(streetLampLight);
    lamp.add(streetLampLight.target);
}

function createStonePlanters() {
    const stone = new THREE.MeshStandardMaterial({ color: 0x8b8d89, roughness: 0.94 });
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x5e615f, roughness: 0.98 });
    const soil = new THREE.MeshStandardMaterial({ color: 0x33271f, roughness: 1 });
    const leaves = new THREE.MeshStandardMaterial({ color: 0x315f38, roughness: 0.93 });
    const flowerColors = [0xd7d0f4, 0xf3cbd5, 0xf2dd89];
    [7.55, 8.48, 9.41].forEach((z, planterIndex) => {
        const planter = new THREE.Group();
        planter.position.set(6.60, 0, z);
        world.add(planter);
        addBox(planter, [0.66, 0.62, 0.66], stone, [0, 0.31, 0], { radius: 0.045 });
        addBox(planter, [0.53, 0.06, 0.53], soil, [0, 0.63, 0], { castShadow: false });
        [-0.21, 0.21].forEach((x) => {
            addBox(planter, [0.045, 0.54, 0.045], darkStone, [x, 0.31, 0], { castShadow: false });
            addBox(planter, [0.045, 0.54, 0.045], darkStone, [0, 0.31, x], { castShadow: false });
        });
        for (let index = 0; index < 7; index += 1) {
            const angle = index / 7 * Math.PI * 2;
            addMesh(planter, new THREE.SphereGeometry(0.13, 10, 7), leaves,
                Math.cos(angle) * 0.20, 0.73 + (index % 2) * 0.08,
                Math.sin(angle) * 0.20, { castShadow: true });
            addMesh(planter, new THREE.SphereGeometry(0.045, 9, 6),
                new THREE.MeshStandardMaterial({
                    color: flowerColors[(planterIndex + index) % flowerColors.length], roughness: 0.82
                }), Math.cos(angle) * 0.23, 0.88 + (index % 2) * 0.05,
                Math.sin(angle) * 0.23, { castShadow: false });
        }
    });
}

function horseStableSurfaceHeight(x, z) {
    // Die Rampe verläuft in Weltkoordinaten von x=-4,74 (Hof) bis zur
    // Türschwelle bei x=-3,24. Dahinter bleibt der Stallboden leicht erhöht.
    if (Math.abs(z + 1.58) > 0.78 || x < -4.74 || x > -0.32)
        return 0;
    if (x <= -3.24)
        return THREE.MathUtils.lerp(0.02, 0.28,
            THREE.MathUtils.clamp((x + 4.74) / 1.50, 0, 1));
    return 0.28;
}

const horseEliminationAxis = new THREE.Vector3(0, 0, 1);
const horseEliminationRotation = new THREE.Quaternion();

function poseHorseElimination(horseState, seconds, delta) {
    const defecating = horseState.mode === "defecating";
    setHorseAnimation(horseState, "Idle");
    horseState.headRig.rotation.x = THREE.MathUtils.damp(horseState.headRig.rotation.x, 0, 5, delta);
    horseState.headRig.position.y = THREE.MathUtils.damp(horseState.headRig.position.y, 1.54, 5, delta);
    horseState.tailRig.rotation.x = THREE.MathUtils.damp(horseState.tailRig.rotation.x,
        defecating ? -0.70 : -0.48, 6, delta);
    horseState.tailRig.rotation.z = Math.sin(seconds * 2.8) * 0.08;
    horseState.eliminationRig?.forEach((segment) => {
        const lift = (defecating ? 0.62 : 0.42) * Math.max(0.25, 1 - segment.index * 0.15);
        horseEliminationRotation.setFromAxisAngle(horseEliminationAxis, lift);
        segment.joint.quaternion.copy(segment.rest).multiply(horseEliminationRotation);
    });
}

function animateHorse(seconds, delta) {
    if (!horse)
        return;
    horse.elapsedSeconds = seconds;
    if (horse.mixer)
        horse.mixer.update(delta);
    if (reduceMotion) {
        setHorseAnimation(horse, "Idle");
        horse.headRig.rotation.x = 0;
        return;
    }
    const position = horse.group.position;
    const horseBusy = ["urinating", "defecating", "resting", "rising", "stable-rest", "neighing"].includes(horse.mode);
    if (!horseBusy && seconds >= horse.nextNeighAt) {
        const soundReady = animalSoundsEnabled && animalSoundsUnlocked;
        horse.mode = "neighing";
        horse.modeUntil = seconds + 2.35;
        // Normalerweise alle 2,5 bis 4,5 Minuten. War iOS beim letzten Termin
        // noch nicht durch eine Berührung für Audio freigeschaltet, folgt nach
        // 20 bis 40 Sekunden ein neuer Versuch statt erst viele Minuten später.
        horse.nextNeighAt = seconds + (soundReady ? 150 + horse.random() * 120 : 20 + horse.random() * 20);
        playAnimalSound("horse", 0.74);
    }
    if (!["urinating", "defecating"].includes(horse.mode))
        horse.tailRig.rotation.x = THREE.MathUtils.damp(horse.tailRig.rotation.x, 0, 6, delta);
    if (["urinating", "defecating"].includes(horse.mode)) {
        poseHorseElimination(horse, seconds, delta);
        if (updateAnimalEliminationEffect(horse, seconds))
            startHorseJourney(horse, position, true);
    }
    else if (horse.mode === "neighing") {
        // Das vorhandene Aufbäumen passt zum Wiehern und bewegt Kopf, Hals und
        // Vorderbeine gemeinsam. Der prozedurale Ersatz hebt dieselben Partien.
        setHorseAnimation(horse, "Rear", 0.20);
        if (!horse.modelRoot) {
            horse.headRig.rotation.x = THREE.MathUtils.damp(horse.headRig.rotation.x, -0.28, 7, delta);
            horse.legs.slice(0, 2).forEach((leg, index) => {
                leg.rotation.x = THREE.MathUtils.damp(leg.rotation.x,
                    (index ? -1 : 1) * 0.72, 7, delta);
            });
        }
        if (seconds >= horse.modeUntil)
            startHorseJourney(horse, position, true);
    }
    else if (horse.mode === "grazing") {
        // Vollständige Originalanimation: Kopf bis zur Grasnarbe und beide
        // Vorderbeine bleiben sichtbar; die dafür typische Spreizung ist
        // bewusst wieder aktiviert.
        setHorseAnimation(horse, "Eating");
        horse.headRig.rotation.x = THREE.MathUtils.damp(horse.headRig.rotation.x, 1.08, 5, delta);
        horse.headRig.position.y = THREE.MathUtils.damp(horse.headRig.position.y, 1.18, 5, delta);
        horse.tailRig.rotation.z = Math.sin(seconds * 1.7) * 0.18;
        grazeAt(position.x, position.z, false, delta * 0.18);
        if (seconds >= horse.modeUntil) {
            startHorseJourney(horse, position);
        }
    }
    else if (horse.mode === "drinking" || horse.mode === "feeding") {
        setHorseAnimation(horse, "Eating");
        horse.headRig.rotation.x = THREE.MathUtils.damp(horse.headRig.rotation.x, 0.94, 5, delta);
        if (seconds >= horse.modeUntil)
            startHorseJourney(horse, position, true);
    }
    else if (horse.mode === "resting") {
        setHorseAnimation(horse, "Sleep");
        if (seconds >= horse.modeUntil) {
            horse.mode = "rising";
            horse.modeUntil = seconds + 2.8;
            setHorseAnimation(horse, "lay_to_idle", 0.45);
        }
    }
    else if (horse.mode === "rising") {
        setHorseAnimation(horse, "lay_to_idle");
        if (seconds >= horse.modeUntil)
            startHorseJourney(horse, position);
    }
    else if (horse.mode === "stable-rest") {
        setHorseAnimation(horse, "Idle");
        if (seconds >= horse.modeUntil) {
            horse.target = new THREE.Vector3(-4.24, 0, -1.58);
            horse.path = [];
            horse.navigation = "stable-exit";
            horse.mode = "walking";
        }
    }
    else {
        horse.headRig.rotation.x = THREE.MathUtils.damp(horse.headRig.rotation.x, 0, 5, delta);
        horse.headRig.position.y = THREE.MathUtils.damp(horse.headRig.position.y, 1.54, 5, delta);
        const dx = horse.target.x - position.x;
        const dz = horse.target.z - position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.35) {
            if (horse.path?.length) {
                horse.target = horse.path.shift();
                return;
            }
            if (horse.navigation === "horse-hay") {
                horse.mode = "feeding";
                horse.modeUntil = seconds + 7 + horse.random() * 9;
                horse.navigation = null;
                return;
            }
            if (horse.navigation === "stable-water-entry") {
                // Der Körper bleibt vor der Tränke; nur Kopf und Hals reichen
                // zum Wasser. Zuvor stand das Pferd geometrisch in der Wanne.
                horse.target = new THREE.Vector3(-2.45, 0, -1.80);
                horse.path = [];
                horse.navigation = "stable-water-inside";
                horse.mode = "walking";
                return;
            }
            if (horse.navigation === "stable-water-inside") {
                horse.mode = "drinking";
                horse.modeUntil = seconds + 9 + horse.random() * 11;
                horse.navigation = null;
                horse.nextStableAt = seconds + 105 + horse.random() * 155;
                return;
            }
            if (horse.navigation === "stable-entry") {
                horse.target = new THREE.Vector3(-1.38, 0, -1.58);
                horse.path = [];
                horse.navigation = "stable-inside";
                horse.mode = "walking";
                return;
            }
            if (horse.navigation === "stable-inside") {
                horse.mode = "stable-rest";
                horse.modeUntil = seconds + 9 + horse.random() * 14;
                return;
            }
            if (horse.navigation === "stable-exit") {
                horse.nextStableAt = seconds + 120 + horse.random() * 210;
                startHorseJourney(horse, position, true);
                return;
            }
            const hour = new Date().getHours();
            const night = hour >= 22 || hour < 6;
            const canRest = horseIsOnGrass(position.x, position.z) &&
                seconds >= horse.nextRestAt && horse.random() < (night ? 0.32 : 0.055);
            if (canRest) {
                horse.mode = "resting";
                horse.modeUntil = seconds + (night ? 35 + horse.random() * 55 : 12 + horse.random() * 20);
                horse.nextRestAt = seconds + (night ? 240 + horse.random() * 360 : 780 + horse.random() * 900);
            }
            else if (horseIsOnGrass(position.x, position.z) && horse.random() < 0.68) {
                horse.mode = "grazing";
                horse.modeUntil = seconds + 5 + horse.random() * 9;
            }
            else {
                startHorseJourney(horse, position);
            }
        }
        else {
            setHorseAnimation(horse, horse.mode === "running" ? "Run" : "Walk");
            const targetYaw = Math.atan2(dx, dz);
            const yawDelta = Math.atan2(
                Math.sin(targetYaw - horse.group.rotation.y),
                Math.cos(targetYaw - horse.group.rotation.y)
            );
            horse.group.rotation.y += yawDelta * Math.min(1, delta * 2.4);
            const speed = horse.mode === "running" ? 1.52 : 0.48;
            const nextX = position.x + Math.sin(horse.group.rotation.y) * speed * delta;
            const nextZ = position.z + Math.cos(horse.group.rotation.y) * speed * delta;
            if (horseCanStandAt(nextX, nextZ)) {
                position.x = nextX;
                position.z = nextZ;
                horse.travelled += speed * delta;
                horse.stuckFor = 0;
            }
            else {
                startHorseJourney(horse, position);
                horse.stuckFor += delta;
                // Sollte eine neue Gartendekoration später versehentlich um
                // das Pferd gebaut werden, wird es nach kurzer Zeit auf den
                // nächsten sicheren Punkt versetzt und bleibt nie hängen.
                if (horse.stuckFor > 1.6) {
                    const rescue = chooseHorseTarget(horse.random, position);
                    position.x = rescue.x;
                    position.z = rescue.z;
                    startHorseJourney(horse, position);
                    horse.stuckFor = 0;
                }
            }
            if (!horse.modelRoot) {
                horse.legs.forEach((leg) => {
                    leg.rotation.x = Math.sin(horse.travelled * 8.2 + leg.userData.walkOffset) * 0.42;
                });
                horse.tailRig.rotation.z = Math.sin(seconds * 2.2) * 0.24;
            }
        }
    }
    const stableFloorY = horseStableSurfaceHeight(position.x, position.z);
    const fallbackStepLift = !horse.modelRoot && ["walking", "running"].includes(horse.mode) ?
        Math.abs(Math.sin(horse.travelled * 8.2)) * 0.025 : 0;
    // Auf der Rampe und im Stall folgt der Hufpunkt der Bodenhöhe ohne träges
    // Nachsinken. Außerhalb bleibt die kleine weiche Schrittbewegung erhalten.
    const inStableRoute = stableFloorY > 0.001;
    position.y = inStableRoute ? stableFloorY + fallbackStepLift :
        THREE.MathUtils.damp(position.y, fallbackStepLift, 14, delta);
    if (!horse.elimination && seconds >= horse.nextDroppingAt &&
        createAnimalEliminationEffect(horse, "defecating", "Pferd", seconds)) {
        horse.nextDroppingAt = seconds + 3000 + horse.random() * 1800;
    }
    else if (!horse.elimination && seconds >= horse.nextUrinationAt &&
        createAnimalEliminationEffect(horse, "urinating", "Pferd", seconds)) {
        horse.nextUrinationAt = seconds + 1200 + horse.random() * 1800;
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

    createGrassEcology();
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

    createStreetLamp();
    createStonePlanters();

    const pool = new THREE.Group();
    // Aus dem Luftbild auf die reale Intex-Größe (ca. 5,5 × 2,7 m)
    // skaliert und parallel zur diagonalen Feldgrenze positioniert.
    // Gegenüber der letzten Vorschau einen Meter weiter von der Pergola weg.
    // Die Bewegung verläuft parallel zum Zaun; die breite Holzplattform bleibt
    // deshalb weiterhin nahezu bündig an der unteren Grundstücksgrenze.
    pool.position.set(-7.19, 0, -5.92);
    pool.rotation.y = THREE.MathUtils.degToRad(-60);
    world.add(pool);
    const poolWall = new THREE.MeshStandardMaterial({ color: 0x2f3940, metalness: 0.08, roughness: 0.82 });
    addBox(pool, [1.82, 0.88, 3.55], poolWall, [0, 0.43, 0], { radius: 0.10 });
    addBox(pool, [1.58, 0.10, 3.30], materials.water, [0, 0.89, 0], { radius: 0.10, castShadow: false });
    const poolRail = new THREE.MeshStandardMaterial({ color: 0xd7d9d5, roughness: 0.50 });
    [-0.86, 0.86].forEach((x) => addBox(pool, [0.07, 0.07, 3.42], poolRail, [x, 0.94, 0]));
    [-1.70, 1.70].forEach((z) => addBox(pool, [1.70, 0.07, 0.07], poolRail, [0, 0.94, z]));

    // Begehbare Holzumrandung mit einer breiten Liegefläche zum hinteren
    // Zaun. Die einzelnen Bretter behalten beim Drehen die Poolausrichtung.
    const deckWood = new THREE.MeshStandardMaterial({ color: 0x6f675b, roughness: 0.96 });
    const deckEdge = new THREE.MeshStandardMaterial({ color: 0x403a33, roughness: 0.98 });
    [-1.14, 1.14].forEach((x) =>
        addBox(pool, [0.42, 0.14, 4.05], deckWood, [x, 0.91, 0], { radius: 0.025 }));
    addBox(pool, [2.70, 0.14, 0.42], deckWood, [0, 0.91, 1.98], { radius: 0.025 });
    // Breite Liegeplattform entlang der langen, zum Zaun gerichteten Seite.
    addBox(pool, [1.02, 0.15, 4.05], deckWood, [-1.82, 0.91, 0], { radius: 0.025 });
    for (let z = -1.72; z <= 1.72; z += 0.20)
        addBox(pool, [0.94, 0.022, 0.05], deckEdge, [-1.82, 1.00, z], { castShadow: false });

    // IMG_7439: Die Poolwände sind vollständig mit senkrechten, verwitterten
    // Holzbrettern verkleidet. Schmale Fugen und leicht wechselnde Grautöne
    // lassen die Verkleidung auch aus der Standardansicht ablesbar bleiben.
    const claddingColors = [0x756b5d, 0x625a50, 0x84786a, 0x6b6257];
    for (let z = -1.70, index = 0; z <= 1.70; z += 0.18, index += 1) {
        const cladding = new THREE.MeshStandardMaterial({
            color: claddingColors[index % claddingColors.length], roughness: 1
        });
        [-0.94, 0.94].forEach((x) =>
            addBox(pool, [0.055, 0.78, 0.155], cladding, [x, 0.42, z], { castShadow: false }));
    }
    for (let x = -0.82, index = 0; x <= 0.82; x += 0.18, index += 1) {
        const cladding = new THREE.MeshStandardMaterial({
            color: claddingColors[(index + 2) % claddingColors.length], roughness: 1
        });
        [-1.82, 1.82].forEach((z) =>
            addBox(pool, [0.155, 0.78, 0.055], cladding, [x, 0.42, z], { castShadow: false }));
    }

    // Blau-weißer Sichtschutz hinter der breiten Liegeseite, plus kurzes
    // Seitenteil wie auf dem Foto. Die Streifen sind echte Geometrie und
    // bleiben deshalb beim Drehen aus jedem Winkel sauber sichtbar.
    const screenBlue = new THREE.MeshStandardMaterial({ color: 0x1d6aa5, roughness: 0.78, side: THREE.DoubleSide });
    const screenWhite = new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 0.84, side: THREE.DoubleSide });
    const screenPost = new THREE.MeshStandardMaterial({ color: 0x746a5b, roughness: 0.98 });
    const screenX = -2.38;
    [-2.02, -0.68, 0.68, 2.02].forEach((z) =>
        addBox(pool, [0.09, 1.40, 0.09], screenPost, [screenX, 1.56, z]));
    for (let stripe = 0; stripe < 10; stripe += 1)
        addBox(pool, [0.035, 0.105, 4.12], stripe % 2 ? screenWhite : screenBlue,
            [screenX + 0.01, 1.02 + stripe * 0.105, 0], { castShadow: false });
    [-2.38, -1.72, -1.06].forEach((x) =>
        addBox(pool, [0.09, 1.40, 0.09], screenPost, [x, 1.56, -2.03]));
    for (let stripe = 0; stripe < 10; stripe += 1)
        addBox(pool, [1.34, 0.105, 0.035], stripe % 2 ? screenWhite : screenBlue,
            [-1.72, 1.02 + stripe * 0.105, -2.03], { castShadow: false });

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
        [-10.10, 0.35, 0.72]
    ].forEach(([x, z, scale]) => createShrub(x, z, scale));
    createSeasonalAccents();
    updateSeasonalScene(true);

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
    createAnimalCareStations();
    createCamelPasture();
    createGardenBirds();
    horse = createHorse();
    dog = createRottweiler();
    restoreAnimalDroppings();
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

const BUILDER_STORAGE_KEY = "solix-house-builder-v1";
const BUILDER_ROTATION_STEP = 90;
const BUILDER_VARIANTS = Object.freeze({
    wall: [
        { id: "wall-custom-standard", label: "Standard · 2,75 m hoch", length: 4.0, height: 2.75 },
        { id: "wall-custom-low", label: "Niedrig · 2,40 m hoch", length: 4.0, height: 2.40 },
        { id: "wall-custom-high", label: "Hoch · 3,10 m hoch", length: 4.0, height: 3.10 },
        // Unsichtbare Altvarianten halten bereits gespeicherte Entwürfe kompatibel.
        { id: "wall-4m", label: "Gerade Wand · 4 m", length: 4.0, height: 2.75, legacy: true },
        { id: "wall-2m", label: "Kurze Wand · 2 m", length: 2.0, height: 2.75, legacy: true },
        { id: "wall-corner", label: "Eckwand · 3 × 3 m", length: 3.0, height: 2.75, legacy: true }
    ],
    window: [
        { id: "window-single", label: "Modern · einflügelig", width: 1.05, height: 1.35 },
        { id: "window-double", label: "Doppelfenster", width: 1.85, height: 1.35 },
        { id: "window-panoramic", label: "Panoramafenster", width: 2.55, height: 1.15 }
    ],
    door: [
        { id: "door-wood", label: "Holztür", width: 1.02, height: 2.12, style: "wood" },
        { id: "door-glass", label: "Glastür", width: 1.02, height: 2.12, style: "glass" },
        { id: "door-modern", label: "Moderne Haustür", width: 1.22, height: 2.18, style: "modern" }
    ],
    floor: [
        { id: "floor-stone", label: "Steinplatten · 3 × 3 m", width: 3, depth: 3, surface: "stone" },
        { id: "floor-wood", label: "Holzdielen · 3 × 3 m", width: 3, depth: 3, surface: "wood" },
        { id: "floor-concrete", label: "Beton · 3 × 3 m", width: 3, depth: 3, surface: "concrete" }
    ],
    grass: [
        { id: "grass-lawn", label: "Rasen · 3 × 3 m", width: 3, depth: 3, surface: "lawn" },
        { id: "grass-meadow", label: "Wiese · 3 × 3 m", width: 3, depth: 3, surface: "meadow" },
        { id: "grass-dry", label: "Trockengras · 3 × 3 m", width: 3, depth: 3, surface: "dry" }
    ],
    fence: [
        { id: "fence-picket", label: "Holzlattenzaun · 3 m", length: 3, height: 1.15, style: "picket" },
        { id: "fence-rail", label: "Weidezaun · 3 m", length: 3, height: 1.20, style: "rail" },
        { id: "fence-privacy", label: "Holz-Sichtschutz · 3 m", length: 3, height: 1.80, style: "privacy" },
        { id: "fence-metal", label: "Metallzaun · 3 m", length: 3, height: 1.25, style: "metal" }
    ],
    tree: [
        { id: "tree-deciduous", label: "Laubbaum", height: 4.4, crown: 1.55, style: "deciduous", foliage: "#4f7d3d" },
        { id: "tree-oak", label: "Eiche", height: 5.2, crown: 1.82, style: "oak", foliage: "#426f35" },
        { id: "tree-maple", label: "Ahorn", height: 4.7, crown: 1.68, style: "maple", foliage: "#628c43" },
        { id: "tree-birch", label: "Birke", height: 5.0, crown: 1.28, style: "birch", foliage: "#70a65a", trunk: "#e8e3d5" },
        { id: "tree-fruit", label: "Apfelbaum", height: 3.2, crown: 1.35, style: "fruit", foliage: "#5b883d" },
        { id: "tree-cherry", label: "Kirschbaum", height: 3.7, crown: 1.45, style: "cherry", foliage: "#638f48" },
        { id: "tree-conifer", label: "Fichte", height: 5.1, crown: 1.45, style: "conifer", foliage: "#315f42" },
        { id: "tree-pine", label: "Kiefer", height: 5.3, crown: 1.32, style: "pine", foliage: "#426f4b" },
        { id: "tree-cypress", label: "Zypresse", height: 4.6, crown: 0.88, style: "cypress", foliage: "#2f6542" }
    ]
});
const BUILDER_COLOR_SWATCHES = Object.freeze([
    "#f1eee5", "#d8c8ad", "#bfc5c8", "#9fb5a2", "#9db5ce", "#8e5a43"
]);
const BUILDER_DEFAULT_COLORS = Object.freeze({
    wall: "#f1eee5", window: "#9db5ce", door: "#8e5a43",
    floor: "#9d9487", grass: "#5d9b49", fence: "#8e6947", tree: "#4f7d3d"
});
const BUILDER_TYPE_LABELS = Object.freeze({
    wall: "Wand", window: "Fenster", door: "Tür",
    floor: "Boden", grass: "Grasfläche", fence: "Zaun", tree: "Baum"
});

function safeBuilderItems() {
    try {
        const parsed = JSON.parse(localStorage.getItem(BUILDER_STORAGE_KEY) || "[]");
        if (!Array.isArray(parsed))
            return [];
        return parsed.slice(0, 400).filter((item) =>
            item && BUILDER_VARIANTS[item.type]?.some((variant) => variant.id === item.variant) &&
            Number.isFinite(item.x) && Number.isFinite(item.z) && Number.isFinite(item.rotation));
    }
    catch (_error) {
        return [];
    }
}

function createBuilderPart(item) {
    const part = new THREE.Group();
    part.name = `Bauteil ${item.type} ${item.variant}`;
    part.position.set(item.x, 0, item.z);
    part.rotation.y = THREE.MathUtils.degToRad(item.rotation);
    part.userData.builderItemId = item.id;
    const color = new THREE.Color(item.color || BUILDER_DEFAULT_COLORS[item.type] || "#f1eee5");
    const wallMaterial = new THREE.MeshStandardMaterial({
        color, roughness: 0.88, metalness: 0, envMapIntensity: 0.25
    });
    const frameMaterial = new THREE.MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.54), roughness: 0.58
    });
    const variant = BUILDER_VARIANTS[item.type].find((entry) => entry.id === item.variant) ||
        BUILDER_VARIANTS[item.type][0];

    if (item.type === "wall") {
        const wallLength = THREE.MathUtils.clamp(item.length || variant.length, 0.5, 28.25);
        addBox(part, [wallLength, variant.height, 0.20], wallMaterial,
            [0, variant.height / 2, 0], { radius: 0.025 });
        if (item.variant === "wall-corner")
            addBox(part, [0.20, variant.height, variant.length], wallMaterial,
                [-variant.length / 2 + 0.10, variant.height / 2, variant.length / 2 - 0.10],
                { radius: 0.025 });
    }
    else if (item.type === "window") {
        const glassMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x83b8d4, roughness: 0.08, metalness: 0.08,
            transparent: true, opacity: 0.88, transmission: renderProfileName === "mobile" ? 0 : 0.10,
            clearcoat: 0.78, depthWrite: true
        });
        const y = 1.48;
        // Paneel und Rahmen reichen durch die komplette Wandstärke. Dadurch ist
        // dieselbe Öffnung innen wie außen sichtbar und bleibt ein einziges Objekt.
        addBox(part, [variant.width, variant.height, 0.26], glassMaterial, [0, y, 0],
            { castShadow: false });
        const border = 0.075;
        [-1, 1].forEach((side) => {
            addBox(part, [border, variant.height + border * 2, 0.32], frameMaterial,
                [side * variant.width / 2, y, 0]);
            addBox(part, [variant.width + border * 2, border, 0.32], frameMaterial,
                [0, y + side * variant.height / 2, 0]);
        });
        if (item.variant === "window-double")
            addBox(part, [border, variant.height, 0.325], frameMaterial, [0, y, 0]);
        addBox(part, [variant.width + 0.18, 0.08, 0.38], frameMaterial,
            [0, y - variant.height / 2 - 0.05, 0]);
    }
    else if (item.type === "door") {
        const doorMaterial = variant.style === "glass" ? new THREE.MeshPhysicalMaterial({
            color: 0x789fb2, roughness: 0.10, transparent: true, opacity: 0.80,
            transmission: renderProfileName === "mobile" ? 0 : 0.16, clearcoat: 0.72
        }) : new THREE.MeshStandardMaterial({
            color: variant.style === "wood" ? color.clone().multiplyScalar(0.72) : color,
            roughness: variant.style === "wood" ? 0.70 : 0.40,
            metalness: variant.style === "modern" ? 0.16 : 0
        });
        addBox(part, [variant.width, variant.height, 0.28], doorMaterial,
            [0, variant.height / 2, 0], { radius: 0.025 });
        const frame = 0.075;
        [-1, 1].forEach((side) =>
            addBox(part, [frame, variant.height + frame, 0.34], frameMaterial,
                [side * (variant.width / 2 + frame / 2), variant.height / 2, 0]));
        addBox(part, [variant.width + frame * 2, frame, 0.34], frameMaterial,
            [0, variant.height + frame / 2, 0]);
        if (variant.style === "wood") {
            for (let panel = -0.32; panel <= 0.32; panel += 0.32) {
                const panelY = variant.height * (0.52 + panel * 0.32);
                addBox(part, [variant.width * 0.72, 0.035, 0.018], frameMaterial,
                    [0, panelY, 0.151], { castShadow: false });
                addBox(part, [variant.width * 0.72, 0.035, 0.018], frameMaterial,
                    [0, panelY, -0.151], { castShadow: false });
            }
        }
        const handle = new THREE.MeshStandardMaterial({ color: 0xd7dde0, metalness: 0.82, roughness: 0.20 });
        [-1, 1].forEach((side) => addMesh(part, new THREE.SphereGeometry(0.055, 12, 8), handle,
            side * variant.width * 0.30, variant.height * 0.52, side * 0.18, { castShadow: false }));
    }
    else if (["floor", "grass"].includes(item.type)) {
        const isGrass = item.type === "grass";
        const surfaceMaterial = new THREE.MeshStandardMaterial({
            color, roughness: isGrass ? 0.98 : 0.86, metalness: 0
        });
        addBox(part, [variant.width, isGrass ? 0.07 : 0.10, variant.depth], surfaceMaterial,
            [0, isGrass ? 0.025 : 0.045, 0], { castShadow: false });
        if (!isGrass) {
            const jointMaterial = new THREE.MeshBasicMaterial({ color: 0x4b443d });
            for (let line = -1; line <= 1; line += 1) {
                const alongX = variant.surface !== "wood";
                addBox(part, alongX ? [0.018, 0.008, variant.depth] : [variant.width, 0.008, 0.018],
                    jointMaterial, alongX ? [line, 0.102, 0] : [0, 0.102, line], { castShadow: false });
            }
        }
        else {
            const grassMaterial = new THREE.MeshStandardMaterial({
                color: color.clone().multiplyScalar(1.08), roughness: 1
            });
            for (let index = 0; index < 20; index += 1) {
                const x = ((index * 37) % 19) / 19 * variant.width - variant.width / 2;
                const z = ((index * 61) % 23) / 23 * variant.depth - variant.depth / 2;
                addMesh(part, new THREE.ConeGeometry(0.025, 0.18 + (index % 3) * 0.035, 4),
                    grassMaterial, x, 0.12, z, { castShadow: false });
            }
        }
    }
    else if (item.type === "fence") {
        const fenceMaterial = new THREE.MeshStandardMaterial({
            color,
            roughness: variant.style === "metal" ? 0.48 : 0.90,
            metalness: variant.style === "metal" ? 0.68 : 0.02
        });
        const detailMaterial = new THREE.MeshStandardMaterial({
            color: color.clone().multiplyScalar(0.70),
            roughness: variant.style === "metal" ? 0.42 : 0.94,
            metalness: variant.style === "metal" ? 0.72 : 0
        });
        const length = variant.length;
        const height = variant.height;
        const postWidth = variant.style === "metal" ? 0.09 : 0.14;
        [-length / 2, length / 2].forEach((x) =>
            addBox(part, [postWidth, height + 0.16, postWidth], detailMaterial,
                [x, (height + 0.16) / 2, 0], { radius: 0.018 }));

        if (variant.style === "rail") {
            [0.37, 0.78].forEach((ratio) =>
                addBox(part, [length, 0.12, 0.10], fenceMaterial,
                    [0, height * ratio, 0], { radius: 0.02 }));
            addBox(part, [0.13, height, 0.13], detailMaterial, [0, height / 2, 0], { radius: 0.018 });
        }
        else if (variant.style === "privacy") {
            const slatCount = 15;
            for (let index = 0; index < slatCount; index += 1) {
                const x = -length / 2 + (index + 0.5) * length / slatCount;
                addBox(part, [length / slatCount * 0.88, height - 0.12, 0.075], fenceMaterial,
                    [x, height / 2, 0], { radius: 0.012 });
            }
            [0.20, height - 0.20].forEach((y) =>
                addBox(part, [length, 0.10, 0.11], detailMaterial, [0, y, -0.055], { radius: 0.015 }));
            addBox(part, [length + 0.08, 0.09, 0.13], detailMaterial,
                [0, height + 0.02, 0], { radius: 0.018 });
        }
        else if (variant.style === "metal") {
            const barCount = 13;
            for (let index = 1; index < barCount - 1; index += 1) {
                const x = -length / 2 + index * length / (barCount - 1);
                addBox(part, [0.035, height - 0.10, 0.035], fenceMaterial,
                    [x, height / 2, 0], { castShadow: false });
            }
            [0.22, height - 0.12].forEach((y) =>
                addBox(part, [length, 0.055, 0.055], detailMaterial,
                    [0, y, 0], { castShadow: false }));
        }
        else {
            [0.34, 0.76].forEach((ratio) =>
                addBox(part, [length, 0.09, 0.11], detailMaterial,
                    [0, height * ratio, -0.035], { radius: 0.014 }));
            const slatCount = 12;
            for (let index = 0; index < slatCount; index += 1) {
                const x = -length / 2 + (index + 0.5) * length / slatCount;
                const slatHeight = height - (index % 2) * 0.08;
                addBox(part, [0.12, slatHeight, 0.07], fenceMaterial,
                    [x, slatHeight / 2, 0], { radius: 0.014 });
            }
        }
    }
    else if (item.type === "tree") {
        const defaultTreeColor = BUILDER_DEFAULT_COLORS.tree.toLowerCase();
        const usesNaturalColor = !item.color || item.color.toLowerCase() === defaultTreeColor;
        const crownColor = usesNaturalColor && variant.foliage ?
            new THREE.Color(variant.foliage) : color;
        const trunkMaterial = new THREE.MeshStandardMaterial({
            color: variant.trunk || "#70452d", roughness: 0.96
        });
        const crownMaterial = new THREE.MeshStandardMaterial({
            color: crownColor,
            roughness: 0.94
        });
        const trunkHeight = variant.height * 0.47;
        addMesh(part, new THREE.CylinderGeometry(0.19, 0.28, trunkHeight, 12), trunkMaterial,
            0, trunkHeight / 2, 0);
        if (variant.style === "birch") {
            const barkMarkMaterial = new THREE.MeshStandardMaterial({ color: 0x4b4b42, roughness: 1 });
            [0.28, 0.47, 0.66, 0.84].forEach((ratio) =>
                addMesh(part, new THREE.CylinderGeometry(0.195, 0.205, 0.035, 12), barkMarkMaterial,
                    0, trunkHeight * ratio, 0, { castShadow: false }));
        }
        if (variant.style === "conifer") {
            [0, 0.72, 1.35].forEach((offset, index) =>
                addMesh(part, new THREE.ConeGeometry(variant.crown * (1 - index * 0.16), 2.25, 14),
                    crownMaterial, 0, trunkHeight + 0.55 + offset, 0));
        }
        else if (variant.style === "cypress") {
            const crown = addMesh(part,
                new THREE.SphereGeometry(variant.crown, 16, 14), crownMaterial,
                0, trunkHeight + variant.height * 0.24, 0);
            crown.scale.set(0.70, 2.15, 0.70);
        }
        else if (variant.style === "pine") {
            [[0, 0, 0], [-0.38, -0.16, 0.12], [0.34, -0.08, -0.18], [0.04, 0.42, 0.02]]
                .forEach(([x, y, z], index) => {
                    const crown = addMesh(part, new THREE.SphereGeometry(variant.crown, 15, 11),
                        crownMaterial, x, trunkHeight + variant.crown * 0.92 + y, z);
                    crown.scale.set(1.06 - index * 0.05, 0.48, 0.92);
                });
        }
        else {
            const spread = variant.style === "oak" ? 1.18 : variant.style === "birch" ? 0.75 : 1;
            [[0, 0, 0], [-0.55, -0.18, 0.18], [0.48, -0.12, -0.25], [0.10, 0.50, 0.08]]
                .forEach(([x, y, z], index) => {
                    const crown = addMesh(part, new THREE.SphereGeometry(variant.crown, 16, 12),
                        crownMaterial, x * spread, trunkHeight + variant.crown * 0.72 + y, z * spread);
                    crown.scale.set(spread, 0.78 + index * 0.025, 0.92 * spread);
                });
            if (["fruit", "cherry"].includes(variant.style)) {
                const fruitMaterial = new THREE.MeshStandardMaterial({
                    color: variant.style === "cherry" ? 0xf3a3b5 : 0xc72f26,
                    roughness: 0.82
                });
                for (let index = 0; index < 10; index += 1) {
                    const angle = index * Math.PI * 0.76;
                    const radius = variant.crown * (0.42 + (index % 3) * 0.12);
                    addMesh(part, new THREE.SphereGeometry(0.075, 8, 6), fruitMaterial,
                        Math.cos(angle) * radius,
                        trunkHeight + variant.crown * (0.58 + (index % 4) * 0.16),
                        Math.sin(angle) * radius * 0.82,
                        { castShadow: false });
                }
            }
        }
    }
    return part;
}

function createHouseBuilder() {
    const root = new THREE.Group();
    root.name = "Interaktiver Haus-Baumodus";
    root.visible = false;
    scene.add(root);
    const foundationMaterial = new THREE.MeshStandardMaterial({
        color: 0xcbd5c0, roughness: 0.98, metalness: 0
    });
    const foundation = addBox(root, [20, 0.16, 20], foundationMaterial,
        [0, -0.09, 0], { castShadow: false });
    foundation.receiveShadow = true;
    const grid = new THREE.GridHelper(20, 20, 0x0f766e, 0x64748b);
    grid.position.y = 0.012;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    gridMaterials.forEach((material, index) => {
        material.transparent = true;
        material.opacity = index === 0 ? 0.72 : 0.38;
    });
    root.add(grid);
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.025;
    ground.userData.builderGround = true;
    root.add(ground);
    const perimeter = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(20, 0.12, 20)),
        new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.86 })
    );
    perimeter.position.y = -0.04;
    root.add(perimeter);
    const drawPreview = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({
            color: 0xfacc15, transparent: true, opacity: 0.64,
            roughness: 0.62, depthWrite: false
        })
    );
    drawPreview.name = "Wand-Zeichenvorschau";
    drawPreview.visible = false;
    drawPreview.renderOrder = 19;
    root.add(drawPreview);
    const builderLight = new THREE.DirectionalLight(0xfff1d7, 3.1);
    builderLight.position.set(-8, 14, 10);
    builderLight.castShadow = true;
    builderLight.shadow.mapSize.set(renderProfile.sunShadowSize, renderProfile.sunShadowSize);
    builderLight.shadow.camera.left = -12;
    builderLight.shadow.camera.right = 12;
    builderLight.shadow.camera.top = 12;
    builderLight.shadow.camera.bottom = -12;
    root.add(builderLight);
    root.add(builderLight.target);

    const builder = {
        root, ground, active: false, rotation: 0,
        items: safeBuilderItems(), objects: new Map(), previousView: null,
        selectedId: null, selectionHelper: null, draggingId: null,
        dragStartClient: null, dragMoved: false,
        drawing: false, drawStart: null, drawEnd: null, drawPreview,
        drawStartSnapped: false, drawEndSnapped: false,
        placementPreview: null, placementPreviewHelper: null,
        previewSnap: null, lastHoverPointer: null, placementEnabled: true,
        cameraNavigation: false,
        selectionBox: new THREE.Box3(), selectionAnchor: new THREE.Vector3()
    };
    // Wandecken innerhalb eines sichtbaren 1-m-Rasterfeldes werden zu einem
    // gemeinsamen, exakt deckungsgleichen Eckpunkt zusammengezogen.
    const WALL_ENDPOINT_SNAP_DISTANCE = 0.95;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function save() {
        try {
            localStorage.setItem(BUILDER_STORAGE_KEY, JSON.stringify(builder.items));
        }
        catch (_error) {
            builderStatus.textContent = "Entwurf bleibt nur bis zum Schließen dieser Seite erhalten.";
        }
    }

    function itemById(id) {
        return builder.items.find((item) => item.id === id) || null;
    }

    function variantForItem(item) {
        return BUILDER_VARIANTS[item.type]?.find((variant) => variant.id === item.variant) ||
            BUILDER_VARIANTS[item.type]?.[0] || null;
    }

    function availableVariants(type) {
        const variants = BUILDER_VARIANTS[type] || BUILDER_VARIANTS.wall;
        return variants.filter((variant) => !variant.legacy);
    }

    function wallLengthForItem(item) {
        return THREE.MathUtils.clamp(item?.length || variantForItem(item)?.length || 4, 0.5, 28.25);
    }

    function setWallLengthControls(item = null) {
        const visible = item?.type === "wall";
        builderWallLengthRow.hidden = !visible;
        if (!visible)
            return;
        const length = wallLengthForItem(item);
        builderWallLength.value = String(length);
        builderWallLengthValue.value = `${length.toLocaleString("de-DE", {
            minimumFractionDigits: 2, maximumFractionDigits: 2
        })} m`;
        builderWallLengthValue.textContent = builderWallLengthValue.value;
    }

    function clearSelectionHelper() {
        if (!builder.selectionHelper)
            return;
        builder.root.remove(builder.selectionHelper);
        builder.selectionHelper.geometry?.dispose?.();
        builder.selectionHelper.material?.dispose?.();
        builder.selectionHelper = null;
    }

    function builderTypeLabel(type) {
        return BUILDER_TYPE_LABELS[type] || "Bauteil";
    }

    function updateSelectionToolsPosition() {
        const object = builder.objects.get(builder.selectedId);
        if (!builder.active || !object) {
            builderSelectionTools.hidden = true;
            return;
        }
        const box = builder.selectionBox.setFromObject(object);
        const anchor = box.getCenter(builder.selectionAnchor);
        anchor.y = box.max.y + 0.34;
        anchor.project(camera);
        if (anchor.z < -1 || anchor.z > 1) {
            builderSelectionTools.hidden = true;
            return;
        }
        const canvasRect = canvas.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        const x = canvasRect.left - stageRect.left + (anchor.x + 1) * canvasRect.width / 2;
        const y = canvasRect.top - stageRect.top + (1 - anchor.y) * canvasRect.height / 2;
        builderSelectionTools.style.left = `${THREE.MathUtils.clamp(x, 74, stageRect.width - 74)}px`;
        builderSelectionTools.style.top = `${THREE.MathUtils.clamp(y, 60, stageRect.height - 18)}px`;
        builderSelectionTools.hidden = false;
    }

    function refreshSelectionHelper() {
        clearSelectionHelper();
        const object = builder.objects.get(builder.selectedId);
        if (!object) {
            builderSelectionTools.hidden = true;
            return;
        }
        builder.selectionHelper = new THREE.BoxHelper(object, 0xfacc15);
        builder.selectionHelper.name = "Ausgewähltes Bauteil";
        builder.selectionHelper.material.depthTest = false;
        builder.selectionHelper.material.transparent = true;
        builder.selectionHelper.material.opacity = 0.96;
        builder.selectionHelper.renderOrder = 20;
        builder.root.add(builder.selectionHelper);
        updateSelectionToolsPosition();
    }

    function syncControlsFromItem(item) {
        if (item.type === "wall" && !Number.isFinite(item.length))
            item.length = variantForItem(item)?.length || 4;
        builderPartType.value = item.type;
        refreshVariants(item.variant);
        builderColor.value = item.color || BUILDER_DEFAULT_COLORS[item.type] || "#f1eee5";
        builderSwatches.querySelectorAll("button").forEach((button) =>
            button.classList.toggle("selected",
                button.style.getPropertyValue("--builder-swatch").toLowerCase() === builderColor.value.toLowerCase()));
        setRotation(item.rotation);
        setWallLengthControls(item);
    }

    function updateBuilderToolUi() {
        const selectionOnly = !builder.placementEnabled && !builder.cameraNavigation;
        builderPointerMode.classList.toggle("selected", selectionOnly);
        builderPointerMode.setAttribute("aria-pressed", String(selectionOnly));
        builderTouchBuild?.classList.toggle("selected", !builder.cameraNavigation);
        builderTouchBuild?.setAttribute("aria-pressed", String(!builder.cameraNavigation));
        builderTouchCamera?.classList.toggle("selected", builder.cameraNavigation);
        builderTouchCamera?.setAttribute("aria-pressed", String(builder.cameraNavigation));
        stage.dataset.builderCamera = String(builder.cameraNavigation);
        stage.dataset.builderTool = builder.cameraNavigation ? "camera" :
            selectionOnly ? "select" : builderPartType.value;
    }

    function setPlacementEnabled(enabled) {
        builder.placementEnabled = Boolean(enabled);
        builder.cameraNavigation = false;
        updateBuilderToolUi();
        if (builder.placementEnabled)
            refreshPlacementPreview();
        else
            disposePlacementPreview();
    }

    function startNewPart() {
        setPlacementEnabled(true);
        selectItem(null, builderPartType.value === "wall" ?
            "Neue Wand: Start- und Endpunkt auf dem Raster ziehen." :
            ["window", "door"].includes(builderPartType.value) ?
                "Neues Fenster oder neue Tür direkt auf eine Wand tippen." :
                `${builderTypeLabel(builderPartType.value)} auf einer freien Fläche platzieren.`);
    }

    function activatePointerMode() {
        finishWallDrawing(true);
        setPlacementEnabled(false);
        selectItem(null, "Auswahl/Maus aktiv: links verschieben, rechts drehen, Mausrad zoomen.");
    }

    function setCameraNavigation(enabled) {
        builder.cameraNavigation = Boolean(enabled);
        finishWallDrawing(true);
        builder.draggingId = null;
        builder.dragStartClient = null;
        builder.dragMoved = false;
        if (builder.cameraNavigation) {
            disposePlacementPreview();
            builderSelectionTools.hidden = true;
            if (window.innerWidth <= 900)
                setPanelCollapsed(true);
            updateStatus("Kamera aktiv: mit einem Finger drehen, mit zwei Fingern verschieben und zoomen.");
        }
        else {
            if (builder.selectedId)
                updateSelectionToolsPosition();
            else if (builder.placementEnabled)
                refreshPlacementPreview();
            updateStatus(builder.placementEnabled ?
                `${builderTypeLabel(builderPartType.value)} wieder aktiv – jetzt auf dem Grundstück platzieren.` :
                "Auswahl wieder aktiv – vorhandenes Bauteil antippen.");
        }
        updateBuilderToolUi();
    }

    function selectItem(id, message = "") {
        builder.selectedId = builder.objects.has(id) ? id : null;
        const item = itemById(builder.selectedId);
        if (item) {
            syncControlsFromItem(item);
            builder.placementEnabled = false;
            updateBuilderToolUi();
        }
        else
            setWallLengthControls(null);
        if (item)
            disposePlacementPreview();
        else
            refreshPlacementPreview();
        refreshSelectionHelper();
        updateStatus(message || (item ?
            `${builderTypeLabel(item.type)} ausgewählt: ziehen zum Verschieben, Symbole direkt am Objekt zum Drehen oder Löschen.` :
            builderPartType.value === "wall" ? "Neue Wand: Start- und Endpunkt auf dem Raster ziehen." :
                ["window", "door"].includes(builderPartType.value) ?
                    "Fenster oder Tür wählen und direkt auf eine Wand tippen." :
                    `${builderTypeLabel(builderPartType.value)} auf einer freien Fläche platzieren.`));
    }

    function wallSegments(item) {
        const variant = variantForItem(item);
        if (!variant)
            return [];
        const wallLength = wallLengthForItem(item);
        const angle = THREE.MathUtils.degToRad(item.rotation);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const segments = [{
            x: item.x, z: item.z, length: wallLength,
            axisX: cos, axisZ: -sin, normalX: sin, normalZ: cos,
            rotation: item.rotation
        }];
        if (item.variant === "wall-corner") {
            const localX = -variant.length / 2 + 0.10;
            const localZ = variant.length / 2 - 0.10;
            segments.push({
                x: item.x + cos * localX + sin * localZ,
                z: item.z - sin * localX + cos * localZ,
                length: variant.length,
                axisX: sin, axisZ: cos, normalX: cos, normalZ: -sin,
                rotation: item.rotation + 90
            });
        }
        return segments;
    }

    function wallEndpoints(excludeWallId = null) {
        const endpoints = [];
        builder.items.filter((item) => item.type === "wall" && item.id !== excludeWallId)
            .forEach((wall) => wallSegments(wall).forEach((segment, wallSegment) => {
                [-1, 1].forEach((direction) => endpoints.push({
                    x: segment.x + segment.axisX * segment.length / 2 * direction,
                    z: segment.z + segment.axisZ * segment.length / 2 * direction,
                    wallId: wall.id,
                    wallSegment,
                    direction
                }));
            }));
        return endpoints;
    }

    function snapWallPoint(point, excludeWallId = null) {
        let best = null;
        wallEndpoints(excludeWallId).forEach((endpoint) => {
            const distance = Math.hypot(point.x - endpoint.x, point.z - endpoint.z);
            if ((!best || distance < best.distance) && distance <= WALL_ENDPOINT_SNAP_DISTANCE)
                best = { ...endpoint, distance };
        });
        return best ? {
            point: new THREE.Vector3(best.x, 0, best.z),
            snapped: true,
            wallId: best.wallId,
            wallSegment: best.wallSegment,
            direction: best.direction
        } : { point: point.clone(), snapped: false, wallId: null };
    }

    function snapMovedWallCenter(item, rawX, rawZ) {
        if (item.type !== "wall")
            return { x: rawX, z: rawZ, snapped: false };
        const candidate = { ...item, x: rawX, z: rawZ };
        let best = null;
        wallSegments(candidate).forEach((segment) => {
            [-1, 1].forEach((direction) => {
                const endpointX = segment.x + segment.axisX * segment.length / 2 * direction;
                const endpointZ = segment.z + segment.axisZ * segment.length / 2 * direction;
                wallEndpoints(item.id).forEach((target) => {
                    const distance = Math.hypot(endpointX - target.x, endpointZ - target.z);
                    if ((!best || distance < best.distance) && distance <= WALL_ENDPOINT_SNAP_DISTANCE) {
                        best = {
                            distance,
                            x: rawX + target.x - endpointX,
                            z: rawZ + target.z - endpointZ
                        };
                    }
                });
            });
        });
        return best ? { x: best.x, z: best.z, snapped: true } : { x: rawX, z: rawZ, snapped: false };
    }

    function snapOpeningToWall(item, rawX, rawZ, onlyWallId = null) {
        if (!["window", "door"].includes(item.type))
            return { x: rawX, z: rawZ, rotation: item.rotation, wallId: null };
        const opening = variantForItem(item);
        let best = null;
        builder.items.filter((candidate) => candidate.type === "wall" &&
            (!onlyWallId || candidate.id === onlyWallId)).forEach((wall) => {
            wallSegments(wall).forEach((segment, wallSegment) => {
                const dx = rawX - segment.x;
                const dz = rawZ - segment.z;
                const half = Math.max(0.05, segment.length / 2 - (opening?.width || 0.8) / 2 - 0.08);
                const progress = THREE.MathUtils.clamp(dx * segment.axisX + dz * segment.axisZ, -half, half);
                const projectedX = segment.x + segment.axisX * progress;
                const projectedZ = segment.z + segment.axisZ * progress;
                const distance = Math.hypot(rawX - projectedX, rawZ - projectedZ);
                if (!best || distance < best.distance) {
                    const side = (dx * segment.normalX + dz * segment.normalZ) < 0 ? -1 : 1;
                    best = {
                        distance,
                        x: projectedX,
                        z: projectedZ,
                        rotation: ((segment.rotation + (side < 0 ? 180 : 0)) % 360 + 360) % 360,
                        wallId: wall.id, wallSegment, wallProgress: progress, wallSide: side
                    };
                }
            });
        });
        return best?.distance <= 1.25 ? best : null;
    }

    function applyItemTransform(item) {
        const object = builder.objects.get(item.id);
        if (!object)
            return;
        object.position.set(item.x, 0, item.z);
        object.rotation.y = THREE.MathUtils.degToRad(item.rotation);
    }

    function positionOpeningOnWall(item) {
        if (!["window", "door"].includes(item.type) || !item.wallId)
            return false;
        const wall = itemById(item.wallId);
        const opening = variantForItem(item);
        if (!wall || wall.type !== "wall" || !opening)
            return false;
        const segments = wallSegments(wall);
        const segmentIndex = Math.min(Math.max(Number(item.wallSegment) || 0, 0), segments.length - 1);
        const segment = segments[segmentIndex];
        if (!segment)
            return false;
        const inferred = (item.x - segment.x) * segment.axisX + (item.z - segment.z) * segment.axisZ;
        const half = Math.max(0.05, segment.length / 2 - (opening.width || 0.8) / 2 - 0.08);
        const progress = THREE.MathUtils.clamp(
            Number.isFinite(item.wallProgress) ? item.wallProgress : inferred,
            -half, half
        );
        const side = Number(item.wallSide) < 0 ? -1 : 1;
        item.wallProgress = progress;
        item.wallSide = side;
        item.wallSegment = segmentIndex;
        item.x = Math.round((segment.x + segment.axisX * progress) * 100) / 100;
        item.z = Math.round((segment.z + segment.axisZ * progress) * 100) / 100;
        item.rotation = ((segment.rotation + (side < 0 ? 180 : 0)) % 360 + 360) % 360;
        applyItemTransform(item);
        if (builder.selectedId === item.id)
            builder.selectionHelper?.update();
        return true;
    }

    function updateAttachedOpenings(wallId) {
        builder.items.filter((item) => item.wallId === wallId).forEach(positionOpeningOnWall);
        builder.selectionHelper?.update();
    }

    function pointerOnGround(event) {
        const rect = canvas.getBoundingClientRect();
        pointer.set(
            (event.clientX - rect.left) / rect.width * 2 - 1,
            -(event.clientY - rect.top) / rect.height * 2 + 1
        );
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObject(builder.ground, false)[0];
        return hit ? builder.root.worldToLocal(hit.point.clone()) : null;
    }

    function itemIdFromObject(object) {
        let current = object;
        while (current && current !== builder.root) {
            if (current.userData?.builderItemId)
                return current.userData.builderItemId;
            current = current.parent;
        }
        return null;
    }

    function builderItemHitAtPointer(event) {
        const rect = canvas.getBoundingClientRect();
        pointer.set(
            (event.clientX - rect.left) / rect.width * 2 - 1,
            -(event.clientY - rect.top) / rect.height * 2 + 1
        );
        raycaster.setFromCamera(pointer, camera);
        for (const hit of raycaster.intersectObjects(Array.from(builder.objects.values()), true)) {
            const id = itemIdFromObject(hit.object);
            if (id)
                return { id, point: builder.root.worldToLocal(hit.point.clone()) };
        }
        return null;
    }

    function wallHitAtPointer(event) {
        const rect = canvas.getBoundingClientRect();
        pointer.set(
            (event.clientX - rect.left) / rect.width * 2 - 1,
            -(event.clientY - rect.top) / rect.height * 2 + 1
        );
        raycaster.setFromCamera(pointer, camera);
        for (const hit of raycaster.intersectObjects(Array.from(builder.objects.values()), true)) {
            const id = itemIdFromObject(hit.object);
            if (itemById(id)?.type === "wall")
                return { id, point: builder.root.worldToLocal(hit.point.clone()) };
        }
        return null;
    }

    function itemAtPointer(event) {
        return builderItemHitAtPointer(event)?.id || null;
    }

    function updateStatus(message = "") {
        const count = builder.items.length;
        builderUndo.disabled = count === 0;
        builderClear.disabled = count === 0;
        builderDelete.disabled = !builder.selectedId;
        builderStatus.textContent = message || (count === 0 ?
            "Noch keine Bauteile gesetzt." :
            builder.selectedId ? "Bauteil ausgewählt: ziehen oder mit den Pfeilen drehen." :
                `${count} ${count === 1 ? "Bauteil" : "Bauteile"} gespeichert.`);
        stage.dataset.builderItemCount = String(count);
        stage.dataset.builderSelection = builder.selectedId ? "true" : "false";
    }

    function addItemObject(item) {
        const object = createBuilderPart(item);
        builder.root.add(object);
        builder.objects.set(item.id, object);
    }

    function replaceItemObject(item) {
        const previous = builder.objects.get(item.id);
        if (previous)
            builder.root.remove(previous);
        addItemObject(item);
        refreshSelectionHelper();
        renderer.shadowMap.needsUpdate = true;
    }

    function rebuild() {
        clearSelectionHelper();
        builder.objects.forEach((object) => builder.root.remove(object));
        builder.objects.clear();
        builder.items.forEach(addItemObject);
        if (!builder.objects.has(builder.selectedId))
            builder.selectedId = null;
        refreshSelectionHelper();
        updateStatus();
    }

    function selectedVariant() {
        const variants = availableVariants(builderPartType.value);
        return variants.find((variant) => variant.id === builderVariant.value) || variants[0];
    }

    function disposePlacementPreview() {
        if (builder.placementPreview) {
            builder.root.remove(builder.placementPreview);
            builder.placementPreview.traverse((child) => {
                child.geometry?.dispose?.();
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.filter(Boolean).forEach((material) => material.dispose?.());
            });
        }
        if (builder.placementPreviewHelper) {
            builder.root.remove(builder.placementPreviewHelper);
            builder.placementPreviewHelper.geometry?.dispose?.();
            builder.placementPreviewHelper.material?.dispose?.();
        }
        builder.placementPreview = null;
        builder.placementPreviewHelper = null;
        builder.previewSnap = null;
        stage.dataset.builderPlacementPreview = "hidden";
    }

    function createPlacementPreview() {
        disposePlacementPreview();
        const type = builderPartType.value;
        if (!builder.active || !builder.placementEnabled || builder.selectedId || !BUILDER_VARIANTS[type])
            return null;
        const variant = selectedVariant();
        const previewItem = {
            id: "builder-placement-preview",
            type,
            variant: variant.id,
            color: builderColor.value,
            rotation: builder.rotation,
            x: 0,
            z: 0
        };
        if (type === "wall")
            previewItem.length = 0.5;
        const preview = createBuilderPart(previewItem);
        preview.name = `${builderTypeLabel(type)}-Platzierungsvorschau`;
        const sourceMaterialsToDispose = new Set();
        preview.traverse((child) => {
            if (!child.isMesh)
                return;
            child.castShadow = false;
            child.receiveShadow = false;
            child.renderOrder = 18;
            const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
            const previewMaterials = sourceMaterials.map((source) => {
                sourceMaterialsToDispose.add(source);
                const material = source.clone();
                material.transparent = true;
                material.opacity = Math.min(source.opacity ?? 1, 0.62);
                material.depthWrite = false;
                if (material.emissive)
                    material.emissive.set(0x0f766e).multiplyScalar(0.38);
                return material;
            });
            child.material = Array.isArray(child.material) ? previewMaterials : previewMaterials[0];
        });
        sourceMaterialsToDispose.forEach((material) => material.dispose?.());
        preview.visible = false;
        builder.root.add(preview);
        const helper = new THREE.BoxHelper(preview, 0xef4444);
        helper.name = "Platzierungsvorschau-Rahmen";
        helper.material.depthTest = false;
        helper.material.transparent = true;
        helper.material.opacity = 0.92;
        helper.renderOrder = 19;
        helper.visible = false;
        builder.root.add(helper);
        builder.placementPreview = preview;
        builder.placementPreviewHelper = helper;
        return preview;
    }

    function openingPlacementAtPointer(event) {
        const type = builderPartType.value;
        if (!["window", "door"].includes(type))
            return null;
        const wallHit = wallHitAtPointer(event);
        const groundPoint = pointerOnGround(event);
        const rawPoint = wallHit?.point || groundPoint;
        if (!rawPoint)
            return null;
        const variant = selectedVariant();
        const draft = {
            type,
            variant: variant.id,
            color: builderColor.value,
            rotation: builder.rotation,
            x: rawPoint.x,
            z: rawPoint.z
        };
        const snap = wallHit ? snapOpeningToWall(draft, rawPoint.x, rawPoint.z, wallHit.id) : null;
        return { point: rawPoint, snap, variant, wallId: wallHit?.id || null };
    }

    function previewPlacementAtPointer(event) {
        const type = builderPartType.value;
        if (["window", "door"].includes(type)) {
            const opening = openingPlacementAtPointer(event);
            if (!opening)
                return null;
            return {
                x: opening.snap?.x ?? opening.point.x,
                z: opening.snap?.z ?? opening.point.z,
                rotation: opening.snap?.rotation ?? builder.rotation,
                snap: opening.snap || null,
                valid: Boolean(opening.snap)
            };
        }
        const point = pointerOnGround(event);
        if (!point)
            return null;
        if (type === "wall") {
            const snapped = snappedWallOrGridPoint(point);
            return {
                x: snapped.point.x,
                z: snapped.point.z,
                rotation: builder.rotation,
                snap: snapped.snapped ? snapped : null,
                valid: true
            };
        }
        return {
            x: THREE.MathUtils.clamp(Math.round(point.x * 2) / 2, -9.5, 9.5),
            z: THREE.MathUtils.clamp(Math.round(point.z * 2) / 2, -9.5, 9.5),
            rotation: builder.rotation,
            snap: null,
            valid: true
        };
    }

    function updatePlacementPreview(event) {
        if (!builder.active || !builder.placementEnabled) {
            disposePlacementPreview();
            return false;
        }
        builder.lastHoverPointer = { clientX: event.clientX, clientY: event.clientY };
        if (builder.selectedId || builder.drawing) {
            disposePlacementPreview();
            return false;
        }
        const placement = previewPlacementAtPointer(event);
        const preview = builder.placementPreview || createPlacementPreview();
        if (!placement || !preview)
            return false;
        preview.position.set(placement.x, 0, placement.z);
        preview.rotation.y = THREE.MathUtils.degToRad(placement.rotation);
        preview.visible = true;
        builder.previewSnap = placement.snap || null;
        const valid = placement.valid;
        preview.traverse((child) => {
            if (!child.isMesh)
                return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.filter(Boolean).forEach((material) => {
                if (material.emissive)
                    material.emissive.set(valid ? 0x0f766e : 0x7f1d1d).multiplyScalar(valid ? 0.50 : 0.72);
            });
        });
        if (builder.placementPreviewHelper) {
            builder.placementPreviewHelper.material.color.set(valid ? 0x2dd4bf : 0xef4444);
            builder.placementPreviewHelper.visible = true;
            builder.placementPreviewHelper.update();
        }
        stage.dataset.builderPlacementPreview = valid ? "valid" : "invalid";
        return valid;
    }

    function refreshPlacementPreview() {
        createPlacementPreview();
        if (builder.lastHoverPointer)
            updatePlacementPreview(builder.lastHoverPointer);
    }

    function leavePlacementPreview() {
        builder.lastHoverPointer = null;
        disposePlacementPreview();
    }

    function refreshVariants(preferredVariant = null) {
        const variants = availableVariants(builderPartType.value);
        builderVariant.replaceChildren(...variants.map((variant) => {
            const option = document.createElement("option");
            option.value = variant.id;
            option.textContent = variant.label;
            return option;
        }));
        if (preferredVariant && variants.some((variant) => variant.id === preferredVariant))
            builderVariant.value = preferredVariant;
        builderVariantLabel.textContent = builderPartType.value === "wall" ? "Wandhöhe" :
            ["floor", "grass"].includes(builderPartType.value) ? "Oberfläche" :
                builderPartType.value === "tree" ? "Baumart" :
                    builderPartType.value === "fence" ? "Zaunart" : "Ausführung";
    }

    function setRotation(value) {
        builder.rotation = ((Math.round(value / BUILDER_ROTATION_STEP) * BUILDER_ROTATION_STEP % 360) + 360) % 360;
        builderRotation.value = `${builder.rotation}°`;
        builderRotation.textContent = `${builder.rotation}°`;
    }

    function snappedGroundPoint(point) {
        return new THREE.Vector3(
            THREE.MathUtils.clamp(Math.round(point.x * 4) / 4, -10, 10),
            0,
            THREE.MathUtils.clamp(Math.round(point.z * 4) / 4, -10, 10)
        );
    }

    function snappedWallOrGridPoint(point) {
        const endpointSnap = snapWallPoint(point);
        return endpointSnap.snapped ? endpointSnap : {
            point: snappedGroundPoint(point),
            snapped: false,
            wallId: null
        };
    }

    function orthogonalWallPoint(start, point) {
        const snapped = snappedGroundPoint(point);
        const dx = snapped.x - start.x;
        const dz = snapped.z - start.z;
        return Math.abs(dx) >= Math.abs(dz) ?
            new THREE.Vector3(snapped.x, 0, start.z) :
            new THREE.Vector3(start.x, 0, snapped.z);
    }

    function updateWallPreview(point) {
        if (!builder.drawing || !builder.drawStart)
            return false;
        disposePlacementPreview();
        const constrainedPoint = orthogonalWallPoint(builder.drawStart, point);
        const candidateSnap = snapWallPoint(constrainedPoint);
        const axisAlignedSnap = candidateSnap.snapped &&
            (Math.abs(candidateSnap.point.x - builder.drawStart.x) < 0.001 ||
                Math.abs(candidateSnap.point.z - builder.drawStart.z) < 0.001);
        const endpointSnap = axisAlignedSnap ? candidateSnap : {
            point: constrainedPoint,
            snapped: false,
            wallId: null
        };
        builder.drawEnd = endpointSnap.point;
        builder.drawEndSnapped = endpointSnap.snapped;
        const dx = builder.drawEnd.x - builder.drawStart.x;
        const dz = builder.drawEnd.z - builder.drawStart.z;
        const length = THREE.MathUtils.clamp(Math.hypot(dx, dz), 0.01, 28.25);
        const variant = selectedVariant();
        const rotation = THREE.MathUtils.radToDeg(Math.atan2(-dz, dx));
        builder.drawPreview.position.set(
            (builder.drawStart.x + builder.drawEnd.x) / 2,
            variant.height / 2,
            (builder.drawStart.z + builder.drawEnd.z) / 2
        );
        builder.drawPreview.rotation.y = THREE.MathUtils.degToRad(rotation);
        builder.drawPreview.scale.set(length, variant.height, 0.20);
        builder.drawPreview.visible = true;
        setRotation(rotation);
        setWallLengthControls({ type: "wall", variant: variant.id, length });
        updateStatus(`Wandlänge: ${length.toLocaleString("de-DE", {
            minimumFractionDigits: 2, maximumFractionDigits: 2
        })} m${endpointSnap.snapped ? " · Ecke eingerastet" : ""} · loslassen zum Setzen.`);
        return true;
    }

    function finishWallDrawing(cancelled = false) {
        if (!builder.drawing)
            return false;
        const start = builder.drawStart;
        const end = builder.drawEnd || builder.drawStart;
        const length = Math.hypot(end.x - start.x, end.z - start.z);
        const connectedCorners = Number(builder.drawStartSnapped) + Number(builder.drawEndSnapped);
        builder.drawing = false;
        builder.drawStart = null;
        builder.drawEnd = null;
        builder.drawStartSnapped = false;
        builder.drawEndSnapped = false;
        builder.drawPreview.visible = false;
        if (cancelled || length < 0.5) {
            setWallLengthControls(null);
            updateStatus(cancelled ? "Wandzeichnung abgebrochen." : "Wand mindestens 0,50 m lang ziehen.");
            return true;
        }
        const variant = selectedVariant();
        const item = {
            id: globalThis.crypto?.randomUUID?.() || `part-${Date.now()}-${builder.items.length}`,
            type: "wall", variant: variant.id, color: builderColor.value,
            length: Math.round(Math.min(length, 28.25) * 100) / 100,
            rotation: ((Math.round(THREE.MathUtils.radToDeg(Math.atan2(-(end.z - start.z), end.x - start.x)) /
                BUILDER_ROTATION_STEP) * BUILDER_ROTATION_STEP % 360) + 360) % 360,
            x: Math.round(((start.x + end.x) / 2) * 100) / 100,
            z: Math.round(((start.z + end.z) / 2) * 100) / 100
        };
        builder.items.push(item);
        addItemObject(item);
        save();
        selectItem(item.id, connectedCorners ?
            `Wand mit ${item.length.toLocaleString("de-DE")} m Länge und ${connectedCorners} eingerasteten ${connectedCorners === 1 ? "Ecke" : "Ecken"} gesetzt.` :
            `Freie Wand mit ${item.length.toLocaleString("de-DE")} m Länge gesetzt.`);
        renderer.shadowMap.needsUpdate = true;
        return true;
    }

    function rotateSelection(delta) {
        const item = itemById(builder.selectedId);
        if (!item) {
            setRotation(builder.rotation + delta);
            refreshPlacementPreview();
            return;
        }
        if (["window", "door"].includes(item.type) && item.wallId) {
            item.wallSide = Number(item.wallSide) < 0 ? 1 : -1;
            positionOpeningOnWall(item);
        }
        else {
            item.rotation = ((Math.round((item.rotation + delta) / BUILDER_ROTATION_STEP) *
                BUILDER_ROTATION_STEP % 360) + 360) % 360;
            if (item.type === "wall")
                updateAttachedOpenings(item.id);
            applyItemTransform(item);
        }
        setRotation(item.rotation);
        refreshSelectionHelper();
        save();
        updateStatus(["window", "door"].includes(item.type) ?
            "Öffnungsrichtung an der Wand gewechselt." : `Auswahl auf ${Math.round(item.rotation)}° gedreht.`);
    }

    function placeAtPointer(event) {
        if (!builder.active || !builder.placementEnabled || builder.selectedId)
            return false;
        const selectedType = builderPartType.value;
        const openingType = ["window", "door"].includes(selectedType);
        const openingPlacement = openingType ? openingPlacementAtPointer(event) : null;
        if (selectedType === "wall") {
            updateStatus("Eine Wand wird durch Ziehen vom Start- bis zum Endpunkt erstellt.");
            return false;
        }
        if (openingType && !openingPlacement?.snap) {
            updateStatus("Fenster und Türen können nur direkt auf einer vorhandenen Wand sitzen.");
            return false;
        }
        const point = openingType ? openingPlacement.point : pointerOnGround(event);
        if (!point)
            return false;
        let x = THREE.MathUtils.clamp(Math.round(point.x * 2) / 2, -9.5, 9.5);
        let z = THREE.MathUtils.clamp(Math.round(point.z * 2) / 2, -9.5, 9.5);
        const variant = selectedVariant();
        const item = {
            id: globalThis.crypto?.randomUUID?.() || `part-${Date.now()}-${builder.items.length}`,
            type: selectedType,
            variant: variant.id,
            color: builderColor.value,
            rotation: builder.rotation,
            x, z
        };
        const snapped = openingType ? openingPlacement.snap : null;
        if (["window", "door"].includes(item.type) && !snapped) {
            updateStatus(`${variant.label}: bitte direkt auf oder neben eine vorhandene Wand tippen.`);
            return false;
        }
        if (snapped) {
            x = THREE.MathUtils.clamp(Math.round(snapped.x * 100) / 100, -9.5, 9.5);
            z = THREE.MathUtils.clamp(Math.round(snapped.z * 100) / 100, -9.5, 9.5);
            Object.assign(item, {
                x, z, rotation: snapped.rotation, wallId: snapped.wallId,
                wallSegment: snapped.wallSegment, wallProgress: snapped.wallProgress,
                wallSide: snapped.wallSide
            });
        }
        builder.items.push(item);
        addItemObject(item);
        save();
        selectItem(item.id, `${variant.label}${snapped?.wallId ? " an Wand eingerastet" : " gesetzt"}.`);
        renderer.shadowMap.needsUpdate = true;
        return true;
    }

    function beginPointer(event) {
        if (!builder.active || builder.cameraNavigation || event.button !== 0)
            return false;
        const hit = builderItemHitAtPointer(event);
        const id = hit?.id || null;
        if (builder.placementEnabled && builderPartType.value === "wall") {
            const point = pointerOnGround(event);
            if (!point)
                return false;
            const startSnap = snappedWallOrGridPoint(hit?.point || point);
            const hitItem = itemById(id);
            const startsAtWallEnd = startSnap.snapped && hitItem?.type === "wall" && startSnap.wallId === hitItem.id;
            if (!id || startsAtWallEnd) {
                builder.drawing = true;
                builder.drawStart = startSnap.point;
                builder.drawEnd = builder.drawStart.clone();
                builder.drawStartSnapped = startSnap.snapped;
                builder.drawEndSnapped = false;
                builder.dragStartClient = { x: event.clientX, y: event.clientY };
                builder.dragMoved = false;
                updateWallPreview(builder.drawEnd);
                return true;
            }
        }
        if (!id)
            return false;
        const clickedItem = itemById(id);
        // Im Fenster-/Türwerkzeug bedeutet ein Klick auf eine Wand „hier
        // einsetzen“. Bereits gesetzte Fenster und Türen bleiben weiterhin
        // direkt auswähl- und verschiebbar.
        if (builder.placementEnabled && ["window", "door"].includes(builderPartType.value) &&
            clickedItem?.type === "wall")
            return false;
        selectItem(id);
        builder.draggingId = id;
        builder.dragStartClient = { x: event.clientX, y: event.clientY };
        builder.dragMoved = false;
        return true;
    }

    function movePointer(event) {
        if (builder.drawing) {
            const point = wallHitAtPointer(event)?.point || pointerOnGround(event);
            if (point) {
                updateWallPreview(point);
                builder.dragMoved = true;
            }
            return true;
        }
        const item = itemById(builder.draggingId);
        if (!item)
            return false;
        const movedPixels = Math.hypot(
            event.clientX - builder.dragStartClient.x,
            event.clientY - builder.dragStartClient.y
        );
        if (movedPixels < 4)
            return true;
        const wallHit = ["window", "door"].includes(item.type) ? wallHitAtPointer(event) : null;
        const point = wallHit?.point || pointerOnGround(event);
        if (!point)
            return true;
        let x = THREE.MathUtils.clamp(Math.round(point.x * 2) / 2, -9.5, 9.5);
        let z = THREE.MathUtils.clamp(Math.round(point.z * 2) / 2, -9.5, 9.5);
        const snapped = ["window", "door"].includes(item.type) ?
            (wallHit ? snapOpeningToWall(item, x, z, wallHit.id) : null) : null;
        if (["window", "door"].includes(item.type) && !snapped) {
            updateStatus("Fenster und Türen bleiben an einer Wand eingerastet.");
            return true;
        }
        if (snapped) {
            x = Math.round(snapped.x * 100) / 100;
            z = Math.round(snapped.z * 100) / 100;
            item.rotation = snapped.rotation;
            item.wallId = snapped.wallId;
            item.wallSegment = snapped.wallSegment;
            item.wallProgress = snapped.wallProgress;
            item.wallSide = snapped.wallSide;
            setRotation(item.rotation);
        }
        else if (item.type === "wall") {
            const wallSnap = snapMovedWallCenter(item, x, z);
            x = THREE.MathUtils.clamp(Math.round(wallSnap.x * 100) / 100, -9.5, 9.5);
            z = THREE.MathUtils.clamp(Math.round(wallSnap.z * 100) / 100, -9.5, 9.5);
        }
        item.x = x;
        item.z = z;
        applyItemTransform(item);
        if (item.type === "wall")
            updateAttachedOpenings(item.id);
        builder.selectionHelper?.update();
        builder.dragMoved = true;
        updateStatus(`Auswahl bei ${x.toLocaleString("de-DE")} / ${z.toLocaleString("de-DE")} m.`);
        return true;
    }

    function endPointer(cancelled = false) {
        if (builder.drawing)
            return finishWallDrawing(cancelled);
        if (!builder.draggingId)
            return false;
        if (builder.dragMoved) {
            save();
            renderer.shadowMap.needsUpdate = true;
            updateStatus("Bauteil verschoben und gespeichert.");
        }
        builder.draggingId = null;
        builder.dragStartClient = null;
        builder.dragMoved = false;
        return true;
    }

    function setPanelCollapsed(collapsed) {
        builderPanel.classList.toggle("is-collapsed", collapsed);
        builderPanelToggle.setAttribute("aria-expanded", String(!collapsed));
        builderPanelToggle.textContent = collapsed ? "⌃" : "⌄";
        builderPanelToggle.setAttribute("aria-label", collapsed ?
            "Werkzeuge ausklappen" : "Werkzeuge einklappen");
    }

    function setActive(active) {
        if (builder.active === active)
            return;
        builder.active = active;
        builderPanel.hidden = !active;
        stage.classList.toggle("is-building", active);
        stage.dataset.builderActive = String(active);
        world.visible = !active;
        builder.root.visible = active;
        if (!active) {
            builder.cameraNavigation = false;
            builderSelectionTools.hidden = true;
            leavePlacementPreview();
            houseInstructions.textContent = "Ziehen: drehen · Zwei Finger/Rechtsklick: verschieben · Zoom: Details";
        }
        if (active) {
            builder.cameraNavigation = false;
            builder.previousView = {
                yaw: state.targetYaw, pitch: state.targetPitch,
                panX: state.targetPanX, panY: state.targetPanY, zoom: state.targetZoom
            };
            cameraTarget.set(0, 1.10, 0);
            state.targetYaw = -0.58;
            state.targetPitch = -0.25;
            state.targetPanX = 0;
            state.targetPanY = 0;
            state.targetZoom = 0.92;
            setMenuOpen(false);
            setPanelCollapsed(window.innerWidth <= 900);
            activatePointerMode();
            houseInstructions.textContent = "Baumodus: rechts ziehen = drehen · Auswahl/Maus: links ziehen = verschieben · Mausrad = Zoom";
            updateStatus("Auswahl/Maus ist aktiv. Erst nach Wahl eines Bauteils oder „Neues Bauteil“ wird etwas gesetzt.");
        }
        else {
            finishWallDrawing(true);
            cameraTarget.set(0, 2.1, 0);
            const view = builder.previousView || DEFAULT_VIEW;
            state.targetYaw = view.yaw;
            state.targetPitch = view.pitch;
            state.targetPanX = view.panX;
            state.targetPanY = view.panY;
            state.targetZoom = view.zoom;
            updateLiveUi();
        }
        renderer.shadowMap.needsUpdate = true;
    }

    refreshVariants();
    setRotation(0);
    updateBuilderToolUi();
    BUILDER_COLOR_SWATCHES.forEach((color, index) => {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "house-builder-swatch" + (index === 0 ? " selected" : "");
        swatch.style.setProperty("--builder-swatch", color);
        swatch.setAttribute("aria-label", `Farbe ${color}`);
        swatch.addEventListener("click", () => {
            builderColor.value = color;
            builderSwatches.querySelectorAll("button").forEach((button) =>
                button.classList.toggle("selected", button === swatch));
            const item = itemById(builder.selectedId);
            if (item) {
                item.color = color;
                replaceItemObject(item);
                save();
                updateStatus("Farbe der Auswahl geändert.");
            }
            else
                refreshPlacementPreview();
        });
        builderSwatches.appendChild(swatch);
    });
    builderPanelToggle.addEventListener("click", () =>
        setPanelCollapsed(!builderPanel.classList.contains("is-collapsed")));
    builderPointerMode.addEventListener("click", activatePointerMode);
    builderTouchBuild?.addEventListener("click", () => {
        if (builder.placementEnabled)
            setCameraNavigation(false);
        else
            startNewPart();
    });
    builderTouchCamera?.addEventListener("click", () => setCameraNavigation(true));
    builderPartType.addEventListener("change", () => {
        if (builder.selectedId)
            selectItem(null);
        setPlacementEnabled(true);
        builderColor.value = BUILDER_DEFAULT_COLORS[builderPartType.value] || "#f1eee5";
        builderSwatches.querySelectorAll("button").forEach((button) =>
            button.classList.toggle("selected",
                button.style.getPropertyValue("--builder-swatch").toLowerCase() === builderColor.value.toLowerCase()));
        refreshVariants();
        setWallLengthControls(null);
        refreshPlacementPreview();
        updateStatus(builderPartType.value === "wall" ?
            "Neue Wand: auf dem Raster vom Start- bis zum Endpunkt ziehen." :
            ["window", "door"].includes(builderPartType.value) ?
                `${builderTypeLabel(builderPartType.value)}: direkt auf eine Wand tippen.` :
                `${builderTypeLabel(builderPartType.value)}: freie Stelle auf dem Grundstück antippen.`);
    });
    builderVariant.addEventListener("change", () => {
        const item = itemById(builder.selectedId);
        if (!item) {
            refreshPlacementPreview();
            return;
        }
        item.variant = builderVariant.value;
        replaceItemObject(item);
        if (item.type === "wall")
            updateAttachedOpenings(item.id);
        else
            positionOpeningOnWall(item);
        save();
        updateStatus(item.type === "wall" ? "Wandhöhe geändert." : "Ausführung geändert.");
    });
    builderWallLength.addEventListener("input", () => {
        const item = itemById(builder.selectedId);
        if (item?.type !== "wall")
            return;
        const length = THREE.MathUtils.clamp(Number(builderWallLength.value) || 0.5, 0.5, 28.25);
        if (item.variant === "wall-corner")
            item.variant = "wall-custom-standard";
        item.length = Math.round(length * 100) / 100;
        replaceItemObject(item);
        updateAttachedOpenings(item.id);
        setWallLengthControls(item);
        save();
        updateStatus(`Wand auf ${item.length.toLocaleString("de-DE", {
            minimumFractionDigits: 2, maximumFractionDigits: 2
        })} m geändert.`);
    });
    builderColor.addEventListener("input", () => {
        builderSwatches.querySelectorAll("button").forEach((button) => button.classList.remove("selected"));
        const item = itemById(builder.selectedId);
        if (!item) {
            refreshPlacementPreview();
            return;
        }
        item.color = builderColor.value;
        replaceItemObject(item);
        save();
        updateStatus("Farbe der Auswahl geändert.");
    });
    builderRotateLeft.addEventListener("click", () => rotateSelection(-BUILDER_ROTATION_STEP));
    builderRotateRight.addEventListener("click", () => rotateSelection(BUILDER_ROTATION_STEP));
    builderNew.addEventListener("click", startNewPart);
    function deleteSelection() {
        const id = builder.selectedId;
        if (!id)
            return;
        const removedIds = new Set([id]);
        if (itemById(id)?.type === "wall")
            builder.items.filter((item) => item.wallId === id).forEach((item) => removedIds.add(item.id));
        removedIds.forEach((removedId) => {
            const object = builder.objects.get(removedId);
            if (object)
                builder.root.remove(object);
            builder.objects.delete(removedId);
        });
        builder.items = builder.items.filter((item) => !removedIds.has(item.id));
        builder.selectedId = null;
        clearSelectionHelper();
        builderSelectionTools.hidden = true;
        setWallLengthControls(null);
        save();
        updateStatus(removedIds.size > 1 ?
            "Wand und daran befestigte Fenster/Türen gelöscht." : "Ausgewähltes Bauteil gelöscht.");
    }
    builderDelete.addEventListener("click", deleteSelection);
    builderSelectionRotateLeft.addEventListener("click", () => rotateSelection(-BUILDER_ROTATION_STEP));
    builderSelectionRotateRight.addEventListener("click", () => rotateSelection(BUILDER_ROTATION_STEP));
    builderSelectionDelete.addEventListener("click", deleteSelection);
    window.addEventListener("keydown", (event) => {
        if (!builder.active || ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(event.target?.tagName))
            return;
        if (["Delete", "Backspace"].includes(event.key)) {
            event.preventDefault();
            deleteSelection();
        }
        else if ([",", "<"].includes(event.key)) {
            event.preventDefault();
            rotateSelection(-BUILDER_ROTATION_STEP);
        }
        else if ([".", ">"].includes(event.key)) {
            event.preventDefault();
            rotateSelection(BUILDER_ROTATION_STEP);
        }
        else if (event.key.toLowerCase() === "n") {
            event.preventDefault();
            startNewPart();
        }
        else if (event.key.toLowerCase() === "m") {
            event.preventDefault();
            activatePointerMode();
        }
        else if (event.key === "Escape")
            selectItem(null);
    });
    builderUndo.addEventListener("click", () => {
        const item = builder.items.pop();
        if (item) {
            const removedIds = new Set([item.id]);
            if (item.type === "wall")
                builder.items.filter((candidate) => candidate.wallId === item.id)
                    .forEach((candidate) => removedIds.add(candidate.id));
            removedIds.forEach((removedId) => {
                const object = builder.objects.get(removedId);
                if (object)
                    builder.root.remove(object);
                builder.objects.delete(removedId);
            });
            builder.items = builder.items.filter((candidate) => !removedIds.has(candidate.id));
            if (removedIds.has(builder.selectedId)) {
                builder.selectedId = null;
                clearSelectionHelper();
                builderSelectionTools.hidden = true;
                setWallLengthControls(null);
            }
            save();
            updateStatus("Letztes Bauteil entfernt.");
        }
    });
    builderClear.addEventListener("click", () => {
        if (!builder.items.length || !window.confirm("Den gespeicherten Hausentwurf wirklich leeren?"))
            return;
        builder.items = [];
        save();
        rebuild();
        updateStatus("Grundstück geleert.");
    });
    builderOpenButton.addEventListener("click", () => setActive(true));
    builderCloseButton.addEventListener("click", () => setActive(false));
    rebuild();
    builder.root.visible = false;

    builder.placeAtPointer = placeAtPointer;
    builder.beginPointer = beginPointer;
    builder.movePointer = movePointer;
    builder.endPointer = endPointer;
    builder.hoverPointer = updatePlacementPreview;
    builder.leavePointer = leavePlacementPreview;
    builder.navigationOnly = () => builder.cameraNavigation || !builder.placementEnabled;
    builder.setActive = setActive;
    builder.updateSelectionToolsPosition = updateSelectionToolsPosition;
    window.solixHouseBuilder = {
        open: () => setActive(true),
        close: () => setActive(false),
        select: (id) => selectItem(id),
        getState: () => ({
            active: builder.active,
            selectedId: builder.selectedId,
            placementEnabled: builder.placementEnabled,
            cameraNavigation: builder.cameraNavigation,
            preview: stage.dataset.builderPlacementPreview,
            items: builder.items.map((item) => ({ ...item }))
        })
    };
    return builder;
}

createGarden();
exteriorHouse = createHouse();
pergolaModel = createPergolaPanels();
balconyPanelModel = createBalconySolarPanels();
solarBankModel = createSolarBank();
secondarySolarBankModel = createSecondarySolarBank();
// Die fruehere Puppenhausansicht ist bewusst vollstaendig aus dem laufenden
// Rendering entfernt. Die schlanke Platzhalterstruktur haelt lediglich die
// gemeinsamen Update-Pfade kompatibel und spart alle Innenraum-Meshes.
interiorHouse = INTERIOR_VIEW_ENABLED ? createInteriorDollhouse() : {
    group: new THREE.Group(),
    devices: []
};
const vehicleModels = createVehicles();
audiModel = vehicleModels.audi.slot;
audiBatteryVisual = vehicleModels.audi.battery;
loadDetailedVehicles(vehicleModels);
const gridBoxModel = createGridBox();
const chargingConnection = createAudiChargeConnection();
const houseBuilder = createHouseBuilder();

if (animalDemoMode) {
    const focusAnimal = animalFocusMode === "camel" ? camelHerd[0] :
        animalFocusMode === "horse" ? horse : animalFocusMode === "dog" ? dog : null;
    if (focusAnimal) {
        state.yaw = state.targetYaw = 0;
        state.pitch = state.targetPitch = -0.04;
        state.zoom = state.targetZoom = 1;
        cameraTarget.set(focusAnimal.group.position.x, 1.05, focusAnimal.group.position.z);
        cameraBaseOffset.set(-3.2, 1.85, -4.3);
        state.panX = state.targetPanX = 0;
        state.panY = state.targetPanY = 0;
        if (animalFocusMode === "horse") {
            horse.group.rotation.y = Math.PI;
            horse.mode = "stable-rest";
            horse.modeUntil = Number.POSITIVE_INFINITY;
        }
        else if (animalFocusMode === "camel") {
            focusAnimal.mode = "resting";
            focusAnimal.modeUntil = Number.POSITIVE_INFINITY;
        }
        else if (animalFocusMode === "dog") {
            dog.path = [];
            dog.target.copy(dog.group.position);
            dog.navigation = null;
            dog.mode = "idle";
            dog.modeUntil = Number.POSITIVE_INFINITY;
        }
    }
    // Ausschließlich für die lokale Vorschau: Damit lassen sich seltene
    // Zustände prüfen, ohne die Produktionsansicht oder Live-Daten zu ändern.
    window.solixAnimalDebug = () => ({
        soundsUnlocked: animalSoundsUnlocked,
        horse: horse ? {
            mode: horse.mode,
            animation: horse.currentActionName,
            nextNeighIn: Math.max(0, horse.nextNeighAt - horse.elapsedSeconds)
        } : null,
        camels: camelHerd.map((camel) => ({
            mode: camel.mode,
            restBlend: Number((camel.restBlend || 0).toFixed(3)),
            calling: camel.elapsedSeconds < camel.callingUntil
        })),
        dog: dog ? {
            mode: dog.mode,
            asset: dog.assetKind || (dog.assetLoaded ? "rottweiler-gltf" : "fallback"),
            hungry: animalResources.dogHungry,
            food: animalResources.dogFood,
            water: animalResources.dogWater,
            barkCount: dogBarkPlayCount,
            position: dog.group.position.toArray().map((value) => Number(value.toFixed(3)))
        } : null,
        birds: gardenBirds.map((bird) => ({
            name: bird.config.name,
            state: bird.state,
            animation: bird.currentActionName,
            lengthCm: Math.round(bird.renderedLength * 100),
            targetLengthCm: Math.round(bird.config.length * 100),
            flightAlignment: bird.flightAlignment == null ? null :
                Number(bird.flightAlignment.toFixed(3))
        }))
    });
}

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
    duration: 0,
    currentMotion: "hold",
    lastWheelPosition: new THREE.Vector2(AUDI_HOME_POSE.x, AUDI_HOME_POSE.z)
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
    audiPresenceMotion.lastWheelPosition.set(pose.x, pose.z);
}

function updateAudiWheelRotation() {
    const previous = audiPresenceMotion.lastWheelPosition;
    const distance = Math.hypot(audiModel.position.x - previous.x, audiModel.position.z - previous.y);
    if (distance > 0.0001 && distance < 1.2) {
        const direction = audiPresenceMotion.currentMotion === "reverse" ? -1 : 1;
        vehicleModels.audi.wheels.forEach((wheel) => {
            const turn = direction * distance / 0.335;
            if (wheel.userData.spinAxis === "y")
                wheel.rotation.y -= turn;
            else
                wheel.rotation.x -= turn;
        });
    }
    previous.set(audiModel.position.x, audiModel.position.z);
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
    audiPresenceMotion.currentMotion = motion;
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
    updateAudiWheelRotation();
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
if (INTERIOR_VIEW_ENABLED)
    prepareExteriorFade(exteriorHouse);

const hemisphere = new THREE.HemisphereLight(0xd9efff, 0x34452d, 1.58);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xffedcf, 3.65);
sun.position.set(-10, 15, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(renderProfile.sunShadowSize, renderProfile.sunShadowSize);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 45;
sun.shadow.bias = -0.00025;
sun.shadow.radius = 2.6;
sun.target.position.set(0, 2.1, 0);
world.add(sun);
world.add(sun.target);
const moonLight = new THREE.DirectionalLight(0x9fc6ff, 0);
moonLight.castShadow = renderProfile.moonShadows;
moonLight.shadow.mapSize.set(
    Math.min(1024, renderProfile.sunShadowSize),
    Math.min(1024, renderProfile.sunShadowSize)
);
moonLight.shadow.camera.left = -16;
moonLight.shadow.camera.right = 16;
moonLight.shadow.camera.top = 16;
moonLight.shadow.camera.bottom = -16;
moonLight.shadow.camera.near = 1;
moonLight.shadow.camera.far = 45;
moonLight.shadow.bias = -0.00035;
moonLight.shadow.radius = 4.5;
moonLight.target.position.set(0, 2.1, 0);
world.add(moonLight);
world.add(moonLight.target);
const fill = new THREE.DirectionalLight(0x8ebef3, 0.62);
fill.position.set(10, 8, -12);
scene.add(fill);
const warmBounce = new THREE.DirectionalLight(0xffc99a, 0.32);
warmBounce.position.set(5, 3, 11);
scene.add(warmBounce);

const weatherVisual = {
    data: {},
    rain: null,
    snow: null,
    stars: null,
    clouds: [],
    sunDisk: null,
    sunHalo: null,
    moonDisk: null,
    moonCanvas: null,
    moonTexture: null,
    moonPhase: null,
    skyColor: new THREE.Color(0x9bc9e5),
    wind: 0,
    windDirection: 270
};
scene.background = weatherVisual.skyColor;

function makeSunTexture() {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 256;
    textureCanvas.height = 256;
    const context = textureCanvas.getContext("2d");
    const glow = context.createRadialGradient(128, 128, 14, 128, 128, 126);
    glow.addColorStop(0, "rgba(255,255,238,1)");
    glow.addColorStop(0.24, "rgba(255,230,128,1)");
    glow.addColorStop(0.52, "rgba(255,194,72,.48)");
    glow.addColorStop(1, "rgba(255,170,42,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function makeCloudTexture() {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 512;
    textureCanvas.height = 256;
    const context = textureCanvas.getContext("2d");
    const puffs = [
        [116, 152, 84], [190, 114, 105], [270, 126, 128],
        [360, 154, 92], [235, 168, 155]
    ];
    puffs.forEach(([x, y, radius]) => {
        const gradient = context.createRadialGradient(x, y, radius * 0.12, x, y, radius);
        gradient.addColorStop(0, "rgba(255,255,255,.98)");
        gradient.addColorStop(0.56, "rgba(239,246,252,.83)");
        gradient.addColorStop(1, "rgba(218,229,239,0)");
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
    });
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function updateMoonPhaseTexture(phaseFraction) {
    if (!weatherVisual.moonCanvas || !weatherVisual.moonTexture)
        return;
    const phase = ((phaseFraction % 1) + 1) % 1;
    if (weatherVisual.moonPhase != null && Math.abs(weatherVisual.moonPhase - phase) < 0.0002)
        return;
    weatherVisual.moonPhase = phase;
    const canvas = weatherVisual.moonCanvas;
    const context = canvas.getContext("2d");
    const image = context.createImageData(canvas.width, canvas.height);
    const angle = phase * Math.PI * 2;
    const lightX = Math.sin(angle);
    const lightZ = -Math.cos(angle);
    const radius = canvas.width * 0.43;
    for (let py = 0; py < canvas.height; py += 1) {
        for (let px = 0; px < canvas.width; px += 1) {
            const x = (px - canvas.width / 2) / radius;
            const y = (canvas.height / 2 - py) / radius;
            const distanceSquared = x * x + y * y;
            if (distanceSquared > 1)
                continue;
            const z = Math.sqrt(Math.max(0, 1 - distanceSquared));
            const light = x * lightX + z * lightZ;
            const lit = THREE.MathUtils.smoothstep(light, -0.025, 0.075);
            const limb = 0.72 + z * 0.28;
            const crater = 0.95 + 0.035 * Math.sin(px * 0.19 + py * 0.11) *
                Math.sin(px * 0.047 - py * 0.083);
            const brightness = (0.055 + lit * 0.945) * limb * crater;
            const edge = THREE.MathUtils.smoothstep(1 - distanceSquared, 0, 0.045);
            const offset = (py * canvas.width + px) * 4;
            image.data[offset] = 224 * brightness;
            image.data[offset + 1] = 232 * brightness;
            image.data[offset + 2] = 242 * brightness;
            image.data[offset + 3] = 255 * edge;
        }
    }
    context.putImageData(image, 0, 0);
    weatherVisual.moonTexture.needsUpdate = true;
}

function createCelestialVisuals() {
    const sunTexture = makeSunTexture();
    weatherVisual.sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sunTexture, transparent: true, opacity: 0.95,
        depthWrite: false, fog: false
    }));
    weatherVisual.sunHalo.scale.set(4.2, 4.2, 1);
    world.add(weatherVisual.sunHalo);
    weatherVisual.sunDisk = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sunTexture, transparent: true, opacity: 1,
        depthWrite: false, fog: false
    }));
    weatherVisual.sunDisk.scale.set(2.15, 2.15, 1);
    world.add(weatherVisual.sunDisk);

    weatherVisual.moonCanvas = document.createElement("canvas");
    weatherVisual.moonCanvas.width = 192;
    weatherVisual.moonCanvas.height = 192;
    weatherVisual.moonTexture = new THREE.CanvasTexture(weatherVisual.moonCanvas);
    weatherVisual.moonTexture.colorSpace = THREE.SRGBColorSpace;
    weatherVisual.moonDisk = new THREE.Sprite(new THREE.SpriteMaterial({
        map: weatherVisual.moonTexture, transparent: true, opacity: 0,
        depthWrite: false, fog: false
    }));
    weatherVisual.moonDisk.scale.set(1.55, 1.55, 1);
    world.add(weatherVisual.moonDisk);
    updateMoonPhaseTexture(0.5);

    const cloudTexture = makeCloudTexture();
    const random = seededNoise(157508);
    for (let index = 0; index < renderProfile.cloudCount; index += 1) {
        const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
            map: cloudTexture,
            color: index % 3 === 0 ? 0xd9e3eb : 0xf2f6fa,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            fog: false
        }));
        const size = 5.8 + random() * 5.4;
        cloud.scale.set(size * 1.8, size, 1);
        cloud.userData.lane = -20 + random() * 40;
        cloud.userData.phase = random();
        cloud.userData.height = 11 + random() * 6;
        world.add(cloud);
        weatherVisual.clouds.push(cloud);
    }
}
createCelestialVisuals();

function createWeatherParticles() {
    const random = seededNoise(844543);
    const makePoints = (count, color, size) => {
        const positions = new Float32Array(count * 3);
        for (let index = 0; index < count; index += 1) {
            positions[index * 3] = -12 + random() * 24;
            positions[index * 3 + 1] = 0.3 + random() * 12;
            positions[index * 3 + 2] = -17 + random() * 34;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            color, size, transparent: true, opacity: 0.78,
            depthWrite: false, sizeAttenuation: true
        });
        const points = new THREE.Points(geometry, material);
        points.visible = false;
        world.add(points);
        return points;
    };
    weatherVisual.rain = makePoints(renderProfile.rainCount, 0xbfe7ff, 0.055);
    weatherVisual.snow = makePoints(renderProfile.snowCount, 0xffffff, 0.105);

    const starPositions = new Float32Array(180 * 3);
    for (let index = 0; index < 180; index += 1) {
        const angle = random() * Math.PI * 2;
        const radius = 28 + random() * 12;
        starPositions[index * 3] = Math.cos(angle) * radius;
        starPositions[index * 3 + 1] = 9 + random() * 19;
        starPositions[index * 3 + 2] = Math.sin(angle) * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    weatherVisual.stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
        color: 0xe6f2ff, size: 0.12, transparent: true, opacity: 0,
        depthWrite: false, fog: false
    }));
    scene.add(weatherVisual.stars);
}
createWeatherParticles();

function weatherDescription(code) {
    const value = numberValue(code);
    if (value == null)
        return { icon: "◌", text: "Wetter wird verbunden" };
    if (value === 0)
        return { icon: "☀️", text: "Klar" };
    if ([1, 2].includes(value))
        return { icon: "🌤️", text: "Leicht bewölkt" };
    if (value === 3)
        return { icon: "☁️", text: "Bewölkt" };
    if ([45, 48].includes(value))
        return { icon: "🌫️", text: "Nebel" };
    if ([51, 53, 55, 56, 57].includes(value))
        return { icon: "🌦️", text: "Nieselregen" };
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(value))
        return { icon: "🌧️", text: "Regen" };
    if ([71, 73, 75, 77, 85, 86].includes(value))
        return { icon: "🌨️", text: "Schnee" };
    if ([95, 96, 99].includes(value))
        return { icon: "⛈️", text: "Gewitter" };
    return { icon: "🌤️", text: "Wechselhaft" };
}

function updateWeatherScene(weather) {
    weatherVisual.data = weather || {};
    const description = weatherDescription(weather?.weather_code);
    const temperature = numberValue(weather?.temperature_c);
    const wind = numberValue(weather?.wind_speed_kmh);
    const windDirection = numberValue(weather?.wind_direction_deg);
    weatherVisual.wind = wind ?? 0;
    weatherVisual.windDirection = windDirection ?? 270;
    const moonPhase = weather?.celestial?.moon?.phase_name;
    weatherIcon.textContent = description.icon;
    weatherTemp.textContent = temperature == null ? "-- °C" :
        temperature.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " °C";
    weatherText.textContent = description.text +
        " · " + SEASON_LABELS[seasonForDate()] +
        (wind == null ? "" : " · " + Math.round(wind) + " km/h") +
        (weather?.is_day === 0 && moonPhase ? " · " + moonPhase : "") +
        (weather?.stale === true ? " · letzter Stand" : "");
    weatherPanel.classList.toggle("stale", weather?.stale === true);
}

function minuteFromWeatherTime(value, fallback) {
    const match = String(value ?? "").match(/T(\d{2}):(\d{2})/);
    if (!match)
        return fallback;
    return Number(match[1]) * 60 + Number(match[2]);
}

function smoothDaylight(minute, sunrise, sunset) {
    const dawn = THREE.MathUtils.smoothstep(minute, sunrise - 35, sunrise + 35);
    const dusk = 1 - THREE.MathUtils.smoothstep(minute, sunset - 35, sunset + 35);
    return THREE.MathUtils.clamp(dawn * dusk, 0, 1);
}

function celestialAt(body, fallbackAzimuth, fallbackElevation) {
    const calculatedAt = Date.parse(weatherVisual.data?.celestial?.calculated_at || "");
    const elapsedMinutes = Number.isFinite(calculatedAt) ?
        THREE.MathUtils.clamp((Date.now() - calculatedAt) / 60000, -1, 15) : 0;
    const azimuth = numberValue(body?.azimuth_deg);
    const elevation = numberValue(body?.elevation_deg);
    const azimuthRate = numberValue(body?.azimuth_rate_deg_per_minute) ?? 0;
    const elevationRate = numberValue(body?.elevation_rate_deg_per_minute) ?? 0;
    return {
        azimuth: ((azimuth ?? fallbackAzimuth) + azimuthRate * elapsedMinutes + 360) % 360,
        elevation: (elevation ?? fallbackElevation) + elevationRate * elapsedMinutes
    };
}

function geographicSkyVector(azimuthDegrees, elevationDegrees, radius = 1) {
    const configuredPanelAzimuth = numberValue(
        weatherVisual.data?.celestial?.orientation?.panel_azimuth_deg
    ) ?? PANEL_AZIMUTH_FALLBACK_DEGREES;
    // Durch rotation.z = -12° kippt die lokale +Y-Flächennormale der
    // Paneele nach +X. Azimut = Paneel-Azimut landet deshalb exakt auf +X,
    // sodass direktes Licht aus Süd-Südost frontal auf die Module trifft.
    const worldAngle = THREE.MathUtils.degToRad(
        azimuthDegrees - configuredPanelAzimuth
    );
    const elevation = THREE.MathUtils.degToRad(elevationDegrees);
    const horizontal = Math.cos(elevation) * radius;
    return new THREE.Vector3(
        Math.cos(worldAngle) * horizontal,
        Math.sin(elevation) * radius,
        Math.sin(worldAngle) * horizontal
    );
}

function animateWeather(seconds, delta) {
    const weather = weatherVisual.data || {};
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const sunrise = minuteFromWeatherTime(weather.sunrise, 390);
    const sunset = minuteFromWeatherTime(weather.sunset, 1230);
    const fallbackDaylight = smoothDaylight(minute, sunrise, sunset);
    const daySpan = Math.max(1, sunset - sunrise);
    const dayProgress = THREE.MathUtils.clamp((minute - sunrise) / daySpan, 0, 1);
    const fallbackSunElevation = fallbackDaylight * 58 - 8;
    const fallbackSunAzimuth = 90 + dayProgress * 180;
    const sunPosition = celestialAt(
        weather.celestial?.sun, fallbackSunAzimuth, fallbackSunElevation
    );
    const moonPosition = celestialAt(
        weather.celestial?.moon, (fallbackSunAzimuth + 180) % 360,
        -fallbackSunElevation
    );
    const daylight = THREE.MathUtils.smoothstep(sunPosition.elevation, -6, 5);
    const directDaylight = THREE.MathUtils.smoothstep(sunPosition.elevation, -1, 11);
    const cloud = THREE.MathUtils.clamp((numberValue(weather.cloud_cover_percent) ?? 30) / 100, 0, 1);
    const daylightColor = new THREE.Color(0x9bcdeb).lerp(new THREE.Color(0x9daab4), cloud * 0.48);
    const nightColor = new THREE.Color(0x061326);
    weatherVisual.skyColor.copy(nightColor).lerp(daylightColor, daylight);
    const twilight = Math.max(0, 1 - Math.abs(sunPosition.elevation + 2) / 10);
    weatherVisual.skyColor.lerp(new THREE.Color(0xe69b74), twilight * 0.28);
    scene.fog.color.copy(weatherVisual.skyColor).multiplyScalar(0.80 + daylight * 0.16);
    const weatherCode = numberValue(weather.weather_code);
    scene.fog.density = THREE.MathUtils.damp(
        scene.fog.density,
        0.010 + cloud * 0.006 + ([45, 48].includes(weatherCode) ? 0.025 : 0),
        3,
        delta
    );
    // Keep direct sunlight bright, but reduce the broad fill light during the
    // day so objects in shadow remain clearly distinguishable.
    hemisphere.intensity = 0.16 + daylight * (1.22 - cloud * 0.38);
    sun.intensity = directDaylight * (3.85 - cloud * 2.45);
    fill.intensity = 0.08 + daylight * 0.42;
    warmBounce.intensity = 0.06 + daylight * 0.18 + twilight * 0.40;
    renderer.toneMappingExposure = 0.60 + daylight * 0.50;

    const sunVector = geographicSkyVector(sunPosition.azimuth, sunPosition.elevation, 28);
    const moonVector = geographicSkyVector(moonPosition.azimuth, moonPosition.elevation, 28);
    sun.position.copy(sunVector);
    moonLight.position.copy(moonVector);
    weatherVisual.sunDisk.position.copy(sunVector).multiplyScalar(1.20);
    weatherVisual.sunHalo.position.copy(weatherVisual.sunDisk.position);
    weatherVisual.moonDisk.position.copy(moonVector).multiplyScalar(1.20);
    const sunVisible = THREE.MathUtils.smoothstep(sunPosition.elevation, -4, 1);
    weatherVisual.sunDisk.material.opacity = sunVisible * (1 - cloud * 0.72);
    weatherVisual.sunHalo.material.opacity = sunVisible * (0.92 - cloud * 0.76);
    const moonAbove = THREE.MathUtils.smoothstep(moonPosition.elevation, -3, 4);
    const moonIllumination = THREE.MathUtils.clamp(
        (numberValue(weather.celestial?.moon?.illumination_percent) ?? 50) / 100, 0, 1
    );
    const moonVisibility = moonAbove * Math.pow(1 - daylight, 0.72) * (1 - cloud * 0.82);
    moonLight.castShadow = renderProfile.moonShadows && moonVisibility > 0.025;
    moonLight.intensity = moonVisibility * moonIllumination * 0.82;
    weatherVisual.moonDisk.material.opacity = moonVisibility * (0.46 + moonIllumination * 0.54);
    updateMoonPhaseTexture(numberValue(weather.celestial?.moon?.phase_fraction) ?? 0.5);
    weatherVisual.stars.material.opacity = Math.pow(1 - daylight, 1.8) *
        (1 - cloud * 0.92) * 0.88;

    const cloudOpacity = THREE.MathUtils.clamp((cloud - 0.08) / 0.92, 0, 1);
    const windToward = geographicSkyVector(
        (weatherVisual.windDirection + 180) % 360, 0, 1
    );
    const windSide = new THREE.Vector3(-windToward.z, 0, windToward.x);
    weatherVisual.clouds.forEach((cloudSprite, index) => {
        const speed = 0.045 + weatherVisual.wind * 0.004;
        const travel = ((seconds * speed + cloudSprite.userData.phase * 52) % 52) - 26;
        cloudSprite.position.copy(windToward).multiplyScalar(travel);
        cloudSprite.position.addScaledVector(windSide, cloudSprite.userData.lane);
        cloudSprite.position.y = cloudSprite.userData.height;
        cloudSprite.material.opacity = cloudOpacity *
            (0.48 + (index % 4) * 0.08) * (0.50 + daylight * 0.50);
    });
    if (streetLampLight) {
        const nightStrength = THREE.MathUtils.smoothstep(1 - daylight, 0.30, 0.82);
        streetLampLight.intensity = THREE.MathUtils.damp(
            streetLampLight.intensity, nightStrength * 34, 2.2, delta
        );
        if (streetLampBulb?.material)
            streetLampBulb.material.emissiveIntensity = 0.18 + nightStrength * 4.6;
    }

    const rainAmount = (numberValue(weather.rain_mm) ?? numberValue(weather.precipitation_mm) ?? 0);
    const snowAmount = numberValue(weather.snowfall_cm) ?? 0;
    const rainCode = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]
        .includes(weatherCode);
    const snowCode = [71, 73, 75, 77, 85, 86].includes(weatherCode);
    weatherVisual.rain.visible = rainAmount > 0.01 || rainCode;
    weatherVisual.snow.visible = snowAmount > 0.001 || snowCode;
    [[weatherVisual.rain, 8.8, 0.16], [weatherVisual.snow, 1.25, 0.38]].forEach(([system, speed, drift]) => {
        if (!system.visible || reduceMotion)
            return;
        const positions = system.geometry.attributes.position.array;
        for (let index = 0; index < positions.length; index += 3) {
            positions[index] += windToward.x * weatherVisual.wind * 0.012 * delta +
                Math.sin(seconds + index) * drift * delta;
            positions[index + 2] += windToward.z * weatherVisual.wind * 0.012 * delta;
            positions[index + 1] -= speed * delta;
            if (positions[index + 1] < 0.12) {
                positions[index + 1] = 9 + (index % 31) * 0.09;
                positions[index] = -12 + ((index * 17) % 240) / 10;
                positions[index + 2] = -17 + ((index * 23) % 340) / 10;
            }
        }
        system.geometry.attributes.position.needsUpdate = true;
    });
}

function exteriorRoomLightTarget(light, now) {
    const minute = now.getHours() * 60 + now.getMinutes();
    const dayNumber = Math.floor(now.getTime() / 86400000);
    // Jeder Raum erhält eine kleine tägliche Verschiebung. Dadurch schalten
    // die Lichter nicht jeden Tag sekundengenau gleich, bleiben aber in einem
    // glaubwürdigen Tagesablauf für zwei berufstätige Personen.
    const shift = ((light.seed * 17 + dayNumber * 11) % 25) - 12;
    const localMinute = minute - shift;
    const inRange = (start, end) => localMinute >= start && localMinute < end;
    const pulse = (minutes = 12, duty = 0.72) => {
        const bucket = Math.floor(localMinute / minutes);
        const value = ((bucket * 37 + light.seed * 19 + dayNumber * 13) % 100) / 100;
        return value < duty;
    };
    switch (light.kind) {
    case "kitchen":
        return (inRange(350, 465) && pulse(15, 0.82)) ||
            (inRange(1065, 1245) && pulse(18, 0.78));
    case "living":
        return inRange(1080, 1390) && pulse(24, 0.88);
    case "office":
        return (inRange(405, 475) || inRange(1040, 1215)) && pulse(20, 0.64);
    case "bedroom":
        return (inRange(360, 430) && pulse(14, 0.58)) ||
            (inRange(1290, 1438) && pulse(18, 0.76));
    case "bath":
        return (inRange(345, 465) || inRange(1260, 1375)) && pulse(9, 0.46);
    default:
        return (inRange(380, 455) || inRange(1030, 1300)) && pulse(11, 0.30);
    }
}

function animateExteriorRoomLights(delta) {
    const now = new Date();
    houseWindowLights.forEach((light) => {
        const target = exteriorRoomLightTarget(light, now) ? 0.72 : 0;
        light.opacity = THREE.MathUtils.damp(light.opacity, target, target > 0 ? 1.8 : 1.1, delta);
        light.material.opacity = light.opacity;
        light.material.color.setHex(light.kind === "bath" ? 0xffe3ad : 0xffa84a);
    });
}

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

if (INTERIOR_VIEW_ENABLED) {
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
}

function setInteriorFlowVisibility(visible) {
    ["houseMain", ...interiorHouse.devices.map((device) => "room-" + device.id)].forEach((id) => {
        const flow = flows[id];
        if (!flow)
            return;
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
if (INTERIOR_VIEW_ENABLED)
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
    if (!INTERIOR_VIEW_ENABLED) {
        simulatedResidualLoad = total;
        return;
    }
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

function secondaryBatteryUsageChartHtml(history) {
    const now = Date.now();
    const windowMs = 24 * 60 * 60 * 1000;
    const points = Array.isArray(history) ? history.map((point) => ({
        time: new Date(point?.time).getTime(),
        percent: numberValue(point?.battery_percent),
        charge: numberValue(point?.charge_w) ?? 0,
        discharge: numberValue(point?.discharge_w) ?? 0
    })).filter((point) => Number.isFinite(point.time) && point.percent != null &&
        point.time >= now - windowMs)
        .sort((left, right) => left.time - right.time) : [];
    if (!points.length)
        return '<span class="house-detail-row"><b>Akkukapazität 24 h</b><span>baut sich im Hintergrund auf</span></span>';

    // Immer dieselbe rollierende 24-h-Achse: Links liegt exakt "vor 24 h",
    // rechts "jetzt". Fehlende ältere Daten bleiben sichtbar als ungemessener
    // Bereich, statt den vorhandenen Ausschnitt irreführend breit zu ziehen.
    const fixedStart = now - windowMs;
    const coordinates = points.map((point) => ({
        ...point,
        x: THREE.MathUtils.clamp((point.time - fixedStart) / windowMs * 100, 0, 100),
        y: 31 - THREE.MathUtils.clamp(point.percent, 0, 100) / 100 * 27
    }));
    const segments = coordinates.slice(1).map((point, index) => {
        const previous = coordinates[index];
        const mode = point.charge >= 5 ? "charging" :
            point.discharge >= 5 ? "discharging" : "idle";
        return '<line class="battery-use-segment ' + mode + '" x1="' +
            previous.x.toFixed(1) + '" y1="' + previous.y.toFixed(1) +
            '" x2="' + point.x.toFixed(1) + '" y2="' + point.y.toFixed(1) +
            '"></line>';
    }).join("");
    const last = coordinates.at(-1);
    const low = coordinates.reduce((result, point) => point.percent < result.percent ? point : result);
    const high = coordinates.reduce((result, point) => point.percent > result.percent ? point : result);
    const extrema = chartExtremeMarkers(low, high,
        (point) => Math.round(point.percent) + ' %');
    return '<span class="battery-use-title"><b>Akkukapazität · 24 h</b>' +
        '<span><i class="charging"></i>Laden <i class="discharging"></i>Entladen</span></span>' +
        '<svg class="house-sparkline battery-use-chart" viewBox="0 0 100 34" preserveAspectRatio="none" ' +
        'aria-label="Ladezustand und Lade- sowie Entladephasen der Solarbank 3 in den letzten 24 Stunden">' +
        '<line class="grid" x1="25" y1="1" x2="25" y2="34"></line>' +
        '<line class="grid" x1="50" y1="1" x2="50" y2="34"></line>' +
        '<line class="grid" x1="75" y1="1" x2="75" y2="34"></line>' +
        missingChartHistoryHtml(coordinates[0].x) + segments + extrema +
        '<circle class="battery-use-point" cx="' + last.x.toFixed(1) +
        '" cy="' + last.y.toFixed(1) + '" r="1.8"></circle></svg>' +
        rolling24HourCaptionHtml('Tief ' + Math.round(low.percent) + ' % · Hoch ' +
            Math.round(high.percent) + ' %');
}

function missingChartHistoryHtml(firstX) {
    const width = THREE.MathUtils.clamp(firstX, 0, 100);
    if (width < 0.8)
        return "";
    const label = width >= 24 ? '<text class="chart-missing-label" x="' +
        (width / 2).toFixed(1) + '" y="17" text-anchor="middle">noch keine Messwerte</text>' : "";
    return '<rect class="chart-missing-range" x="0" y="1" width="' +
        width.toFixed(1) + '" height="30"></rect>' + label;
}

function rolling24HourCaptionHtml(summary) {
    return '<span class="house-sparkline-caption house-chart-time-axis">' +
        '<span>-24 h</span><span>-18 h</span><span>-12 h</span><span>-6 h</span><span>jetzt</span>' +
        '</span><span class="house-chart-summary">' + escapeHtml(summary) + '</span>';
}

function chartExtremeMarkers(low, high, formatter) {
    const marker = (point, kind, label, placeBelow) => {
        const x = THREE.MathUtils.clamp(point.x, 8, 92);
        const nearTop = point.y < 7;
        const nearBottom = point.y > 27;
        let textY = placeBelow ? point.y + 5.2 : point.y - 3.1;
        if (nearTop) textY = point.y + 5.2;
        if (nearBottom) textY = point.y - 3.1;
        return '<g class="chart-extreme-marker ' + kind + '">' +
            '<circle class="chart-extreme ' + kind + '" cx="' + point.x.toFixed(1) +
            '" cy="' + point.y.toFixed(1) + '" r="2.2"></circle>' +
            '<text class="chart-extreme-value ' + kind + '" x="' + x.toFixed(1) +
            '" y="' + THREE.MathUtils.clamp(textY, 4, 32).toFixed(1) +
            '" text-anchor="middle">' + escapeHtml(label) + '</text></g>';
    };
    const lowMarker = marker(low, 'low', formatter(low), false);
    if (high === low) return lowMarker;
    return lowMarker + marker(high, 'high', formatter(high), true);
}

function temperatureChartHtml(history, label) {
    const now = Date.now();
    const windowMs = 24 * 60 * 60 * 1000;
    const points = Array.isArray(history) ? history.map((point) => ({
        time: new Date(point?.time).getTime(),
        value: numberValue(point?.temperature_c)
    })).filter((point) => Number.isFinite(point.time) && point.value != null &&
        point.time >= now - windowMs).sort((a, b) => a.time - b.time) : [];
    if (!points.length)
        return '<span class="house-detail-row"><b>Temperatur 24 h</b><span>noch kein Sensorwert</span></span>';
    const minimum = Math.min(...points.map((point) => point.value));
    const maximum = Math.max(...points.map((point) => point.value));
    const span = Math.max(4, maximum - minimum);
    const fixedStart = now - windowMs;
    const coordinates = points.map((point) => ({
        x: THREE.MathUtils.clamp((point.time - fixedStart) / windowMs * 100, 0, 100),
        y: 31 - (point.value - (minimum - 2)) / (span + 4) * 27,
        value: point.value
    }));
    const last = coordinates.at(-1);
    const low = coordinates.reduce((result, point) => point.value < result.value ? point : result);
    const high = coordinates.reduce((result, point) => point.value > result.value ? point : result);
    const extrema = chartExtremeMarkers(low, high,
        (point) => point.value.toLocaleString('de-DE', {maximumFractionDigits: 1}) + ' °C');
    return '<span class="battery-use-title"><b>' + escapeHtml(label) + ' · 24 h</b><span>' +
        last.value.toLocaleString("de-DE", {maximumFractionDigits: 1}) + ' °C</span></span>' +
        '<svg class="house-sparkline temperature-chart" viewBox="0 0 100 34" preserveAspectRatio="none" ' +
        'aria-label="Batterietemperatur der letzten 24 Stunden">' +
        '<line class="grid" x1="25" y1="1" x2="25" y2="34"></line>' +
        '<line class="grid" x1="50" y1="1" x2="50" y2="34"></line>' +
        '<line class="grid" x1="75" y1="1" x2="75" y2="34"></line>' +
        missingChartHistoryHtml(coordinates[0].x) + '<polyline class="line" points="' +
        coordinates.map((point) => point.x.toFixed(1) + ',' + point.y.toFixed(1)).join(' ') +
        '"></polyline>' + extrema + '<circle class="point" cx="' + last.x.toFixed(1) + '" cy="' +
        last.y.toFixed(1) + '" r="1.6"></circle></svg>' +
        rolling24HourCaptionHtml('Tief ' +
            minimum.toLocaleString("de-DE", {maximumFractionDigits: 1}) + ' °C · Hoch ' +
            maximum.toLocaleString("de-DE", {maximumFractionDigits: 1}) + ' °C');
}

function audiBatteryChartHtml(history, sessions) {
    const now = Date.now();
    const points = Array.isArray(history) ? history.map((point) => ({
        time: new Date(point?.time).getTime(),
        percent: numberValue(point?.battery_percent),
        charging: point?.charging === true
    })).filter((point) => Number.isFinite(point.time) && point.percent != null &&
        point.time >= now - 24 * 60 * 60 * 1000).sort((a, b) => a.time - b.time) : [];
    let chart = '<span class="house-detail-row"><b>Akkulauf 24 h</b><span>baut sich live auf</span></span>';
    if (points.length) {
        const coordinates = points.map((point) => ({...point,
            x: THREE.MathUtils.clamp((point.time - (now - 24 * 60 * 60 * 1000)) /
                (24 * 60 * 60 * 1000) * 100, 0, 100),
            y: 31 - THREE.MathUtils.clamp(point.percent, 0, 100) / 100 * 27
        }));
        const segments = coordinates.slice(1).map((point, index) => {
            const previous = coordinates[index];
            return '<line class="battery-use-segment ' + (point.charging ? 'charging' : 'idle') +
                '" x1="' + previous.x.toFixed(1) + '" y1="' + previous.y.toFixed(1) +
                '" x2="' + point.x.toFixed(1) + '" y2="' + point.y.toFixed(1) + '"></line>';
        }).join('');
        const last = coordinates.at(-1);
        const low = coordinates.reduce((result, point) => point.percent < result.percent ? point : result);
        const high = coordinates.reduce((result, point) => point.percent > result.percent ? point : result);
        const extrema = chartExtremeMarkers(low, high,
            (point) => Math.round(point.percent) + ' %');
        chart = '<span class="battery-use-title"><b>Audi-Akku · 24 h</b><span><i class="charging"></i>Laden</span></span>' +
            '<svg class="house-sparkline battery-use-chart" viewBox="0 0 100 34" preserveAspectRatio="none" ' +
            'aria-label="Audi-Ladestand der letzten 24 Stunden">' + segments + extrema +
            '<circle class="battery-use-point" cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) +
            '" r="1.8"></circle></svg><span class="house-sparkline-caption"><span>-24 h</span><span>' +
            'Tief ' + Math.round(low.percent) + ' % · Hoch ' + Math.round(high.percent) +
            ' %</span><span>jetzt</span></span>';
    }
    const recent = Array.isArray(sessions) ? sessions.slice(-3).reverse() : [];
    const sessionRows = recent.length ? recent.map((session) => {
        const start = formatTimestamp(session?.start).replace(' Uhr', '');
        const amount = numberValue(session?.charged_kwh);
        const percent = numberValue(session?.charged_percent);
        return '<span class="house-detail-row"><b>' + (session?.active ? 'Aktuelle Ladung' : start) +
            '</b><span>' + (amount != null ? amount.toLocaleString('de-DE', {maximumFractionDigits: 2}) + ' kWh' :
                percent != null ? '+' + Math.round(percent) + ' %' : 'läuft') + '</span></span>';
    }).join('') : '<span class="house-detail-row"><b>Ladevorgänge</b><span>noch keine Session</span></span>';
    return chart + '<span class="charging-session-list">' + sessionRows + '</span>';
}

function renderComponentDetail(component) {
    return '<span class="house-detail-grid">' + detailRowsHtml(component.rows) + '</span>' +
        '<span class="house-detail-advanced"><span class="house-detail-facts">' +
        detailRowsHtml(component.advancedRows || []) + '</span>' +
        (component.chart ? '<span class="house-detail-chart">' + component.chart + '</span>' : "") +
        '</span>';
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
    const secondaryPvTodayWh = numberValue(secondary.pv_today_wh);
    const secondaryBatteryHistory = Array.isArray(secondary.battery_history) ?
        secondary.battery_history : [];
    const primaryTemperature = numberValue(solix.battery_temperature_c);
    const primaryTemperatureHistory = Array.isArray(solix.battery_temperature_history) ?
        solix.battery_temperature_history : [];
    const audiBatteryHistory = Array.isArray(audi.battery_history) ? audi.battery_history : [];
    const audiChargingSessions = Array.isArray(audi.charging_sessions) ? audi.charging_sessions : [];
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
                ["Temperatur", primaryTemperature == null ? "nicht gemeldet" :
                    primaryTemperature.toLocaleString("de-DE", {maximumFractionDigits: 1}) + " °C"],
                ["Aktualisiert", solixUpdate]
            ],
            chart: temperatureChartHtml(primaryTemperatureHistory, "Akkutemperatur"),
            active: batteryCharge >= 5 || batteryDischarge >= 5
        },
        battery3: {
            id: "battery3", label: "SOLARBANK 3", icon: "🔋", color: colors.battery3,
            value: secondarySoc == null ? "--" : Math.round(secondarySoc) + " %",
            status: secondaryStatus,
            tone: solixStale || secondarySoc == null ? "muted" :
                secondaryCharge >= 5 || secondaryDischarge >= 5 ? "active" : "idle",
            detail: [
                "Heute " + formatEnergy(secondaryPvTodayWh),
                "Eingang " + formatPower(secondaryPv),
                "Verbrauch " + formatPower(secondaryOutput)
            ].filter(Boolean).join(" · "),
            rows: [
                ["Heute erzeugt", formatEnergy(secondaryPvTodayWh)],
                ["Aktueller Eingang", formatPower(secondaryPv)],
                ["Aktueller Verbrauch", formatPower(secondaryOutput)]
            ],
            advancedRows: [],
            chart: secondaryBatteryUsageChartHtml(secondaryBatteryHistory),
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
            chart: audiBatteryChartHtml(audiBatteryHistory, audiChargingSessions),
            active: charging
        },
        raw: {
            pv, pvStrings, batterySoc, batteryCharge, batteryDischarge, batteryEnergyWh,
            secondaryPv, secondaryPvStrings, secondarySoc, secondaryCharge,
            secondaryDischarge, secondaryEnergyWh, secondaryCapacityWh, secondaryOutput,
            secondaryPvTodayWh, secondaryBatteryHistory,
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
    updateWeatherScene(state.data.weather || {});
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
    if (!INTERIOR_VIEW_ENABLED) {
        if (cutawayVisible)
            setCutawayVisible(false);
        cutawayBlend = THREE.MathUtils.damp(cutawayBlend, 0, 6.5, delta);
        applyExteriorFade(cutawayBlend);
        interiorHouse.group.visible = false;
        stage.dataset.detailLevel = state.zoom >= 1.36 ? "close" :
            state.zoom >= 1.08 ? "near" : "overview";
        return;
    }
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
    Object.entries(animalResourceLabelAnchors).forEach(([id, anchorInfo]) => {
        const anchor = anchorInfo.object.localToWorld(anchorInfo.offset.clone());
        const cameraSpace = anchor.clone().applyMatrix4(camera.matrixWorldInverse);
        const projected = anchor.project(camera);
        const rawX = (projected.x * 0.5 + 0.5) * rect.width;
        const rawY = (-projected.y * 0.5 + 0.5) * rect.height;
        const element = animalResourceLabelElements[id];
        element.style.left = THREE.MathUtils.clamp(rawX, 48, rect.width - 48) + "px";
        element.style.top = THREE.MathUtils.clamp(rawY, 42, rect.height - 34) + "px";
        element.style.setProperty("--resource-label-scale", THREE.MathUtils.clamp(
            0.72 + state.zoom * 0.25, 0.90, 1.34
        ));
        element.classList.toggle("behind", cameraSpace.z > rootPosition.z);
        element.classList.toggle("outside", rawX < -60 || rawX > rect.width + 60 ||
            rawY < -50 || rawY > rect.height + 50);
    });
    const droppingMeshes = [...horseDroppings, ...animalDroppings];
    if (droppingMeshes.length) {
        const droppingAnchor = droppingMeshes.reduce((sum, dropping) =>
            sum.add(dropping.position), new THREE.Vector3()).divideScalar(droppingMeshes.length);
        droppingAnchor.y = 0.82;
        const anchor = world.localToWorld(droppingAnchor);
        const cameraSpace = anchor.clone().applyMatrix4(camera.matrixWorldInverse);
        const projected = anchor.project(camera);
        const rawX = (projected.x * 0.5 + 0.5) * rect.width;
        const rawY = (-projected.y * 0.5 + 0.5) * rect.height;
        animalCleanLabel.style.left = THREE.MathUtils.clamp(rawX, 66, rect.width - 66) + "px";
        animalCleanLabel.style.top = THREE.MathUtils.clamp(rawY, 46, rect.height - 38) + "px";
        animalCleanLabel.style.setProperty("--resource-label-scale", THREE.MathUtils.clamp(
            0.72 + state.zoom * 0.25, 0.90, 1.34
        ));
        animalCleanLabel.classList.toggle("behind", cameraSpace.z > rootPosition.z);
        animalCleanLabel.classList.toggle("outside", rawX < -70 || rawX > rect.width + 70 ||
            rawY < -55 || rawY > rect.height + 55);
    }
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
        // Hauptwert und Kartenmaßstab bleiben übersichtlich; nur die kleinen
        // Zusatzinformationen wachsen im Nahzoom deutlich stärker.
        element.style.setProperty("--scene-detail-scale", THREE.MathUtils.clamp(
            0.94 + Math.max(0, state.zoom - 1) * 0.44,
            0.94,
            1.78
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, renderProfile.pixelRatio));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const compactView = width < 700;
    camera.fov = compactView ? 45 : 39;
    const basePosition = new THREE.Vector3(
        compactView ? 16.8 : 12.8,
        compactView ? 12.0 : 9.1,
        compactView ? 21.4 : 16.0
    );
    if (animalDemoMode && ["horse", "camel", "dog"].includes(animalFocusMode))
        basePosition.copy(cameraTarget).add(new THREE.Vector3(-3.2, 1.85, -4.3));
    cameraBaseOffset.copy(basePosition).sub(cameraTarget);
    updateCameraTransform();
    camera.updateProjectionMatrix();
    if (houseBuilder.active)
        houseBuilder.updateSelectionToolsPosition();
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
    houseBuilder.hoverPointer(event);
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
    if (state.pointers.size === 1) {
        state.pointerStartX = event.clientX;
        state.pointerStartY = event.clientY;
        state.lastPointerX = event.clientX;
        state.lastPointerY = event.clientY;
        const builderDrag = houseBuilder.beginPointer(event);
        const mouse = event.pointerType === "mouse";
        const builderNavigation = houseBuilder.active && houseBuilder.navigationOnly();
        state.pointerMode = builderDrag ? "builder-drag" :
            mouse && houseBuilder.active && event.button === 2 ? "rotate" :
                mouse && (event.button === 1 || (builderNavigation && event.button === 0) ||
                    (!houseBuilder.active && event.button === 2)) ? "pan" : "rotate";
        state.pointerMoved = false;
    }
    else if (state.pointers.size === 2) {
        houseBuilder.endPointer(true);
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
    houseBuilder.hoverPointer(event);
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
    if (state.pointerMode === "builder-drag") {
        houseBuilder.movePointer(event);
        state.lastPointerX = event.clientX;
        state.lastPointerY = event.clientY;
        return;
    }
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
    const handledBuilderPointer = houseBuilder.endPointer(event.type === "pointercancel");
    const placeBuilderPart = houseBuilder.active && state.pointers.size === 1 &&
        !handledBuilderPointer && !state.pointerMoved && event.button === 0 && event.type === "pointerup";
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
    if (placeBuilderPart)
        houseBuilder.placeAtPointer(event);
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
canvas.addEventListener("pointerleave", () => {
    if (!state.pointers.size)
        houseBuilder.leavePointer();
});
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

if (renderQualitySelect) {
    renderQualitySelect.value = renderQualityPreference;
    const profileDescriptions = {
        eco: "24 Bilder/s · reduzierte Effekte",
        mobile: "iPhone-Profil · 30 Bilder/s · optimierte Schatten",
        desktop: "Desktop-Profil · 60 Bilder/s",
        full: "60 Bilder/s · höchste Auflösung"
    };
    renderQualityStatus.textContent = profileDescriptions[renderProfileName];
    renderQualitySelect.addEventListener("change", () => {
        try {
            localStorage.setItem("solix-render-quality", renderQualitySelect.value);
        }
        catch (_error) {
            // Safari-Privatmodus kann lokalen Speicher sperren.
        }
        renderQualityStatus.textContent = "Wird neu geladen …";
        window.setTimeout(() => window.location.reload(), 120);
    });
}

syncAnimalState();

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

let renderedFrame = 0;
let lastRenderedAt = 0;
let accumulatedWeatherDelta = 0;
let accumulatedEcologyDelta = 0;

function animate(time) {
    window.requestAnimationFrame(animate);
    if (document.hidden) {
        state.lastTime = time;
        lastRenderedAt = time;
        return;
    }
    const frameInterval = 1000 / renderProfile.targetFps;
    if (lastRenderedAt && time - lastRenderedAt < frameInterval - 1)
        return;
    lastRenderedAt = time;
    renderedFrame += 1;
    const seconds = time * 0.001;
    const delta = Math.min(0.05, (time - state.lastTime) * 0.001 || 0.016);
    state.lastTime = time;
    state.yaw = THREE.MathUtils.damp(state.yaw, state.targetYaw, 10, delta);
    state.pitch = THREE.MathUtils.damp(state.pitch, state.targetPitch, 10, delta);
    state.panX = THREE.MathUtils.damp(state.panX, state.targetPanX, 10, delta);
    state.panY = THREE.MathUtils.damp(state.panY, state.targetPanY, 10, delta);
    state.zoom = THREE.MathUtils.damp(state.zoom, state.targetZoom, 10, delta);
    if (houseBuilder.active)
        houseBuilder.root.rotation.y = state.yaw;
    else
        world.rotation.y = state.yaw;
    updateCameraTransform();
    if (houseBuilder.active)
        houseBuilder.updateSelectionToolsPosition();
    updateCutawayMode(delta);
    updateAudiPresenceMotion(time);

    if (Math.floor(seconds) !== Math.floor(seconds - delta))
        updatePanelDetails();
    const routineMinute = Math.floor(Date.now() / 60000);
    if (routineMinute !== lastRoutineMinute) {
        lastRoutineMinute = routineMinute;
        updateInteriorElectricity(componentData().raw.interiorLoad, new Date());
        updateSeasonalScene();
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
        animateTroughWater(seconds);
    }

    if (!houseBuilder.active) {
        animateSchematicBattery(solarBankBatteryVisual, seconds);
        animateSchematicBattery(secondarySolarBankBatteryVisual, seconds);
        animateSchematicBattery(audiBatteryVisual, seconds);
        animatePondFish(seconds);
        animateGardenBirds(seconds, delta);
        animateHorse(seconds, delta);
        animateCamels(seconds, delta);
        animateDog(seconds, delta);
        reconcileSharedAnimalMotion(delta);
    }
    if (animalDemoMode) {
        stage.dataset.animalSounds = animalSoundsUnlocked ? "unlocked" : "locked";
        stage.dataset.horseMode = horse?.mode || "missing";
        stage.dataset.horseAnimation = horse?.currentActionName || "loading";
        stage.dataset.camelResting = String(camelHerd.filter((camel) =>
            ["couching", "resting", "rising"].includes(camel.mode)).length);
        stage.dataset.birdAnimations = gardenBirds
            .map((bird) => `${bird.config.name}:${bird.state}/${bird.currentActionName}`)
            .join("|");
        stage.dataset.birdSpeciesCount = String(gardenBirds.length);
        stage.dataset.birdActiveCount = String(gardenBirds.filter((bird) => bird.state !== "away").length);
        stage.dataset.birdVisitorLimit = String(activeBirdVisitorLimit);
        stage.dataset.birdSinging = gardenBirds
            .filter((bird) => seconds < bird.singingUntil)
            .map((bird) => bird.config.name)
            .join("|") || "none";
        stage.dataset.birdAudio = birdAudioContext?.state || "locked";
        stage.dataset.birdSongCount = String(birdSongPlayCount);
        stage.dataset.dogMode = dog?.mode || "missing";
        stage.dataset.dogAsset = dog?.assetKind || "fallback";
        stage.dataset.dogAnimation = dog?.currentActionName || "loading";
        stage.dataset.dogHungry = String(animalResources.dogHungry);
        stage.dataset.dogBarkCount = String(dogBarkPlayCount);
        stage.dataset.animalMotionRole = animalMotionRole;
        stage.dataset.animalPositionAudit = [
            dog ? `dog:${dog.group.position.x.toFixed(2)},${dog.group.position.y.toFixed(2)},${dog.group.position.z.toFixed(2)}` : "",
            horse ? `horse:${horse.group.position.x.toFixed(2)},${horse.group.position.y.toFixed(2)},${horse.group.position.z.toFixed(2)}` : "",
            ...camelHerd.map((camel, index) =>
                `camel-${index}:${camel.group.position.x.toFixed(2)},${camel.group.position.y.toFixed(2)},${camel.group.position.z.toFixed(2)}`)
        ].filter(Boolean).join("|");
        stage.dataset.birdScaleAudit = gardenBirds.map((bird) =>
            `${bird.config.name}:${Math.round(bird.renderedLength * 100)}/${Math.round(bird.config.length * 100)}cm`)
            .join("|");
        stage.dataset.birdFlightAlignment = gardenBirds
            .filter((bird) => bird.state.startsWith("flying") && bird.flightAlignment != null)
            .map((bird) => `${bird.config.name}:${bird.flightAlignment.toFixed(2)}`)
            .join("|") || "none";
        stage.dataset.birdMissingAnimations = gardenBirds.map((bird) => {
            const required = bird.config.model === "swamphen" ?
                ["fly", "idle", "walking"] : bird.config.model === "sparrow" ?
                    ["fly", "idle", "walking", "eat"] :
                    ["fly", "glide", "landing", "idle", "takeoff"];
            const missing = required.filter((name) => !bird.actions[name]);
            return missing.length ? `${bird.config.name}:${missing.join(",")}` : "";
        }).filter(Boolean).join("|") || "none";
        stage.dataset.season = seasonalVisuals.current || seasonForDate();
        stage.dataset.troughWaterSurfaces = String(troughWaterSurfaces.length);
    }
    if (houseBuilder.active)
        accumulatedEcologyDelta = 0;
    else {
        accumulatedEcologyDelta += delta;
        if (renderedFrame % renderProfile.ecologyInterval === 0) {
            updateAnimalEcology(time, accumulatedEcologyDelta);
            accumulatedEcologyDelta = 0;
        }
    }
    accumulatedWeatherDelta += delta;
    if (renderedFrame % renderProfile.weatherInterval === 0) {
        animateWeather(seconds, accumulatedWeatherDelta);
        animateSeasonalAccents(seconds);
        animateExteriorRoomLights(accumulatedWeatherDelta);
        accumulatedWeatherDelta = 0;
    }
    if (!renderer.shadowMap.autoUpdate && renderedFrame % renderProfile.shadowInterval === 0)
        renderer.shadowMap.needsUpdate = true;
    if (!houseBuilder.active && renderedFrame % renderProfile.labelInterval === 0)
        updateLabelPositions();
    renderer.render(scene, camera);
}

resize();
updateLiveUi();
if (new URLSearchParams(window.location.search).get("audi_demo") === "1")
    window.setTimeout(runAudiPresenceDemo, 1400);
sceneLoadingManager.itemEnd(SCENE_BOOTSTRAP_ITEM);
window.requestAnimationFrame(animate);
