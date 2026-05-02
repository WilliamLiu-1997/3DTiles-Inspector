import { Matrix4, Quaternion, Raycaster, Sphere, Vector2, Vector3 } from 'three';
import { isGaussianSplatScene } from '3d-tiles-rendererjs-3dgs-plugin';
import {
  CROP_BOX_DEFAULT_HALF_SIZE,
  DEFAULT_CROP_TRANSFORM_MODE,
  createCropBox as createCropBoxObject,
  disposeCropBox,
  normalizeCropBoxTransform,
  setCropBoxSelectedStyle,
  syncCropBoxSdf,
} from './cropBox.js';
import {
  clamp,
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
import { updateCropBoxControls } from './cropBoxUi.js';
import { createViewerScene } from './sceneSetup.js';
import { createViewerTransformControls } from './transformControls.js';
import { bindViewerEvents } from './viewerEvents.js';
import { createViewerShutdownRequester } from './viewerShutdown.js';
import { createSetPositionPointerTracker } from './setPositionPointerTracker.js';
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
  const rootActive = activeTransformTarget === 'tiles';
  translateButton.classList.toggle(
    'active',
    rootActive && mode === 'translate',
  );
  rotateButton.classList.toggle('active', rootActive && mode === 'rotate');
}

const {
  camera,
  cameraController,
  cropBoxLineGeometry,
  cropGroup,
  cropSplatEdit,
  dracoLoader,
  editableGroup,
  globeGroup,
  ktx2Loader,
  renderer,
  scene,
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

const { transformControls, transformControlsHelper } =
  createViewerTransformControls({
    camera,
    cameraController,
    domElement: renderer.domElement,
    scene,
    transformHandle,
    callbacks: {
      createCropSnapshot,
      onCropObjectChange: () => {
        const selectedBox = getSelectedCropBox();
        if (selectedBox) {
          normalizeCropBoxTransform(selectedBox);
          syncCropBoxSdf(selectedBox);
          updateCropBoxVisualState();
        }
      },
      onRootObjectChange: (matrix) => {
        applyEditableGroupMatrixFromRootTransform(matrix);
        syncCoordinateInputsFromTilesTransform();
      },
      pushCropUndoSnapshot,
      snapshotsEqual: (snapshot) =>
        snapshotsEqual(snapshot, createCropSnapshot()),
    },
    getActiveTransformTarget: () => activeTransformTarget,
    getCropTransformSnapshot: () => cropTransformSnapshot,
    getSelectedCropBox,
    getSyncingTransformHandle: () => syncingTransformHandle,
    setCropTransformSnapshot: (snapshot) => {
      cropTransformSnapshot = snapshot;
    },
  });

const sphere = new Sphere();
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
let tiles = null;
let toolbarVisible = true;
let activeTransformMode = null;
let lastSavedMatrix = new Matrix4();
const savedRootMatrix = new Matrix4();
let savedRootMatrixPromise = Promise.resolve();
let savedRootMatrixLoadError = null;
let pendingSetPosition = false;
let pendingCropSetPosition = false;
let syncingTransformHandle = false;
let tilesTransformDirty = false;
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
    } else if (target === 'crop') {
      applyCropSetPositionFromPointerEvent(event);
    }
  },
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
  clearCropBoxes();
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
    clearCropSelection({ sync: false });
    activeTransformTarget = 'tiles';
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
  const box = createCropBoxObject({
    id,
    lineGeometry: cropBoxLineGeometry,
    matrix,
  });
  cropGroup.add(box.root);
  cropBoxes.push(box);
  syncCropEditSdfs();
  return box;
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

function updateCropButtons() {
  updateCropBoxControls({
    activeCropTransformMode,
    activeTransformTarget,
    cropBoxes,
    elements: viewerElements,
    onBoxButtonClick: (box, index) => {
      if (box.id === selectedCropBoxId) {
        clearCropSelection();
        setStatus(`Deselected crop box ${index + 1}.`);
        return;
      }
      selectCropBox(box.id);
      if (!activeCropTransformMode) {
        setCropTransformMode(DEFAULT_CROP_TRANSFORM_MODE);
      }
      setStatus(`Selected crop box ${index + 1}.`);
    },
    pendingCropSetPosition,
    selectedCropBoxId,
    tilesetHasGaussianSplats,
    undoDepth: cropUndoStack.length,
  });
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

function clearCropSelection({ sync = true } = {}) {
  selectedCropBoxId = null;
  activeCropTransformMode = null;
  pendingCropSetPosition = false;
  setPositionPointerTracker.clear();
  if (activeTransformTarget === 'crop') {
    activeTransformTarget = null;
  }
  updateCropBoxVisualState();
  if (sync) {
    updateModeButtons(activeTransformMode);
    updateCropButtons();
    syncTransformControlsState();
  }
}

function selectCropBox(id) {
  selectedCropBoxId = cropBoxes.some((box) => box.id === id) ? id : null;
  if (!selectedCropBoxId) {
    clearCropSelection();
    return;
  }
  updateCropBoxVisualState();
  updateCropButtons();
  syncTransformControlsState();
}

function getDefaultCropBoxQuaternion(position, target) {
  return geoCamera.getLocalFrameQuaternion(position, target);
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
  cameraController.enabled = !transformControls.dragging;
  syncTransformControlsState();
  updateCropButtons();
}

function setSetPositionMode(active) {
  pendingSetPosition = active;
  setPositionPointerTracker.clear();
  if (active) {
    pendingCropSetPosition = false;
    setTransformMode(null);
    setCropTransformMode(null);
    clearCropSelection({ sync: false });
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
  setPositionPointerTracker.clear();
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
  saveButton.disabled = true;
  const splatCropBoxes = getSplatCropBoxesPayload();
  setStatus(
    splatCropBoxes.length > 0
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
      saveState,
      saveUrl: SAVE_URL,
      splatCropBoxes,
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
    saveButton.disabled = false;
  }
}

bindViewerEvents({
  camera,
  cameraController,
  dracoLoader,
  elements: viewerElements,
  geometricError,
  getActiveCropTransformMode: () => activeCropTransformMode,
  getActiveTransformMode: () => activeTransformMode,
  getActiveTransformTarget: () => activeTransformTarget,
  getGlobeTiles: () => globeController.getTiles(),
  getTerrainEnabled: () => globeController.isTerrainEnabled(),
  getTiles: () => tiles,
  handlers: {
    addCropBox,
    cancelPositionPickModes,
    deleteSelectedCropBox,
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
    toggleCropSetPositionMode,
    toggleCropTransformMode,
    toggleToolbarVisibility,
    toggleTransformMode,
    toggleSetPositionMode,
    undoCropBoxEdit,
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
