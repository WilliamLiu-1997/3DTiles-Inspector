export function getViewerElements() {
  const toolbarEl = document.getElementById('toolbar');

  return {
    boundingVolumeButton: document.getElementById('bounding-volume'),
    cacheBytesValueEl: document.getElementById('cache-bytes-value'),
    cropAddButton: document.getElementById('crop-add'),
    cropCountValueEl: document.getElementById('crop-count-value'),
    cropDeleteButton: document.getElementById('crop-delete'),
    cropListEl: document.getElementById('crop-list'),
    cropMoveButton: document.getElementById('crop-move'),
    cropRotateButton: document.getElementById('crop-rotate'),
    cropScaleButton: document.getElementById('crop-scale'),
    cropSectionEl: document.getElementById('crop-section'),
    cropSetPositionButton: document.getElementById('crop-set-position'),
    cropUndoButton: document.getElementById('crop-undo'),
    geometricErrorLayerScaleInput: document.getElementById(
      'geometric-error-layer-scale',
    ),
    geometricErrorLayerValueEl: document.getElementById(
      'geometric-error-layer-value',
    ),
    geometricErrorScaleInput: document.getElementById('geometric-error-scale'),
    geometricErrorValueEl: document.getElementById('geometric-error-value'),
    heightInput: document.getElementById('height'),
    latitudeInput: document.getElementById('latitude'),
    longitudeInput: document.getElementById('longitude'),
    moveCameraToCoordinateButton: document.getElementById(
      'move-camera-to-coordinate',
    ),
    moveTilesToCoordinateButton: document.getElementById(
      'move-tiles-to-coordinate',
    ),
    moveToTilesButton: document.getElementById('move-to-tiles'),
    resetButton: document.getElementById('reset'),
    rotateButton: document.getElementById('rotate'),
    saveButton: document.getElementById('save'),
    setPositionButton: document.getElementById('set-position'),
    splatsCountStatEl: document.getElementById('splats-count-stat'),
    splatsCountValueEl: document.getElementById('splats-count-value'),
    statusEl: document.getElementById('status'),
    terrainButton: document.getElementById('terrain'),
    tilesDownloadingValueEl: document.getElementById('tiles-downloading-value'),
    tilesLoadedValueEl: document.getElementById('tiles-loaded-value'),
    tilesParsingValueEl: document.getElementById('tiles-parsing-value'),
    tilesVisibleValueEl: document.getElementById('tiles-visible-value'),
    toolbarDockEl: toolbarEl.parentElement,
    toolbarEl,
    toolbarToggleButton: document.getElementById('toolbar-toggle'),
    translateButton: document.getElementById('translate'),
  };
}
