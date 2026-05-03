import { Matrix4, Quaternion, Vector2, Vector3 } from 'three';
import {
  SCREEN_SELECTION_MIN_DEPTH_RANGE,
  SCREEN_SELECTION_MIN_DRAG_DISTANCE_SQ,
  UNIT_SCALE,
  WORLD_Z,
  cameraForward,
  cameraPosition,
  clamp,
  copyMatrix4Array,
  farPlaneCornerOffset,
  plane,
  rayDirection,
  rectScratch,
  selectionCurrentTransformMatrix,
  selectionForward,
  selectionReferenceInverseMatrix,
  selectionReferenceTransformMatrix,
  selectionTransformDeltaMatrix,
  transformedPlane,
  unprojectPoint,
} from './state.js';

export function getClampedClientPoint(event, domRect, target) {
  target.set(
    clamp(event.clientX, domRect.left, domRect.right),
    clamp(event.clientY, domRect.top, domRect.bottom),
  );
  return target;
}

export function getClientSelectionRect(start, end, target = rectScratch) {
  target.minX = Math.min(start.x, end.x);
  target.maxX = Math.max(start.x, end.x);
  target.minY = Math.min(start.y, end.y);
  target.maxY = Math.max(start.y, end.y);
  return target;
}

function clientPointToNdc(point, domRect) {
  return {
    x: ((point.x - domRect.left) / domRect.width) * 2 - 1,
    y: 1 - ((point.y - domRect.top) / domRect.height) * 2,
  };
}

function getNdcSelectionRect(clientRect, domRect) {
  const topLeft = clientPointToNdc(
    new Vector2(clientRect.minX, clientRect.minY),
    domRect,
  );
  const bottomRight = clientPointToNdc(
    new Vector2(clientRect.maxX, clientRect.maxY),
    domRect,
  );
  return {
    minX: Math.min(topLeft.x, bottomRight.x),
    maxX: Math.max(topLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, bottomRight.y),
    maxY: Math.max(topLeft.y, bottomRight.y),
  };
}

export function updateOverlayRect(overlayEl, rectEl, clientRect) {
  if (!overlayEl || !rectEl) {
    return;
  }

  overlayEl.hidden = false;
  rectEl.style.left = `${clientRect.minX}px`;
  rectEl.style.top = `${clientRect.minY}px`;
  rectEl.style.width = `${Math.max(1, clientRect.maxX - clientRect.minX)}px`;
  rectEl.style.height = `${Math.max(1, clientRect.maxY - clientRect.minY)}px`;
}

export function clearOverlay(overlayEl, rectEl) {
  if (!overlayEl || !rectEl) {
    return;
  }

  overlayEl.hidden = true;
  rectEl.style.left = '0px';
  rectEl.style.top = '0px';
  rectEl.style.width = '0px';
  rectEl.style.height = '0px';
}

function getWorldPointAtViewDepth(camera, ndcX, ndcY, viewDepth, target) {
  unprojectPoint.set(ndcX, ndcY, 0.5).unproject(camera);
  rayDirection.copy(unprojectPoint).sub(camera.position).normalize();
  camera.getWorldDirection(cameraForward);
  const forwardDot = rayDirection.dot(cameraForward);
  if (Math.abs(forwardDot) < 1e-6) {
    return null;
  }

  target
    .copy(rayDirection)
    .multiplyScalar(viewDepth / forwardDot)
    .add(camera.position);
  return target;
}

function createPointAtViewDepth(camera, ndcX, ndcY, viewDepth) {
  const point = new Vector3();
  return getWorldPointAtViewDepth(camera, ndcX, ndcY, viewDepth, point)
    ? point
    : null;
}

function getWorldPointOnPlane(camera, ndcX, ndcY, sourcePlane, target) {
  unprojectPoint.set(ndcX, ndcY, 0.5).unproject(camera);
  rayDirection.copy(unprojectPoint).sub(camera.position).normalize();
  const denominator = rayDirection.dot(sourcePlane.normal);
  if (Math.abs(denominator) < 1e-6) {
    return null;
  }

  const distance =
    -(sourcePlane.normal.dot(camera.position) + sourcePlane.constant) /
    denominator;
  if (!Number.isFinite(distance) || distance <= 0) {
    return null;
  }

  target.copy(rayDirection).multiplyScalar(distance).add(camera.position);
  return target;
}

function createPointOnPlane(camera, ndcX, ndcY, sourcePlane) {
  const point = new Vector3();
  return getWorldPointOnPlane(camera, ndcX, ndcY, sourcePlane, point)
    ? point
    : null;
}

export function normalizeDepthRange(camera, depthRange) {
  const nearDepth = Math.max(
    camera.near,
    Number(depthRange?.near ?? depthRange?.nearDepth) || camera.near,
  );
  return {
    farDepth: Math.max(
      nearDepth + SCREEN_SELECTION_MIN_DEPTH_RANGE,
      Number(depthRange?.far ?? depthRange?.farDepth) || nearDepth + 100,
    ),
    nearDepth,
  };
}

export function createPlaneMatrix(sourcePlane) {
  const position = sourcePlane.normal
    .clone()
    .multiplyScalar(-sourcePlane.constant);
  const quaternion = new Quaternion().setFromUnitVectors(
    WORLD_Z,
    sourcePlane.normal,
  );
  return new Matrix4().compose(position, quaternion, UNIT_SCALE).toArray();
}

function createPlaneFromMatrix(matrixArray, target = transformedPlane) {
  const matrix = new Matrix4().fromArray(matrixArray);
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const normal = new Vector3(0, 0, 1);
  matrix.decompose(position, quaternion, scale);
  normal.applyQuaternion(quaternion).normalize();
  return target.setFromNormalAndCoplanarPoint(normal, position);
}

export function createPlaneMatrixFromNormalAndPoint(normal, point) {
  return createPlaneMatrix(plane.setFromNormalAndCoplanarPoint(normal, point));
}

function pushPlaneMatrixFromPlane(matrices, sourcePlane, insidePoint) {
  const normalLengthSq = sourcePlane.normal.lengthSq();
  if (!Number.isFinite(normalLengthSq) || normalLengthSq < 1e-12) {
    return false;
  }

  if (sourcePlane.distanceToPoint(insidePoint) > 0) {
    sourcePlane.negate();
  }
  matrices.push(createPlaneMatrix(sourcePlane));
  return true;
}

function pushPlaneMatrixFromPoints(matrices, a, b, c, insidePoint) {
  return pushPlaneMatrixFromPlane(
    matrices,
    plane.setFromCoplanarPoints(a, b, c).clone(),
    insidePoint,
  );
}

function pushPlaneMatrixFromNormal(matrices, normal, point, insidePoint) {
  return pushPlaneMatrixFromPlane(
    matrices,
    plane.setFromNormalAndCoplanarPoint(normal, point).clone(),
    insidePoint,
  );
}

export function normalizeFarPlaneAxes(normal, right, up) {
  up.addScaledVector(normal, -up.dot(normal));
  if (up.lengthSq() >= 1e-12) {
    up.normalize();
    right.crossVectors(up, normal).normalize();
    return true;
  }

  right.addScaledVector(normal, -right.dot(normal));
  if (right.lengthSq() < 1e-12) {
    return false;
  }
  right.normalize();
  up.crossVectors(normal, right).normalize();
  return true;
}

function createFarPlaneData({
  cameraPosition: sourceCameraPosition,
  farBottomLeft,
  farBottomRight,
  farCenter,
  farNormal,
  farTopLeft,
  farTopRight,
  nearBottomLeft,
  nearBottomRight,
  nearTopLeft,
  nearTopRight,
}) {
  const normal = farNormal.clone().normalize();
  const right = farTopRight.clone().sub(farTopLeft);
  const up = farTopLeft.clone().sub(farBottomLeft);
  if (!normalizeFarPlaneAxes(normal, right, up)) {
    return null;
  }

  const corners = [farTopLeft, farTopRight, farBottomRight, farBottomLeft];
  const minRight = Math.min(...corners.map((point) => point.dot(right)));
  const maxRight = Math.max(...corners.map((point) => point.dot(right)));
  const minUp = Math.min(...corners.map((point) => point.dot(up)));
  const maxUp = Math.max(...corners.map((point) => point.dot(up)));
  const width = maxRight - minRight;
  const height = maxUp - minUp;
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    centerOffset: farCenter.clone().sub(sourceCameraPosition).toArray(),
    corners: corners.map((corner) => {
      farPlaneCornerOffset.copy(corner).sub(farCenter);
      return [farPlaneCornerOffset.dot(right), farPlaneCornerOffset.dot(up)];
    }),
    height,
    nearCorners: [
      nearTopLeft,
      nearTopRight,
      nearBottomRight,
      nearBottomLeft,
    ].map((corner) => {
      farPlaneCornerOffset.copy(corner).sub(farCenter);
      return [
        farPlaneCornerOffset.dot(right),
        farPlaneCornerOffset.dot(up),
        farPlaneCornerOffset.dot(normal),
      ];
    }),
    right: right.toArray(),
    up: up.toArray(),
    width,
  };
}

function createFrustumData(camera, rect, depthRange) {
  const { farDepth, nearDepth } = normalizeDepthRange(camera, depthRange);
  const centerX = (rect.minX + rect.maxX) * 0.5;
  const centerY = (rect.minY + rect.maxY) * 0.5;
  const nearCenter = createPointAtViewDepth(
    camera,
    centerX,
    centerY,
    nearDepth,
  );
  const farCenter = createPointAtViewDepth(camera, centerX, centerY, farDepth);
  if (!nearCenter || !farCenter) {
    return null;
  }

  selectionForward.copy(farCenter).sub(camera.position);
  if (selectionForward.lengthSq() < 1e-12) {
    return null;
  }
  selectionForward.normalize();
  const nearDistance = Math.max(
    SCREEN_SELECTION_MIN_DEPTH_RANGE,
    nearCenter.distanceTo(camera.position),
  );
  const farDistance = Math.max(
    nearDistance + SCREEN_SELECTION_MIN_DEPTH_RANGE,
    farCenter.distanceTo(camera.position),
  );
  const insidePoint = selectionForward
    .clone()
    .multiplyScalar((nearDistance + farDistance) * 0.5)
    .add(camera.position);
  plane.setFromNormalAndCoplanarPoint(selectionForward, farCenter);

  const farClipPlane = plane.clone();
  const farTopLeft = createPointOnPlane(
    camera,
    rect.minX,
    rect.maxY,
    farClipPlane,
  );
  const farTopRight = createPointOnPlane(
    camera,
    rect.maxX,
    rect.maxY,
    farClipPlane,
  );
  const farBottomRight = createPointOnPlane(
    camera,
    rect.maxX,
    rect.minY,
    farClipPlane,
  );
  const farBottomLeft = createPointOnPlane(
    camera,
    rect.minX,
    rect.minY,
    farClipPlane,
  );

  plane.setFromNormalAndCoplanarPoint(selectionForward, nearCenter);
  const nearPlane = plane.clone();
  const nearTopLeft = createPointOnPlane(
    camera,
    rect.minX,
    rect.maxY,
    nearPlane,
  );
  const nearTopRight = createPointOnPlane(
    camera,
    rect.maxX,
    rect.maxY,
    nearPlane,
  );
  const nearBottomRight = createPointOnPlane(
    camera,
    rect.maxX,
    rect.minY,
    nearPlane,
  );
  const nearBottomLeft = createPointOnPlane(
    camera,
    rect.minX,
    rect.minY,
    nearPlane,
  );
  if (
    !farTopLeft ||
    !farTopRight ||
    !farBottomRight ||
    !farBottomLeft ||
    !nearTopLeft ||
    !nearTopRight ||
    !nearBottomRight ||
    !nearBottomLeft
  ) {
    return null;
  }

  const matrices = [];
  pushPlaneMatrixFromPoints(
    matrices,
    farTopLeft,
    farBottomLeft,
    camera.position,
    insidePoint,
  );
  pushPlaneMatrixFromPoints(
    matrices,
    farBottomRight,
    farTopRight,
    camera.position,
    insidePoint,
  );
  pushPlaneMatrixFromPoints(
    matrices,
    farTopRight,
    farTopLeft,
    camera.position,
    insidePoint,
  );
  pushPlaneMatrixFromPoints(
    matrices,
    farBottomLeft,
    farBottomRight,
    camera.position,
    insidePoint,
  );
  pushPlaneMatrixFromNormal(
    matrices,
    selectionForward.clone().negate(),
    nearCenter,
    insidePoint,
  );
  pushPlaneMatrixFromNormal(
    matrices,
    selectionForward.clone(),
    farCenter,
    insidePoint,
  );
  if (matrices.length !== 6) {
    return null;
  }

  const farPlaneData = createFarPlaneData({
    cameraPosition: camera.position,
    farBottomLeft,
    farBottomRight,
    farCenter,
    farNormal: selectionForward,
    farTopLeft,
    farTopRight,
    nearBottomLeft,
    nearBottomRight,
    nearCenter,
    nearTopLeft,
    nearTopRight,
  });
  if (!farPlaneData) {
    return null;
  }

  return {
    depthRange: {
      farDepth: farDistance,
      maxFarDepth: farDistance,
      nearDepth: nearDistance,
    },
    farPlane: farPlaneData,
    planeMatrices: matrices,
    selectionForward: selectionForward.toArray(),
  };
}

export function createSelectionData({
  camera,
  domElement,
  end,
  getDepthRange,
  start,
}) {
  const domRect = domElement.getBoundingClientRect();
  if (domRect.width <= 0 || domRect.height <= 0) {
    return null;
  }

  const clientRect = getClientSelectionRect(start, end);
  const width = clientRect.maxX - clientRect.minX;
  const height = clientRect.maxY - clientRect.minY;
  if (width * width + height * height < SCREEN_SELECTION_MIN_DRAG_DISTANCE_SQ) {
    return null;
  }

  const rect = getNdcSelectionRect(clientRect, domRect);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  cameraPosition.copy(camera.position);
  const depthRange = normalizeDepthRange(camera, getDepthRange());
  const viewProjectionMatrix = new Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .toArray();
  const frustum = createFrustumData(camera, rect, depthRange);
  if (!frustum) {
    return null;
  }

  return {
    cameraPosition: cameraPosition.toArray(),
    depthRange: frustum.depthRange,
    farPlane: frustum.farPlane,
    planeMatrices: frustum.planeMatrices,
    rect,
    selectionForward: frustum.selectionForward,
    viewProjectionMatrix,
  };
}

export function getSelectionTransformDelta(selection, currentTransformMatrix) {
  selectionCurrentTransformMatrix.fromArray(
    copyMatrix4Array(currentTransformMatrix, selection.currentTransformMatrix),
  );
  selectionReferenceTransformMatrix.fromArray(
    selection.referenceTransformMatrix,
  );
  selectionReferenceInverseMatrix
    .copy(selectionReferenceTransformMatrix)
    .invert();
  return selectionTransformDeltaMatrix
    .copy(selectionCurrentTransformMatrix)
    .multiply(selectionReferenceInverseMatrix);
}

export function transformPlaneMatrix(matrixArray, transformMatrix) {
  return createPlaneMatrix(
    createPlaneFromMatrix(matrixArray).applyMatrix4(transformMatrix),
  );
}
