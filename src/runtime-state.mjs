const session = {};
const viewState = {};
const inputState = {};
const mapState = {};
const profileState = {};
const soundState = {};
const resourceState = {};
const AIRCRAFT_SPECS = Object.fromEntries(Object.entries(AIRCRAFT_DATA).map(([id, r]) => [id, r.model]));
const PROPELLER_SPECS = Object.fromEntries(Object.entries(AIRCRAFT_DATA).filter(([, r]) => r.propeller).map(([id, r]) => [id, r.propeller]));
const AIRCRAFT_TREE = Object.fromEntries(Object.entries(AIRCRAFT_DATA).map(([id, r]) => [id, r.tree]));
const weaponInfo = Object.fromEntries(Object.entries(AIRCRAFT_DATA).filter(([, r]) => Object.keys(r.weapons).length).map(([id, r]) => [id, r.weapons]));
const AI_FIGHTER = Object.fromEntries(Object.entries(AIRCRAFT_DATA).filter(([, r]) => r.ai).map(([id, r]) => [id, r.ai]));
const RESEARCH_COSTS = Object.fromEntries(Object.entries(AIRCRAFT_DATA).map(([id, r]) => [id, r.researchCost]));
const planeInfo = Object.fromEntries(Object.entries(AIRCRAFT_DATA).map(([id, r]) => [id, {
  ...r.performance,
  specs: aircraftCatalogueSpecs(r)
}]));
const FLIGHT_PHYSICS = {
  stepSeconds: 1 / 120,
  maxBankRadians: 85 * Math.PI / 180,
  liftResponse: 4.5,
  aoaSoft: .13,
  aoaLimit: .26,
  negativePitchFraction: .75
};
const DUEL_BOUNDARY_RULES = {
  aiMarginMeters: 100,
  playerMarginMeters: 300,
  desertionSeconds: 15
};
mapState.koreaTerrainBounds = null;
session.duelDesertionRemaining = null;
const $ = s => document.querySelector(s);
const sceneRoot = $('#scene');
viewState.scene = undefined;
viewState.camera = undefined;
viewState.renderer = undefined;
viewState.clock = undefined;
session.player = undefined;
session.enemy = undefined;
session.playerPlane = 'f86';
session.enemyPlaneType = 'mig15';
session.weaponMode = 'mg';
session.enemyWeaponMode = 'both';
session.playerAmmo = {
  mg: 1800,
  n37: 40,
  ns23: 160,
  hispano: 720
};
session.enemyAmmo = {
  mg: 1800,
  n37: 40,
  ns23: 160,
  hispano: 720
};
session.playerWeaponCooldowns = {
  mg: 0,
  m2: 0,
  mg762: 0,
  n37: 0,
  ns23: 0,
  hispano: 0
};
session.enemyWeaponCooldowns = {
  mg: 0,
  m2: 0,
  mg762: 0,
  n37: 0,
  ns23: 0,
  hispano: 0
};
session.playing = false;
session.ended = false;
session.kills = 0;
session.hp = 700;
session.eHp = 600;
inputState.throttleValue = 1;
session.worldTime = 0;
viewState.previewRenderer = null;
viewState.previewScene = null;
viewState.previewCamera = null;
viewState.previewPlane = null;
viewState.previewType = 'mig15';
inputState.keys = {
  up: false,
  down: false,
  left: false,
  right: false,
  fire: false,
  bomb: false,
  look: false
};
inputState.joystickInput = {
  x: 0,
  y: 0
};
const FLIGHT_CONTROL = {
  deadzone: .08,
  sideslipAssistRate: .85,
  sideslipAssistMaxFraction: .22,
  cameraPositionResponse: 16,
  cameraRotationResponse: 18
};
const AI_CONTROL = {
  rollResponse: 7,
  pitchResponse: 7
};
viewState.cameraOrbitYaw = 0;
viewState.cameraOrbitPitch = 0;
viewState.cameraInputAt = -1;
viewState.cameraDragPointer = null;
viewState.cameraPoseInitialized = false;
inputState.filteredControlX = 0;
inputState.filteredControlY = 0;
session.bullets = [];
resourceState.bulletPool = [];
resourceState.bulletResources = {};
session.bombsInFlight = [];
inputState.bombKeyWasDown = false;
mapState.clouds = [];
const CAMPAIGN_DURATION = 300;
const CAMPAIGN_RESUPPLY_INTERVAL = 50;
const CAMPAIGN_ESCORT_LIMIT = 5;
const CAMPAIGN_ESCORT_RESPAWN = 30;
session.gameMode = 'airspace';
session.campaignElapsed = 0;
session.campaignTimeRemaining = CAMPAIGN_DURATION;
session.campaignResupplyRemaining = CAMPAIGN_RESUPPLY_INTERVAL;
session.campaignEscortSerial = 0;
session.campaignBomberPhase = 0;
session.campaignBombers = [];
session.campaignEscorts = [];
session.campaignRespawns = [];
viewState.campaignMarkerNodes = new Map();
const METERS_PER_UNIT = 10;
const SPAWN_DISTANCE_METERS = 2000;
const AIRSPACE_RULES = {
  teamSize: 5,
  mapMeters: 6000,
  captureRadiusMeters: 300,
  captureSeconds: 15,
  baseRadiusMeters: 300,
  supplyRate: .1,
  scoreRate: 1,
  scoreToWin: 100,
  stepSeconds: 1 / 60
};
session.airspaceUnits = [];
viewState.airspaceMarkerNodes = new Map();
session.airspaceState = null;
session.airspaceSpectating = false;
session.airspaceObservedId = null;
session.airspaceAccumulator = 0;
session.airspacePrepareToken = 0;
const CONTROL_SETTINGS_KEY = 'sky-duel.flight-controls.v1';
const DEFAULT_CONTROL_SETTINGS = {
  mode: 'cursor',
  sensitivity: 1
};
inputState.controlSettings = loadControlSettings();
session.battlePaused = false;
session.pausedEngineRunning = true;
inputState.cursorDragPointer = null;
inputState.cursorTarget = null;
inputState.cursorCandidate = null;
inputState.cursorCandidateSeconds = 0;
inputState.cursorOutsideSeconds = 0;
inputState.cursorDirectionWorld = new THREE.Vector3(0, 0, -1);
inputState.flightPointerClearers = [];
const MAP_LIBRARY = {
  openSea: {
    name: '远洋空域',
    sizeMeters: 22000
  },
  korea1951: {
    name: '1951·朝鲜',
    modelFile: './korea-1951-terrain.glb',
    sizeMeters: 6000
  }
};
mapState.activeMapId = 'openSea';
mapState.groundPlane = null;
mapState.mapSun = null;
mapState.mapHemisphere = null;
mapState.koreaTerrain = null;
mapState.koreaTerrainPromise = null;
mapState.koreaHeightGrid = null;
const BOMBER_LOADOUTS = {
  '20x500': {
    count: 20,
    eachLb: 500
  },
  '40x500': {
    count: 40,
    eachLb: 500
  },
  '18x1000': {
    count: 18,
    eachLb: 1000
  },
  '8x2000': {
    count: 8,
    eachLb: 2000
  },
  '4x4000': {
    count: 4,
    eachLb: 4000
  }
};
const PROFILE_KEY = 'sky-duel-profile-v1';
profileState.unlockedPlanes = [];
profileState.selectedAircraft = 'i15';
profileState.selectedBombPayload = '18x1000';
profileState.researchNation = 'all';
const DUEL_RATING_RANGE = 1.0;
const B29_TURRETS = [{
  id: 'frontUpper',
  name: '前上炮塔',
  guns: 4,
  offset: [0, .16, -.62],
  yawCenterDeg: 0,
  yawHalfDeg: 90,
  minElevationDeg: -2.5,
  maxElevationDeg: 90
}, {
  id: 'rearUpper',
  name: '后上炮塔',
  guns: 2,
  offset: [0, .16, .56],
  yawCenterDeg: 180,
  yawHalfDeg: 90,
  minElevationDeg: 0,
  maxElevationDeg: 90
}, {
  id: 'frontLower',
  name: '前下炮塔',
  guns: 2,
  offset: [0, -.17, -.56],
  yawCenterDeg: 0,
  yawHalfDeg: 90,
  minElevationDeg: -90,
  maxElevationDeg: 5
}, {
  id: 'rearLower',
  name: '后下炮塔',
  guns: 2,
  offset: [0, -.17, .54],
  yawCenterDeg: 180,
  yawHalfDeg: 90,
  minElevationDeg: -90,
  maxElevationDeg: 5
}, {
  id: 'tail',
  name: '尾炮塔',
  guns: 2,
  offset: [0, .02, 1.42],
  yawCenterDeg: 180,
  yawHalfDeg: 30,
  minElevationDeg: -30,
  maxElevationDeg: 30
}];
const blueSpawn = new THREE.Vector3(0, 60, SPAWN_DISTANCE_METERS / (2 * METERS_PER_UNIT));
const redSpawn = new THREE.Vector3(0, 60, -SPAWN_DISTANCE_METERS / (2 * METERS_PER_UNIT));
const mat = (color, rough = .65, metal = .1) => new THREE.MeshStandardMaterial({
  color,
  roughness: rough,
  metalness: metal,
  flatShading: true
});
const AI_TACTICS = {
  maxAltitudeMeters: 3000,
  decisionSeconds: .15,
  minStateSeconds: {
    GUARD: .4,
    INTERCEPT: .55,
    ALIGN: .35,
    FIRE_PASS: .45,
    BREAK: 1.5,
    REJOIN: 1.1,
    RECOVER: 1.0
  },
  escortLeashMeters: 1400,
  escortReturnTriggerMeters: 1100,
  escortEngageMeters: 1050,
  escortTargetExitMeters: 1250,
  escortReturnMeters: 750,
  groundClearanceMeters: 260,
  recoveryEnterDot: .42,
  recoveryExitDot: .90,
  recoveryEnterSeconds: .3,
  recoveryStableSeconds: .4
};
const AI_DUEL_CENTER = new THREE.Vector3(0, 60, 0);
const planeDracoLoader = new DRACOLoader();
const planeModelLoader = new GLTFLoader();
resourceState.planeModelPromises = {};
resourceState.wreckedAircraft = [];
resourceState.propellerBlurTexture = null;
const CHASE_REFERENCE_ASPECT = 2048 / 920;
const CHASE_NARROW_PRESETS = {
  "i15": [15.752, 4.971],
  "mig3": [17.275, 5.495],
  "f3f2": [15.734, 4.595],
  "i15bis": [16.541, 5.108],
  "bf109b1": [15.72, 4.954],
  "p36a": [17.002, 5.423],
  "mig15": [18.955, 4.828],
  "f86": [21.645, 5.568],
  "meteor": [22.391, 5.882],
  "b29": [73.016, 20.673],
  "i16": [14.86, 4.529]
};
const AUDIO_FILES = {
  jetEngine: './audio/jet_engine_loop.wav',
  b29Engine: './audio/b29_engine_loop.wav',
  i15Engine: './audio/i15bis_engine_loop.wav',
  pv1Gun: './audio/pv1_gun_shot.wav',
  f86Gun: './audio/f86_gun_shot.wav',
  b29Gun: './audio/b29_gun_shot.wav',
  mig23Gun: './audio/mig23_gun_shot.wav',
  mig37Gun: './audio/mig37_gun_shot.wav',
  meteorGun: './audio/meteor20_gun_shot.wav',
  bombDrop: './audio/bomb_drop.mp3',
  kill: './audio/kill_confirm.mp3'
};
const AUDIO_VOLUMES = {
  f86Gun: .42,
  b29Gun: .48,
  pv1Gun: .42,
  mig23Gun: .53,
  mig37Gun: .47,
  meteorGun: .5,
  bombDrop: .66,
  kill: .7
};
soundState.audioPools = Object.create(null);
soundState.audioLastPlayed = Object.create(null);
soundState.audioBuffers = new Map();
soundState.audioLoads = new Map();
soundState.gunVoices = new Set();
soundState.audioPrepared = false;
soundState.audioContext = null;
soundState.audioMaster = null;
soundState.engineAudio = null;
soundState.engineAudioType = null;
soundState.engineGeneration = 0;
soundState.engineStartPending = false;
soundState.nextGunStart = new WeakMap();
viewState.damageFlashTimer = null;
viewState.damageFlashNextAt = 0;
const BATTLE_TIMING = {
  stepSeconds: 1 / 120,
  maxStepsPerFrame: 48,
  hudIntervalSeconds: .05
};
session.battleSimulationAccumulator = 0;
session.battleHudElapsed = Infinity;
viewState.cameraTrackedRoot = null;
viewState.cameraAnchorPosition = new THREE.Vector3();
viewState.cameraAnchorDelta = new THREE.Vector3();
session.battleRenderRoots = [];
const ECONOMY_RULES = {
  startGP: 2000,
  maxBalance: 999999999,
  killRP: 80,
  killGP: 200,
  winRP: 120,
  winGP: 400,
  lossRP: 30,
  lossGP: 100,
  timeRP: .3,
  timeGP: .8,
  maxRewardSeconds: 300,
  minResultSeconds: 20
};
profileState.economy = {
  rp: 0,
  gp: ECONOMY_RULES.startGP,
  research: {},
  completedSorties: 0
};
profileState.battleRewardSeconds = 0;
profileState.battleRewardSettled = true;
const NATIONAL_FLAGS = {
  cn: '<rect width="24" height="16" fill="#de2910"/><path fill="#ffde00" d="m5 2 .8 2.1H8l-1.8 1.3.7 2.1L5 6.2 3.1 7.5l.7-2.1L2 4.1h2.2z"/><circle cx="10" cy="2.5" r=".7" fill="#ffde00"/><circle cx="11.4" cy="4.4" r=".7" fill="#ffde00"/><circle cx="11.2" cy="6.8" r=".7" fill="#ffde00"/><circle cx="9.5" cy="8.7" r=".7" fill="#ffde00"/>',
  us: '<rect width="24" height="16" fill="#fff"/><path stroke="#b22234" stroke-width="1.3" d="M0 .7h24M0 3.2h24M0 5.7h24M0 8.2h24M0 10.7h24M0 13.2h24M0 15.5h24"/><rect width="10" height="8" fill="#3c3b6e"/><path fill="#fff" d="M2 2h1v1H2zm3 0h1v1H5zm3 0h1v1H8zM2 5h1v1H2zm3 0h1v1H5zm3 0h1v1H8z"/>',
  ussr: '<rect width="24" height="16" fill="#ce2028"/><path fill="#ffd700" d="m5 2 .7 2H8L6.1 5.4l.8 2.1L5 6.2 3 7.5l.8-2.1L2 4h2.3z"/><path d="M5 8.5a3 3 0 0 0 4 2M7 7.8l3 3M7 7.8l.8-1" fill="none" stroke="#ffd700" stroke-width="1.1"/>',
  uk: '<rect width="24" height="16" fill="#012169"/><path stroke="#fff" stroke-width="4" d="M0 0 24 16M24 0 0 16"/><path stroke="#c8102e" stroke-width="1.5" d="M0 0 24 16M24 0 0 16"/><path stroke="#fff" stroke-width="5" d="M12 0v16M0 8h24"/><path stroke="#c8102e" stroke-width="2.5" d="M12 0v16M0 8h24"/>',
  de: '<rect width="24" height="5.4" fill="#111"/><rect y="5.3" width="24" height="5.4" fill="#dd0000"/><rect y="10.6" width="24" height="5.4" fill="#ffce00"/>'
};
const NATIONAL_NAMES = {
  cn: '中国',
  us: '美国',
  ussr: '苏联',
  uk: '英国',
  de: '德国'
};
const keyMap = {
  ArrowUp: 'up',
  w: 'up',
  ArrowDown: 'down',
  s: 'down',
  ArrowLeft: 'left',
  a: 'left',
  ArrowRight: 'right',
  d: 'right',
  ' ': 'fire',
  b: 'bomb',
  c: 'look'
};
const setKey = (e, pressed) => {
  if (pressed && !session.playing) return;
  if (session.gameMode === 'airspace' && session.airspaceSpectating && e.key.toLowerCase() !== 'c') return;
  const k = keyMap[e.key] || keyMap[e.key.toLowerCase()];
  if (!k) return;
  e.preventDefault();
  inputState.keys[k] = pressed;
  document.querySelector(`[data-key="${k}"]`)?.classList.toggle('on', pressed);
};
soundState.menuMusic = null;
soundState.nativeSuspended = false;
profileState.pendingRewards = [];
const FLIGHT_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  nose: new THREE.Vector3(0, 0, -1)
};
