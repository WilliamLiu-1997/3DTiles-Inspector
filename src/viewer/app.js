import { isGaussianSplatScene } from '3d-tiles-rendererjs-3dgs-plugin';
import { forceOpaqueScene, normalizeLocalResourceUrl } from './utils.js';
import { postSaveTransform } from './io/saveTransformRequest.js';
import {
  parseCoordinateInputs as parseCoordinateInputValues,
  setCoordinateInputs,
} from './dom/coordinateInputs.js';
import { createRuntimeStats } from './dom/runtimeStats.js';
import { createStatusPanel } from './dom/statusPanel.js';
import { createViewerToggles } from './dom/viewerToggles.js';
import { createGeoCameraController } from './transform/geoCamera.js';
import { createGeometricErrorController } from './transform/geometricError.js';
import { createGlobeController } from './scene/globeController.js';
import { createViewerScene } from './scene/sceneSetup.js';
import { createViewerTransformControls } from './scene/transformControls.js';
import { bindViewerEvents } from './dom/events.js';
import { createViewerShutdownRequester } from './io/shutdown.js';
import { createSetPositionController } from './io/setPositionController.js';
import { createFlyToController } from './navigation/flyTo.js';
import { createCropController } from './screenSelection/cropController.js';
import { createRootTransformController } from './transform/rootTransformController.js';
import { createTransformModeController } from './transform/transformModeController.js';
import {
  DEFAULT_ERROR_TARGET,
  createInspectorTilesRenderer,
} from './scene/tiles.js';
import {
  BASIS_TRANSCODER_PATH,
  CAMERA_CENTER_MODE_DISTANCE_SQ,
  DRACO_DECODER_PATH,
  MOVE_TO_COORDINATE_RADIUS,
  MOVE_TO_TILES_HEADING,
  MOVE_TO_TILES_PITCH,
  MOVE_TO_TILES_ROLL,
  ROOT_TILESET_LABEL,
  SAVE_URL,
  SET_POSITION_CLICK_MAX_DISTANCE_SQ,
  SHUTDOWN_URL,
  TILESET_URL,
} from './config.js';
import { getViewerElements } from './dom/elements.js';

const viewerElements = getViewerElements();
const {
  boundingVolumeButton,
  cacheBytesValueEl,
  cropSectionEl,
  geometricErrorLayerScaleInput,
  geometricErrorLayerValueEl,
  geometricErrorScaleInput,
  geometricErrorValueEl,
  heightInput,
  latitudeInput,
  longitudeInput,
  rotateButton,
  saveButton,
  saveProgressEl,
  screenSelectionOverlayEl,
  screenSelectionRectEl,
  setPositionButton,
  splatsCountStatEl,
  splatsCountValueEl,
  statusEl,
  terrainButton,
  tilesDownloadingValueEl,
  tilesLoadedValueEl,
  tilesParsingValueEl,
  tilesVisibleValueEl,
  toolbarDockEl,
  toolbarEl,
  toolbarToggleButton,
  translateButton,
} = viewerElements;

const MOVE_TO_TILES_POSE = {
  heading: MOVE_TO_TILES_HEADING,
  pitch: MOVE_TO_TILES_PITCH,
  roll: MOVE_TO_TILES_ROLL,
};
const SAVE_LOCK_CONTROL_SELECTOR = 'button, input, select, textarea';
const SAVE_LOCK_EXEMPT_SELECTOR = '[data-save-lock-exempt]';

const { handleSaveProgress, setSaveProgress, setStatus } = createStatusPanel({
  saveProgressEl,
  statusEl,
});

const requestViewerShutdown = createViewerShutdownRequester(SHUTDOWN_URL);

function parseCoordinateInputs() {
  return parseCoordinateInputValues({
    heightInput,
    latitudeInput,
    longitudeInput,
    setStatus,
  });
}

function updateCoordinateInputs(latitude, longitude, height) {
  setCoordinateInputs(
    { heightInput, latitudeInput, longitudeInput },
    { height, latitude, longitude },
  );
}

const {
  camera,
  cameraController,
  dracoLoader,
  editableGroup,
  globeGroup,
  ktx2Loader,
  renderer,
  scene,
  screenSelectionSplatEdit,
  terrainLight,
  transformHandle,
} = createViewerScene({
  basisTranscoderPath: BASIS_TRANSCODER_PATH,
  container: document.getElementById('app'),
  dracoDecoderPath: DRACO_DECODER_PATH,
});

let tiles = null;

function getActiveEllipsoid() {
  return tiles?.ellipsoid || globeController.getEllipsoid();
}

const globeController = createGlobeController({
  camera,
  globeGroup,
  onTilesChanged: () => {
    cameraController.setEllipsoid(getActiveEllipsoid());
  },
  renderer,
});

const viewerToggles = createViewerToggles({
  boundingVolumeButton,
  globeController,
  setStatus,
  terrainButton,
  terrainLight,
  toolbarDockEl,
  toolbarEl,
  toolbarToggleButton,
});

let cropController = null;
let setPositionController = null;
let transformModeController = null;
let rootTransform = null;
let savedControlDisabledStates = null;

function setSaveUiLocked(locked) {
  if (!toolbarDockEl) {
    return;
  }

  if (locked) {
    if (savedControlDisabledStates) {
      return;
    }

    savedControlDisabledStates = new Map();
    toolbarDockEl
      .querySelectorAll(SAVE_LOCK_CONTROL_SELECTOR)
      .forEach((control) => {
        if (control.closest(SAVE_LOCK_EXEMPT_SELECTOR)) {
          return;
        }
        savedControlDisabledStates.set(control, control.disabled);
        control.disabled = true;
      });
    toolbarDockEl.classList.add('saving');
    toolbarDockEl.setAttribute('aria-busy', 'true');
    return;
  }

  if (!savedControlDisabledStates) {
    return;
  }

  toolbarDockEl.classList.remove('saving');
  toolbarDockEl.removeAttribute('aria-busy');
  savedControlDisabledStates.forEach((wasDisabled, control) => {
    if (control.isConnected) {
      control.disabled = wasDisabled;
    }
  });
  savedControlDisabledStates = null;
}

cameraController.setPointerDownFilter((event) => {
  return !(cropController?.getPendingMode() && event.button === 0);
});

const { transformControls, transformControlsHelper } =
  createViewerTransformControls({
    camera,
    cameraController,
    domElement: renderer.domElement,
    scene,
    transformHandle,
    callbacks: {
      onObjectChange: (object) =>
        cropController?.handleTransformControlObjectChange(object) ?? false,
      onRootObjectChange: (matrix) => {
        rootTransform.applyFromRootTransform(matrix);
        rootTransform.syncCoordinateInputs();
      },
    },
    getSyncingTransformHandle: () => rootTransform?.isSyncingHandle() ?? false,
  });

let tilesetHasGaussianSplats = false;

const runtimeStats = createRuntimeStats({
  cacheBytesValueEl,
  getScene: () => scene,
  getTiles: () => tiles,
  hasGaussianSplats: () => tilesetHasGaussianSplats,
  splatsCountValueEl,
  tilesDownloadingValueEl,
  tilesLoadedValueEl,
  tilesParsingValueEl,
  tilesVisibleValueEl,
});

const geoCamera = createGeoCameraController({
  camera,
  centerModeDistanceSq: CAMERA_CENTER_MODE_DISTANCE_SQ,
  getActiveEllipsoid: () => flyTo.getActiveEllipsoid(),
});

const geometricError = createGeometricErrorController({
  defaultErrorTarget: DEFAULT_ERROR_TARGET,
  geometricErrorLayerScaleInput,
  geometricErrorLayerValueEl,
  geometricErrorScaleInput,
  geometricErrorValueEl,
  getTiles: () => tiles,
});

function getTilesetBoundingSphere(target) {
  if (!tiles || !tiles.getBoundingSphere(target)) {
    return false;
  }

  editableGroup.updateMatrixWorld(true);
  target.center.applyMatrix4(editableGroup.matrixWorld);
  target.radius *= editableGroup.matrixWorld.getMaxScaleOnAxis();
  return true;
}

const flyTo = createFlyToController({
  camera,
  cameraController,
  domElement: renderer.domElement,
  geoCamera,
  globeController,
  moveToTilesPose: MOVE_TO_TILES_POSE,
  moveToCoordinateRadius: MOVE_TO_COORDINATE_RADIUS,
  setStatus,
  applyTilesPlacementFromCoordinate: (lat, lon, h) =>
    rootTransform.applyFromCoordinate(lat, lon, h),
  getTiles: () => tiles,
  getTilesetBoundingSphere,
});

setPositionController = createSetPositionController({
  cameraController,
  maxClickDistanceSq: SET_POSITION_CLICK_MAX_DISTANCE_SQ,
  setPositionButton,
  setStatus,
  setTransformMode: (mode) => transformModeController.setMode(mode),
  syncTransformControlsState: () => transformModeController.syncControls(),
  transformControls,
  applyTilesPlacementFromPointerEvent: async (event) => {
    const coordinate = await flyTo.applyTilesSetPositionFromPointerEvent(event);
    if (coordinate) {
      updateCoordinateInputs(
        coordinate.latitude,
        coordinate.longitude,
        coordinate.height,
      );
      setStatus(
        'Moved tileset root to the clicked position using ENU orientation. Click Save to persist.',
      );
      setPositionController.cancelMode();
    }
  },
  cancelOtherPositionPickModes: () => cropController?.deactivate(),
});

cropController = createCropController({
  camera,
  cameraController,
  domElement: renderer.domElement,
  overlayEl: screenSelectionOverlayEl,
  rectEl: screenSelectionRectEl,
  scene,
  screenSelectionSplatEdit,
  setStatus,
  setTransformMode: (mode) => transformModeController.setMode(mode),
  syncTransformControlsState: () => transformModeController.syncControls(),
  transformControls,
  viewerElements,
  cancelOtherPositionPickModes: () => setPositionController.cancelMode(),
  getCurrentRootTransformArray: () => rootTransform.getCurrentRootTransformArray(),
  getTilesetBoundingSphere,
});

transformModeController = createTransformModeController({
  cropController,
  rotateButton,
  setPositionController,
  transformControls,
  transformControlsHelper,
  transformHandle,
  translateButton,
});

rootTransform = createRootTransformController({
  editableGroup,
  geoCamera,
  getTiles: () => tiles,
  rootTilesetLabel: ROOT_TILESET_LABEL,
  transformControlsHelper,
  transformHandle,
  onCoordinateChanged: updateCoordinateInputs,
  onTransformsInvalidated: () => cropController.syncWorldState(),
});

function setGaussianSplatUiVisible(visible) {
  if (splatsCountStatEl) {
    splatsCountStatEl.hidden = !visible;
  }
  if (cropSectionEl) {
    cropSectionEl.hidden = !visible;
  }
}

function resetGaussianSplatTilesetState() {
  tilesetHasGaussianSplats = false;
  setGaussianSplatUiVisible(false);
  cropController.setHasGaussianSplats(false);
  cropController.clearAll();
  runtimeStats.update(true);
}

function markTilesetHasGaussianSplats() {
  if (tilesetHasGaussianSplats) {
    return;
  }

  tilesetHasGaussianSplats = true;
  setGaussianSplatUiVisible(true);
  cropController.setHasGaussianSplats(true);
  runtimeStats.update(true);
}

function cancelPositionPickModes() {
  setPositionController.cancelMode();
  cropController.cancelMode();
}

function exitSaveInteractionModes() {
  setPositionController.cancelMode();
  cropController.deactivate();
  transformModeController.setMode(null);
}

geometricError.initializeInputs();
transformModeController.setMode(null);

function moveCameraToTiles() {
  cancelPositionPickModes();
  flyTo.moveCameraToTiles();
}

function moveCameraToCoordinate() {
  cancelPositionPickModes();
  const coordinate = parseCoordinateInputs();
  if (!coordinate) {
    return;
  }
  flyTo.moveCameraToCoordinate(coordinate);
}

async function moveTilesToCoordinate() {
  cancelPositionPickModes();
  const coordinate = parseCoordinateInputs();
  if (!coordinate) {
    return;
  }

  try {
    await rootTransform.applyFromCoordinate(
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
  rootTransform.applySaved(rootTransform.getLastSaved());
  setStatus('Reset to the last saved transform.');
}

function loadTileset(url, { frameOnLoad = true } = {}) {
  if (tiles) {
    editableGroup.remove(tiles.group);
    tiles.dispose();
    tiles = null;
    viewerToggles.setBoundingVolumePlugin(null);
  }
  resetGaussianSplatTilesetState();
  rootTransform.reset();
  transformModeController.syncControls();
  geometricError.resetSavedScales();
  rootTransform.refresh(url);

  const showBoundingVolume = viewerToggles.getBoundingVolumeVisible();
  const { debugTilesPlugin, tiles: next } = createInspectorTilesRenderer({
    camera,
    dracoLoader,
    ktxLoader: ktx2Loader,
    preprocessURL: normalizeLocalResourceUrl,
    renderer,
    scene,
    showBoundingVolume,
    tilePreprocess: geometricError.applyLayerScaleToTile,
    url,
  });
  tiles = next;
  viewerToggles.setBoundingVolumePlugin(debugTilesPlugin);
  geometricError.updateTilesetErrorTarget();
  next.addEventListener('load-model', ({ scene: modelScene }) => {
    forceOpaqueScene(modelScene);
    if (isGaussianSplatScene(modelScene)) {
      markTilesetHasGaussianSplats();
    }
    rootTransform.markDirty();
  });
  next.addEventListener('tile-visibility-change', () => {
    rootTransform.markDirty();
  });

  const lruCache = next.lruCache;
  lruCache.minSize = 256;
  lruCache.maxSize = 4096;
  lruCache.minBytesSize = 0.2 * 2 ** 30;
  lruCache.maxBytesSize = 2 * 2 ** 30;
  lruCache.unloadPercent = 0.1;

  editableGroup.add(next.group);

  let framed = !frameOnLoad;
  const tryFrame = () => {
    if (framed) {
      return;
    }
    if (flyTo.frameTileset()) {
      framed = true;
      setStatus('Tileset ready.');
    }
  };

  next.addEventListener(
    'load-tileset',
    geometricError.applyLayerScaleToTileset,
  );
  next.addEventListener('load-tile-set', tryFrame);
  next.addEventListener('load-tileset', tryFrame);
}

async function saveTransform() {
  cancelPositionPickModes();
  if (cropController.hasPendingSelections()) {
    setStatus(
      'Confirm or cancel pending screen selections before saving.',
      true,
    );
    return;
  }

  saveButton.disabled = true;
  setSaveProgress(0);
  const splatScreenSelections = cropController.getPayload();
  const cropRegionCount = splatScreenSelections.length;
  exitSaveInteractionModes();
  setSaveUiLocked(true);
  setStatus(
    cropRegionCount > 0
      ? 'Saving transform and deleting cropped splats...'
      : 'Saving transform...',
  );

  const currentMatrix = rootTransform.getCurrentMatrix();
  const incrementalMatrix = rootTransform.getIncrementalSinceSaved(currentMatrix);
  const saveState = geometricError.getSaveState();
  let unlockSaveUi = true;

  try {
    const payload = await postSaveTransform({
      incrementalMatrix,
      onProgress: handleSaveProgress,
      saveState,
      saveUrl: SAVE_URL,
      splatScreenSelections,
    });
    if (payload && payload.transform != null) {
      rootTransform.setFromTransform(payload.transform);
    } else {
      await rootTransform.reloadFromUrl(TILESET_URL);
    }
    geometricError.markSaved(saveState);
    rootTransform.markSaved(currentMatrix);
    geometricError.resetPendingScales();
    rootTransform.syncTransformHandle();
    rootTransform.syncCoordinateInputs();
    if (cropRegionCount > 0) {
      const deletedSplats = Number(payload.deletedSplats || 0);
      const processedSplatResources = Number(
        payload.processedSplatResources || 0,
      );
      cropController.clearAll();
      loadTileset(TILESET_URL, { frameOnLoad: false });
      setStatus(
        `Saved transform and deleted ${deletedSplats} cropped splats from ${processedSplatResources} splat resource${processedSplatResources === 1 ? '' : 's'}. Reloading tileset.`,
      );
    } else {
      setStatus(
        `Saved transform, geometric-error scale x${geometricError.formatScale(
          saveState.savedGeometricErrorScale,
        )}, and layer multiplier x${geometricError.formatScale(
          saveState.savedGeometricErrorLayerScale,
        )} to ${ROOT_TILESET_LABEL} and build_summary.json.`,
      );
    }
  } catch (err) {
    setStatus(err && err.message ? err.message : String(err), true);
  } finally {
    setSaveProgress(null);
    if (unlockSaveUi) {
      setSaveUiLocked(false);
      saveButton.disabled = false;
    }
  }
}

bindViewerEvents({
  camera,
  cameraController,
  dracoLoader,
  elements: viewerElements,
  geometricError,
  getActiveTransformMode: () => transformModeController.getMode(),
  getGlobeTiles: () => globeController.getTiles(),
  getTerrainEnabled: () => globeController.isTerrainEnabled(),
  getTiles: () => tiles,
  handlers: {
    cancelCropScreenSelection: cropController.cancel,
    cancelPositionPickModes,
    confirmCropScreenSelection: cropController.confirm,
    handleScreenSelectionPointerCancel: cropController.handlePointerCancel,
    handleScreenSelectionPointerDown: cropController.handlePointerDown,
    handleScreenSelectionPointerMove: cropController.handlePointerMove,
    handleScreenSelectionPointerUp: cropController.handlePointerUp,
    handleSetPositionPointerCancel: setPositionController.handlePointerCancel,
    handleSetPositionPointerDown: setPositionController.handlePointerDown,
    handleSetPositionPointerMove: setPositionController.handlePointerMove,
    handleSetPositionPointerUp: setPositionController.handlePointerUp,
    moveCameraToCoordinate,
    moveCameraToTiles,
    moveTilesToCoordinate,
    requestViewerShutdown,
    resetToSaved,
    saveTransform,
    setTerrainEnabled: viewerToggles.setTerrainEnabled,
    toggleBoundingVolume: viewerToggles.toggleBoundingVolume,
    toggleCropScreenSelectionMode: cropController.toggle,
    toggleToolbarVisibility: viewerToggles.toggleToolbarVisibility,
    toggleTransformMode: transformModeController.toggle,
    toggleSetPositionMode: setPositionController.toggle,
  },
  ktx2Loader,
  renderer,
  setStatus,
});

loadTileset(TILESET_URL);

function frame() {
  cameraController.update();
  rootTransform.flush();
  globeController.update();
  tiles?.update();
  renderer.render(scene, camera);
  runtimeStats.update();
  requestAnimationFrame(frame);
}

frame();
