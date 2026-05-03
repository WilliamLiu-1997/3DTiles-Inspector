import {
  SCREEN_SELECTION_ACTION_EXCLUDE,
  SCREEN_SELECTION_MIN_DEPTH_RANGE,
  cameraPosition,
  copyDepthRange,
  copyFarPlane,
  copyMatrix4Array,
  copyRect,
  copyVectorArray,
  farPoint,
  getSelectionForward,
  selectionForward,
} from './state.js';
import {
  createPlaneMatrixFromNormalAndPoint,
  getSelectionTransformDelta,
  transformPlaneMatrix,
} from './geometry.js';
import {
  applyScreenSelectionSdfMatrices,
  createScreenSelectionSdfs,
  setScreenSelectionEditSelection,
} from './sdf.js';
import {
  disposeScreenSelectionFarHandle,
  updateScreenSelectionFarHandle,
} from './farHandle.js';

export { SCREEN_SELECTION_ACTION_EXCLUDE } from './state.js';
export {
  createScreenSelectionEdit,
  setScreenSelectionEditSelection,
} from './sdf.js';
export {
  createScreenSelectionFarHandle,
  getScreenSelectionFarDepthFromPosition,
} from './farHandle.js';
export { createScreenSelectionPointerTracker } from './pointerTracker.js';

export function createScreenSelection({
  cameraPosition: sourceCameraPosition,
  depthRange,
  farPlane,
  id,
  planeMatrices,
  rect,
  selectionForward: sourceSelectionForward,
  transformMatrix,
  viewProjectionMatrix,
}) {
  const copiedPlaneMatrices = planeMatrices.map((matrix) => matrix.slice());
  const referenceTransformMatrix = copyMatrix4Array(transformMatrix);
  return {
    action: SCREEN_SELECTION_ACTION_EXCLUDE,
    basePlaneMatrices: copiedPlaneMatrices.map((matrix) => matrix.slice()),
    cameraPosition: copyVectorArray(sourceCameraPosition),
    currentTransformMatrix: referenceTransformMatrix.slice(),
    depthRange: copyDepthRange(depthRange),
    farPlane: copyFarPlane(farPlane),
    id,
    planeMatrices: copiedPlaneMatrices,
    referenceTransformMatrix,
    rect: copyRect(rect),
    selectionForward: copyVectorArray(sourceSelectionForward, [0, 0, -1]),
    sdfs: createScreenSelectionSdfs(copiedPlaneMatrices),
    viewProjectionMatrix: viewProjectionMatrix.slice(),
  };
}

export function disposeScreenSelection(selection) {
  if (selection?.edit) {
    setScreenSelectionEditSelection(selection.edit, null, true);
    selection.edit.removeFromParent();
    selection.edit = null;
  }
  disposeScreenSelectionFarHandle(selection);
  selection?.sdfs?.forEach((sdf) => {
    sdf.removeFromParent();
  });
}

export function getScreenSelectionPayload(selection) {
  return {
    action: SCREEN_SELECTION_ACTION_EXCLUDE,
    planeMatrices: selection.planeMatrices.map((matrix) => matrix.slice()),
    rect: copyRect(selection.rect),
    viewProjectionMatrix: selection.viewProjectionMatrix.slice(),
  };
}

export function setScreenSelectionShape(
  selection,
  {
    cameraPosition: sourceCameraPosition,
    depthRange,
    farPlane,
    planeMatrices,
    rect,
    selectionForward: sourceSelectionForward,
    viewProjectionMatrix,
  },
  currentTransformMatrix,
) {
  if (!selection) {
    return;
  }

  const previousFarDepth = Number(selection.depthRange?.farDepth);
  const copiedPlaneMatrices = planeMatrices.map((matrix) => matrix.slice());
  const referenceTransformMatrix = copyMatrix4Array(currentTransformMatrix);

  selection.basePlaneMatrices = copiedPlaneMatrices.map((matrix) =>
    matrix.slice(),
  );
  selection.cameraPosition = copyVectorArray(sourceCameraPosition);
  selection.currentTransformMatrix = referenceTransformMatrix.slice();
  selection.depthRange = copyDepthRange(depthRange);
  selection.farPlane = copyFarPlane(farPlane);
  selection.planeMatrices = copiedPlaneMatrices;
  selection.referenceTransformMatrix = referenceTransformMatrix;
  selection.rect = copyRect(rect);
  selection.selectionForward = copyVectorArray(sourceSelectionForward, [
    0,
    0,
    -1,
  ]);
  selection.viewProjectionMatrix = viewProjectionMatrix.slice();

  updateScreenSelectionWorldState(selection, currentTransformMatrix);

  if (!Number.isFinite(previousFarDepth)) {
    return;
  }

  const nextFarDepth = Math.min(
    selection.depthRange.maxFarDepth,
    Math.max(
      selection.depthRange.nearDepth + SCREEN_SELECTION_MIN_DEPTH_RANGE,
      previousFarDepth,
    ),
  );
  if (Math.abs(nextFarDepth - selection.depthRange.farDepth) > 1e-9) {
    setScreenSelectionFarDepth(
      selection,
      nextFarDepth,
      currentTransformMatrix,
    );
  }
}

export function updateScreenSelectionWorldState(
  selection,
  currentTransformMatrix,
  active = selection?.farHandle?.visible,
) {
  if (!selection) {
    return;
  }

  const currentMatrix = copyMatrix4Array(
    currentTransformMatrix,
    selection.currentTransformMatrix,
  );
  selection.currentTransformMatrix = currentMatrix;
  const delta = getSelectionTransformDelta(selection, currentMatrix);
  selection.planeMatrices = selection.basePlaneMatrices.map((matrix) =>
    transformPlaneMatrix(matrix, delta),
  );
  applyScreenSelectionSdfMatrices(selection);
  updateScreenSelectionFarHandle(selection, active, currentMatrix);
}

export function setScreenSelectionFarDepth(
  selection,
  farDepth,
  currentTransformMatrix,
) {
  const depthRange = copyDepthRange({
    ...selection.depthRange,
    farDepth,
  });
  selection.depthRange = depthRange;

  getSelectionForward(selection);
  cameraPosition.fromArray(selection.cameraPosition);
  farPoint
    .copy(selectionForward)
    .multiplyScalar(depthRange.farDepth)
    .add(cameraPosition);
  selection.basePlaneMatrices[5] = createPlaneMatrixFromNormalAndPoint(
    selectionForward,
    farPoint,
  );
  updateScreenSelectionWorldState(selection, currentTransformMatrix);
}
