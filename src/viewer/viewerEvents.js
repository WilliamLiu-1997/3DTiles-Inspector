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
  } = elements;

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
  toolbarToggleButton.addEventListener('click', handlers.toggleToolbarVisibility);
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
  renderer.domElement.addEventListener(
    'pointerdown',
    (event) => {
      if (handlers.handleScreenSelectionPointerDown(event)) {
        return;
      }
      handlers.handleSetPositionPointerDown(event);
    },
  );
  renderer.domElement.addEventListener(
    'pointermove',
    (event) => {
      if (handlers.handleScreenSelectionPointerMove(event)) {
        return;
      }
      handlers.handleSetPositionPointerMove(event);
    },
  );
  renderer.domElement.addEventListener(
    'pointerup',
    (event) => {
      if (handlers.handleScreenSelectionPointerUp(event)) {
        return;
      }
      handlers.handleSetPositionPointerUp(event);
    },
  );
  renderer.domElement.addEventListener(
    'pointercancel',
    (event) => {
      if (handlers.handleScreenSelectionPointerCancel(event)) {
        return;
      }
      handlers.handleSetPositionPointerCancel(event);
    },
  );

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
