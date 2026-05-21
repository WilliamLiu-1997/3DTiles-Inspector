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
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    uniformScaleTrackPointerId = event.pointerId;
    uniformScaleTrackEl.focus();
    uniformScaleTrackEl.classList.add('dragging');
    uniformScaleTrackEl.setPointerCapture(event.pointerId);
    uniformScale.beginTrackDrag(event.clientX);
  });
  uniformScaleTrackEl.addEventListener('pointermove', (event) => {
    if (event.pointerId !== uniformScaleTrackPointerId) {
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
  toolbarToggleButton.addEventListener(
    'click',
    handlers.toggleToolbarVisibility,
  );
  terrainButton.addEventListener('click', () => {
    handlers.setTerrainEnabled(!getTerrainEnabled());
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
