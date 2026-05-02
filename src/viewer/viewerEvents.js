export function bindViewerEvents({
  camera,
  cameraController,
  dracoLoader,
  elements,
  geometricError,
  getActiveCropTransformMode,
  getActiveTransformMode,
  getActiveTransformTarget,
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
    cropAddButton,
    cropDeleteButton,
    cropMoveButton,
    cropRotateButton,
    cropScaleButton,
    cropSetPositionButton,
    cropUndoButton,
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
  cropAddButton.addEventListener('click', handlers.addCropBox);
  cropMoveButton.addEventListener('click', () => {
    handlers.cancelPositionPickModes();
    handlers.toggleCropTransformMode('translate');
    setStatus(
      getActiveTransformTarget() === 'crop' &&
        getActiveCropTransformMode() === 'translate'
        ? 'Crop box move mode enabled.'
        : 'Crop box move mode disabled.',
    );
  });
  cropRotateButton.addEventListener('click', () => {
    handlers.cancelPositionPickModes();
    handlers.toggleCropTransformMode('rotate');
    setStatus(
      getActiveTransformTarget() === 'crop' &&
        getActiveCropTransformMode() === 'rotate'
        ? 'Crop box rotate mode enabled.'
        : 'Crop box rotate mode disabled.',
    );
  });
  cropScaleButton.addEventListener('click', () => {
    handlers.cancelPositionPickModes();
    handlers.toggleCropTransformMode('scale');
    setStatus(
      getActiveTransformTarget() === 'crop' &&
        getActiveCropTransformMode() === 'scale'
        ? 'Crop box scale mode enabled.'
        : 'Crop box scale mode disabled.',
    );
  });
  cropSetPositionButton.addEventListener(
    'click',
    handlers.toggleCropSetPositionMode,
  );
  cropDeleteButton.addEventListener('click', handlers.deleteSelectedCropBox);
  cropUndoButton.addEventListener('click', handlers.undoCropBoxEdit);
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
    handlers.handleSetPositionPointerDown,
  );
  renderer.domElement.addEventListener(
    'pointermove',
    handlers.handleSetPositionPointerMove,
  );
  renderer.domElement.addEventListener(
    'pointerup',
    handlers.handleSetPositionPointerUp,
  );
  renderer.domElement.addEventListener(
    'pointercancel',
    handlers.handleSetPositionPointerCancel,
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
