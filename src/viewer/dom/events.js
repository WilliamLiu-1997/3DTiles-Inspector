export function bindViewerEvents({
  camera,
  cameraController,
  dracoLoader,
  elements,
  geometricError,
  getActiveTransformMode,
  getGlobeTiles,
  getTerrainEnabled,
  getTiles,
  handlers,
  ktx2Loader,
  renderer,
  setStatus,
  uniformScale,
}) {
  const {
    boundingVolumeButton,
    cropScreenCancelButton,
    cropScreenConfirmButton,
    cropScreenSelectButton,
    keepSphereCancelButton,
    keepSphereConfirmButton,
    keepSphereCreateButton,
    keepSphereRadiusTrackEl,
    keepSphereSizeValueInput,
    geometricErrorLayerScaleInput,
    geometricErrorScaleInput,
    moveCameraToCoordinateButton,
    moveTilesToCoordinateButton,
    moveToTilesButton,
    resetButton,
    rotateButton,
    saveButton,
    setPositionButton,
    terrainButton,
    toolbarToggleButton,
    translateButton,
    uniformScaleTrackEl,
    uniformScaleValueInput,
  } = elements;

  let uniformScaleTrackPointerId = null;
  let keepSphereRadiusTrackPointerId = null;

  function setUniformScaleStatus() {
    setStatus(
      `Scale set to x${uniformScale.formatScale(uniformScale.getScale())}.`,
    );
  }

  function updateUniformScaleFromTrackPointer(event) {
    handlers.cancelPositionPickModes();
    uniformScale.setScaleFromTrackClientX(event.clientX);
  }

  translateButton.addEventListener('click', () => {
    handlers.cancelPositionPickModes();
    handlers.toggleTransformMode('translate');
    setStatus(
      getActiveTransformMode() === 'translate'
        ? 'Translate mode enabled.'
        : 'Translate mode disabled.',
    );
  });
  rotateButton.addEventListener('click', () => {
    handlers.cancelPositionPickModes();
    handlers.toggleTransformMode('rotate');
    setStatus(
      getActiveTransformMode() === 'rotate'
        ? 'Rotate mode enabled.'
        : 'Rotate mode disabled.',
    );
  });
  uniformScaleTrackEl.addEventListener('pointerdown', (event) => {
    if (
      event.button !== 0 ||
      uniformScaleTrackEl.classList.contains('disabled')
    ) {
      return;
    }

    event.preventDefault();
    if (!uniformScale.beginTrackDrag(event.clientX)) {
      return;
    }
    uniformScaleTrackPointerId = event.pointerId;
    uniformScaleTrackEl.focus();
    uniformScaleTrackEl.classList.add('dragging');
    uniformScaleTrackEl.setPointerCapture(event.pointerId);
  });
  uniformScaleTrackEl.addEventListener('pointermove', (event) => {
    if (event.pointerId !== uniformScaleTrackPointerId) {
      return;
    }

    if (uniformScaleTrackEl.classList.contains('disabled')) {
      uniformScaleTrackPointerId = null;
      uniformScaleTrackEl.classList.remove('dragging');
      uniformScaleTrackEl.releasePointerCapture(event.pointerId);
      return;
    }

    updateUniformScaleFromTrackPointer(event);
  });
  uniformScaleTrackEl.addEventListener('pointerup', (event) => {
    if (event.pointerId !== uniformScaleTrackPointerId) {
      return;
    }

    uniformScaleTrackPointerId = null;
    uniformScaleTrackEl.classList.remove('dragging');
    uniformScaleTrackEl.releasePointerCapture(event.pointerId);
    if (uniformScaleTrackEl.classList.contains('disabled')) {
      return;
    }
    setUniformScaleStatus();
  });
  uniformScaleTrackEl.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== uniformScaleTrackPointerId) {
      return;
    }

    uniformScaleTrackPointerId = null;
    uniformScaleTrackEl.classList.remove('dragging');
    uniformScaleTrackEl.releasePointerCapture(event.pointerId);
  });
  uniformScaleTrackEl.addEventListener('keydown', (event) => {
    if (uniformScaleTrackEl.classList.contains('disabled')) {
      return;
    }

    let handled = true;
    const step = event.shiftKey ? 1 : 0.1;

    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      uniformScale.nudgeScaleExponent(-step);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      uniformScale.nudgeScaleExponent(step);
    } else {
      handled = false;
    }

    if (!handled) {
      return;
    }

    event.preventDefault();
    handlers.cancelPositionPickModes();
    setUniformScaleStatus();
  });
  uniformScaleValueInput.addEventListener('input', () => {
    handlers.cancelPositionPickModes();
    uniformScale.setScaleValue(uniformScaleValueInput.value);
  });
  uniformScaleValueInput.addEventListener('change', () => {
    if (
      !uniformScale.setScaleValue(uniformScaleValueInput.value, {
        commit: true,
      })
    ) {
      setStatus('Scale must be greater than 0.', true);
      return;
    }
    setUniformScaleStatus();
  });
  cropScreenSelectButton.addEventListener(
    'click',
    handlers.toggleCropScreenSelectionMode,
  );
  cropScreenConfirmButton.addEventListener(
    'click',
    handlers.confirmCropScreenSelection,
  );
  cropScreenCancelButton.addEventListener(
    'click',
    handlers.cancelCropScreenSelection,
  );
  keepSphereCreateButton.addEventListener('click', handlers.createKeepSphere);
  keepSphereConfirmButton.addEventListener('click', handlers.confirmKeepSphere);
  keepSphereCancelButton.addEventListener('click', handlers.cancelKeepSphere);
  keepSphereRadiusTrackEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || keepSphereRadiusTrackEl.classList.contains('disabled')) {
      return;
    }

    event.preventDefault();
    if (!handlers.beginKeepSphereRadiusTrackDrag(event.clientX)) {
      return;
    }
    keepSphereRadiusTrackPointerId = event.pointerId;
    keepSphereRadiusTrackEl.focus();
    keepSphereRadiusTrackEl.classList.add('dragging');
    keepSphereRadiusTrackEl.setPointerCapture(event.pointerId);
  });
  keepSphereRadiusTrackEl.addEventListener('pointermove', (event) => {
    if (event.pointerId !== keepSphereRadiusTrackPointerId) {
      return;
    }

    handlers.setKeepSphereRadiusFromTrackClientX(event.clientX);
  });
  keepSphereRadiusTrackEl.addEventListener('pointerup', (event) => {
    if (event.pointerId !== keepSphereRadiusTrackPointerId) {
      return;
    }

    keepSphereRadiusTrackPointerId = null;
    keepSphereRadiusTrackEl.classList.remove('dragging');
    keepSphereRadiusTrackEl.releasePointerCapture(event.pointerId);
    handlers.endKeepSphereRadiusTrackDrag({ commit: true });
  });
  keepSphereRadiusTrackEl.addEventListener('pointercancel', (event) => {
    if (event.pointerId !== keepSphereRadiusTrackPointerId) {
      return;
    }

    keepSphereRadiusTrackPointerId = null;
    keepSphereRadiusTrackEl.classList.remove('dragging');
    keepSphereRadiusTrackEl.releasePointerCapture(event.pointerId);
    handlers.endKeepSphereRadiusTrackDrag();
  });
  keepSphereRadiusTrackEl.addEventListener('keydown', (event) => {
    if (keepSphereRadiusTrackEl.classList.contains('disabled')) {
      return;
    }

    let handled = true;
    const step = event.shiftKey ? 1 : 0.1;

    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      handlers.nudgeKeepSphereRadiusExponent(-step);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      handlers.nudgeKeepSphereRadiusExponent(step);
    } else {
      handled = false;
    }

    if (handled) {
      event.preventDefault();
    }
  });
  keepSphereSizeValueInput.addEventListener('input', () => {
    handlers.setKeepSphereSizeValue(keepSphereSizeValueInput.value);
  });
  keepSphereSizeValueInput.addEventListener('change', () => {
    if (
      !handlers.setKeepSphereSizeValue(keepSphereSizeValueInput.value, {
        commit: true,
      })
    ) {
      setStatus('Crop sphere size must be greater than 0.', true);
    }
  });
  toolbarToggleButton.addEventListener(
    'click',
    handlers.toggleToolbarVisibility,
  );
  terrainButton.addEventListener('click', () => {
    if (!handlers.setTerrainEnabled(!getTerrainEnabled())) {
      return;
    }
    setStatus(
      getTerrainEnabled()
        ? 'Terrain enabled with Cesium World Terrain.'
        : 'Terrain disabled. Using ellipsoid imagery globe.',
    );
  });
  boundingVolumeButton.addEventListener('click', handlers.toggleBoundingVolume);
  geometricErrorScaleInput.addEventListener('input', () => {
    geometricError.setScaleExponent(geometricErrorScaleInput.value);
  });
  geometricErrorScaleInput.addEventListener('change', () => {
    setStatus(
      `Geometric-error scale set to x${geometricError.formatScale(
        geometricError.getScale(),
      )}.`,
    );
  });
  geometricErrorLayerScaleInput.addEventListener('input', () => {
    geometricError.setLayerScaleExponent(geometricErrorLayerScaleInput.value);
  });
  geometricErrorLayerScaleInput.addEventListener('change', () => {
    setStatus(
      `Geometric-error layer multiplier set to x${geometricError.formatScale(
        geometricError.getLayerScale(),
      )}.`,
    );
  });
  moveToTilesButton.addEventListener('click', handlers.moveCameraToTiles);
  moveCameraToCoordinateButton.addEventListener(
    'click',
    handlers.moveCameraToCoordinate,
  );
  moveTilesToCoordinateButton.addEventListener(
    'click',
    handlers.moveTilesToCoordinate,
  );
  setPositionButton.addEventListener('click', handlers.toggleSetPositionMode);
  resetButton.addEventListener('click', handlers.resetToSaved);
  saveButton.addEventListener('click', handlers.saveTransform);
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (handlers.handleScreenSelectionPointerDown(event)) {
      return;
    }
    handlers.handleSetPositionPointerDown(event);
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (handlers.handleScreenSelectionPointerMove(event)) {
      return;
    }
    handlers.handleSetPositionPointerMove(event);
  });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (handlers.handleScreenSelectionPointerUp(event)) {
      return;
    }
    handlers.handleSetPositionPointerUp(event);
  });
  renderer.domElement.addEventListener('pointercancel', (event) => {
    if (handlers.handleScreenSelectionPointerCancel(event)) {
      return;
    }
    handlers.handleSetPositionPointerCancel(event);
  });

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    getTiles()?.setResolutionFromRenderer(camera, renderer);
    getGlobeTiles()?.setResolutionFromRenderer(camera, renderer);
  });

  window.addEventListener('pagehide', handlers.requestViewerShutdown);
  window.addEventListener('beforeunload', () => {
    handlers.requestViewerShutdown();
    cameraController.dispose();
    dracoLoader.dispose();
    ktx2Loader.dispose();
  });
}
