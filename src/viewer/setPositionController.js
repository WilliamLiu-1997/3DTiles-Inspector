import { createSetPositionPointerTracker } from './io/setPositionPointerTracker.js';

export function createSetPositionController({
  cameraController,
  maxClickDistanceSq,
  setPositionButton,
  setStatus,
  setTransformMode,
  syncTransformControlsState,
  transformControls,
  applyTilesPlacementFromPointerEvent,
  cancelOtherPositionPickModes,
}) {
  let pendingSetPosition = false;

  const tracker = createSetPositionPointerTracker({
    getActiveTarget: () => (pendingSetPosition ? 'tiles' : null),
    maxClickDistanceSq,
    onApply: async (target, event) => {
      if (target === 'tiles') {
        await applyTilesPlacementFromPointerEvent(event);
      }
    },
  });

  function syncUi() {
    setPositionButton.classList.toggle('active', pendingSetPosition);
    cameraController.enabled = !transformControls.dragging;
    syncTransformControlsState();
  }

  function setMode(active) {
    pendingSetPosition = active;
    tracker.clear();
    if (active) {
      cancelOtherPositionPickModes();
      setTransformMode(null);
    }
    syncUi();
  }

  function cancelMode() {
    if (!pendingSetPosition) {
      return;
    }
    setMode(false);
  }

  function toggle() {
    if (pendingSetPosition) {
      setMode(false);
      setStatus('Set Position cancelled.');
      return;
    }

    setMode(true);
    setStatus(
      'Click the globe, terrain, or tiles without dragging to place the tileset root.',
    );
  }

  return {
    cancelMode,
    handlePointerCancel: tracker.handlePointerCancel,
    handlePointerDown: tracker.handlePointerDown,
    handlePointerMove: tracker.handlePointerMove,
    handlePointerUp: tracker.handlePointerUp,
    isPending: () => pendingSetPosition,
    setMode,
    toggle,
  };
}
