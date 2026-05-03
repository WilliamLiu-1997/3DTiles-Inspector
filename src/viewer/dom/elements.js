export function getViewerElements() {
  const toolbarEl = document.getElementById('toolbar');

  return {
    boundingVolumeButton: document.getElementById('bounding-volume'),
    cacheBytesValueEl: document.getElementById('cache-bytes-value'),
    cropCountValueEl: document.getElementById('crop-count-value'),
    cropListEl: document.getElementById('crop-list'),
    cropSectionEl: document.getElementById('crop-section'),
    cropScreenCancelButton: document.getElementById('crop-screen-cancel'),
    cropScreenConfirmButton: document.getElementById('crop-screen-confirm'),
    cropScreenSelectButton: document.getElementById('crop-screen-select'),
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
    saveProgressEl: document.getElementById('save-progress'),
    screenSelectionOverlayEl: document.getElementById(
      'screen-selection-overlay',
    ),
    screenSelectionRectEl: document.getElementById('screen-selection-rect'),
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
