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
  setScreenSelectionEditSelection,
  setScreenSelectionFarDepth,
  updateScreenSelectionWorldState,
} from './screenSelection/index.js';
import { updateCropControls } from './dom/cropUi.js';

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
  let hasGaussianSplats = false;
  const sphere = new Sphere();
  const cameraForward = new Vector3();

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
    onSelectionCreated: handleSelectionCreated,
    overlayEl,
    rectEl,
  });

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
    refreshUi();
  }

  function cancelMode() {
    if (!pendingMode) {
      return;
    }
    setMode(false);
  }

  function handleSelectionCreated(selectionData) {
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
    syncEditSdfs();
    syncFarHandles();
    syncTransformControlsState();
    refreshUi();
    setStatus(
      'Added screen exclude selection. Drag the 3D far plane, then Confirm or Cancel before drawing another.',
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
    refreshUi();
    syncTransformControlsState();
    setStatus(
      wasActive
        ? 'Screen selection deactivated.'
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
    refreshUi();
  }

  return {
    cancel,
    cancelMode,
    clearAll,
    confirm,
    deactivate,
    getActiveSelection,
    getPayload,
    getPendingMode: () => pendingMode,
    handlePointerCancel: pointerTracker.handlePointerCancel,
    handlePointerDown: pointerTracker.handlePointerDown,
    handlePointerMove: pointerTracker.handlePointerMove,
    handlePointerUp: pointerTracker.handlePointerUp,
    handleSelectionRemove,
    handleSelectionSelect,
    handleTransformControlObjectChange,
    hasPendingSelections: () => pendingSelections.length > 0,
    notifyTransformModeChanged,
    setHasGaussianSplats,
    syncWorldState,
    toggle,
  };
}
