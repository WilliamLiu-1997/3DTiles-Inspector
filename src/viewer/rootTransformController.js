import { Matrix4, Vector3 } from 'three';
import {
  applyEditableMatrixFromRootTransform,
  applySavedObjectMatrix,
  getIncrementalMatrix,
  getObjectMatrix,
  getRootTransform,
  refreshLoadedTileSceneMatrices,
  refreshSavedRootMatrix,
  resetEditableObjectTransform,
  setSavedRootMatrixFromTransform,
  updateTilesRendererGroupMatrices,
} from './transform/tilesetTransform.js';

export function createRootTransformController({
  editableGroup,
  geoCamera,
  getTiles,
  rootTilesetLabel,
  transformControlsHelper,
  transformHandle,
  onTransformsInvalidated,
  onCoordinateChanged,
}) {
  const coordinateWorldPosition = new Vector3();
  const coordinateTransformMatrix = new Matrix4();
  const coordinateEditMatrix = new Matrix4();
  const currentRootTransformMatrix = new Matrix4();
  const savedRootInverseMatrix = new Matrix4();
  const savedRootMatrix = new Matrix4();
  const lastSavedMatrix = new Matrix4();
  let savedRootMatrixPromise = Promise.resolve();
  let savedRootMatrixLoadError = null;
  let syncingTransformHandle = false;
  let tilesTransformDirty = false;

  function getCurrentRootTransform(target) {
    return getRootTransform({
      editableGroup,
      lastSavedMatrix,
      savedRootInverseMatrix,
      savedRootMatrix,
      target,
    });
  }

  function getCurrentRootTransformArray() {
    return getCurrentRootTransform(currentRootTransformMatrix).toArray();
  }

  function getCurrentMatrix() {
    return getObjectMatrix(editableGroup);
  }

  function invalidate() {
    tilesTransformDirty = true;
    editableGroup.updateMatrixWorld(true);
    const tiles = getTiles();
    updateTilesRendererGroupMatrices(tiles);
    refreshLoadedTileSceneMatrices(tiles);
    onTransformsInvalidated?.();
    transformControlsHelper?.updateMatrixWorld(true);
  }

  function syncCoordinateInputs() {
    if (savedRootMatrixLoadError) {
      return;
    }

    getCurrentRootTransform(currentRootTransformMatrix);
    coordinateWorldPosition.setFromMatrixPosition(currentRootTransformMatrix);
    const coordinate =
      geoCamera.getCartographicFromWorldPosition(coordinateWorldPosition);
    if (!coordinate) {
      return;
    }

    onCoordinateChanged(
      coordinate.latitude,
      coordinate.longitude,
      coordinate.height,
    );
  }

  function syncTransformHandle() {
    syncingTransformHandle = true;
    try {
      applySavedObjectMatrix(
        transformHandle,
        getCurrentRootTransform(currentRootTransformMatrix),
      );
      transformHandle.updateMatrixWorld(true);
      transformControlsHelper?.updateMatrixWorld(true);
    } finally {
      syncingTransformHandle = false;
    }
  }

  function applySaved(matrix) {
    applySavedObjectMatrix(editableGroup, matrix);
    invalidate();
    syncTransformHandle();
    syncCoordinateInputs();
  }

  function applyFromRootTransform(rootTransform) {
    applyEditableMatrixFromRootTransform({
      editableGroup,
      lastSavedMatrix,
      rootTransform,
      savedRootInverseMatrix,
      savedRootMatrix,
      target: coordinateEditMatrix,
    });
    invalidate();
  }

  async function applyFromCoordinate(latitude, longitude, height) {
    await savedRootMatrixPromise;
    if (savedRootMatrixLoadError) {
      throw savedRootMatrixLoadError;
    }

    geoCamera.getCoordinateTransform(
      latitude,
      longitude,
      height,
      coordinateTransformMatrix,
    );
    applyEditableMatrixFromRootTransform({
      editableGroup,
      lastSavedMatrix,
      rootTransform: coordinateTransformMatrix,
      savedRootInverseMatrix,
      savedRootMatrix,
      target: coordinateEditMatrix,
    });
    invalidate();
    syncTransformHandle();
    syncCoordinateInputs();
  }

  function reset() {
    resetEditableObjectTransform(editableGroup);
    lastSavedMatrix.identity();
    resetEditableObjectTransform(transformHandle);
    tilesTransformDirty = true;
  }

  function refresh(url) {
    savedRootMatrix.identity();
    savedRootMatrixLoadError = null;
    savedRootMatrixPromise = refreshSavedRootMatrix({
      rootTilesetLabel,
      target: savedRootMatrix,
      url,
    }).then(
      () => {
        savedRootMatrixLoadError = null;
        syncTransformHandle();
        syncCoordinateInputs();
      },
      (err) => {
        savedRootMatrixLoadError = err;
        savedRootMatrix.identity();
        syncTransformHandle();
        syncCoordinateInputs();
      },
    );
    return savedRootMatrixPromise;
  }

  function setFromTransform(transform) {
    setSavedRootMatrixFromTransform({
      target: savedRootMatrix,
      transform,
    });
    savedRootMatrixLoadError = null;
    savedRootMatrixPromise = Promise.resolve(savedRootMatrix);
  }

  async function reloadFromUrl(url) {
    savedRootMatrixPromise = refreshSavedRootMatrix({
      rootTilesetLabel,
      target: savedRootMatrix,
      url,
    }).then(
      () => {
        savedRootMatrixLoadError = null;
      },
      (err) => {
        savedRootMatrixLoadError = err;
        savedRootMatrix.identity();
      },
    );
    await savedRootMatrixPromise;
    if (savedRootMatrixLoadError) {
      throw savedRootMatrixLoadError;
    }
  }

  function markSaved(currentMatrix) {
    lastSavedMatrix.copy(currentMatrix);
  }

  function getIncrementalSinceSaved(currentMatrix) {
    return getIncrementalMatrix(currentMatrix, lastSavedMatrix);
  }

  function flush() {
    if (!tilesTransformDirty) {
      return;
    }
    tilesTransformDirty = false;
    editableGroup.updateMatrixWorld(true);
    const tiles = getTiles();
    updateTilesRendererGroupMatrices(tiles);
    refreshLoadedTileSceneMatrices(tiles);
  }

  return {
    applyFromCoordinate,
    applyFromRootTransform,
    applySaved,
    flush,
    getCurrentMatrix,
    getCurrentRootTransform,
    getCurrentRootTransformArray,
    getIncrementalSinceSaved,
    getLastSaved: () => lastSavedMatrix,
    getLoadError: () => savedRootMatrixLoadError,
    isSyncingHandle: () => syncingTransformHandle,
    markDirty() {
      tilesTransformDirty = true;
    },
    markSaved,
    refresh,
    reloadFromUrl,
    reset,
    setFromTransform,
    syncCoordinateInputs,
    syncTransformHandle,
  };
}
