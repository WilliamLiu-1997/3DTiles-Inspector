import {
  AmbientLight,
  BoxGeometry,
  Color,
  EdgesGeometry,
  MathUtils,
  Group,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import {
  SplatEdit,
  SplatEditRgbaBlendMode,
  SplatEditSdf,
  SplatEditSdfType,
} from '@sparkjsdev/spark';
import { TilesRenderer } from '3d-tiles-renderer';
import {
  GLTFExtensionsPlugin,
  ImplicitTilingPlugin,
  TileCompressionPlugin,
  TilesFadePlugin,
  UnloadTilesPlugin,
  XYZTilesPlugin,
} from '3d-tiles-renderer/plugins';
import {
  CesiumIonAuthPlugin,
  DebugTilesPlugin,
  ImageOverlayPlugin,
  QuantizedMeshPlugin,
  XYZTilesOverlay,
} from '3d-tiles-renderer/three/plugins';
import {
  GaussianSplatPlugin,
  isGaussianSplatScene,
} from '3d-tiles-rendererjs-3dgs-plugin';
import { Ion } from 'cesium';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CameraController } from './cameraController.js';

const SAVE_URL = new URL('../__inspector/save-transform', import.meta.url).href;
const SHUTDOWN_URL = new URL('../__inspector/shutdown', import.meta.url).href;
const VIEWER_CONFIG =
  globalThis.__TILES_INSPECTOR_CONFIG__ &&
  typeof globalThis.__TILES_INSPECTOR_CONFIG__ === 'object'
    ? globalThis.__TILES_INSPECTOR_CONFIG__
    : {};
const ROOT_TILESET_LABEL =
  typeof VIEWER_CONFIG.tilesetLabel === 'string' &&
  VIEWER_CONFIG.tilesetLabel.length > 0
    ? VIEWER_CONFIG.tilesetLabel
    : 'tileset.json';
const TILESET_URL = normalizeLocalResourceUrl(
  VIEWER_CONFIG.tilesetUrl || new URL('../tileset.json', import.meta.url).href,
);
const THREE_EXAMPLES_BASE_URL = new URL(
  './vendor/three/examples/jsm/',
  import.meta.url,
).href;
const DRACO_DECODER_PATH = `${THREE_EXAMPLES_BASE_URL}libs/draco/gltf/`;
const BASIS_TRANSCODER_PATH = `${THREE_EXAMPLES_BASE_URL}libs/basis/`;
const SATELLITE_IMAGERY = {
  url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  levels: 18,
};
const CESIUM_ION_TERRAIN = {
  apiToken: Ion.defaultAccessToken,
  assetId: 1,
};
const CAMERA_CENTER_MODE_DISTANCE = 3000000;
const CAMERA_CENTER_MODE_DISTANCE_SQ = CAMERA_CENTER_MODE_DISTANCE ** 2;
const MOVE_TO_TILES_HEADING = 0;
const MOVE_TO_TILES_PITCH = MathUtils.degToRad(-30);
const MOVE_TO_TILES_ROLL = 0;
const MOVE_TO_COORDINATE_RADIUS = 10;
const CROP_BOX_MIN_HALF_SIZE = 0.01;
const CROP_BOX_DEFAULT_HALF_SIZE = 10;
const CROP_BOX_SELECTED_COLOR = 0xffcf33;
const CROP_BOX_DEFAULT_COLOR = 0x8f8f8f;
const CROP_BOX_LINE_WIDTH = 1.5;
const CROP_BOX_SELECTED_LINE_WIDTH = 2;
const CROP_BOX_OVERLAY_OPACITY = 0.1;
const CROP_BOX_SELECTED_OVERLAY_OPACITY = 0.2;
const DEFAULT_CROP_TRANSFORM_MODE = 'scale';
const SET_POSITION_CLICK_MAX_DISTANCE_PX = 2;
const SET_POSITION_CLICK_MAX_DISTANCE_SQ =
  SET_POSITION_CLICK_MAX_DISTANCE_PX ** 2;

const statusEl = document.getElementById('status');
const cacheBytesValueEl = document.getElementById('cache-bytes-value');
const splatsCountStatEl = document.getElementById('splats-count-stat');
const splatsCountValueEl = document.getElementById('splats-count-value');
const tilesDownloadingValueEl = document.getElementById(
  'tiles-downloading-value',
);
const tilesParsingValueEl = document.getElementById('tiles-parsing-value');
const tilesLoadedValueEl = document.getElementById('tiles-loaded-value');
const tilesVisibleValueEl = document.getElementById('tiles-visible-value');
const toolbarEl = document.getElementById('toolbar');
const toolbarDockEl = toolbarEl.parentElement;
const toolbarToggleButton = document.getElementById('toolbar-toggle');
const translateButton = document.getElementById('translate');
const rotateButton = document.getElementById('rotate');
const cropAddButton = document.getElementById('crop-add');
const cropMoveButton = document.getElementById('crop-move');
const cropRotateButton = document.getElementById('crop-rotate');
const cropScaleButton = document.getElementById('crop-scale');
const cropSetPositionButton = document.getElementById('crop-set-position');
const cropDeleteButton = document.getElementById('crop-delete');
const cropUndoButton = document.getElementById('crop-undo');
const cropSectionEl = document.getElementById('crop-section');
const cropCountValueEl = document.getElementById('crop-count-value');
const cropListEl = document.getElementById('crop-list');
const moveToTilesButton = document.getElementById('move-to-tiles');
const terrainButton = document.getElementById('terrain');
const boundingVolumeButton = document.getElementById('bounding-volume');
const latitudeInput = document.getElementById('latitude');
const longitudeInput = document.getElementById('longitude');
const heightInput = document.getElementById('height');
const moveCameraToCoordinateButton = document.getElementById(
  'move-camera-to-coordinate',
);
const moveTilesToCoordinateButton = document.getElementById(
  'move-tiles-to-coordinate',
);
const geometricErrorScaleInput = document.getElementById(
  'geometric-error-scale',
);
const geometricErrorValueEl = document.getElementById('geometric-error-value');
const geometricErrorLayerScaleInput = document.getElementById(
  'geometric-error-layer-scale',
);
const geometricErrorLayerValueEl = document.getElementById(
  'geometric-error-layer-value',
);
const setPositionButton = document.getElementById('set-position');
const resetButton = document.getElementById('reset');
const saveButton = document.getElementById('save');
const GEOMETRIC_ERROR_SCALE_MIN_EXPONENT = -4;
const GEOMETRIC_ERROR_SCALE_MAX_EXPONENT = 4;
const GEOMETRIC_ERROR_SCALE_STEP = 0.1;
const GEOMETRIC_ERROR_LAYER_SCALE_MIN_EXPONENT = -3;
const GEOMETRIC_ERROR_LAYER_SCALE_MAX_EXPONENT = 3;
const GEOMETRIC_ERROR_LAYER_SCALE_STEP = 0.1;
const DEFAULT_ERROR_TARGET = 16;
const DEFAULT_TERRAIN_ERROR_TARGET = 16;
const RUNTIME_STATS_UPDATE_INTERVAL_MS = 250;

function normalizeLocalResourceUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  if (value.startsWith('//')) {
    return `/${value.replace(/^\/+/, '')}`;
  }

  if (value.startsWith('/')) {
    return value.replace(/\/{2,}/g, '/');
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.origin === window.location.origin) {
        parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
        return parsed.toString();
      }
    } catch (err) {
      return value;
    }
  }

  return value;
}

function forceOpaqueMaterial(material) {
  if (!material) {
    return;
  }
  if (Array.isArray(material)) {
    material.forEach(forceOpaqueMaterial);
    return;
  }
  material.transparent = false;
}

function forceOpaqueScene(root) {
  root.traverse((child) => {
    if (child.material) {
      forceOpaqueMaterial(child.material);
    }
  });
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', !!isError);
}

let shutdownRequested = false;

function requestViewerShutdown() {
  if (shutdownRequested) {
    return;
  }
  shutdownRequested = true;

  let sent = false;
  try {
    if (navigator.sendBeacon) {
      sent = navigator.sendBeacon(SHUTDOWN_URL, '');
    }
  } catch (err) {
    sent = false;
  }

  if (!sent) {
    fetch(SHUTDOWN_URL, {
      method: 'POST',
      body: '',
      keepalive: true,
    }).catch(() => {});
  }
}

function getFiniteMatrix4Array(value, name = 'matrix') {
  if (!Array.isArray(value) || value.length !== 16) {
    throw new Error(`${name} must be a 16-number matrix.`);
  }

  return value.map((entry, index) => {
    const number = Number(entry);
    if (!Number.isFinite(number)) {
      throw new Error(`${name}[${index}] must be a finite number.`);
    }
    return number;
  });
}

function parseCoordinateInputs() {
  const latitude = Number(latitudeInput.value);
  const longitude = Number(longitudeInput.value);
  const height = Number(heightInput.value);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    setStatus('Latitude and longitude must be valid numbers.', true);
    return null;
  }

  if (!Number.isFinite(height)) {
    setStatus('Height must be a valid number.', true);
    return null;
  }

  if (latitude < -90 || latitude > 90) {
    setStatus('Latitude must be in [-90, 90].', true);
    return null;
  }

  if (longitude < -180 || longitude > 180) {
    setStatus('Longitude must be in [-180, 180].', true);
    return null;
  }

  return {
    height,
    latitude,
    longitude,
  };
}

function updateModeButtons(mode) {
  const rootActive = activeTransformTarget === 'tiles';
  translateButton.classList.toggle(
    'active',
    rootActive && mode === 'translate',
  );
  rotateButton.classList.toggle('active', rootActive && mode === 'rotate');
}

function composeMatrix(target, matrix) {
  matrix.decompose(target.position, target.quaternion, target.scale);
  target.updateMatrix();
  target.updateMatrixWorld(true);
}

function formatCoordinateInputValue(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : '';
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function exponentToGeometricErrorScale(exponent) {
  return 2 ** exponent;
}

function formatGeometricErrorScale(value) {
  if (value < 0.1) {
    return value.toFixed(3);
  }

  return value.toFixed(2);
}

function formatBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let next = Math.max(0, Number(value) || 0);
  let unitIndex = 0;

  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex++;
  }

  if (unitIndex === 0) {
    return `${Math.round(next)} ${units[unitIndex]}`;
  }

  const digits = next >= 100 ? 0 : next >= 10 ? 1 : 2;
  return `${next.toFixed(digits)} ${units[unitIndex]}`;
}

function formatInteger(value) {
  return Math.max(0, Math.round(Number(value) || 0)).toLocaleString('en-US');
}

function setRaycasterFromCamera(raycaster, coords, camera) {
  const { origin, direction } = raycaster.ray;
  const nearZ = camera.reversedDepth ? 1 : -1;
  const farZ = camera.reversedDepth ? 0 : 1;

  origin.set(coords.x, coords.y, nearZ).unproject(camera);
  direction.set(coords.x, coords.y, farZ).unproject(camera).sub(origin);
  raycaster.near = 0;
  raycaster.far = direction.length();
  raycaster.camera = camera;
  direction.normalize();
}

function mouseToCoords(clientX, clientY, element, target) {
  const rect = element.getBoundingClientRect();
  target.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  target.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}

const renderer = new WebGLRenderer({
  antialias: false,
  alpha: true,
  premultipliedAlpha: true,
  reversedDepthBuffer: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(DRACO_DECODER_PATH);

const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath(BASIS_TRANSCODER_PATH);
ktx2Loader.detectSupport(renderer);

const scene = new Scene();
scene.background = new Color(0xffffff);

const terrainLight = new AmbientLight(0xffffff, Math.PI);
terrainLight.visible = false;
scene.add(terrainLight);

const camera = new PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  1,
  2e7,
);
camera.position.set(0, 0, 1.75e7);
camera.updateMatrixWorld(true);

const contentGroup = new Group();
scene.add(contentGroup);

const globeGroup = new Group();
contentGroup.add(globeGroup);

const editableGroup = new Group();
contentGroup.add(editableGroup);
const transformHandle = new Group();
scene.add(transformHandle);
const cropGroup = new Group();
cropGroup.name = 'Crop Boxes';
scene.add(cropGroup);
const cropSplatEdit = new SplatEdit({
  name: 'Crop Box Preview Hide',
  rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
  sdfSmooth: 0,
  softEdge: 0,
});
scene.add(cropSplatEdit);
const cropBoxGeometry = new BoxGeometry(2, 2, 2);
const cropBoxEdgesGeometry = new EdgesGeometry(cropBoxGeometry);
const cropBoxLineGeometry = new LineSegmentsGeometry().fromEdgesGeometry(
  cropBoxEdgesGeometry,
);

const cameraController = new CameraController(renderer, contentGroup, camera);
let globeTiles = null;
let terrainEnabled = true;

function configureGlobeTiles(next) {
  next.registerPlugin(new TilesFadePlugin());
  next.registerPlugin(new TileCompressionPlugin());
  next.registerPlugin(new UnloadTilesPlugin());
  next.preprocessURL = normalizeLocalResourceUrl;
  next.setCamera(camera);
  next.setResolutionFromRenderer(camera, renderer);
  next.addEventListener('load-model', ({ scene: modelScene }) => {
    forceOpaqueScene(modelScene);
  });
  return next;
}

function createImageryGlobeTiles() {
  const next = new TilesRenderer();
  next.downloadQueue.maxJobs = 8;
  next.parseQueue.maxJobs = 2;
  next.registerPlugin(
    new XYZTilesPlugin({
      shape: 'ellipsoid',
      center: true,
      levels: SATELLITE_IMAGERY.levels,
      url: SATELLITE_IMAGERY.url,
    }),
  );
  configureGlobeTiles(next);
  next.errorTarget = DEFAULT_ERROR_TARGET;
  return next;
}

function createTerrainGlobeTiles() {
  const next = new TilesRenderer();
  next.downloadQueue.maxJobs = 8;
  next.parseQueue.maxJobs = 2;
  next.registerPlugin(
    new CesiumIonAuthPlugin({
      apiToken: CESIUM_ION_TERRAIN.apiToken,
      assetId: String(CESIUM_ION_TERRAIN.assetId),
      autoRefreshToken: true,
      assetTypeHandler: (type, tilesRenderer) => {
        if (type === 'TERRAIN') {
          tilesRenderer.registerPlugin(new QuantizedMeshPlugin({}));
        }
      },
    }),
  );
  next.registerPlugin(
    new ImageOverlayPlugin({
      renderer,
      overlays: [
        new XYZTilesOverlay({
          url: SATELLITE_IMAGERY.url,
          levels: SATELLITE_IMAGERY.levels,
          tileDimension: 256,
          projection: 'EPSG:3857',
          color: 0xffffff,
          opacity: 1,
        }),
      ],
    }),
  );
  configureGlobeTiles(next);
  next.errorTarget = DEFAULT_TERRAIN_ERROR_TARGET;
  return next;
}

const transformControls = new TransformControls(camera, renderer.domElement);
const transformControlsHelper =
  typeof transformControls.getHelper === 'function'
    ? transformControls.getHelper()
    : null;
transformControls.setMode('translate');
transformControls.setSpace('local');
transformControls.size = 0.95;
transformControls.addEventListener('dragging-changed', ({ value }) => {
  cameraController.enabled = !value;
});
transformControls.addEventListener('objectChange', () => {
  if (syncingTransformHandle) {
    return;
  }

  if (activeTransformTarget === 'crop') {
    const selectedBox = getSelectedCropBox();
    if (selectedBox) {
      normalizeCropBoxTransform(selectedBox);
      syncCropBoxSdf(selectedBox);
      updateCropBoxVisualState();
    }
    return;
  }

  transformHandle.updateMatrix();
  transformHandle.updateMatrixWorld(true);
  applyEditableGroupMatrixFromRootTransform(transformHandle.matrix);
  syncCoordinateInputsFromTilesTransform();
});
transformControls.addEventListener('mouseDown', () => {
  if (activeTransformTarget === 'crop' && getSelectedCropBox()) {
    cropTransformSnapshot = createCropSnapshot();
  }
});
transformControls.addEventListener('mouseUp', () => {
  if (activeTransformTarget !== 'crop' || !cropTransformSnapshot) {
    cropTransformSnapshot = null;
    return;
  }

  if (!snapshotsEqual(cropTransformSnapshot, createCropSnapshot())) {
    pushCropUndoSnapshot(cropTransformSnapshot);
  }
  cropTransformSnapshot = null;
});
if (transformControlsHelper) {
  scene.add(transformControlsHelper);
}

const sphere = new Sphere();
const worldRight = new Vector3(1, 0, 0);
const centerNorth = new Vector3(0, 1, 0);
const cartographicTarget = {
  height: 0,
  lat: 0,
  lon: 0,
};
const moveToTilesBasis = new Matrix4();
const moveToTilesPosition = new Vector3();
const moveToTilesEast = new Vector3();
const moveToTilesNorth = new Vector3();
const moveToTilesUp = new Vector3();
const moveToTilesForward = new Vector3();
const moveToTilesRight = new Vector3();
const moveToTilesBackward = new Vector3();
const moveToTilesQuaternion = new Quaternion();
const coordinateWorldPosition = new Vector3();
const coordinateTransformMatrix = new Matrix4();
const coordinateEditMatrix = new Matrix4();
const currentRootTransformMatrix = new Matrix4();
const savedRootInverseMatrix = new Matrix4();
const cropSetPositionWorldPosition = new Vector3();
const cropSetPositionLocalPosition = new Vector3();
const pointerCoords = new Vector2();
const pickRaycaster = new Raycaster();
const pickTargets = [];
const originalTileGeometricErrors = new WeakMap();
let tiles = null;
let toolbarVisible = true;
let activeTransformMode = null;
let geometricErrorScaleExponent = 0;
let geometricErrorScale = 1;
let lastSavedGeometricErrorScale = 1;
let geometricErrorLayerScaleExponent = 0;
let geometricErrorLayerScale = 1;
let lastSavedGeometricErrorLayerScale = 1;
let lastSavedMatrix = new Matrix4();
const savedRootMatrix = new Matrix4();
let savedRootMatrixPromise = Promise.resolve();
let savedRootMatrixLoadError = null;
let pendingSetPosition = false;
let pendingCropSetPosition = false;
let setPositionPointerStart = null;
let syncingTransformHandle = false;
let tilesTransformDirty = false;
let lastRuntimeStatsUpdateTime = -Infinity;
let showBoundingVolume = false;
let debugTilesPlugin = null;
let tilesetHasGaussianSplats = false;
let activeTransformTarget = null;
let activeCropTransformMode = null;
let cropBoxes = [];
let selectedCropBoxId = null;
let nextCropBoxId = 1;
let cropUndoStack = [];
let cropTransformSnapshot = null;

function getActiveEllipsoid() {
  return tiles?.ellipsoid || globeTiles?.ellipsoid || null;
}

function updateTilesetErrorTarget() {
  if (!tiles) {
    return;
  }

  tiles.errorTarget = DEFAULT_ERROR_TARGET / getEffectiveGeometricErrorScale();
}

function updateGeometricErrorScaleDisplay() {
  geometricErrorValueEl.textContent = `x${formatGeometricErrorScale(
    geometricErrorScale,
  )}`;
}

function updateGeometricErrorLayerScaleDisplay() {
  geometricErrorLayerValueEl.textContent = `x${formatGeometricErrorScale(
    geometricErrorLayerScale,
  )}`;
}

function getEffectiveGeometricErrorScale() {
  return lastSavedGeometricErrorScale * geometricErrorScale;
}

function getEffectiveGeometricErrorLayerScale() {
  return lastSavedGeometricErrorLayerScale * geometricErrorLayerScale;
}

function getOriginalTileGeometricError(tile) {
  if (!tile || typeof tile !== 'object') {
    return null;
  }

  if (!originalTileGeometricErrors.has(tile)) {
    const number = Number(tile.geometricError);
    if (!Number.isFinite(number)) {
      return null;
    }
    originalTileGeometricErrors.set(tile, number);
  }

  return originalTileGeometricErrors.get(tile);
}

function getKnownTileLeafGeometricError(tile, visited = new Set()) {
  const originalGeometricError = getOriginalTileGeometricError(tile);
  if (
    originalGeometricError === null ||
    !tile ||
    typeof tile !== 'object' ||
    visited.has(tile)
  ) {
    return originalGeometricError;
  }

  visited.add(tile);
  let leafGeometricError = null;
  const children = Array.isArray(tile.children) ? tile.children : [];
  for (const child of children) {
    const childLeafGeometricError = getKnownTileLeafGeometricError(
      child,
      visited,
    );
    if (childLeafGeometricError !== null) {
      leafGeometricError =
        leafGeometricError === null
          ? childLeafGeometricError
          : Math.min(leafGeometricError, childLeafGeometricError);
    }
  }
  visited.delete(tile);
  return leafGeometricError === null
    ? originalGeometricError
    : leafGeometricError;
}

function getGlobalTileLeafGeometricError(tile) {
  const rootLeafGeometricError = tiles?.root
    ? getKnownTileLeafGeometricError(tiles.root)
    : null;
  const tileLeafGeometricError = getKnownTileLeafGeometricError(tile);

  if (rootLeafGeometricError === null) {
    return tileLeafGeometricError;
  }

  if (tileLeafGeometricError === null) {
    return rootLeafGeometricError;
  }

  return Math.min(rootLeafGeometricError, tileLeafGeometricError);
}

function applyGeometricErrorLayerScaleToTile(
  tile,
  leafGeometricError = getGlobalTileLeafGeometricError(tile),
) {
  const originalGeometricError = getOriginalTileGeometricError(tile);
  if (originalGeometricError === null || leafGeometricError === null) {
    return;
  }

  tile.geometricError =
    leafGeometricError +
    (originalGeometricError - leafGeometricError) *
      getEffectiveGeometricErrorLayerScale();
}

function applyGeometricErrorLayerScaleToTileset() {
  if (!tiles) {
    return;
  }

  const leafGeometricError = getGlobalTileLeafGeometricError(tiles.root);
  tiles.traverse(
    (tile) => {
      applyGeometricErrorLayerScaleToTile(tile, leafGeometricError);
      return false;
    },
    null,
    false,
  );
}

function createGeometricErrorLayerScalePlugin() {
  return {
    name: 'GeometricErrorLayerScalePlugin',
    preprocessNode(tile) {
      applyGeometricErrorLayerScaleToTile(tile);
    },
  };
}

function getGaussianMeshSplatCount(mesh) {
  if (!mesh || typeof mesh !== 'object') {
    return 0;
  }

  const directCount =
    mesh.extSplats?.getNumSplats?.() ??
    mesh.extSplats?.numSplats ??
    mesh.packedSplats?.getNumSplats?.() ??
    mesh.packedSplats?.numSplats ??
    mesh.splats?.getNumSplats?.();

  return Number.isFinite(directCount) ? directCount : 0;
}

function getLoadedGaussianSplatCount() {
  if (!tiles || typeof tiles.forEachLoadedModel !== 'function') {
    return 0;
  }

  let total = 0;
  tiles.forEachLoadedModel((loadedScene) => {
    if (!loadedScene?.visible || !isGaussianSplatScene(loadedScene)) {
      return;
    }

    const meshes = loadedScene.userData.gaussianSplatMeshes || [];
    for (const mesh of meshes) {
      total += getGaussianMeshSplatCount(mesh);
    }
  });

  return total;
}

function getActiveSparkSplatsCount() {
  let count = null;

  scene.traverse((node) => {
    if (count !== null || node?.visible === false) {
      return;
    }

    const activeSplats = node?.activeSplats;
    if (
      Number.isFinite(activeSplats) &&
      typeof node?.clearSplats === 'function' &&
      typeof node?.render === 'function'
    ) {
      count = activeSplats;
    }
  });

  return count;
}

function updateRuntimeStats(force = false) {
  if (
    !cacheBytesValueEl ||
    !splatsCountValueEl ||
    !tilesDownloadingValueEl ||
    !tilesParsingValueEl ||
    !tilesLoadedValueEl ||
    !tilesVisibleValueEl
  ) {
    return;
  }

  const now = performance.now();
  if (
    !force &&
    now - lastRuntimeStatsUpdateTime < RUNTIME_STATS_UPDATE_INTERVAL_MS
  ) {
    return;
  }

  lastRuntimeStatsUpdateTime = now;

  const cacheBytes = tiles?.lruCache?.cachedBytes ?? 0;
  const tilesStats = tiles?.stats;
  const downloadingTiles = tilesStats?.downloading ?? 0;
  const parsingTiles = tilesStats?.parsing ?? 0;
  const loadedTiles = tilesStats?.loaded ?? 0;
  const visibleTiles = tiles?.visibleTiles?.size ?? tilesStats?.visible ?? 0;
  const activeSparkSplats = tilesetHasGaussianSplats
    ? getActiveSparkSplatsCount()
    : null;
  const splatCount = tilesetHasGaussianSplats
    ? (activeSparkSplats ?? getLoadedGaussianSplatCount())
    : 0;

  cacheBytesValueEl.textContent = formatBytes(cacheBytes);
  splatsCountValueEl.textContent = formatInteger(splatCount);
  tilesDownloadingValueEl.textContent = formatInteger(downloadingTiles);
  tilesParsingValueEl.textContent = formatInteger(parsingTiles);
  tilesLoadedValueEl.textContent = formatInteger(loadedTiles);
  tilesVisibleValueEl.textContent = formatInteger(visibleTiles);
}

function setTilesetHasGaussianSplats(hasGaussianSplats) {
  const nextValue = Boolean(hasGaussianSplats);
  const changed = tilesetHasGaussianSplats !== nextValue;
  tilesetHasGaussianSplats = nextValue;

  if (splatsCountStatEl) {
    splatsCountStatEl.hidden = !tilesetHasGaussianSplats;
  }
  if (cropSectionEl) {
    cropSectionEl.hidden = !tilesetHasGaussianSplats;
  }

  if (!tilesetHasGaussianSplats && changed) {
    clearCropBoxes();
  }

  updateCropButtons();
  updateRuntimeStats(true);
}

function setGeometricErrorScaleExponent(exponent) {
  geometricErrorScaleExponent = clamp(
    Number(exponent),
    GEOMETRIC_ERROR_SCALE_MIN_EXPONENT,
    GEOMETRIC_ERROR_SCALE_MAX_EXPONENT,
  );
  geometricErrorScale = exponentToGeometricErrorScale(
    geometricErrorScaleExponent,
  );
  geometricErrorScaleInput.value = geometricErrorScaleExponent.toFixed(1);
  updateGeometricErrorScaleDisplay();
  updateTilesetErrorTarget();
}

function setGeometricErrorLayerScaleExponent(exponent) {
  geometricErrorLayerScaleExponent = clamp(
    Number(exponent),
    GEOMETRIC_ERROR_LAYER_SCALE_MIN_EXPONENT,
    GEOMETRIC_ERROR_LAYER_SCALE_MAX_EXPONENT,
  );
  geometricErrorLayerScale = exponentToGeometricErrorScale(
    geometricErrorLayerScaleExponent,
  );
  geometricErrorLayerScaleInput.value =
    geometricErrorLayerScaleExponent.toFixed(1);
  updateGeometricErrorLayerScaleDisplay();
  applyGeometricErrorLayerScaleToTileset();
}

function syncTerrainButton() {
  terrainButton.classList.toggle('active', terrainEnabled);
  terrainLight.visible = terrainEnabled;
}

function syncBoundingVolumeButton() {
  boundingVolumeButton?.classList.toggle('active', showBoundingVolume);
}

function syncToolbarVisibility() {
  const sidebarLabel = toolbarVisible ? 'Hide Sidebar' : 'Show Sidebar';
  toolbarDockEl.classList.toggle('expanded', toolbarVisible);
  toolbarDockEl.classList.toggle('collapsed', !toolbarVisible);
  toolbarEl.classList.toggle('hidden', !toolbarVisible);
  toolbarToggleButton.textContent = sidebarLabel;
  toolbarToggleButton.setAttribute('aria-label', sidebarLabel);
  toolbarToggleButton.setAttribute('aria-expanded', String(toolbarVisible));
}

function toggleToolbarVisibility() {
  toolbarVisible = !toolbarVisible;
  syncToolbarVisibility();
}

function applyBoundingVolumeVisibility() {
  if (!debugTilesPlugin) {
    return;
  }

  debugTilesPlugin.displayBoxBounds = showBoundingVolume;
  debugTilesPlugin.displaySphereBounds = showBoundingVolume;
  debugTilesPlugin.displayRegionBounds = showBoundingVolume;
  debugTilesPlugin.update();
}

function setBoundingVolumeVisible(visible) {
  showBoundingVolume = visible;
  syncBoundingVolumeButton();
  applyBoundingVolumeVisibility();
}

function toggleBoundingVolume() {
  setBoundingVolumeVisible(!showBoundingVolume);
  setStatus(
    showBoundingVolume
      ? 'Bounding volumes enabled.'
      : 'Bounding volumes disabled.',
  );
}

function setTerrainEnabled(enabled) {
  const next = enabled ? createTerrainGlobeTiles() : createImageryGlobeTiles();

  if (globeTiles) {
    globeGroup.remove(globeTiles.group);
    globeTiles.dispose();
  }

  terrainEnabled = enabled;
  globeTiles = next;
  globeGroup.add(next.group);
  cameraController.setEllipsoid(getActiveEllipsoid());
  syncTerrainButton();
}

function syncTransformControlsState() {
  const selectedBox = getSelectedCropBox();
  const pendingPositionPick = pendingSetPosition || pendingCropSetPosition;
  const cropControlsVisible =
    activeTransformTarget === 'crop' &&
    activeCropTransformMode !== null &&
    selectedBox !== null &&
    !pendingPositionPick;
  const rootControlsVisible =
    activeTransformTarget === 'tiles' &&
    activeTransformMode !== null &&
    !pendingPositionPick;

  if (cropControlsVisible) {
    if (transformControls.object !== selectedBox.root) {
      transformControls.attach(selectedBox.root);
    }
    transformControls.setMode(activeCropTransformMode);
    transformControls.setSpace('local');
  } else if (rootControlsVisible) {
    if (transformControls.object !== transformHandle) {
      transformControls.attach(transformHandle);
    }
    transformControls.setMode(activeTransformMode);
    transformControls.setSpace('local');
  } else if (transformControls.object) {
    transformControls.detach();
  }

  const controlsVisible = cropControlsVisible || rootControlsVisible;
  transformControls.enabled = controlsVisible;
  if (transformControlsHelper) {
    transformControlsHelper.visible = controlsVisible;
    transformControlsHelper.updateMatrixWorld(true);
  }
}

function setTransformMode(mode) {
  activeTransformMode = mode;
  if (mode !== null) {
    activeTransformTarget = 'tiles';
    activeCropTransformMode = null;
  } else if (activeTransformTarget === 'tiles') {
    activeTransformTarget = null;
  }
  if (mode !== null) {
    transformControls.setMode(mode);
  }
  updateModeButtons(mode);
  updateCropButtons();
  syncTransformControlsState();
}

function toggleTransformMode(mode) {
  setTransformMode(activeTransformMode === mode ? null : mode);
}

geometricErrorScaleInput.min = String(GEOMETRIC_ERROR_SCALE_MIN_EXPONENT);
geometricErrorScaleInput.max = String(GEOMETRIC_ERROR_SCALE_MAX_EXPONENT);
geometricErrorScaleInput.step = String(GEOMETRIC_ERROR_SCALE_STEP);
geometricErrorLayerScaleInput.min = String(
  GEOMETRIC_ERROR_LAYER_SCALE_MIN_EXPONENT,
);
geometricErrorLayerScaleInput.max = String(
  GEOMETRIC_ERROR_LAYER_SCALE_MAX_EXPONENT,
);
geometricErrorLayerScaleInput.step = String(GEOMETRIC_ERROR_LAYER_SCALE_STEP);
setGeometricErrorScaleExponent(geometricErrorScaleExponent);
setGeometricErrorLayerScaleExponent(geometricErrorLayerScaleExponent);
setTerrainEnabled(terrainEnabled);
setTransformMode(activeTransformMode);
updateCropButtons();
syncToolbarVisibility();
syncBoundingVolumeButton();

function applySavedMatrix(matrix) {
  composeMatrix(editableGroup, matrix);
  invalidateTilesetTransforms();
  syncTransformHandleFromTilesTransform();
  syncCoordinateInputsFromTilesTransform();
}

function getCurrentMatrix() {
  editableGroup.updateMatrix();
  editableGroup.updateMatrixWorld(true);
  return editableGroup.matrix.clone();
}

function getCurrentRootTransform(target) {
  editableGroup.updateMatrix();
  editableGroup.updateMatrixWorld(true);
  return target
    .copy(editableGroup.matrix)
    .multiply(savedRootInverseMatrix.copy(lastSavedMatrix).invert())
    .multiply(savedRootMatrix);
}

function updateTilesRendererGroupMatrices(tilesRenderer) {
  const group = tilesRenderer?.group;
  if (!group) {
    return;
  }

  group.updateMatrixWorld(true);

  if (
    group.matrixWorldInverse &&
    typeof group.matrixWorldInverse.copy === 'function'
  ) {
    group.matrixWorldInverse.copy(group.matrixWorld).invert();
  }
}

function refreshLoadedTileSceneMatrices(tilesRenderer) {
  if (
    !tilesRenderer ||
    typeof tilesRenderer.forEachLoadedModel !== 'function'
  ) {
    return;
  }

  tilesRenderer.forEachLoadedModel((loadedScene) => {
    if (typeof loadedScene.updateWorldMatrix === 'function') {
      loadedScene.updateWorldMatrix(false, true);
    } else {
      loadedScene.updateMatrixWorld(true);
    }
  });
}

function invalidateTilesetTransforms() {
  tilesTransformDirty = true;
  editableGroup.updateMatrixWorld(true);
  updateTilesRendererGroupMatrices(tiles);
  refreshLoadedTileSceneMatrices(tiles);
  transformControlsHelper?.updateMatrixWorld(true);
}

function applyEditableGroupMatrixFromRootTransform(rootTransform) {
  coordinateEditMatrix
    .copy(rootTransform)
    .multiply(savedRootInverseMatrix.copy(savedRootMatrix).invert())
    .multiply(lastSavedMatrix);
  composeMatrix(editableGroup, coordinateEditMatrix);
  invalidateTilesetTransforms();
}

function syncTransformHandleFromTilesTransform() {
  syncingTransformHandle = true;
  try {
    composeMatrix(
      transformHandle,
      getCurrentRootTransform(currentRootTransformMatrix),
    );
    transformHandle.updateMatrixWorld(true);
    transformControlsHelper?.updateMatrixWorld(true);
  } finally {
    syncingTransformHandle = false;
  }
}

function resetEditableGroup() {
  editableGroup.position.set(0, 0, 0);
  editableGroup.quaternion.identity();
  editableGroup.scale.set(1, 1, 1);
  editableGroup.updateMatrix();
  editableGroup.updateMatrixWorld(true);
  lastSavedMatrix.identity();
  transformHandle.position.set(0, 0, 0);
  transformHandle.quaternion.identity();
  transformHandle.scale.set(1, 1, 1);
  transformHandle.updateMatrix();
  transformHandle.updateMatrixWorld(true);
  syncTransformControlsState();
  tilesTransformDirty = true;
}

function getTilesetWorldBoundingSphere() {
  if (!tiles || !tiles.getBoundingSphere(sphere)) {
    return false;
  }

  editableGroup.updateMatrixWorld(true);
  sphere.center.applyMatrix4(editableGroup.matrixWorld);
  sphere.radius *= editableGroup.matrixWorld.getMaxScaleOnAxis();
  return true;
}

function getCameraDistanceForBoundingSphere(radius) {
  const verticalHalfFov = MathUtils.degToRad(camera.fov) * 0.5;
  const horizontalHalfFov = Math.atan(
    Math.tan(verticalHalfFov) * camera.aspect,
  );
  const limitingHalfFov = Math.max(
    Math.min(verticalHalfFov, horizontalHalfFov),
    1e-3,
  );

  return Math.max(radius / Math.sin(limitingHalfFov), 1);
}

function isCenterModePosition(position) {
  return position.lengthSq() <= CAMERA_CENTER_MODE_DISTANCE_SQ;
}

function getLocalFrame(referencePoint) {
  const ellipsoid = getActiveEllipsoid();
  ellipsoid.getPositionToCartographic(referencePoint, cartographicTarget);
  ellipsoid.getEastNorthUpFrame(
    cartographicTarget.lat,
    cartographicTarget.lon,
    cartographicTarget.height,
    moveToTilesBasis,
  );
  moveToTilesEast.setFromMatrixColumn(moveToTilesBasis, 0).normalize();
  moveToTilesNorth.setFromMatrixColumn(moveToTilesBasis, 1).normalize();
  moveToTilesUp.setFromMatrixColumn(moveToTilesBasis, 2).normalize();
}

function getCoordinateWorldPosition(latitude, longitude, height, target) {
  const ellipsoid = getActiveEllipsoid();
  return ellipsoid.getCartographicToPosition(
    MathUtils.degToRad(latitude),
    MathUtils.degToRad(longitude),
    height,
    target,
  );
}

function getCoordinateTransform(latitude, longitude, height, target) {
  const ellipsoid = getActiveEllipsoid();
  return ellipsoid.getEastNorthUpFrame(
    MathUtils.degToRad(latitude),
    MathUtils.degToRad(longitude),
    height,
    target,
  );
}

async function refreshSavedRootMatrix(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(
      `Failed to load ${ROOT_TILESET_LABEL} metadata for coordinate placement (${response.status}).`,
    );
  }

  const payload = await response.json();
  savedRootMatrix.identity();

  const rootTransform = payload?.root?.transform;
  if (rootTransform != null) {
    savedRootMatrix.fromArray(
      getFiniteMatrix4Array(rootTransform, 'tileset.root.transform'),
    );
  }

  return savedRootMatrix;
}

function syncCoordinateInputsFromTilesTransform() {
  if (savedRootMatrixLoadError) {
    return;
  }

  const ellipsoid = getActiveEllipsoid();
  getCurrentRootTransform(currentRootTransformMatrix);
  coordinateWorldPosition.setFromMatrixPosition(currentRootTransformMatrix);
  ellipsoid.getPositionToCartographic(
    coordinateWorldPosition,
    cartographicTarget,
  );

  latitudeInput.value = formatCoordinateInputValue(
    MathUtils.radToDeg(cartographicTarget.lat),
    8,
  );
  longitudeInput.value = formatCoordinateInputValue(
    MathUtils.radToDeg(cartographicTarget.lon),
    8,
  );
  heightInput.value = formatCoordinateInputValue(cartographicTarget.height, 3);
}

function updateCoordinateInputs(latitude, longitude, height) {
  latitudeInput.value = formatCoordinateInputValue(latitude, 8);
  longitudeInput.value = formatCoordinateInputValue(longitude, 8);
  heightInput.value = formatCoordinateInputValue(height, 3);
}

function raycastPickWorldPosition(target) {
  pickTargets.length = 0;

  if (tiles?.group) {
    pickTargets.push(tiles.group);
  }

  if (globeTiles?.group) {
    pickTargets.push(globeTiles.group);
  }

  if (pickTargets.length === 0) {
    return false;
  }

  for (const root of pickTargets) {
    root.updateMatrixWorld(true);
  }

  const [hit] = pickRaycaster.intersectObjects(pickTargets, true);
  if (!hit) {
    return false;
  }

  target.copy(hit.point);
  return true;
}

function getSelectedCropBox() {
  return cropBoxes.find((box) => box.id === selectedCropBoxId) || null;
}

function syncCropEditSdfs() {
  cropSplatEdit.sdfs = null;
  cropSplatEdit.clear();
  cropBoxes.forEach((box) => {
    cropSplatEdit.add(box.sdf);
  });
}

function syncCropBoxSdf(box) {
  box.root.updateMatrix();
  box.root.updateMatrixWorld(true);
  box.root.matrixWorld.decompose(
    box.sdf.position,
    box.sdf.quaternion,
    box.sdf.scale,
  );
  box.sdf.updateMatrix();
  box.sdf.updateMatrixWorld(true);
}

function normalizeCropBoxTransform(box) {
  box.root.scale.set(
    Math.max(Math.abs(box.root.scale.x), CROP_BOX_MIN_HALF_SIZE),
    Math.max(Math.abs(box.root.scale.y), CROP_BOX_MIN_HALF_SIZE),
    Math.max(Math.abs(box.root.scale.z), CROP_BOX_MIN_HALF_SIZE),
  );
  box.root.updateMatrix();
  box.root.updateMatrixWorld(true);
}

function setCropBoxSelectedStyle(box, selected) {
  const color = selected ? CROP_BOX_SELECTED_COLOR : CROP_BOX_DEFAULT_COLOR;
  const linewidth = selected
    ? CROP_BOX_SELECTED_LINE_WIDTH
    : CROP_BOX_LINE_WIDTH;

  box.edges.material.color.setHex(color);
  box.edges.material.linewidth = linewidth;
  box.overlayEdges.material.color.setHex(color);
  box.overlayEdges.material.opacity = selected
    ? CROP_BOX_SELECTED_OVERLAY_OPACITY
    : CROP_BOX_OVERLAY_OPACITY;
  box.overlayEdges.material.linewidth = linewidth;
}

function updateCropBoxVisualState() {
  cropBoxes.forEach((box) => {
    setCropBoxSelectedStyle(box, box.id === selectedCropBoxId);
  });
}

function createCropSnapshot() {
  cropBoxes.forEach((box) => {
    box.root.updateMatrix();
  });
  return {
    activeCropTransformMode,
    boxes: cropBoxes.map((box) => ({
      id: box.id,
      matrix: box.root.matrix.toArray(),
    })),
    nextCropBoxId,
    selectedCropBoxId,
  };
}

function cloneCropSnapshot(snapshot) {
  return {
    activeCropTransformMode: snapshot.activeCropTransformMode,
    boxes: snapshot.boxes.map((box) => ({
      id: box.id,
      matrix: box.matrix.slice(),
    })),
    nextCropBoxId: snapshot.nextCropBoxId,
    selectedCropBoxId: snapshot.selectedCropBoxId,
  };
}

function snapshotsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pushCropUndoSnapshot(snapshot = createCropSnapshot()) {
  cropUndoStack.push(cloneCropSnapshot(snapshot));
  if (cropUndoStack.length > 50) {
    cropUndoStack.shift();
  }
  updateCropButtons();
}

function createCropBox({ id, matrix }) {
  const root = new Group();
  root.name = `Crop Box ${id}`;
  root.userData.cropBoxId = id;

  const edges = new LineSegments2(
    cropBoxLineGeometry,
    new LineMaterial({
      color: CROP_BOX_DEFAULT_COLOR,
      linewidth: CROP_BOX_LINE_WIDTH,
      transparent: false,
    }),
  );
  edges.userData.cropBoxId = id;
  const overlayEdges = new LineSegments2(
    cropBoxLineGeometry,
    new LineMaterial({
      color: CROP_BOX_DEFAULT_COLOR,
      depthTest: false,
      depthWrite: false,
      linewidth: CROP_BOX_LINE_WIDTH,
      opacity: CROP_BOX_OVERLAY_OPACITY,
      transparent: true,
    }),
  );
  overlayEdges.renderOrder = Infinity;
  overlayEdges.userData.cropBoxId = id;
  root.add(edges);
  root.add(overlayEdges);

  const sdf = new SplatEditSdf({
    type: SplatEditSdfType.BOX,
    color: new Color(0xffffff),
    opacity: 0,
    radius: 0,
  });

  const box = {
    edges,
    id,
    overlayEdges,
    root,
    sdf,
  };

  composeMatrix(root, new Matrix4().fromArray(matrix));
  normalizeCropBoxTransform(box);
  syncCropBoxSdf(box);
  cropGroup.add(root);
  cropBoxes.push(box);
  syncCropEditSdfs();
  return box;
}

function disposeCropBox(box) {
  box.sdf.removeFromParent();
  cropGroup.remove(box.root);
  box.edges.material.dispose();
  box.overlayEdges.material.dispose();
}

function restoreCropSnapshot(snapshot) {
  cropBoxes.forEach(disposeCropBox);
  cropBoxes = [];
  nextCropBoxId = snapshot.nextCropBoxId;
  selectedCropBoxId = snapshot.selectedCropBoxId;
  activeCropTransformMode = snapshot.activeCropTransformMode;

  snapshot.boxes.forEach((box) => {
    createCropBox(box);
  });

  if (!getSelectedCropBox()) {
    selectedCropBoxId = null;
    activeCropTransformMode = null;
    if (activeTransformTarget === 'crop') {
      activeTransformTarget = null;
    }
  } else if (activeCropTransformMode) {
    activeTransformTarget = 'crop';
    activeTransformMode = null;
  } else if (activeTransformTarget === 'crop') {
    activeTransformTarget = null;
  }

  syncCropEditSdfs();
  updateModeButtons(activeTransformMode);
  updateCropBoxVisualState();
  updateCropButtons();
  syncTransformControlsState();
}

function clearCropBoxes({ resetUndo = true } = {}) {
  cancelCropSetPositionMode();
  cropBoxes.forEach(disposeCropBox);
  cropBoxes = [];
  selectedCropBoxId = null;
  activeCropTransformMode = null;
  if (activeTransformTarget === 'crop') {
    activeTransformTarget = null;
  }
  if (resetUndo) {
    cropUndoStack = [];
  }
  cropTransformSnapshot = null;
  syncCropEditSdfs();
  updateCropButtons();
  syncTransformControlsState();
}

function updateCropList() {
  cropListEl.replaceChildren();
  cropBoxes.forEach((box, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Box ${index + 1}`;
    button.classList.toggle('active', box.id === selectedCropBoxId);
    button.addEventListener('click', () => {
      selectCropBox(box.id);
      if (!activeCropTransformMode) {
        setCropTransformMode(DEFAULT_CROP_TRANSFORM_MODE);
      }
      setStatus(`Selected crop box ${index + 1}.`);
    });
    cropListEl.appendChild(button);
  });
}

function updateCropButtons() {
  const hasSelectedBox =
    tilesetHasGaussianSplats && getSelectedCropBox() !== null;
  const cropActive = activeTransformTarget === 'crop';
  cropAddButton.disabled = !tilesetHasGaussianSplats;
  cropCountValueEl.textContent = String(cropBoxes.length);
  cropMoveButton.disabled = !hasSelectedBox;
  cropRotateButton.disabled = !hasSelectedBox;
  cropScaleButton.disabled = !hasSelectedBox;
  cropSetPositionButton.disabled = !hasSelectedBox;
  cropDeleteButton.disabled = !hasSelectedBox;
  cropUndoButton.disabled = cropUndoStack.length === 0;
  cropMoveButton.classList.toggle(
    'active',
    cropActive && activeCropTransformMode === 'translate',
  );
  cropRotateButton.classList.toggle(
    'active',
    cropActive && activeCropTransformMode === 'rotate',
  );
  cropScaleButton.classList.toggle(
    'active',
    cropActive && activeCropTransformMode === 'scale',
  );
  cropSetPositionButton.classList.toggle('active', pendingCropSetPosition);
  updateCropList();
}

function setCropTransformMode(mode) {
  activeCropTransformMode = mode;
  if (mode !== null) {
    activeTransformTarget = 'crop';
    activeTransformMode = null;
    transformControls.setMode(mode);
    transformControls.setSpace('local');
  } else if (activeTransformTarget === 'crop') {
    activeTransformTarget = null;
  }
  updateModeButtons(activeTransformMode);
  updateCropButtons();
  syncTransformControlsState();
}

function toggleCropTransformMode(mode) {
  setCropTransformMode(
    activeTransformTarget === 'crop' && activeCropTransformMode === mode
      ? null
      : mode,
  );
}

function selectCropBox(id) {
  selectedCropBoxId = cropBoxes.some((box) => box.id === id) ? id : null;
  if (!selectedCropBoxId && activeTransformTarget === 'crop') {
    activeCropTransformMode = null;
    activeTransformTarget = null;
  }
  updateCropBoxVisualState();
  updateCropButtons();
  syncTransformControlsState();
}

function getDefaultCropBoxQuaternion(position, target) {
  if (
    position.lengthSq() < CAMERA_CENTER_MODE_DISTANCE_SQ ||
    !getActiveEllipsoid()
  ) {
    return target.identity();
  }

  getLocalFrame(position);
  moveToTilesBasis.makeBasis(moveToTilesEast, moveToTilesNorth, moveToTilesUp);
  return target.setFromRotationMatrix(moveToTilesBasis);
}

function createDefaultCropBoxMatrix(target) {
  const position = new Vector3();
  const quaternion = new Quaternion();
  let halfSize = CROP_BOX_DEFAULT_HALF_SIZE;

  pointerCoords.set(0, 0);
  setRaycasterFromCamera(pickRaycaster, pointerCoords, camera);
  if (raycastPickWorldPosition(position)) {
    if (getTilesetWorldBoundingSphere()) {
      halfSize = clamp(sphere.radius * 0.05, 0.5, Math.max(0.5, sphere.radius));
    }
  } else if (getTilesetWorldBoundingSphere()) {
    position.copy(sphere.center);
    halfSize = clamp(sphere.radius * 0.1, 0.5, Math.max(0.5, sphere.radius));
  } else {
    camera.getWorldDirection(position);
    position.multiplyScalar(100).add(camera.position);
  }

  return target.compose(
    position,
    getDefaultCropBoxQuaternion(position, quaternion),
    new Vector3(halfSize, halfSize, halfSize),
  );
}

function addCropBox() {
  if (!tilesetHasGaussianSplats) {
    setStatus(
      'Crop boxes are available for 3D Gaussian Splat tilesets only.',
      true,
    );
    return;
  }

  cancelPositionPickModes();
  pushCropUndoSnapshot();
  const id = nextCropBoxId++;
  createCropBox({
    id,
    matrix: createDefaultCropBoxMatrix(new Matrix4()).toArray(),
  });
  selectCropBox(id);
  setCropTransformMode(DEFAULT_CROP_TRANSFORM_MODE);
  setStatus('Added a crop box. Scale, move, or rotate it before saving.');
}

function deleteSelectedCropBox() {
  const selectedBox = getSelectedCropBox();
  if (!selectedBox) {
    return;
  }

  cancelCropSetPositionMode();
  pushCropUndoSnapshot();
  cropBoxes = cropBoxes.filter((box) => box !== selectedBox);
  disposeCropBox(selectedBox);
  syncCropEditSdfs();
  const nextSelection = cropBoxes[cropBoxes.length - 1] || null;
  selectCropBox(nextSelection ? nextSelection.id : null);
  setStatus('Deleted the selected crop box.');
}

function undoCropBoxEdit() {
  const snapshot = cropUndoStack.pop();
  if (!snapshot) {
    return;
  }
  cancelCropSetPositionMode();
  restoreCropSnapshot(snapshot);
  setStatus('Undid the latest crop-box edit.');
}

function getSplatCropBoxesPayload() {
  return cropBoxes.map((box) => {
    box.root.updateMatrixWorld(true);
    return {
      matrix: box.root.matrixWorld.toArray(),
    };
  });
}

function syncPositionPickModeState() {
  setPositionButton.classList.toggle('active', pendingSetPosition);
  cropSetPositionButton.classList.toggle('active', pendingCropSetPosition);
  cameraController.enabled = !transformControls.dragging;
  syncTransformControlsState();
  updateCropButtons();
}

function setSetPositionMode(active) {
  pendingSetPosition = active;
  setPositionPointerStart = null;
  if (active) {
    pendingCropSetPosition = false;
    setTransformMode(null);
    setCropTransformMode(null);
  }
  syncPositionPickModeState();
}

function cancelSetPositionMode() {
  if (!pendingSetPosition) {
    return;
  }

  setSetPositionMode(false);
}

function setCropSetPositionMode(active) {
  const hasSelectedBox = getSelectedCropBox() !== null;
  pendingCropSetPosition = active && hasSelectedBox;
  setPositionPointerStart = null;
  if (pendingCropSetPosition) {
    pendingSetPosition = false;
    setTransformMode(null);
    setCropTransformMode(null);
  }
  syncPositionPickModeState();
}

function cancelCropSetPositionMode() {
  if (!pendingCropSetPosition) {
    return;
  }

  setCropSetPositionMode(false);
}

function cancelPositionPickModes() {
  cancelSetPositionMode();
  cancelCropSetPositionMode();
}

async function applyTilesPlacementFromCoordinate(latitude, longitude, height) {
  await savedRootMatrixPromise;
  if (savedRootMatrixLoadError) {
    throw savedRootMatrixLoadError;
  }

  getCoordinateTransform(
    latitude,
    longitude,
    height,
    coordinateTransformMatrix,
  );
  coordinateEditMatrix
    .copy(coordinateTransformMatrix)
    .multiply(savedRootInverseMatrix.copy(savedRootMatrix).invert())
    .multiply(lastSavedMatrix);
  composeMatrix(editableGroup, coordinateEditMatrix);
  invalidateTilesetTransforms();
  syncTransformHandleFromTilesTransform();
  syncCoordinateInputsFromTilesTransform();
}

function pickWorldPositionFromPointerEvent(event, target) {
  mouseToCoords(
    event.clientX,
    event.clientY,
    renderer.domElement,
    pointerCoords,
  );
  setRaycasterFromCamera(pickRaycaster, pointerCoords, camera);

  if (raycastPickWorldPosition(target)) {
    return true;
  }

  const ellipsoid = getActiveEllipsoid();
  return !!ellipsoid && ellipsoid.intersectRay(pickRaycaster.ray, target);
}

function pickCoordinateFromPointerEvent(event) {
  const ellipsoid = getActiveEllipsoid();
  if (!ellipsoid) {
    return null;
  }

  if (!pickWorldPositionFromPointerEvent(event, coordinateWorldPosition)) {
    return null;
  }

  ellipsoid.getPositionToCartographic(
    coordinateWorldPosition,
    cartographicTarget,
  );
  return {
    height: cartographicTarget.height,
    latitude: MathUtils.radToDeg(cartographicTarget.lat),
    longitude: MathUtils.radToDeg(cartographicTarget.lon),
  };
}

function setSelectedCropBoxPositionFromPointerEvent(event) {
  const selectedBox = getSelectedCropBox();
  if (!selectedBox) {
    return false;
  }

  if (
    !pickWorldPositionFromPointerEvent(event, cropSetPositionWorldPosition)
  ) {
    setStatus(
      'No globe, terrain, or tiles hit under cursor. Click the globe, terrain, or tiles to place the crop box.',
      true,
    );
    return false;
  }

  const snapshot = createCropSnapshot();
  cropSetPositionLocalPosition.copy(cropSetPositionWorldPosition);
  if (selectedBox.root.parent) {
    selectedBox.root.parent.updateMatrixWorld(true);
    selectedBox.root.parent.worldToLocal(cropSetPositionLocalPosition);
  }
  selectedBox.root.position.copy(cropSetPositionLocalPosition);
  selectedBox.root.updateMatrix();
  selectedBox.root.updateMatrixWorld(true);
  normalizeCropBoxTransform(selectedBox);
  syncCropBoxSdf(selectedBox);
  updateCropBoxVisualState();
  syncTransformControlsState();

  if (!snapshotsEqual(snapshot, createCropSnapshot())) {
    pushCropUndoSnapshot(snapshot);
  }

  return true;
}

async function applyTilesSetPositionFromPointerEvent(event) {
  const coordinate = pickCoordinateFromPointerEvent(event);
  if (!coordinate) {
    setStatus(
      'No globe, terrain, or tiles hit under cursor. Click the globe, terrain, or tiles to place the tileset root.',
      true,
    );
    return;
  }

  updateCoordinateInputs(
    coordinate.latitude,
    coordinate.longitude,
    coordinate.height,
  );

  try {
    await applyTilesPlacementFromCoordinate(
      coordinate.latitude,
      coordinate.longitude,
      coordinate.height,
    );
    setStatus(
      'Moved tileset root to the clicked position using ENU orientation. Click Save to persist.',
    );
    setSetPositionMode(false);
  } catch (err) {
    setStatus(err && err.message ? err.message : String(err), true);
  }
}

function applyCropSetPositionFromPointerEvent(event) {
  if (!setSelectedCropBoxPositionFromPointerEvent(event)) {
    return;
  }

  setCropSetPositionMode(false);
  setCropTransformMode(DEFAULT_CROP_TRANSFORM_MODE);
  setStatus('Moved selected crop box to the clicked position.');
}

function getActiveSetPositionTarget() {
  if (pendingSetPosition) {
    return 'tiles';
  }
  if (pendingCropSetPosition) {
    return 'crop';
  }
  return null;
}

function shouldTrackSetPositionPointer(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return false;
  }
  return event.isPrimary !== false;
}

function handleSetPositionPointerDown(event) {
  const target = getActiveSetPositionTarget();
  if (!target || !shouldTrackSetPositionPointer(event)) {
    if (setPositionPointerStart && event.isPrimary === false) {
      setPositionPointerStart.moved = true;
    }
    return;
  }

  setPositionPointerStart = {
    clientX: event.clientX,
    clientY: event.clientY,
    moved: false,
    pointerId: event.pointerId,
    target,
  };
}

function updateSetPositionPointerMovement(event) {
  if (
    !setPositionPointerStart ||
    event.pointerId !== setPositionPointerStart.pointerId
  ) {
    return;
  }

  const deltaX = event.clientX - setPositionPointerStart.clientX;
  const deltaY = event.clientY - setPositionPointerStart.clientY;
  if (
    deltaX * deltaX + deltaY * deltaY >
    SET_POSITION_CLICK_MAX_DISTANCE_SQ
  ) {
    setPositionPointerStart.moved = true;
  }
}

function handleSetPositionPointerMove(event) {
  updateSetPositionPointerMovement(event);
}

function pointerMatchesSetPositionStart(event) {
  if (!setPositionPointerStart) {
    return false;
  }
  updateSetPositionPointerMovement(event);
  if (event.pointerId !== setPositionPointerStart.pointerId) {
    return false;
  }
  if (setPositionPointerStart.moved) {
    return false;
  }
  if (getActiveSetPositionTarget() !== setPositionPointerStart.target) {
    return false;
  }

  const deltaX = event.clientX - setPositionPointerStart.clientX;
  const deltaY = event.clientY - setPositionPointerStart.clientY;
  return (
    deltaX * deltaX + deltaY * deltaY <= SET_POSITION_CLICK_MAX_DISTANCE_SQ
  );
}

async function handleSetPositionPointerUp(event) {
  if (!setPositionPointerStart) {
    return;
  }

  const target = setPositionPointerStart.target;
  const shouldApply = pointerMatchesSetPositionStart(event);
  setPositionPointerStart = null;

  if (!shouldApply) {
    return;
  }

  if (target === 'tiles') {
    await applyTilesSetPositionFromPointerEvent(event);
  } else if (target === 'crop') {
    applyCropSetPositionFromPointerEvent(event);
  }
}

function handleSetPositionPointerCancel(event) {
  if (
    setPositionPointerStart &&
    event.pointerId === setPositionPointerStart.pointerId
  ) {
    setPositionPointerStart = null;
  }
}

function getCenterModeHeadingPitchRollForward(heading, pitch) {
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosHeading = Math.cos(heading);
  const sinHeading = Math.sin(heading);

  moveToTilesForward.set(
    sinHeading * cosPitch,
    cosHeading * cosPitch,
    sinPitch,
  );

  return moveToTilesForward.normalize();
}

function getHeadingPitchRollForward(referencePoint, heading, pitch) {
  if (isCenterModePosition(referencePoint)) {
    return getCenterModeHeadingPitchRollForward(heading, pitch);
  }

  if (referencePoint.lengthSq() < 1e-6) {
    return moveToTilesForward.set(0, 0, -1);
  }

  getLocalFrame(referencePoint);

  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosHeading = Math.cos(heading);
  const sinHeading = Math.sin(heading);

  moveToTilesForward
    .copy(moveToTilesNorth)
    .multiplyScalar(cosHeading * cosPitch)
    .addScaledVector(moveToTilesEast, sinHeading * cosPitch)
    .addScaledVector(moveToTilesUp, sinPitch)
    .normalize();

  return moveToTilesForward;
}

function getCenterModeHeadingPitchRollBasis(heading, pitch, roll) {
  getCenterModeHeadingPitchRollForward(heading, pitch);

  moveToTilesRight
    .copy(worldRight)
    .multiplyScalar(Math.cos(heading))
    .addScaledVector(centerNorth, -Math.sin(heading))
    .normalize();
  moveToTilesUp.crossVectors(moveToTilesRight, moveToTilesForward).normalize();

  if (roll !== 0) {
    moveToTilesRight.applyAxisAngle(moveToTilesForward, roll).normalize();
    moveToTilesUp.applyAxisAngle(moveToTilesForward, roll).normalize();
  }

  moveToTilesBackward.copy(moveToTilesForward).negate();
}

function getHeadingPitchRollQuaternion(referencePoint, heading, pitch, roll) {
  if (isCenterModePosition(referencePoint)) {
    getCenterModeHeadingPitchRollBasis(heading, pitch, roll);
  } else if (referencePoint.lengthSq() < 1e-6) {
    moveToTilesQuaternion.identity();
    return moveToTilesQuaternion;
  } else {
    getHeadingPitchRollForward(referencePoint, heading, pitch);
    moveToTilesRight
      .copy(moveToTilesEast)
      .multiplyScalar(Math.cos(heading))
      .addScaledVector(moveToTilesNorth, -Math.sin(heading))
      .normalize();
    moveToTilesUp
      .crossVectors(moveToTilesRight, moveToTilesForward)
      .normalize();

    if (roll !== 0) {
      moveToTilesRight.applyAxisAngle(moveToTilesForward, roll).normalize();
      moveToTilesUp.applyAxisAngle(moveToTilesForward, roll).normalize();
    }

    moveToTilesBackward.copy(moveToTilesForward).negate();
  }

  moveToTilesBasis.makeBasis(
    moveToTilesRight,
    moveToTilesUp,
    moveToTilesBackward,
  );
  return moveToTilesQuaternion.setFromRotationMatrix(moveToTilesBasis);
}

function getBoundingSphereFlyToPosition(target, range, options) {
  const { heading, pitch } = options;
  if (heading === undefined && pitch === undefined) {
    const direction =
      target.lengthSq() > 1e-6
        ? moveToTilesPosition.copy(target).normalize()
        : camera.position.lengthSq() > 1e-6
          ? moveToTilesPosition.copy(camera.position).normalize()
          : moveToTilesPosition.set(0, -1, 0);
    return direction.multiplyScalar(range).add(target);
  }

  const resolvedHeading = heading ?? 0;
  const resolvedPitch = pitch ?? -Math.PI / 2;
  const centerForward = getCenterModeHeadingPitchRollForward(
    resolvedHeading,
    resolvedPitch,
  );
  const centerPosition = moveToTilesPosition
    .copy(target)
    .addScaledVector(centerForward, -range);
  if (isCenterModePosition(centerPosition)) {
    return centerPosition;
  }

  const forward = getHeadingPitchRollForward(
    target,
    resolvedHeading,
    resolvedPitch,
  );
  return moveToTilesPosition.copy(target).addScaledVector(forward, -range);
}

function getFlyToPoseFromBoundingSphere(target, radius, options) {
  const safeRadius = Math.max(radius, 1);
  let offsetDistance = safeRadius;

  if (camera instanceof PerspectiveCamera) {
    const verticalFov = MathUtils.degToRad(camera.fov);
    const horizontalFov =
      2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const minHalfFov = Math.max(0.1, Math.min(verticalFov, horizontalFov) / 2);
    offsetDistance = safeRadius / Math.sin(minHalfFov) + safeRadius * 0.75;
  } else {
    offsetDistance = getCameraDistanceForBoundingSphere(safeRadius);
  }

  const position = getBoundingSphereFlyToPosition(
    target,
    offsetDistance,
    options,
  );
  const quaternion = getHeadingPitchRollQuaternion(
    isCenterModePosition(position) ? position : target,
    options.heading ?? 0,
    options.pitch ?? -Math.PI / 2,
    options.roll ?? 0,
  );

  return {
    position,
    quaternion,
  };
}

function frameTileset() {
  if (!getTilesetWorldBoundingSphere()) {
    return false;
  }

  const pose = getFlyToPoseFromBoundingSphere(sphere.center, sphere.radius, {
    heading: MOVE_TO_TILES_HEADING,
    pitch: MOVE_TO_TILES_PITCH,
    roll: MOVE_TO_TILES_ROLL,
  });
  camera.position.copy(pose.position);
  camera.quaternion.copy(pose.quaternion);
  camera.updateMatrixWorld(true);
  cameraController.setCamera(camera);
  return true;
}

function moveCameraToTiles() {
  cancelPositionPickModes();
  if (frameTileset()) {
    setStatus('Moved camera to the tileset.');
  } else {
    setStatus('Tileset is not ready to frame yet.', true);
  }
}

function toggleSetPositionMode() {
  if (pendingSetPosition) {
    setSetPositionMode(false);
    setStatus('Set Position cancelled.');
    return;
  }

  setSetPositionMode(true);
  setStatus(
    'Click the globe, terrain, or tiles without dragging to place the tileset root.',
  );
}

function toggleCropSetPositionMode() {
  if (!tilesetHasGaussianSplats) {
    setStatus(
      'Crop box Set Position is available for 3D Gaussian Splat tilesets only.',
      true,
    );
    return;
  }

  if (pendingCropSetPosition) {
    setCropSetPositionMode(false);
    setStatus('Crop box Set Position cancelled.');
    return;
  }

  if (!getSelectedCropBox()) {
    setStatus('Select a crop box before setting its position.', true);
    return;
  }

  setCropSetPositionMode(true);
  setStatus(
    'Click the globe, terrain, or tiles without dragging to place the selected crop box.',
  );
}

function moveCameraToCoordinate() {
  cancelPositionPickModes();
  const coordinate = parseCoordinateInputs();
  if (!coordinate) {
    return;
  }

  getCoordinateWorldPosition(
    coordinate.latitude,
    coordinate.longitude,
    coordinate.height,
    coordinateWorldPosition,
  );
  const pose = getFlyToPoseFromBoundingSphere(
    coordinateWorldPosition,
    MOVE_TO_COORDINATE_RADIUS,
    {
      heading: MOVE_TO_TILES_HEADING,
      pitch: MOVE_TO_TILES_PITCH,
      roll: MOVE_TO_TILES_ROLL,
    },
  );
  camera.position.copy(pose.position);
  camera.quaternion.copy(pose.quaternion);
  camera.updateMatrixWorld(true);
  cameraController.setCamera(camera);
  setStatus('Moved camera to the specified coordinate.');
}

async function moveTilesToCoordinate() {
  cancelPositionPickModes();
  const coordinate = parseCoordinateInputs();
  if (!coordinate) {
    return;
  }

  try {
    await applyTilesPlacementFromCoordinate(
      coordinate.latitude,
      coordinate.longitude,
      coordinate.height,
    );
    setStatus(
      'Moved tileset root to the specified coordinate using ENU orientation. Click Save to persist.',
    );
  } catch (err) {
    setStatus(err && err.message ? err.message : String(err), true);
  }
}

function resetToSaved() {
  cancelPositionPickModes();
  applySavedMatrix(lastSavedMatrix);
  setStatus('Reset to the last saved transform.');
}

function loadTileset(url) {
  if (tiles) {
    editableGroup.remove(tiles.group);
    tiles.dispose();
    tiles = null;
    debugTilesPlugin = null;
  }
  clearCropBoxes();
  setTilesetHasGaussianSplats(false);

  updateRuntimeStats(true);

  resetEditableGroup();
  lastSavedGeometricErrorScale = 1;
  lastSavedGeometricErrorLayerScale = 1;
  setGeometricErrorScaleExponent(0);
  setGeometricErrorLayerScaleExponent(0);
  savedRootMatrix.identity();
  savedRootMatrixLoadError = null;
  savedRootMatrixPromise = refreshSavedRootMatrix(url).then(
    () => {
      savedRootMatrixLoadError = null;
      syncTransformHandleFromTilesTransform();
      syncCoordinateInputsFromTilesTransform();
    },
    (err) => {
      savedRootMatrixLoadError = err;
      savedRootMatrix.identity();
      syncTransformHandleFromTilesTransform();
      syncCoordinateInputsFromTilesTransform();
    },
  );

  const next = new TilesRenderer(url);
  next.downloadQueue.maxJobs = 8;
  next.parseQueue.maxJobs = 4;
  next.registerPlugin(new TilesFadePlugin());
  next.registerPlugin(new TileCompressionPlugin());
  next.registerPlugin(new UnloadTilesPlugin());
  next.registerPlugin(new ImplicitTilingPlugin());
  next.registerPlugin(createGeometricErrorLayerScalePlugin());
  next.registerPlugin(
    new GaussianSplatPlugin({
      renderer,
      scene,
      sparkRendererOptions: {
        accumExtSplats: true,
      },
    }),
  );
  debugTilesPlugin = new DebugTilesPlugin({
    displayBoxBounds: showBoundingVolume,
    displaySphereBounds: showBoundingVolume,
    displayRegionBounds: showBoundingVolume,
  });
  next.registerPlugin(debugTilesPlugin);
  next.registerPlugin(
    new GLTFExtensionsPlugin({
      metadata: true,
      rtc: true,
      dracoLoader,
      ktxLoader: ktx2Loader,
      meshoptDecoder: MeshoptDecoder,
      autoDispose: false,
    }),
  );
  next.preprocessURL = normalizeLocalResourceUrl;
  next.setCamera(camera);
  next.setResolutionFromRenderer(camera, renderer);
  tiles = next;
  updateTilesetErrorTarget();
  applyBoundingVolumeVisibility();
  next.addEventListener('load-model', ({ scene: modelScene }) => {
    forceOpaqueScene(modelScene);
    if (isGaussianSplatScene(modelScene)) {
      setTilesetHasGaussianSplats(true);
    }
    tilesTransformDirty = true;
  });
  next.addEventListener('tile-visibility-change', () => {
    tilesTransformDirty = true;
  });

  const lruCache = next.lruCache;
  lruCache.minSize = 256;
  lruCache.maxSize = 4096;
  lruCache.minBytesSize = 0.2 * 2 ** 30;
  lruCache.maxBytesSize = 2 * 2 ** 30;
  lruCache.unloadPercent = 0.1;

  editableGroup.add(next.group);

  let framed = false;
  const tryFrame = () => {
    if (framed) {
      return;
    }
    if (frameTileset()) {
      framed = true;
      setStatus('Tileset ready.');
    }
  };

  next.addEventListener('load-tileset', applyGeometricErrorLayerScaleToTileset);
  next.addEventListener('load-tile-set', tryFrame);
  next.addEventListener('load-tileset', tryFrame);
}

async function saveTransform() {
  cancelPositionPickModes();
  saveButton.disabled = true;
  const splatCropBoxes = getSplatCropBoxesPayload();
  setStatus(
    splatCropBoxes.length > 0
      ? 'Saving transform and deleting cropped splats...'
      : 'Saving transform...',
  );

  const currentMatrix = getCurrentMatrix();
  const incrementalMatrix = currentMatrix
    .clone()
    .multiply(lastSavedMatrix.clone().invert());
  const incrementalGeometricErrorScale = geometricErrorScale;
  const savedGeometricErrorScale = getEffectiveGeometricErrorScale();
  const incrementalGeometricErrorLayerScale = geometricErrorLayerScale;
  const savedGeometricErrorLayerScale = getEffectiveGeometricErrorLayerScale();

  try {
    const response = await fetch(SAVE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        geometricErrorLayerScale: incrementalGeometricErrorLayerScale,
        geometricErrorScale: incrementalGeometricErrorScale,
        splatCropBoxes,
        transform: incrementalMatrix.toArray(),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Save failed.');
    }
    if (payload && payload.transform != null) {
      savedRootMatrix.fromArray(
        getFiniteMatrix4Array(payload.transform, 'transform'),
      );
      savedRootMatrixLoadError = null;
      savedRootMatrixPromise = Promise.resolve(savedRootMatrix);
    } else {
      savedRootMatrixPromise = refreshSavedRootMatrix(TILESET_URL).then(
        () => {
          savedRootMatrixLoadError = null;
        },
        (err) => {
          savedRootMatrixLoadError = err;
          savedRootMatrix.identity();
        },
      );
      await savedRootMatrixPromise;
      if (savedRootMatrixLoadError) {
        throw savedRootMatrixLoadError;
      }
    }
    lastSavedGeometricErrorScale = savedGeometricErrorScale;
    lastSavedGeometricErrorLayerScale = savedGeometricErrorLayerScale;
    lastSavedMatrix.copy(currentMatrix);
    setGeometricErrorScaleExponent(0);
    setGeometricErrorLayerScaleExponent(0);
    syncTransformHandleFromTilesTransform();
    syncCoordinateInputsFromTilesTransform();
    if (splatCropBoxes.length > 0) {
      const deletedSplats = Number(payload.deletedSplats || 0);
      const processedSplatResources = Number(
        payload.processedSplatResources || 0,
      );
      clearCropBoxes();
      loadTileset(TILESET_URL);
      setStatus(
        `Saved transform and deleted ${deletedSplats} cropped splats from ${processedSplatResources} splat resource${processedSplatResources === 1 ? '' : 's'}. Reloading tileset.`,
      );
    } else {
      setStatus(
        `Saved transform, geometric-error scale x${formatGeometricErrorScale(
          savedGeometricErrorScale,
        )}, and layer multiplier x${formatGeometricErrorScale(
          savedGeometricErrorLayerScale,
        )} to ${ROOT_TILESET_LABEL} and build_summary.json.`,
      );
    }
  } catch (err) {
    setStatus(err && err.message ? err.message : String(err), true);
  } finally {
    saveButton.disabled = false;
  }
}

translateButton.addEventListener('click', () => {
  cancelPositionPickModes();
  toggleTransformMode('translate');
  setStatus(
    activeTransformMode === 'translate'
      ? 'Translate mode enabled.'
      : 'Translate mode disabled.',
  );
});
rotateButton.addEventListener('click', () => {
  cancelPositionPickModes();
  toggleTransformMode('rotate');
  setStatus(
    activeTransformMode === 'rotate'
      ? 'Rotate mode enabled.'
      : 'Rotate mode disabled.',
  );
});
cropAddButton.addEventListener('click', addCropBox);
cropMoveButton.addEventListener('click', () => {
  cancelPositionPickModes();
  toggleCropTransformMode('translate');
  setStatus(
    activeTransformTarget === 'crop' && activeCropTransformMode === 'translate'
      ? 'Crop box move mode enabled.'
      : 'Crop box move mode disabled.',
  );
});
cropRotateButton.addEventListener('click', () => {
  cancelPositionPickModes();
  toggleCropTransformMode('rotate');
  setStatus(
    activeTransformTarget === 'crop' && activeCropTransformMode === 'rotate'
      ? 'Crop box rotate mode enabled.'
      : 'Crop box rotate mode disabled.',
  );
});
cropScaleButton.addEventListener('click', () => {
  cancelPositionPickModes();
  toggleCropTransformMode('scale');
  setStatus(
    activeTransformTarget === 'crop' && activeCropTransformMode === 'scale'
      ? 'Crop box scale mode enabled.'
      : 'Crop box scale mode disabled.',
  );
});
cropSetPositionButton.addEventListener('click', toggleCropSetPositionMode);
cropDeleteButton.addEventListener('click', deleteSelectedCropBox);
cropUndoButton.addEventListener('click', undoCropBoxEdit);
toolbarToggleButton.addEventListener('click', toggleToolbarVisibility);
terrainButton.addEventListener('click', () => {
  setTerrainEnabled(!terrainEnabled);
  setStatus(
    terrainEnabled
      ? 'Terrain enabled with Cesium World Terrain.'
      : 'Terrain disabled. Using ellipsoid imagery globe.',
  );
});
boundingVolumeButton.addEventListener('click', toggleBoundingVolume);
geometricErrorScaleInput.addEventListener('input', () => {
  setGeometricErrorScaleExponent(geometricErrorScaleInput.value);
});
geometricErrorScaleInput.addEventListener('change', () => {
  setStatus(
    `Geometric-error scale set to x${formatGeometricErrorScale(
      geometricErrorScale,
    )}.`,
  );
});
geometricErrorLayerScaleInput.addEventListener('input', () => {
  setGeometricErrorLayerScaleExponent(geometricErrorLayerScaleInput.value);
});
geometricErrorLayerScaleInput.addEventListener('change', () => {
  setStatus(
    `Geometric-error layer multiplier set to x${formatGeometricErrorScale(
      geometricErrorLayerScale,
    )}.`,
  );
});
moveToTilesButton.addEventListener('click', moveCameraToTiles);
moveCameraToCoordinateButton.addEventListener('click', moveCameraToCoordinate);
moveTilesToCoordinateButton.addEventListener('click', moveTilesToCoordinate);
setPositionButton.addEventListener('click', toggleSetPositionMode);
resetButton.addEventListener('click', resetToSaved);
saveButton.addEventListener('click', saveTransform);
renderer.domElement.addEventListener(
  'pointerdown',
  handleSetPositionPointerDown,
);
renderer.domElement.addEventListener(
  'pointermove',
  handleSetPositionPointerMove,
);
renderer.domElement.addEventListener(
  'pointerup',
  handleSetPositionPointerUp,
);
renderer.domElement.addEventListener(
  'pointercancel',
  handleSetPositionPointerCancel,
);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  tiles?.setResolutionFromRenderer(camera, renderer);
  globeTiles?.setResolutionFromRenderer(camera, renderer);
});

window.addEventListener('pagehide', requestViewerShutdown);
window.addEventListener('beforeunload', () => {
  requestViewerShutdown();
  cameraController.dispose();
  dracoLoader.dispose();
  ktx2Loader.dispose();
});

loadTileset(TILESET_URL);

function frame() {
  cameraController.update();
  if (tilesTransformDirty) {
    editableGroup.updateMatrixWorld(true);
    updateTilesRendererGroupMatrices(tiles);
    refreshLoadedTileSceneMatrices(tiles);
    tilesTransformDirty = false;
  }
  globeTiles?.update();
  tiles?.update();
  renderer.render(scene, camera);
  updateRuntimeStats();
  requestAnimationFrame(frame);
}

frame();
