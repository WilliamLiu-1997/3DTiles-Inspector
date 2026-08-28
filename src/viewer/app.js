import { SplatMesh } from 'gaussian-splat-lite';
import { forceOpaqueMaterial, normalizeLocalResourceUrl } from './utils.js';
import { postSaveTransform } from './io/saveTransformRequest.js';
import {
  parseCoordinateInputs as parseCoordinateInputValues,
  setCoordinateInputs,
} from './dom/coordinateInputs.js';
import { createRuntimeStats } from './dom/runtimeStats.js';
import { createStatusPanel } from './dom/statusPanel.js';
import { createThemeController } from './dom/theme.js';
import { createViewerToggles } from './dom/viewerToggles.js';
import { createGeoCameraController } from './transform/geoCamera.js';
import { createGeometricErrorController } from './transform/geometricError.js';
import { createUniformScaleController } from './transform/uniformScale.js';
import { createGlobeController } from './scene/globeController.js';
import { createRenderLoop } from './scene/renderLoop.js';
import { createViewerScene } from './scene/sceneSetup.js';
import { createViewerTransformControls } from './scene/transformControls.js';
import {
  createCameraMovementTileQueueController,
} from './scene/cameraMovementTileQueues.js';
import { bindViewerEvents } from './dom/events.js';
import { createViewerShutdownRequester } from './io/shutdown.js';
import { createSetPositionController } from './io/setPositionController.js';
import { createFlyToController } from './navigation/flyTo.js';
import { createCameraUrlPoseController } from './navigation/cameraUrlPose.js';
import { createCropController } from './screenSelection/cropController.js';
import { createRootTransformController } from './transform/rootTransformController.js';
import { markWorldMatricesDirty } from './transform/tilesetTransform.js';
import { createTransformModeController } from './transform/transformModeController.js';
import {
  DEFAULT_ERROR_TARGET,
  createInspectorTilesRenderer,
} from './scene/tiles.js';
import {
  BASIS_TRANSCODER_PATH,
  CAMERA_CENTER_MODE_DISTANCE_SQ,
  CAMERA_CENTER_MODE_FAR,
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
  cesiumIonTokenInput,
  cropSectionEl,
  geometricErrorLayerScaleInput,
  geometricErrorLayerValueEl,
  geometricErrorScaleInput,
  geometricErrorValueEl,
  fpsValueEl,
  heightInput,
  latitudeInput,
  longitudeInput,
  renderOnDemandToggle,
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
  themeToggle,
  tilesDownloadingValueEl,
  tilesLoadedValueEl,
  tilesParsingValueEl,
  tilesVisibleValueEl,
  toolbarDockEl,
  toolbarEl,
  toolbarScrollEl,
  toolbarToggleButton,
  translateButton,
  uniformScaleTrackEl,
  uniformScaleValueInput,
} = viewerElements;

function syncToolbarScrollbarGutter() {
  if (!toolbarScrollEl) {
    return;
  }

  const scrollbarGutter = Math.max(
    0,
    toolbarScrollEl.offsetWidth - toolbarScrollEl.clientWidth,
  );
  toolbarScrollEl.style.setProperty(
    '--toolbar-scrollbar-gutter',
    `${scrollbarGutter}px`,
  );
}

syncToolbarScrollbarGutter();
if (toolbarScrollEl && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(syncToolbarScrollbarGutter).observe(toolbarScrollEl);
}

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

let renderLoop = null;

function requestRender() {
  renderLoop?.requestRender();
}

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
  gaussianSplatRenderer,
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
  onRenderDirty: requestRender,
});

const cameraExteriorModeFar = camera.far;

function updateCameraFarForMode() {
  const nextFar =
    camera.position.lengthSq() <= CAMERA_CENTER_MODE_DISTANCE_SQ
      ? CAMERA_CENTER_MODE_FAR
      : cameraExteriorModeFar;
  if (camera.far !== nextFar) {
    camera.far = nextFar;
    camera.updateProjectionMatrix();
  }
}

createThemeController({
  onThemeChanged: requestRender,
  scene,
  themeToggle,
});

let tiles = null;
let globeTiles = null;
const observedTilesRenderers = new Set();

function observeTilesRenderer(next) {
  if (!next || observedTilesRenderers.has(next)) {
    return;
  }

  observedTilesRenderers.add(next);
  next.addEventListener('needs-render', requestRender);
  next.addEventListener('needs-update', requestRender);
  requestRender();
}

function unobserveTilesRenderer(current) {
  if (!current || !observedTilesRenderers.delete(current)) {
    return;
  }

  current.removeEventListener('needs-render', requestRender);
  current.removeEventListener('needs-update', requestRender);
}

const cameraMovementTileQueues = createCameraMovementTileQueueController({
  cameraController,
});

function getActiveEllipsoid() {
  return tiles?.ellipsoid || globeController.getEllipsoid();
}

const globeController = createGlobeController({
  camera,
  globeGroup,
  onTilesChanged: (next) => {
    unobserveTilesRenderer(globeTiles);
    globeTiles = next;
    observeTilesRenderer(next);
    cameraController.setEllipsoid(getActiveEllipsoid());
  },
  renderer,
});

const viewerToggles = createViewerToggles({
  boundingVolumeButton,
  cesiumIonTokenInput,
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
let savedUniformScaleTrackDisabledState = null;

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
    savedUniformScaleTrackDisabledState =
      uniformScaleTrackEl?.classList.contains('disabled') ?? false;
    uniformScaleTrackEl?.classList.add('disabled');
    uniformScaleTrackEl?.classList.remove('dragging');
    uniformScaleTrackEl?.setAttribute('aria-disabled', 'true');
    uniformScaleTrackEl?.style.setProperty('--scale-track-offset', '0px');
    toolbarDockEl.classList.add('saving');
    toolbarDockEl.setAttribute('aria-busy', 'true');
    cropController?.setInteractionLocked(true);
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
  if (uniformScaleTrackEl) {
    uniformScaleTrackEl.classList.toggle(
      'disabled',
      !!savedUniformScaleTrackDisabledState,
    );
    if (savedUniformScaleTrackDisabledState) {
      uniformScaleTrackEl.setAttribute('aria-disabled', 'true');
    } else {
      uniformScaleTrackEl.removeAttribute('aria-disabled');
    }
  }
  savedUniformScaleTrackDisabledState = null;
  cropController?.setInteractionLocked(false);
}

cameraController.setPointerDownFilter((event) => {
  return !(cropController?.shouldCapturePointerDown(event) ?? false);
});

const { transformControls, transformControlsHelper } =
  createViewerTransformControls({
    camera,
    cameraController,
    domElement: renderer.domElement,
    scene,
    transformHandle,
    reversedDepthBuffer: renderer.capabilities.reversedDepthBuffer,
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
transformControls.addEventListener('change', requestRender);

let tilesetHasGaussianSplats = false;
const gaussianSplatWorldMatrixNodes = new WeakMap();

const runtimeStats = createRuntimeStats({
  cacheBytesValueEl,
  fpsValueEl,
  getGaussianSplatRenderer: () => gaussianSplatRenderer,
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

const uniformScale = createUniformScaleController({
  applyScale: (scale) => rootTransform?.applyUniformScale(scale),
  uniformScaleTrackEl,
  uniformScaleValueInput,
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
  requestRender,
  setStatus,
  applyTilesPlacementFromCoordinate: (lat, lon, h) =>
    rootTransform.applyFromCoordinate(lat, lon, h),
  getTiles: () => tiles,
  getTilesetBoundingSphere,
});

const cameraUrlPose = createCameraUrlPoseController({
  camera,
  cameraController,
  setStatus,
});
const appliedInitialCameraPose = cameraUrlPose.applyFromUrl({
  showStatus: true,
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
  reversedDepthBuffer: renderer.capabilities.reversedDepthBuffer,
  onSceneChanged: requestRender,
  setStatus,
  setTransformMode: (mode) => transformModeController.setMode(mode),
  syncTransformControlsState: () => transformModeController.syncControls(),
  transformControls,
  viewerElements,
  cancelOtherPositionPickModes: () => setPositionController.cancelMode(),
  getCurrentRootTransformArray: () =>
    rootTransform.getCurrentRootTransformArray(),
  getLocalFrameQuaternion: (referencePoint, target) =>
    geoCamera.getLocalFrameQuaternion(referencePoint, target),
  getTiles: () => tiles,
  getTilesetBoundingSphere,
});
cameraController.setRaycastHitFilter((intersection) =>
  cropController?.isRaycastHitVisible(intersection) ?? true,
);

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
  rootTilesetLabel: ROOT_TILESET_LABEL,
  transformControlsHelper,
  transformHandle,
  onCoordinateChanged: updateCoordinateInputs,
  onTransformsInvalidated: () => cropController.syncWorldState(),
  onUniformScaleChanged: uniformScale.syncFromRootScale,
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

function inspectLoadedTileScene(root) {
  const opaqueMaterials = new Set();
  const worldMatrixNodes = new Set();
  root.traverse((object) => {
    const material = object.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => opaqueMaterials.add(entry));
    } else if (material) {
      opaqueMaterials.add(material);
    }

    if (!(object instanceof SplatMesh)) {
      return;
    }

    let current = object;
    while (current) {
      worldMatrixNodes.add(current);
      if (current === root) {
        break;
      }
      current = current.parent;
    }
  });
  return { opaqueMaterials, worldMatrixNodes };
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
uniformScale.initializeInputs();
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
    flyTo.moveCameraToTiles();
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
    cameraMovementTileQueues.setTiles(null);
    unobserveTilesRenderer(tiles);
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
    showBoundingVolume,
    tilePreprocess: geometricError.applyLayerScaleToTile,
    url,
  });
  tiles = next;
  observeTilesRenderer(next);
  cameraMovementTileQueues.setTiles(next);
  viewerToggles.setBoundingVolumePlugin(debugTilesPlugin);
  geometricError.updateTilesetErrorTarget();
  next.addEventListener('load-model', ({ scene: modelScene }) => {
    const { opaqueMaterials, worldMatrixNodes } =
      inspectLoadedTileScene(modelScene);
    if (worldMatrixNodes.size > 0) {
      gaussianSplatWorldMatrixNodes.set(modelScene, worldMatrixNodes);
      markTilesetHasGaussianSplats();
    } else {
      opaqueMaterials.forEach(forceOpaqueMaterial);
    }
  });
  next.addEventListener(
    'tile-visibility-change',
    ({ scene: modelScene, visible }) => {
      if (!visible || !modelScene?.parent) {
        return;
      }
      const worldMatrixNodes = gaussianSplatWorldMatrixNodes.get(modelScene);
      if (worldMatrixNodes) {
        // TilesGroup skips clean children after reparenting. GSL already updates
        // each SplatMesh every frame, so dirty only its cached ancestor paths.
        markWorldMatricesDirty(worldMatrixNodes);
      }
    },
  );

  const lruCache = next.lruCache;
  lruCache.minSize = 1024;
  lruCache.maxSize = 4096;
  lruCache.minBytesSize = 0.5 * 2 ** 30;
  lruCache.maxBytesSize = 2 * 2 ** 30;

  editableGroup.add(next.group);

  let framed = !frameOnLoad;
  const tryFrame = () => {
    if (framed) {
      return;
    }
    if (
      flyTo.frameTileset({
        activeStatus: 'Framing tileset...',
        doneStatus: 'Tileset ready.',
      })
    ) {
      framed = true;
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
      'Confirm or cancel pending crop selections before saving.',
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
  const incrementalMatrix =
    rootTransform.getIncrementalSinceSaved(currentMatrix);
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
      const deletedSplatFiles = Number(payload.deletedSplatFiles || 0);
      cropController.clearAll();
      loadTileset(TILESET_URL, { frameOnLoad: false });
      setStatus(
        `Saved transform and deleted ${deletedSplats} cropped splats from ${processedSplatResources} splat resource${processedSplatResources === 1 ? '' : 's'}${deletedSplatFiles > 0 ? `, removing ${deletedSplatFiles} orphaned file${deletedSplatFiles === 1 ? '' : 's'}` : ''}. Reloading tileset.`,
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

function renderFrame(time = performance.now()) {
  cameraController.update(time);
  const cameraFlightActive = flyTo.update(time);
  cameraUrlPose.update(time);
  updateCameraFarForMode();
  globeController.update();
  tiles?.update();
  renderer.render(scene, camera);
  runtimeStats.recordRenderedFrame(time);
  runtimeStats.update();
  return cameraFlightActive;
}

renderLoop = createRenderLoop({
  onFrame: renderFrame,
  onIdle: runtimeStats.markRenderIdle,
  renderOnDemand: true,
});
renderOnDemandToggle.checked = renderLoop.isRenderOnDemand();
cameraController.addEventListener('update', requestRender);

function setRenderOnDemand(enabled) {
  const next = !!enabled;
  renderOnDemandToggle.checked = next;
  renderLoop.setRenderOnDemand(next);
  setStatus(
    next
      ? 'Render on demand enabled. The canvas pauses when the scene is idle.'
      : 'Render on demand disabled. Continuous rendering resumed.',
  );
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
  gaussianSplatRenderer,
  handlers: {
    cancelCropScreenSelection: cropController.cancel,
    beginKeepSphereRadiusTrackDrag:
      cropController.beginKeepSphereRadiusTrackDrag,
    cancelKeepSphere: cropController.cancelKeepSphere,
    cancelPositionPickModes,
    confirmCropScreenSelection: cropController.confirm,
    confirmKeepSphere: cropController.confirmKeepSphere,
    createKeepSphere: cropController.createKeepSphere,
    disposeRenderLoop: renderLoop.dispose,
    endKeepSphereRadiusTrackDrag:
      cropController.endKeepSphereRadiusTrackDrag,
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
    requestRender,
    requestViewerShutdown,
    resetToSaved,
    saveTransform,
    nudgeKeepSphereRadiusExponent: cropController.nudgeKeepSphereRadiusExponent,
    setKeepSphereRadiusFromTrackClientX:
      cropController.setKeepSphereRadiusFromTrackClientX,
    setKeepSphereSizeValue: cropController.setKeepSphereSizeValue,
    setRenderOnDemand,
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
  uniformScale,
});

window.addEventListener('popstate', () => {
  if (cameraUrlPose.applyFromUrl({ showStatus: true })) {
    flyTo.cancelCameraFlight();
    cancelPositionPickModes();
  }
});
window.addEventListener('pagehide', cameraUrlPose.flush);
cameraController.addEventListener('finish', cameraUrlPose.flush);

loadTileset(TILESET_URL, { frameOnLoad: !appliedInitialCameraPose });
requestRender();
