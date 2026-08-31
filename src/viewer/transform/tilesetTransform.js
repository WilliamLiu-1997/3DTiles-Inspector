import { composeMatrix, getFiniteMatrix4Array } from '../utils.js';

export function applySavedObjectMatrix(object, matrix) {
  composeMatrix(object, matrix);
}

export function getObjectMatrix(object) {
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

export function markWorldMatricesDirty(objects) {
  for (const object of objects) {
    object.matrixWorldNeedsUpdate = true;
  }
}

export function repairTilesGroupChildMatrices(tilesRenderer) {
  const group = tilesRenderer?.group;
  if (!group) {
    return;
  }

  for (const child of group.children) {
    // TilesFadePlugin can keep a fading scene in the group's children after
    // setTileActive(false) clears its parent. Restore the Three.js hierarchy
    // invariant before rendering so the scene inherits the edited root matrix.
    if (child.parent !== group) {
      child.parent = group;
      child.updateMatrixWorld(true);
    }
  }
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
