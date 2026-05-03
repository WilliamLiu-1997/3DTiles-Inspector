import { Sphere, Vector3 } from 'three';
import {
  SCREEN_SELECTION_ACTION_EXCLUDE,
  createScreenSelection,
  createScreenSelectionEdit,
  createScreenSelectionFarHandle,
  createScreenSelectionPointerTracker,
  disposeScreenSelection,
  getScreenSelectionFarDepthFromPosition,
  getScreenSelectionPayload,
  setScreenSelectionShape,
  setScreenSelectionEditSelection,
  setScreenSelectionFarDepth,
  updateScreenSelectionWorldState,
} from './index.js';
import {
  clearOverlay,
  createSelectionData,
} from './geometry.js';
import {
  SCREEN_EDIT_CORNER_HIT_SIZE,
  SCREEN_EDIT_CORNER_PARTS,
  SCREEN_EDIT_EDGE_HIT_SIZE,
  SCREEN_EDIT_EDGE_PARTS,
  SCREEN_EDIT_PART_POINT_INDICES,
  clampClientPoints,
  copyClientPoint,
  copyClientPoints,
  createScreenEditOverlay,
  getClientRectPoints,
  getPartPoint,
  isConvexClientQuad,
  pointSegmentDistanceSq,
} from './editOverlay.js';
import { updateCropControls } from '../dom/cropUi.js';

const CAMERA_POSITION_EPSILON_SQ = 1e-12;
const CAMERA_QUATERNION_EPSILON = 1e-10;
const CAMERA_PROJECTION_EPSILON = 1e-10;

export function createCropController({
  camera,
  cameraController,
  domElement,
  overlayEl,
  rectEl,
  scene,
  screenSelectionSplatEdit,
  setStatus,
  setTransformMode,
  syncTransformControlsState,
  transformControls,
  viewerElements,
  cancelOtherPositionPickModes,
  getCurrentRootTransformArray,
  getTilesetBoundingSphere,
}) {
  let selections = [];
  let pendingSelections = [];
  let nextSelectionId = 1;
  let activeSelectionId = null;
  let pendingMode = false;
  let pendingScreenEdit = null;
  let pendingEditDrag = null;
  let editCursor = '';
  let hasGaussianSplats = false;
  const sphere = new Sphere();
  const cameraForward = new Vector3();
  const screenEditOverlay = createScreenEditOverlay({ overlayEl, rectEl });

  function getActiveSelection() {
    if (activeSelectionId == null) {
      return null;
    }
    return findSelection(activeSelectionId)?.selection || null;
  }

  function getEntries() {
    return [
      ...selections.map((selection) => ({ style: 'exclude', selection })),
      ...pendingSelections.map((selection) => ({
        style: 'preview',
        selection,
      })),
    ];
  }

  function setEditCursor(cursor) {
    const nextCursor = cursor || '';
    if (editCursor === nextCursor) {
      return;
    }
    domElement.style.cursor = nextCursor;
    editCursor = nextCursor;
  }

  function clearEditCursor() {
    setEditCursor('');
  }

  function getActivePendingEdit() {
    if (!pendingScreenEdit || activeSelectionId !== pendingScreenEdit.selectionId) {
      return null;
    }
    const match = pendingSelections.find(
      (selection) => selection.id === pendingScreenEdit.selectionId,
    );
    return match ? pendingScreenEdit : null;
  }

  function clearScreenEditOverlay() {
    screenEditOverlay.clear();
    clearEditCursor();
  }

  function syncPendingEditOverlay() {
    const edit = getActivePendingEdit();
    if (!edit) {
      clearScreenEditOverlay();
      if (!pendingMode) {
        clearOverlay(overlayEl, rectEl);
      }
      return;
    }

    screenEditOverlay.render(edit.clientPoints, { showGrid: false });
  }

  function createCameraPoseSnapshot() {
    camera.updateMatrixWorld(true);
    return {
      position: camera.position.toArray(),
      projectionMatrix: camera.projectionMatrix.toArray(),
      quaternion: camera.quaternion.toArray(),
    };
  }

  function projectionChanged(source, target) {
    if (!Array.isArray(source) || !Array.isArray(target)) {
      return true;
    }
    return source.some(
      (value, index) =>
        Math.abs(value - target[index]) > CAMERA_PROJECTION_EPSILON,
    );
  }

  function cameraPoseChanged(cameraPose) {
    if (!cameraPose) {
      return true;
    }

    camera.updateMatrixWorld(true);
    const dx = camera.position.x - cameraPose.position[0];
    const dy = camera.position.y - cameraPose.position[1];
    const dz = camera.position.z - cameraPose.position[2];
    if (dx * dx + dy * dy + dz * dz > CAMERA_POSITION_EPSILON_SQ) {
      return true;
    }

    const quaternion = cameraPose.quaternion;
    const quaternionDot = Math.abs(
      camera.quaternion.x * quaternion[0] +
        camera.quaternion.y * quaternion[1] +
        camera.quaternion.z * quaternion[2] +
        camera.quaternion.w * quaternion[3],
    );
    if (1 - Math.min(1, quaternionDot) > CAMERA_QUATERNION_EPSILON) {
      return true;
    }

    return projectionChanged(
      camera.projectionMatrix.toArray(),
      cameraPose.projectionMatrix,
    );
  }

  function clearPendingScreenEdit() {
    pendingScreenEdit = null;
    pendingEditDrag = null;
    syncPendingEditOverlay();
  }

  function freezePendingScreenEdit(showStatus = false) {
    const hadEdit = !!pendingScreenEdit;
    if (!hadEdit) {
      return false;
    }

    clearPendingScreenEdit();
    if (showStatus) {
      setStatus(
        'Screen selection shape fixed after camera movement. Drag the 3D far plane, then Confirm or Cancel.',
      );
    }
    return true;
  }

  function freezePendingScreenEditIfCameraChanged() {
    if (!pendingScreenEdit || pendingEditDrag) {
      return false;
    }
    if (!cameraPoseChanged(pendingScreenEdit.cameraPose)) {
      return false;
    }
    return freezePendingScreenEdit(true);
  }

  function createPendingScreenEdit(selection, clientRect) {
    pendingScreenEdit = {
      cameraPose: createCameraPoseSnapshot(),
      clientPoints: clampClientPoints(getClientRectPoints(clientRect), domElement),
      selectionId: selection.id,
    };
    syncPendingEditOverlay();
  }

  function syncWorldState() {
    const transform = getCurrentRootTransformArray();
    getEntries().forEach(({ selection }) => {
      updateScreenSelectionWorldState(
        selection,
        transform,
        selection.id === activeSelectionId,
      );
    });
  }

  function syncEditSdfs() {
    syncWorldState();
    setScreenSelectionEditSelection(screenSelectionSplatEdit, null, false);
    const styled = [
      ...selections.map((selection) => ({
        style: selection.id === activeSelectionId ? 'preview' : 'exclude',
        selection,
      })),
      ...pendingSelections.map((selection) => ({
        style: 'preview',
        selection,
      })),
    ];

    styled.forEach(({ style, selection }) => {
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

  function syncFarHandles() {
    const entries = getEntries();
    if (
      activeSelectionId != null &&
      !entries.some(({ selection }) => selection.id === activeSelectionId)
    ) {
      activeSelectionId = null;
    }

    entries.forEach(({ selection }) => {
      if (!selection.farHandle) {
        scene.add(createScreenSelectionFarHandle(selection));
      }
    });
    syncWorldState();
  }

  function refreshUi() {
    updateCropControls({
      activeScreenSelectionId: activeSelectionId,
      elements: viewerElements,
      pendingScreenSelectionMode: pendingMode,
      screenSelections: selections,
      pendingScreenSelections: pendingSelections,
      onScreenSelectionRemove: handleSelectionRemove,
      onScreenSelectionSelect: handleSelectionSelect,
      tilesetHasGaussianSplats: hasGaussianSplats,
    });
  }

  function getDepthRange() {
    if (!getTilesetBoundingSphere(sphere)) {
      return {
        far: camera.near + 100,
        near: camera.near,
      };
    }

    camera.getWorldDirection(cameraForward);
    const centerDepth = sphere.center
      .clone()
      .sub(camera.position)
      .dot(cameraForward);
    const sphereFarthestDistance =
      camera.position.distanceTo(sphere.center) + sphere.radius;
    const near = Math.max(camera.near, centerDepth - sphere.radius);
    return {
      far: sphereFarthestDistance,
      near,
    };
  }

  const pointerTracker = createScreenSelectionPointerTracker({
    camera,
    domElement,
    getDepthRange,
    onOverlayClear: clearScreenEditOverlay,
    onOverlayUpdate: (clientRect) => {
      screenEditOverlay.render(getClientRectPoints(clientRect), {
        showGrid: true,
      });
      return true;
    },
    onSelectionCreated: handleSelectionCreated,
    overlayEl,
    rectEl,
  });

  function createEditHit(part) {
    return { cursor: 'grab', part };
  }

  function getPendingEditHit(event) {
    if (freezePendingScreenEditIfCameraChanged()) {
      return null;
    }

    const edit = getActivePendingEdit();
    if (!edit) {
      return null;
    }

    const pointer = { x: event.clientX, y: event.clientY };
    for (const part of SCREEN_EDIT_CORNER_PARTS) {
      const point = getPartPoint(edit.clientPoints, part);
      const dx = pointer.x - point.x;
      const dy = pointer.y - point.y;
      if (dx * dx + dy * dy <= SCREEN_EDIT_CORNER_HIT_SIZE ** 2) {
        return createEditHit(part);
      }
    }

    for (const part of SCREEN_EDIT_EDGE_PARTS) {
      const [startIndex, endIndex] = SCREEN_EDIT_PART_POINT_INDICES[part];
      if (
        pointSegmentDistanceSq(
          pointer,
          edit.clientPoints[startIndex],
          edit.clientPoints[endIndex],
        ) <=
        SCREEN_EDIT_EDGE_HIT_SIZE ** 2
      ) {
        return createEditHit(part);
      }
    }

    return null;
  }

  function getPendingEditDragPoints(event) {
    const { part, startClientX, startClientY, startPoints } = pendingEditDrag;
    const domRect = domElement.getBoundingClientRect();
    const indices = SCREEN_EDIT_PART_POINT_INDICES[part] || [];
    let dx = event.clientX - startClientX;
    let dy = event.clientY - startClientY;

    indices.forEach((index) => {
      const point = startPoints[index];
      dx = Math.max(dx, domRect.left - point.x);
      dx = Math.min(dx, domRect.right - point.x);
      dy = Math.max(dy, domRect.top - point.y);
      dy = Math.min(dy, domRect.bottom - point.y);
    });

    return startPoints.map((point, index) =>
      indices.includes(index)
        ? {
            x: point.x + dx,
            y: point.y + dy,
          }
        : copyClientPoint(point),
    );
  }

  function updatePendingEditSelection(clientPoints) {
    const edit = getActivePendingEdit();
    if (!edit) {
      return false;
    }

    const match = findSelection(edit.selectionId);
    if (!match) {
      return false;
    }

    if (!isConvexClientQuad(clientPoints)) {
      return false;
    }

    const selectionData = createSelectionData({
      camera,
      clientPoints,
      domElement,
      getDepthRange,
    });
    if (!selectionData) {
      return false;
    }

    edit.clientPoints = copyClientPoints(clientPoints);
    setScreenSelectionShape(
      match.selection,
      selectionData,
      getCurrentRootTransformArray(),
    );
    syncPendingEditOverlay();
    syncTransformControlsState();
    return true;
  }

  function handlePendingEditPointerDown(event) {
    if (event.button !== 0) {
      return false;
    }

    const hit = getPendingEditHit(event);
    if (!hit) {
      return false;
    }

    pendingEditDrag = {
      part: hit.part,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPoints: copyClientPoints(pendingScreenEdit.clientPoints),
      updated: false,
    };
    domElement.setPointerCapture?.(event.pointerId);
    screenEditOverlay.setActivePart(hit.part);
    setEditCursor('grabbing');
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePendingEditPointerMove(event) {
    if (pendingEditDrag) {
      if (event.pointerId !== pendingEditDrag.pointerId) {
        return false;
      }

      pendingEditDrag.updated =
        updatePendingEditSelection(getPendingEditDragPoints(event)) ||
        pendingEditDrag.updated;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (event.buttons) {
      return false;
    }

    const hit = getPendingEditHit(event);
    screenEditOverlay.setActivePart(hit?.part);
    setEditCursor(hit?.cursor || '');
    return false;
  }

  function handlePendingEditPointerUp(event) {
    if (!pendingEditDrag || event.pointerId !== pendingEditDrag.pointerId) {
      return false;
    }

    domElement.releasePointerCapture?.(event.pointerId);
    const updated = pendingEditDrag.updated;
    pendingEditDrag = null;
    const hit = getPendingEditHit(event);
    screenEditOverlay.setActivePart(hit?.part);
    setEditCursor(hit?.cursor || '');
    setStatus(
      updated
        ? 'Updated screen selection convex quadrilateral.'
        : 'Screen selection must stay convex.',
      !updated,
    );
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePendingEditPointerCancel(event) {
    if (!pendingEditDrag || event.pointerId !== pendingEditDrag.pointerId) {
      return false;
    }

    domElement.releasePointerCapture?.(event.pointerId);
    pendingEditDrag = null;
    screenEditOverlay.setActivePart(null);
    clearEditCursor();
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function setMode(active) {
    pendingMode =
      active && hasGaussianSplats && pendingSelections.length === 0;
    pointerTracker.setActive(pendingMode);
    if (pendingMode) {
      activeSelectionId = null;
      cancelOtherPositionPickModes();
      setTransformMode(null);
      syncEditSdfs();
      syncFarHandles();
    }
    cameraController.enabled = !transformControls.dragging;
    syncTransformControlsState();
    syncPendingEditOverlay();
    refreshUi();
  }

  function cancelMode() {
    if (!pendingMode) {
      return;
    }
    setMode(false);
  }

  function handleSelectionCreated(selectionData, clientRect) {
    if (pendingSelections.length > 0) {
      setMode(false);
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
      id: nextSelectionId++,
      transformMatrix: getCurrentRootTransformArray(),
      ...selectionData,
    });
    pendingSelections.push(selection);
    activeSelectionId = selection.id;
    setMode(false);
    createPendingScreenEdit(selection, clientRect);
    syncEditSdfs();
    syncFarHandles();
    syncTransformControlsState();
    refreshUi();
    setStatus(
      'Added screen exclude selection. Drag corner points or edges into a convex quadrilateral before moving the camera, then adjust the 3D far plane and Confirm or Cancel.',
    );
  }

  function toggle() {
    if (!hasGaussianSplats) {
      setStatus(
        'Screen selection is available for 3D Gaussian Splat tilesets only.',
        true,
      );
      return;
    }

    if (pendingMode) {
      setMode(false);
      setStatus('Screen selection paused.');
      return;
    }

    if (pendingSelections.length > 0) {
      setStatus(
        'Confirm or Cancel the current screen selection before drawing another.',
        true,
      );
      return;
    }

    setMode(true);
    setStatus('Drag one screen exclude rectangle.');
  }

  function confirm() {
    if (pendingSelections.length === 0) {
      return;
    }

    const count = pendingSelections.length;
    selections.push(...pendingSelections);
    clearPendingScreenEdit();
    pendingSelections = [];
    activeSelectionId = null;
    setMode(false);
    syncEditSdfs();
    syncFarHandles();
    syncTransformControlsState();
    refreshUi();
    setStatus(
      `Confirmed ${count} screen selection${count === 1 ? '' : 's'}. Click its row to adjust the 3D far plane, or Save to apply.`,
    );
  }

  function cancel() {
    const hadMode = pendingMode;
    const hadSelection = pendingSelections.length > 0;
    cancelMode();
    if (
      pendingSelections.some(
        (selection) => selection.id === activeSelectionId,
      )
    ) {
      activeSelectionId = null;
    }
    clearPendingScreenEdit();
    pendingSelections.forEach(disposeScreenSelection);
    pendingSelections = [];
    syncEditSdfs();
    syncFarHandles();
    refreshUi();
    syncTransformControlsState();
    if (hadMode || hadSelection) {
      setStatus('Screen selection cancelled.');
    }
  }

  function findSelection(selectionId) {
    const id = Number(selectionId);
    let selection = selections.find((entry) => entry.id === id);
    if (selection) {
      return { confirmed: true, selection };
    }

    selection = pendingSelections.find((entry) => entry.id === id);
    return selection ? { confirmed: false, selection } : null;
  }

  function updateFarDepth(selectionId, farDepth, commit) {
    const match = findSelection(selectionId);
    if (!match) {
      return;
    }

    setScreenSelectionFarDepth(
      match.selection,
      farDepth,
      getCurrentRootTransformArray(),
    );
    syncEditSdfs();
    syncFarHandles();

    if (commit) {
      refreshUi();
      setStatus('Updated screen selection far plane.');
    }
  }

  function handleTransformControlObjectChange(object) {
    if (!object?.userData?.screenSelectionFarHandle) {
      return false;
    }

    const match = findSelection(object.userData.screenSelectionId);
    if (!match) {
      return true;
    }

    updateFarDepth(
      match.selection.id,
      getScreenSelectionFarDepthFromPosition(
        match.selection,
        object.position,
        getCurrentRootTransformArray(),
      ),
      false,
    );
    refreshUi();
    return true;
  }

  function handleSelectionSelect(selectionId) {
    const match = findSelection(selectionId);
    if (!match) {
      return;
    }

    const wasActive = activeSelectionId === match.selection.id;
    activeSelectionId = wasActive ? null : match.selection.id;
    setTransformMode(null);
    syncEditSdfs();
    syncFarHandles();
    syncPendingEditOverlay();
    refreshUi();
    syncTransformControlsState();
    const canEditPendingRect = !wasActive && !!getActivePendingEdit();
    setStatus(
      wasActive
        ? 'Screen selection deactivated.'
        : canEditPendingRect
          ? 'Drag corner points or edges into a convex quadrilateral before moving the camera, or drag the 3D far plane to adjust depth.'
        : 'Drag the 3D far plane handle to adjust screen selection depth.',
    );
  }

  function removeFromList(list, selectionId) {
    const id = Number(selectionId);
    const index = list.findIndex((selection) => selection.id === id);
    if (index === -1) {
      return false;
    }

    const [selection] = list.splice(index, 1);
    disposeScreenSelection(selection);
    return true;
  }

  function handleSelectionRemove(selectionId) {
    const removed =
      removeFromList(selections, selectionId) ||
      removeFromList(pendingSelections, selectionId);
    if (!removed) {
      return;
    }

    if (Number(selectionId) === activeSelectionId) {
      activeSelectionId = null;
    }
    if (Number(selectionId) === pendingScreenEdit?.selectionId) {
      clearPendingScreenEdit();
    }
    syncEditSdfs();
    syncFarHandles();
    refreshUi();
    syncTransformControlsState();
    setStatus('Removed screen selection.');
  }

  function getPayload() {
    syncWorldState();
    return selections.map(getScreenSelectionPayload);
  }

  function clearAll() {
    cancelMode();
    selections.forEach(disposeScreenSelection);
    pendingSelections.forEach(disposeScreenSelection);
    selections = [];
    pendingSelections = [];
    activeSelectionId = null;
    clearPendingScreenEdit();
    syncEditSdfs();
    syncFarHandles();
    refreshUi();
    syncTransformControlsState();
  }

  function setHasGaussianSplats(value) {
    hasGaussianSplats = !!value;
    refreshUi();
  }

  function deactivate() {
    activeSelectionId = null;
    syncEditSdfs();
    syncFarHandles();
    syncPendingEditOverlay();
    cancelMode();
    refreshUi();
  }

  function notifyTransformModeChanged() {
    if (activeSelectionId == null) {
      return;
    }
    activeSelectionId = null;
    syncEditSdfs();
    syncFarHandles();
    syncPendingEditOverlay();
    refreshUi();
  }

  function shouldCapturePointerDown(event) {
    return (
      event.button === 0 &&
      (pendingMode || getPendingEditHit(event) !== null)
    );
  }

  function handlePointerDown(event) {
    if (pointerTracker.handlePointerDown(event)) {
      return true;
    }
    return handlePendingEditPointerDown(event);
  }

  function handlePointerMove(event) {
    if (pointerTracker.handlePointerMove(event)) {
      return true;
    }
    return handlePendingEditPointerMove(event);
  }

  function handlePointerUp(event) {
    if (pointerTracker.handlePointerUp(event)) {
      return true;
    }
    return handlePendingEditPointerUp(event);
  }

  function handlePointerCancel(event) {
    if (pointerTracker.handlePointerCancel(event)) {
      return true;
    }
    return handlePendingEditPointerCancel(event);
  }

  cameraController.addEventListener(
    'update',
    freezePendingScreenEditIfCameraChanged,
  );
  cameraController.addEventListener(
    'finish',
    freezePendingScreenEditIfCameraChanged,
  );

  return {
    cancel,
    cancelMode,
    clearAll,
    confirm,
    deactivate,
    getActiveSelection,
    getPayload,
    getPendingMode: () => pendingMode,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleSelectionRemove,
    handleSelectionSelect,
    handleTransformControlObjectChange,
    hasPendingSelections: () => pendingSelections.length > 0,
    notifyTransformModeChanged,
    setHasGaussianSplats,
    shouldCapturePointerDown,
    syncWorldState,
    toggle,
  };
}
