import { composeMatrix, getFiniteMatrix4Array } from './viewerUtils.js';

export function applySavedObjectMatrix(object, matrix) {
  composeMatrix(object, matrix);
}

export function getObjectMatrix(object) {
  object.updateMatrix();
  object.updateMatrixWorld(true);
  return object.matrix.clone();
}

export function getIncrementalMatrix(currentMatrix, lastSavedMatrix) {
  return currentMatrix.clone().multiply(lastSavedMatrix.clone().invert());
}

export function getRootTransform({
  editableGroup,
  lastSavedMatrix,
  savedRootInverseMatrix,
  savedRootMatrix,
  target,
}) {
  editableGroup.updateMatrix();
  editableGroup.updateMatrixWorld(true);
  return target
    .copy(editableGroup.matrix)
    .multiply(savedRootInverseMatrix.copy(lastSavedMatrix).invert())
    .multiply(savedRootMatrix);
}

export function applyEditableMatrixFromRootTransform({
  editableGroup,
  lastSavedMatrix,
  rootTransform,
  savedRootInverseMatrix,
  savedRootMatrix,
  target,
}) {
  target
    .copy(rootTransform)
    .multiply(savedRootInverseMatrix.copy(savedRootMatrix).invert())
    .multiply(lastSavedMatrix);
  composeMatrix(editableGroup, target);
}

export function updateTilesRendererGroupMatrices(tilesRenderer) {
  const group = tilesRenderer?.group;
  if (!group) {
    return;
  }

  group.updateMatrixWorld(true);

  if (
    group.matrixWorldInverse &&
    typeof group.matrixWorldInverse.copy === 'function'
  ) {
    group.matrixWorldInverse.copy(group.matrixWorld).invert();
  }
}

export function refreshLoadedTileSceneMatrices(tilesRenderer) {
  if (
    !tilesRenderer ||
    typeof tilesRenderer.forEachLoadedModel !== 'function'
  ) {
    return;
  }

  tilesRenderer.forEachLoadedModel((loadedScene) => {
    if (typeof loadedScene.updateWorldMatrix === 'function') {
      loadedScene.updateWorldMatrix(false, true);
    } else {
      loadedScene.updateMatrixWorld(true);
    }
  });
}

export function resetEditableObjectTransform(object) {
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  object.scale.set(1, 1, 1);
  object.updateMatrix();
  object.updateMatrixWorld(true);
}

export async function refreshSavedRootMatrix({
  rootTilesetLabel,
  target,
  url,
}) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(
      `Failed to load ${rootTilesetLabel} metadata for coordinate placement (${response.status}).`,
    );
  }

  const payload = await response.json();
  target.identity();

  const rootTransform = payload?.root?.transform;
  if (rootTransform != null) {
    target.fromArray(
      getFiniteMatrix4Array(rootTransform, 'tileset.root.transform'),
    );
  }

  return target;
}

export function setSavedRootMatrixFromTransform({
  label = 'transform',
  target,
  transform,
}) {
  target.fromArray(getFiniteMatrix4Array(transform, label));
  return target;
}
