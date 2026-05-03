import { Matrix4, Raycaster, Sphere, Vector2, Vector3 } from 'three';
import { isGaussianSplatScene } from '3d-tiles-rendererjs-3dgs-plugin';
import {
  forceOpaqueScene,
  mouseToCoords,
  normalizeLocalResourceUrl,
  setRaycasterFromCamera,
} from './viewerUtils.js';
import {
  applyEditableMatrixFromRootTransform,
  applySavedObjectMatrix,
  getIncrementalMatrix,
  getObjectMatrix,
  getRootTransform,
  refreshLoadedTileSceneMatrices,
  refreshSavedRootMatrix,
  resetEditableObjectTransform,
  setSavedRootMatrixFromTransform,
  updateTilesRendererGroupMatrices,
} from './tilesetTransform.js';
import { postSaveTransform } from './saveTransformRequest.js';
import {
  parseCoordinateInputs as parseCoordinateInputValues,
  setCoordinateInputs,
} from './coordinateInputs.js';
import { createRuntimeStats } from './runtimeStats.js';
import { createGeoCameraController } from './geoCamera.js';
import { createGeometricErrorController } from './geometricError.js';
import { createGlobeController } from './globeController.js';
import { updateCropControls } from './cropUi.js';
import { createViewerScene } from './sceneSetup.js';
import { createViewerTransformControls } from './transformControls.js';
import { bindViewerEvents } from './viewerEvents.js';
import { createViewerShutdownRequester } from './viewerShutdown.js';
import { createSetPositionPointerTracker } from './setPositionPointerTracker.js';
import {
  createScreenSelection,
  createScreenSelectionEdit,
  createScreenSelectionFarHandle,
  createScreenSelectionPointerTracker,
  disposeScreenSelection,
  getScreenSelectionFarDepthFromPosition,
  getScreenSelectionPayload,
  SCREEN_SELECTION_ACTION_EXCLUDE,
  setScreenSelectionFarDepth,
  setScreenSelectionEditSelection,
  updateScreenSelectionWorldState,
} from './screenSelection.js';
import {
  DEFAULT_ERROR_TARGET,
  createInspectorTilesRenderer,
} from './tiles.js';
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
} from './viewerConfig.js';
import { getViewerElements } from './domElements.js';

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

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', !!isError);
}

function setSaveProgress(percent) {
  if (!saveProgressEl) {
    return;
  }

  if (percent == null) {
    saveProgressEl.hidden = true;
    saveProgressEl.value = 0;
    return;
  }

  saveProgressEl.hidden = false;
  saveProgressEl.value = Math.min(100, Math.max(0, percent));
}

function handleSaveProgress(progress) {
  const percent = Number(progress?.percent);
  const hasPercent = Number.isFinite(percent);
  if (hasPercent) {
    setSaveProgress(percent);
  }

  if (typeof progress?.message === 'string' && progress.message.length > 0) {
    setStatus(
      hasPercent
        ? `${progress.message} ${Math.round(Math.min(100, Math.max(0, percent)))}%`
        : progress.message,
    );
  }
}

const requestViewerShutdown = createViewerShutdownRequester(SHUTDOWN_URL);

function parseCoordinateInputs() {
  return parseCoordinateInputValues({
    heightInput,
    latitudeInput,
    longitudeInput,
    setStatus,
  });
}

function updateModeButtons(mode) {
  translateButton.classList.toggle('active', mode === 'translate');
  rotateButton.classList.toggle('active', mode === 'rotate');
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
const globeController = createGlobeController({
  camera,
  globeGroup,
  onTilesChanged: () => {
    cameraController.setEllipsoid(getActiveEllipsoid());
  },
  renderer,
});
cameraController.setPointerDownFilter((event) => {
  return !(pendingCropScreenSelectionMode && event.button === 0);
});

const { transformControls, transformControlsHelper } =
  createViewerTransformControls({
    camera,
    cameraController,
    domElement: renderer.domElement,
    scene,
    transformHandle,
    callbacks: {
      onObjectChange: handleTransformControlObjectChange,
      onRootObjectChange: (matrix) => {
        applyEditableGroupMatrixFromRootTransform(matrix);
        syncCoordinateInputsFromTilesTransform();
      },
    },
    getSyncingTransformHandle: () => syncingTransformHandle,
  });

const sphere = new Sphere();
const coordinateWorldPosition = new Vector3();
const coordinateTransformMatrix = new Matrix4();
const coordinateEditMatrix = new Matrix4();
const currentRootTransformMatrix = new Matrix4();
const savedRootInverseMatrix = new Matrix4();
const screenSelectionCameraForward = new Vector3();
const pointerCoords = new Vector2();
const pickRaycaster = new Raycaster();
const pickTargets = [];
let tiles = null;
let toolbarVisible = true;
let activeTransformMode = null;
let lastSavedMatrix = new Matrix4();
const savedRootMatrix = new Matrix4();
let savedRootMatrixPromise = Promise.resolve();
let savedRootMatrixLoadError = null;
let pendingSetPosition = false;
let syncingTransformHandle = false;
let tilesTransformDirty = false;
let showBoundingVolume = false;
let debugTilesPlugin = null;
let tilesetHasGaussianSplats = false;
let cropScreenSelections = [];
let pendingCropScreenSelections = [];
let nextCropScreenSelectionId = 1;
let activeCropScreenSelectionId = null;
let pendingCropScreenSelectionMode = false;
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

function getActiveEllipsoid() {
  return tiles?.ellipsoid || globeController.getEllipsoid();
}

const geoCamera = createGeoCameraController({
  camera,
  centerModeDistanceSq: CAMERA_CENTER_MODE_DISTANCE_SQ,
  getActiveEllipsoid,
});

const geometricError = createGeometricErrorController({
  defaultErrorTarget: DEFAULT_ERROR_TARGET,
  geometricErrorLayerScaleInput,
  geometricErrorLayerValueEl,
  geometricErrorScaleInput,
  geometricErrorValueEl,
  getTiles: () => tiles,
});

const setPositionPointerTracker = createSetPositionPointerTracker({
  getActiveTarget: getActiveSetPositionTarget,
  maxClickDistanceSq: SET_POSITION_CLICK_MAX_DISTANCE_SQ,
  onApply: async (target, event) => {
    if (target === 'tiles') {
      await applyTilesSetPositionFromPointerEvent(event);
    }
  },
});

const screenSelectionPointerTracker = createScreenSelectionPointerTracker({
  camera,
  domElement: renderer.domElement,
  getDepthRange: getScreenSelectionDepthRange,
  onSelectionCreated: handleScreenSelectionCreated,
  overlayEl: screenSelectionOverlayEl,
  rectEl: screenSelectionRectEl,
});

function updateRuntimeStats(force = false) {
  runtimeStats.update(force);
}

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
  clearCropSelections();
  updateRuntimeStats(true);
}

function markTilesetHasGaussianSplats() {
  if (tilesetHasGaussianSplats) {
    return;
  }

  tilesetHasGaussianSplats = true;
  setGaussianSplatUiVisible(true);
  updateCropButtons();
  updateRuntimeStats(true);
}

function syncTerrainButton() {
  const terrainEnabled = globeController.isTerrainEnabled();
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
  globeController.setTerrainEnabled(enabled);
  syncTerrainButton();
}

function getActiveCropScreenSelection() {
  if (activeCropScreenSelectionId == null) {
    return null;
  }
  return findCropScreenSelection(activeCropScreenSelectionId)?.selection || null;
}

function setTransformControlAxes(showX, showY, showZ) {
  transformControls.showX = showX;
  transformControls.showY = showY;
  transformControls.showZ = showZ;
}

function syncTransformControlsState() {
  const pendingPositionPick =
    pendingSetPosition || pendingCropScreenSelectionMode;
  const activeCropScreenSelection = getActiveCropScreenSelection();
  const farControlsVisible =
    !!activeCropScreenSelection?.farHandle && !pendingPositionPick;
  const rootControlsVisible =
    activeTransformMode !== null &&
    !farControlsVisible &&
    !pendingPositionPick;

  if (farControlsVisible) {
    if (transformControls.object !== activeCropScreenSelection.farHandle) {
      transformControls.attach(activeCropScreenSelection.farHandle);
    }
    transformControls.setMode('translate');
    transformControls.setSpace('local');
    setTransformControlAxes(false, false, true);
  } else if (rootControlsVisible) {
    if (transformControls.object !== transformHandle) {
      transformControls.attach(transformHandle);
    }
    transformControls.setMode(activeTransformMode);
    transformControls.setSpace('local');
    setTransformControlAxes(true, true, true);
  } else if (transformControls.object) {
    transformControls.detach();
  }

  const controlsVisible = farControlsVisible || rootControlsVisible;
  transformControls.enabled = controlsVisible;
  if (transformControlsHelper) {
    transformControlsHelper.visible = controlsVisible;
    transformControlsHelper.updateMatrixWorld(true);
  }
}

function setTransformMode(mode) {
  activeTransformMode = mode;
  if (mode !== null && activeCropScreenSelectionId != null) {
    activeCropScreenSelectionId = null;
    syncScreenSelectionEditSdfs();
    syncScreenSelectionFarHandles();
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

geometricError.initializeInputs();
setTerrainEnabled(globeController.isTerrainEnabled());
setTransformMode(activeTransformMode);
updateCropButtons();
syncToolbarVisibility();
syncBoundingVolumeButton();

function applySavedMatrix(matrix) {
  applySavedObjectMatrix(editableGroup, matrix);
  invalidateTilesetTransforms();
  syncTransformHandleFromTilesTransform();
  syncCoordinateInputsFromTilesTransform();
}

function getCurrentMatrix() {
  return getObjectMatrix(editableGroup);
}

function getCurrentRootTransform(target) {
  return getRootTransform({
    editableGroup,
    lastSavedMatrix,
    savedRootInverseMatrix,
    savedRootMatrix,
    target,
  });
}

function invalidateTilesetTransforms() {
  tilesTransformDirty = true;
  editableGroup.updateMatrixWorld(true);
  updateTilesRendererGroupMatrices(tiles);
  refreshLoadedTileSceneMatrices(tiles);
  syncScreenSelectionsToTilesTransform();
  transformControlsHelper?.updateMatrixWorld(true);
}

function applyEditableGroupMatrixFromRootTransform(rootTransform) {
  applyEditableMatrixFromRootTransform({
    editableGroup,
    lastSavedMatrix,
    rootTransform,
    savedRootInverseMatrix,
    savedRootMatrix,
    target: coordinateEditMatrix,
  });
  invalidateTilesetTransforms();
}

function syncTransformHandleFromTilesTransform() {
  syncingTransformHandle = true;
  try {
    applySavedObjectMatrix(
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
  resetEditableObjectTransform(editableGroup);
  lastSavedMatrix.identity();
  resetEditableObjectTransform(transformHandle);
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

function syncCoordinateInputsFromTilesTransform() {
  if (savedRootMatrixLoadError) {
    return;
  }

  getCurrentRootTransform(currentRootTransformMatrix);
  coordinateWorldPosition.setFromMatrixPosition(currentRootTransformMatrix);
  const coordinate =
    geoCamera.getCartographicFromWorldPosition(coordinateWorldPosition);
  if (!coordinate) {
    return;
  }

  updateCoordinateInputs(
    coordinate.latitude,
    coordinate.longitude,
    coordinate.height,
  );
}

function updateCoordinateInputs(latitude, longitude, height) {
  setCoordinateInputs(
    {
      heightInput,
      latitudeInput,
      longitudeInput,
    },
    {
      height,
      latitude,
      longitude,
    },
  );
}

function raycastPickWorldPosition(target) {
  pickTargets.length = 0;

  if (tiles?.group) {
    pickTargets.push(tiles.group);
  }

  const globeTiles = globeController.getTiles();
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

function getCurrentRootTransformArray() {
  return getCurrentRootTransform(currentRootTransformMatrix).toArray();
}

function syncScreenSelectionsToTilesTransform() {
  const transform = getCurrentRootTransformArray();
  getCropScreenSelectionEntries().forEach(({ selection }) => {
    updateScreenSelectionWorldState(
      selection,
      transform,
      selection.id === activeCropScreenSelectionId,
    );
  });
}

function syncScreenSelectionEditSdfs() {
  syncScreenSelectionsToTilesTransform();
  setScreenSelectionEditSelection(screenSelectionSplatEdit, null, false);
  const selections = [
    ...cropScreenSelections.map((selection) => ({
      style:
        selection.id === activeCropScreenSelectionId ? 'preview' : 'exclude',
      selection,
    })),
    ...pendingCropScreenSelections.map((selection) => ({
      style: 'preview',
      selection,
    })),
  ];

  selections.forEach(({ style, selection }) => {
    if (!selection.edit) {
      selection.edit = createScreenSelectionEdit({
        style,
        name: `Screen Selection ${selection.id}`,
      });
      scene.add(selection.edit);
    }
    selection.edit.ordering =
      style === 'preview' ? 1000000 + selection.id : selection.id;
    setScreenSelectionEditSelection(selection.edit, selection, style);
  });
}

function getCropScreenSelectionEntries() {
  return [
    ...cropScreenSelections.map((selection) => ({
      style: 'exclude',
      selection,
    })),
    ...pendingCropScreenSelections.map((selection) => ({
      style: 'preview',
      selection,
    })),
  ];
}

function syncScreenSelectionFarHandles() {
  const entries = getCropScreenSelectionEntries();
  if (
    activeCropScreenSelectionId != null &&
    !entries.some(({ selection }) => selection.id === activeCropScreenSelectionId)
  ) {
    activeCropScreenSelectionId = null;
  }

  entries.forEach(({ selection }) => {
    if (!selection.farHandle) {
      scene.add(createScreenSelectionFarHandle(selection));
    }
  });
  syncScreenSelectionsToTilesTransform();
}

function clearCropSelections() {
  cancelCropScreenSelectionMode();
  cropScreenSelections.forEach(disposeScreenSelection);
  pendingCropScreenSelections.forEach(disposeScreenSelection);
  cropScreenSelections = [];
  pendingCropScreenSelections = [];
  activeCropScreenSelectionId = null;
  syncScreenSelectionEditSdfs();
  syncScreenSelectionFarHandles();
  updateCropButtons();
  syncTransformControlsState();
}

function updateCropButtons() {
  updateCropControls({
    activeScreenSelectionId: activeCropScreenSelectionId,
    elements: viewerElements,
    pendingScreenSelectionMode: pendingCropScreenSelectionMode,
    screenSelections: cropScreenSelections,
    pendingScreenSelections: pendingCropScreenSelections,
    onScreenSelectionRemove: handleScreenSelectionRemove,
    onScreenSelectionSelect: handleScreenSelectionSelect,
    tilesetHasGaussianSplats,
  });
}

function getScreenSelectionDepthRange() {
  if (!getTilesetWorldBoundingSphere()) {
    return {
      far: camera.near + 100,
      near: camera.near,
    };
  }

  camera.getWorldDirection(screenSelectionCameraForward);
  const centerDepth = sphere.center
    .clone()
    .sub(camera.position)
    .dot(screenSelectionCameraForward);
  const sphereFarthestDistance =
    camera.position.distanceTo(sphere.center) + sphere.radius;
  const near = Math.max(camera.near, centerDepth - sphere.radius);
  return {
    far: sphereFarthestDistance,
    near,
  };
}

function setCropScreenSelectionMode(active) {
  pendingCropScreenSelectionMode =
    active &&
    tilesetHasGaussianSplats &&
    pendingCropScreenSelections.length === 0;
  screenSelectionPointerTracker.setActive(pendingCropScreenSelectionMode);
  if (pendingCropScreenSelectionMode) {
    activeCropScreenSelectionId = null;
    pendingSetPosition = false;
    setPositionPointerTracker.clear();
    setTransformMode(null);
    syncScreenSelectionEditSdfs();
    syncScreenSelectionFarHandles();
  }
  cameraController.enabled = !transformControls.dragging;
  syncTransformControlsState();
  updateModeButtons(activeTransformMode);
  updateCropButtons();
}

function cancelCropScreenSelectionMode() {
  if (!pendingCropScreenSelectionMode) {
    return;
  }

  setCropScreenSelectionMode(false);
}

function handleScreenSelectionCreated(selectionData) {
  if (pendingCropScreenSelections.length > 0) {
    setCropScreenSelectionMode(false);
    setStatus(
      'Confirm or Cancel the current screen selection before drawing another.',
      true,
    );
    return;
  }

  if (!selectionData) {
    setStatus('Screen selection was too small.', true);
    return;
  }

  const selection = createScreenSelection({
    action: SCREEN_SELECTION_ACTION_EXCLUDE,
    id: nextCropScreenSelectionId++,
    transformMatrix: getCurrentRootTransformArray(),
    ...selectionData,
  });
  pendingCropScreenSelections.push(selection);
  activeCropScreenSelectionId = selection.id;
  setCropScreenSelectionMode(false);
  syncScreenSelectionEditSdfs();
  syncScreenSelectionFarHandles();
  syncTransformControlsState();
  updateCropButtons();
  setStatus(
    'Added screen exclude selection. Drag the 3D far plane, then Confirm or Cancel before drawing another.',
  );
}

function toggleCropScreenSelectionMode() {
  if (!tilesetHasGaussianSplats) {
    setStatus(
      'Screen selection is available for 3D Gaussian Splat tilesets only.',
      true,
    );
    return;
  }

  if (pendingCropScreenSelectionMode) {
    setCropScreenSelectionMode(false);
    setStatus('Screen selection paused.');
    return;
  }

  if (pendingCropScreenSelections.length > 0) {
    setStatus(
      'Confirm or Cancel the current screen selection before drawing another.',
      true,
    );
    return;
  }

  setCropScreenSelectionMode(true);
  setStatus('Drag one screen exclude rectangle.');
}

function confirmCropScreenSelection() {
  if (pendingCropScreenSelections.length === 0) {
    return;
  }

  const selectionCount = pendingCropScreenSelections.length;
  cropScreenSelections.push(...pendingCropScreenSelections);
  pendingCropScreenSelections = [];
  activeCropScreenSelectionId = null;
  setCropScreenSelectionMode(false);
  syncScreenSelectionEditSdfs();
  syncScreenSelectionFarHandles();
  syncTransformControlsState();
  updateCropButtons();
  setStatus(
    `Confirmed ${selectionCount} screen selection${selectionCount === 1 ? '' : 's'}. Click its row to adjust the 3D far plane, or Save to apply.`,
  );
}

function cancelCropScreenSelection() {
  const hadMode = pendingCropScreenSelectionMode;
  const hadSelection = pendingCropScreenSelections.length > 0;
  cancelCropScreenSelectionMode();
  if (
    pendingCropScreenSelections.some(
      (selection) => selection.id === activeCropScreenSelectionId,
    )
  ) {
    activeCropScreenSelectionId = null;
  }
  pendingCropScreenSelections.forEach(disposeScreenSelection);
  pendingCropScreenSelections = [];
  syncScreenSelectionEditSdfs();
  syncScreenSelectionFarHandles();
  updateCropButtons();
  syncTransformControlsState();
  if (hadMode || hadSelection) {
    setStatus('Screen selection cancelled.');
  }
}

function findCropScreenSelection(selectionId) {
  const id = Number(selectionId);
  let selection = cropScreenSelections.find((entry) => entry.id === id);
  if (selection) {
    return { confirmed: true, selection };
  }

  selection = pendingCropScreenSelections.find((entry) => entry.id === id);
  return selection ? { confirmed: false, selection } : null;
}

function updateCropScreenSelectionFarDepth(selectionId, farDepth, commit) {
  const match = findCropScreenSelection(selectionId);
  if (!match) {
    return;
  }

  setScreenSelectionFarDepth(
    match.selection,
    farDepth,
    getCurrentRootTransformArray(),
  );
  syncScreenSelectionEditSdfs();
  syncScreenSelectionFarHandles();

  if (commit) {
    updateCropButtons();
    setStatus('Updated screen selection far plane.');
  }
}

function handleTransformControlObjectChange(object) {
  if (!object?.userData?.screenSelectionFarHandle) {
    return false;
  }

  const match = findCropScreenSelection(object.userData.screenSelectionId);
  if (!match) {
    return true;
  }

  updateCropScreenSelectionFarDepth(
    match.selection.id,
    getScreenSelectionFarDepthFromPosition(
      match.selection,
      object.position,
      getCurrentRootTransformArray(),
    ),
    false,
  );
  updateCropButtons();
  return true;
}

function handleScreenSelectionSelect(selectionId) {
  const match = findCropScreenSelection(selectionId);
  if (!match) {
    return;
  }

  const wasActive = activeCropScreenSelectionId === match.selection.id;
  activeCropScreenSelectionId = wasActive ? null : match.selection.id;
  setTransformMode(null);
  syncScreenSelectionEditSdfs();
  syncScreenSelectionFarHandles();
  updateCropButtons();
  syncTransformControlsState();
  setStatus(
    wasActive
      ? 'Screen selection deactivated.'
      : 'Drag the 3D far plane handle to adjust screen selection depth.',
  );
}

function removeScreenSelectionFromList(list, selectionId) {
  const id = Number(selectionId);
  const index = list.findIndex((selection) => selection.id === id);
  if (index === -1) {
    return false;
  }

  const [selection] = list.splice(index, 1);
  disposeScreenSelection(selection);
  return true;
}

function handleScreenSelectionRemove(selectionId) {
  const removed =
    removeScreenSelectionFromList(cropScreenSelections, selectionId) ||
    removeScreenSelectionFromList(pendingCropScreenSelections, selectionId);
  if (!removed) {
    return;
  }

  if (Number(selectionId) === activeCropScreenSelectionId) {
    activeCropScreenSelectionId = null;
  }
  syncScreenSelectionEditSdfs();
  syncScreenSelectionFarHandles();
  updateCropButtons();
  syncTransformControlsState();
  setStatus('Removed screen selection.');
}

function getSplatScreenSelectionsPayload() {
  syncScreenSelectionsToTilesTransform();
  return cropScreenSelections.map(getScreenSelectionPayload);
}

function syncPositionPickModeState() {
  setPositionButton.classList.toggle('active', pendingSetPosition);
  cameraController.enabled = !transformControls.dragging;
  syncTransformControlsState();
  updateCropButtons();
}

function setSetPositionMode(active) {
  pendingSetPosition = active;
  setPositionPointerTracker.clear();
  if (active) {
    activeCropScreenSelectionId = null;
    syncScreenSelectionEditSdfs();
    syncScreenSelectionFarHandles();
    cancelCropScreenSelectionMode();
    setTransformMode(null);
  }
  syncPositionPickModeState();
}

function cancelSetPositionMode() {
  if (!pendingSetPosition) {
    return;
  }

  setSetPositionMode(false);
}

function cancelPositionPickModes() {
  cancelSetPositionMode();
  cancelCropScreenSelectionMode();
}

async function applyTilesPlacementFromCoordinate(latitude, longitude, height) {
  await savedRootMatrixPromise;
  if (savedRootMatrixLoadError) {
    throw savedRootMatrixLoadError;
  }

  geoCamera.getCoordinateTransform(
    latitude,
    longitude,
    height,
    coordinateTransformMatrix,
  );
  applyEditableMatrixFromRootTransform({
    editableGroup,
    lastSavedMatrix,
    rootTransform: coordinateTransformMatrix,
    savedRootInverseMatrix,
    savedRootMatrix,
    target: coordinateEditMatrix,
  });
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
  if (!pickWorldPositionFromPointerEvent(event, coordinateWorldPosition)) {
    return null;
  }

  return geoCamera.getCartographicFromWorldPosition(coordinateWorldPosition);
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

function getActiveSetPositionTarget() {
  if (pendingSetPosition) {
    return 'tiles';
  }
  return null;
}

function frameTileset() {
  if (!getTilesetWorldBoundingSphere()) {
    return false;
  }

  const pose = geoCamera.getFlyToPoseFromBoundingSphere(
    sphere.center,
    sphere.radius,
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

function moveCameraToCoordinate() {
  cancelPositionPickModes();
  const coordinate = parseCoordinateInputs();
  if (!coordinate) {
    return;
  }

  geoCamera.getCoordinateWorldPosition(
    coordinate.latitude,
    coordinate.longitude,
    coordinate.height,
    coordinateWorldPosition,
  );
  const pose = geoCamera.getFlyToPoseFromBoundingSphere(
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
  resetGaussianSplatTilesetState();

  resetEditableGroup();
  geometricError.resetSavedScales();
  savedRootMatrix.identity();
  savedRootMatrixLoadError = null;
  savedRootMatrixPromise = refreshSavedRootMatrix({
    rootTilesetLabel: ROOT_TILESET_LABEL,
    target: savedRootMatrix,
    url,
  }).then(
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

  const { debugTilesPlugin: nextDebugTilesPlugin, tiles: next } =
    createInspectorTilesRenderer({
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
  debugTilesPlugin = nextDebugTilesPlugin;
  tiles = next;
  geometricError.updateTilesetErrorTarget();
  applyBoundingVolumeVisibility();
  next.addEventListener('load-model', ({ scene: modelScene }) => {
    forceOpaqueScene(modelScene);
    if (isGaussianSplatScene(modelScene)) {
      markTilesetHasGaussianSplats();
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

  next.addEventListener('load-tileset', geometricError.applyLayerScaleToTileset);
  next.addEventListener('load-tile-set', tryFrame);
  next.addEventListener('load-tileset', tryFrame);
}

async function saveTransform() {
  cancelPositionPickModes();
  if (pendingCropScreenSelections.length > 0) {
    setStatus('Confirm or cancel pending screen selections before saving.', true);
    return;
  }

  saveButton.disabled = true;
  setSaveProgress(0);
  const splatScreenSelections = getSplatScreenSelectionsPayload();
  const cropRegionCount = splatScreenSelections.length;
  setStatus(
    cropRegionCount > 0
      ? 'Saving transform and deleting cropped splats...'
      : 'Saving transform...',
  );

  const currentMatrix = getCurrentMatrix();
  const incrementalMatrix = getIncrementalMatrix(
    currentMatrix,
    lastSavedMatrix,
  );
  const saveState = geometricError.getSaveState();

  try {
    const payload = await postSaveTransform({
      incrementalMatrix,
      onProgress: handleSaveProgress,
      saveState,
      saveUrl: SAVE_URL,
      splatScreenSelections,
    });
    if (payload && payload.transform != null) {
      setSavedRootMatrixFromTransform({
        target: savedRootMatrix,
        transform: payload.transform,
      });
      savedRootMatrixLoadError = null;
      savedRootMatrixPromise = Promise.resolve(savedRootMatrix);
    } else {
      savedRootMatrixPromise = refreshSavedRootMatrix({
        rootTilesetLabel: ROOT_TILESET_LABEL,
        target: savedRootMatrix,
        url: TILESET_URL,
      }).then(
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
    geometricError.markSaved(saveState);
    lastSavedMatrix.copy(currentMatrix);
    geometricError.resetPendingScales();
    syncTransformHandleFromTilesTransform();
    syncCoordinateInputsFromTilesTransform();
    if (cropRegionCount > 0) {
      const deletedSplats = Number(payload.deletedSplats || 0);
      const processedSplatResources = Number(
        payload.processedSplatResources || 0,
      );
      clearCropSelections();
      loadTileset(TILESET_URL);
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
    saveButton.disabled = false;
  }
}

bindViewerEvents({
  camera,
  cameraController,
  dracoLoader,
  elements: viewerElements,
  geometricError,
  getActiveTransformMode: () => activeTransformMode,
  getGlobeTiles: () => globeController.getTiles(),
  getTerrainEnabled: () => globeController.isTerrainEnabled(),
  getTiles: () => tiles,
  handlers: {
    cancelCropScreenSelection,
    cancelPositionPickModes,
    confirmCropScreenSelection,
    handleScreenSelectionPointerCancel:
      screenSelectionPointerTracker.handlePointerCancel,
    handleScreenSelectionPointerDown:
      screenSelectionPointerTracker.handlePointerDown,
    handleScreenSelectionPointerMove:
      screenSelectionPointerTracker.handlePointerMove,
    handleScreenSelectionPointerUp:
      screenSelectionPointerTracker.handlePointerUp,
    handleSetPositionPointerCancel:
      setPositionPointerTracker.handlePointerCancel,
    handleSetPositionPointerDown: setPositionPointerTracker.handlePointerDown,
    handleSetPositionPointerMove: setPositionPointerTracker.handlePointerMove,
    handleSetPositionPointerUp: setPositionPointerTracker.handlePointerUp,
    moveCameraToCoordinate,
    moveCameraToTiles,
    moveTilesToCoordinate,
    requestViewerShutdown,
    resetToSaved,
    saveTransform,
    setTerrainEnabled,
    toggleBoundingVolume,
    toggleCropScreenSelectionMode,
    toggleToolbarVisibility,
    toggleTransformMode,
    toggleSetPositionMode,
  },
  ktx2Loader,
  renderer,
  setStatus,
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
  globeController.update();
  tiles?.update();
  renderer.render(scene, camera);
  updateRuntimeStats();
  requestAnimationFrame(frame);
}

frame();
