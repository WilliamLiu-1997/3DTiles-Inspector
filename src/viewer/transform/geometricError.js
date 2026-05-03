import {
  clamp,
  exponentToGeometricErrorScale,
  formatGeometricErrorScale,
} from '../utils.js';
import {
  GEOMETRIC_ERROR_LAYER_SCALE_MAX_EXPONENT,
  GEOMETRIC_ERROR_LAYER_SCALE_MIN_EXPONENT,
  GEOMETRIC_ERROR_LAYER_SCALE_STEP,
  GEOMETRIC_ERROR_SCALE_MAX_EXPONENT,
  GEOMETRIC_ERROR_SCALE_MIN_EXPONENT,
  GEOMETRIC_ERROR_SCALE_STEP,
} from '../config.js';

export function createGeometricErrorController({
  defaultErrorTarget,
  geometricErrorLayerScaleInput,
  geometricErrorLayerValueEl,
  geometricErrorScaleInput,
  geometricErrorValueEl,
  getTiles,
}) {
  const originalTileGeometricErrors = new WeakMap();
  let geometricErrorScaleExponent = 0;
  let geometricErrorScale = 1;
  let lastSavedGeometricErrorScale = 1;
  let geometricErrorLayerScaleExponent = 0;
  let geometricErrorLayerScale = 1;
  let lastSavedGeometricErrorLayerScale = 1;

  function getEffectiveGeometricErrorScale() {
    return lastSavedGeometricErrorScale * geometricErrorScale;
  }

  function getEffectiveGeometricErrorLayerScale() {
    return lastSavedGeometricErrorLayerScale * geometricErrorLayerScale;
  }

  function updateTilesetErrorTarget() {
    const tiles = getTiles();
    if (!tiles) {
      return;
    }

    tiles.errorTarget = defaultErrorTarget / getEffectiveGeometricErrorScale();
  }

  function updateScaleDisplay() {
    geometricErrorValueEl.textContent = `x${formatGeometricErrorScale(
      geometricErrorScale,
    )}`;
  }

  function updateLayerScaleDisplay() {
    geometricErrorLayerValueEl.textContent = `x${formatGeometricErrorScale(
      geometricErrorLayerScale,
    )}`;
  }

  function getOriginalTileGeometricError(tile) {
    if (!tile || typeof tile !== 'object') {
      return null;
    }

    if (!originalTileGeometricErrors.has(tile)) {
      const number = Number(tile.geometricError);
      if (!Number.isFinite(number)) {
        return null;
      }
      originalTileGeometricErrors.set(tile, number);
    }

    return originalTileGeometricErrors.get(tile);
  }

  function getKnownTileLeafGeometricError(tile, visited = new Set()) {
    const originalGeometricError = getOriginalTileGeometricError(tile);
    if (
      originalGeometricError === null ||
      !tile ||
      typeof tile !== 'object' ||
      visited.has(tile)
    ) {
      return originalGeometricError;
    }

    visited.add(tile);
    let leafGeometricError = null;
    const children = Array.isArray(tile.children) ? tile.children : [];
    for (const child of children) {
      const childLeafGeometricError = getKnownTileLeafGeometricError(
        child,
        visited,
      );
      if (childLeafGeometricError !== null) {
        leafGeometricError =
          leafGeometricError === null
            ? childLeafGeometricError
            : Math.min(leafGeometricError, childLeafGeometricError);
      }
    }
    visited.delete(tile);
    return leafGeometricError === null
      ? originalGeometricError
      : leafGeometricError;
  }

  function getGlobalTileLeafGeometricError(tile) {
    const tiles = getTiles();
    const rootLeafGeometricError = tiles?.root
      ? getKnownTileLeafGeometricError(tiles.root)
      : null;
    const tileLeafGeometricError = getKnownTileLeafGeometricError(tile);

    if (rootLeafGeometricError === null) {
      return tileLeafGeometricError;
    }

    if (tileLeafGeometricError === null) {
      return rootLeafGeometricError;
    }

    return Math.min(rootLeafGeometricError, tileLeafGeometricError);
  }

  function applyLayerScaleToTile(
    tile,
    leafGeometricError = getGlobalTileLeafGeometricError(tile),
  ) {
    const originalGeometricError = getOriginalTileGeometricError(tile);
    if (originalGeometricError === null || leafGeometricError === null) {
      return;
    }

    tile.geometricError =
      leafGeometricError +
      (originalGeometricError - leafGeometricError) *
        getEffectiveGeometricErrorLayerScale();
  }

  function applyLayerScaleToTileset() {
    const tiles = getTiles();
    if (!tiles) {
      return;
    }

    const leafGeometricError = getGlobalTileLeafGeometricError(tiles.root);
    tiles.traverse(
      (tile) => {
        applyLayerScaleToTile(tile, leafGeometricError);
        return false;
      },
      null,
      false,
    );
  }

  function setScaleExponent(exponent) {
    geometricErrorScaleExponent = clamp(
      Number(exponent),
      GEOMETRIC_ERROR_SCALE_MIN_EXPONENT,
      GEOMETRIC_ERROR_SCALE_MAX_EXPONENT,
    );
    geometricErrorScale = exponentToGeometricErrorScale(
      geometricErrorScaleExponent,
    );
    geometricErrorScaleInput.value = geometricErrorScaleExponent.toFixed(1);
    updateScaleDisplay();
    updateTilesetErrorTarget();
  }

  function setLayerScaleExponent(exponent) {
    geometricErrorLayerScaleExponent = clamp(
      Number(exponent),
      GEOMETRIC_ERROR_LAYER_SCALE_MIN_EXPONENT,
      GEOMETRIC_ERROR_LAYER_SCALE_MAX_EXPONENT,
    );
    geometricErrorLayerScale = exponentToGeometricErrorScale(
      geometricErrorLayerScaleExponent,
    );
    geometricErrorLayerScaleInput.value =
      geometricErrorLayerScaleExponent.toFixed(1);
    updateLayerScaleDisplay();
    applyLayerScaleToTileset();
  }

  function initializeInputs() {
    geometricErrorScaleInput.min = String(GEOMETRIC_ERROR_SCALE_MIN_EXPONENT);
    geometricErrorScaleInput.max = String(GEOMETRIC_ERROR_SCALE_MAX_EXPONENT);
    geometricErrorScaleInput.step = String(GEOMETRIC_ERROR_SCALE_STEP);
    geometricErrorLayerScaleInput.min = String(
      GEOMETRIC_ERROR_LAYER_SCALE_MIN_EXPONENT,
    );
    geometricErrorLayerScaleInput.max = String(
      GEOMETRIC_ERROR_LAYER_SCALE_MAX_EXPONENT,
    );
    geometricErrorLayerScaleInput.step = String(
      GEOMETRIC_ERROR_LAYER_SCALE_STEP,
    );
    setScaleExponent(geometricErrorScaleExponent);
    setLayerScaleExponent(geometricErrorLayerScaleExponent);
  }

  function resetSavedScales() {
    lastSavedGeometricErrorScale = 1;
    lastSavedGeometricErrorLayerScale = 1;
    setScaleExponent(0);
    setLayerScaleExponent(0);
  }

  function getSaveState() {
    return {
      incrementalGeometricErrorLayerScale: geometricErrorLayerScale,
      incrementalGeometricErrorScale: geometricErrorScale,
      savedGeometricErrorLayerScale: getEffectiveGeometricErrorLayerScale(),
      savedGeometricErrorScale: getEffectiveGeometricErrorScale(),
    };
  }

  function markSaved(saveState) {
    lastSavedGeometricErrorScale = saveState.savedGeometricErrorScale;
    lastSavedGeometricErrorLayerScale =
      saveState.savedGeometricErrorLayerScale;
  }

  function resetPendingScales() {
    setScaleExponent(0);
    setLayerScaleExponent(0);
  }

  return {
    applyLayerScaleToTile,
    applyLayerScaleToTileset,
    formatScale: formatGeometricErrorScale,
    getLayerScale: () => geometricErrorLayerScale,
    getSaveState,
    getScale: () => geometricErrorScale,
    initializeInputs,
    markSaved,
    resetPendingScales,
    resetSavedScales,
    setLayerScaleExponent,
    setScaleExponent,
    updateTilesetErrorTarget,
  };
}
