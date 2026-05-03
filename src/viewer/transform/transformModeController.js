export function createTransformModeController({
  cropController,
  rotateButton,
  setPositionController,
  transformControls,
  transformControlsHelper,
  transformHandle,
  translateButton,
}) {
  let activeMode = null;

  function updateButtons() {
    translateButton.classList.toggle('active', activeMode === 'translate');
    rotateButton.classList.toggle('active', activeMode === 'rotate');
  }

  function setAxes(showX, showY, showZ) {
    transformControls.showX = showX;
    transformControls.showY = showY;
    transformControls.showZ = showZ;
  }

  function syncControls() {
    const pendingPositionPick =
      setPositionController.isPending() || cropController.getPendingMode();
    const activeCropScreenSelection = cropController.getActiveSelection();
    const farControlsVisible =
      !!activeCropScreenSelection?.farHandle && !pendingPositionPick;
    const rootControlsVisible =
      activeMode !== null && !farControlsVisible && !pendingPositionPick;

    if (farControlsVisible) {
      if (transformControls.object !== activeCropScreenSelection.farHandle) {
        transformControls.attach(activeCropScreenSelection.farHandle);
      }
      transformControls.setMode('translate');
      transformControls.setSpace('local');
      setAxes(false, false, true);
    } else if (rootControlsVisible) {
      if (transformControls.object !== transformHandle) {
        transformControls.attach(transformHandle);
      }
      transformControls.setMode(activeMode);
      transformControls.setSpace('local');
      setAxes(true, true, true);
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

  function setMode(mode) {
    activeMode = mode;
    if (mode !== null) {
      cropController.notifyTransformModeChanged();
      transformControls.setMode(mode);
    }
    updateButtons();
    syncControls();
  }

  function toggle(mode) {
    setMode(activeMode === mode ? null : mode);
  }

  return {
    getMode: () => activeMode,
    setMode,
    syncControls,
    toggle,
  };
}
