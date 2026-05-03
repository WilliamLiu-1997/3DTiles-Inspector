import {
  Color,
  Group,
  Matrix4,
  Plane,
  Quaternion,
  Vector2,
  Vector3,
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import {
  SplatEdit,
  SplatEditRgbaBlendMode,
  SplatEditSdf,
  SplatEditSdfType,
} from '@sparkjsdev/spark';

export const SCREEN_SELECTION_ACTION_EXCLUDE = 'exclude';

const SCREEN_SELECTION_EXCLUDE_COLOR = new Color(1, 0.82, 0);
const SCREEN_SELECTION_HIDDEN_COLOR = new Color(1, 1, 1);
const SCREEN_SELECTION_HIDDEN_ALPHA = 0;
const SCREEN_SELECTION_FAR_HANDLE_COLOR = 0xffffff;
const SCREEN_SELECTION_FAR_HANDLE_AXIS_DIRECTION = -1;
const SCREEN_SELECTION_FAR_HANDLE_RENDER_ORDER = 1000000;
const SCREEN_SELECTION_FAR_HANDLE_GRID_DIVISIONS = 8;
const SCREEN_SELECTION_FAR_HANDLE_GUIDE_LINE_WIDTH = 0.5;
const SCREEN_SELECTION_FAR_HANDLE_LINE_WIDTH = 1;
const SCREEN_SELECTION_MIN_DRAG_DISTANCE_SQ = 16;
const SCREEN_SELECTION_MIN_DEPTH_RANGE = 0.001;
const WORLD_Z = new Vector3(0, 0, 1);
const UNIT_SCALE = new Vector3(1, 1, 1);

const dragStart = new Vector2();
const dragCurrent = new Vector2();
const rectScratch = {
  maxX: 0,
  maxY: 0,
  minX: 0,
  minY: 0,
};
const unprojectPoint = new Vector3();
const rayDirection = new Vector3();
const cameraForward = new Vector3();
const cameraPosition = new Vector3();
const selectionForward = new Vector3();
const farPoint = new Vector3();
const farPlaneRight = new Vector3();
const farPlaneUp = new Vector3();
const farPlaneNormal = new Vector3();
const farPlaneCenterOffset = new Vector3();
const farPlaneCornerOffset = new Vector3();
const plane = new Plane();
const selectionCurrentTransformMatrix = new Matrix4();
const selectionReferenceTransformMatrix = new Matrix4();
const selectionReferenceInverseMatrix = new Matrix4();
const selectionTransformDeltaMatrix = new Matrix4();
const selectionTransformInverseDeltaMatrix = new Matrix4();
const transformedPlane = new Plane();

const IDENTITY_MATRIX4 = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function copyRect(rect) {
  return {
    maxX: rect.maxX,
    maxY: rect.maxY,
    minX: rect.minX,
    minY: rect.minY,
  };
}

function copyVectorArray(value, fallback = [0, 0, 0]) {
  return Array.isArray(value) && value.length === 3
    ? value.slice()
    : fallback.slice();
}

function copyMatrix4Array(value, fallback = IDENTITY_MATRIX4) {
  return Array.isArray(value) && value.length === 16
    ? value.map(Number)
    : fallback.slice();
}

function copyPlaneCorners(value, width, height) {
  if (Array.isArray(value) && value.length === 4) {
    return value.map((corner) =>
      Array.isArray(corner) && corner.length >= 2
        ? [
            Number(corner[0]) || 0,
            Number(corner[1]) || 0,
            Number(corner[2]) || 0,
          ]
        : [0, 0],
    );
  }

  return [
    [-width * 0.5, height * 0.5],
    [width * 0.5, height * 0.5],
    [width * 0.5, -height * 0.5],
    [-width * 0.5, -height * 0.5],
  ];
}

function getSelectionForward(selection, target = selectionForward) {
  target.fromArray(copyVectorArray(selection?.selectionForward, [0, 0, -1]));
  if (target.lengthSq() < 1e-12) {
    target.set(0, 0, -1);
  }
  return target.normalize();
}

function copyFarPlane(value) {
  const width = Math.max(
    SCREEN_SELECTION_MIN_DEPTH_RANGE,
    Number(value?.width) || SCREEN_SELECTION_MIN_DEPTH_RANGE,
  );
  const height = Math.max(
    SCREEN_SELECTION_MIN_DEPTH_RANGE,
    Number(value?.height) || SCREEN_SELECTION_MIN_DEPTH_RANGE,
  );
  return {
    centerOffset: copyVectorArray(value?.centerOffset),
    corners: copyPlaneCorners(value?.corners, width, height),
    height,
    nearCorners: copyPlaneCorners(value?.nearCorners, width, height),
    right: copyVectorArray(value?.right, [1, 0, 0]),
    up: copyVectorArray(value?.up, [0, 1, 0]),
    width,
  };
}

function pushFarHandleSegment(vertices, start, end) {
  vertices.push(start[0], start[1], start[2] || 0, end[0], end[1], end[2] || 0);
}

function getCurrentFarPlaneCorner(corner, ratio) {
  return [
    corner[0] * ratio * SCREEN_SELECTION_FAR_HANDLE_AXIS_DIRECTION,
    corner[1] * ratio,
    0,
  ];
}

function getCurrentNearPlaneCorner(corner, selection) {
  return [
    corner[0] * SCREEN_SELECTION_FAR_HANDLE_AXIS_DIRECTION,
    corner[1],
    ((corner[2] || 0) +
      selection.depthRange.maxFarDepth -
      selection.depthRange.farDepth) *
      SCREEN_SELECTION_FAR_HANDLE_AXIS_DIRECTION,
  ];
}

function lerpFarPlaneCorner(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t,
  ];
}

function getCurrentFarHandleCorners(selection) {
  const ratio = getFarDepthRatio(selection);
  const [topLeft, topRight, bottomRight, bottomLeft] =
    selection.farPlane.corners.map((corner) =>
      getCurrentFarPlaneCorner(corner, ratio),
    );
  const [nearTopLeft, nearTopRight, nearBottomRight, nearBottomLeft] =
    selection.farPlane.nearCorners.map((corner) =>
      getCurrentNearPlaneCorner(corner, selection),
    );

  return {
    bottomLeft,
    bottomRight,
    nearBottomLeft,
    nearBottomRight,
    nearTopLeft,
    nearTopRight,
    topLeft,
    topRight,
  };
}

function createFarHandleGridPositions(selection) {
  const { bottomLeft, bottomRight, topLeft, topRight } =
    getCurrentFarHandleCorners(selection);
  const vertices = [];

  for (
    let index = 0;
    index <= SCREEN_SELECTION_FAR_HANDLE_GRID_DIVISIONS;
    index++
  ) {
    const t = index / SCREEN_SELECTION_FAR_HANDLE_GRID_DIVISIONS;
    pushFarHandleSegment(
      vertices,
      lerpFarPlaneCorner(topLeft, topRight, t),
      lerpFarPlaneCorner(bottomLeft, bottomRight, t),
    );
    pushFarHandleSegment(
      vertices,
      lerpFarPlaneCorner(topLeft, bottomLeft, t),
      lerpFarPlaneCorner(topRight, bottomRight, t),
    );
  }

  return vertices;
}

function createFarHandleGuidePositions(selection) {
  const {
    bottomLeft,
    bottomRight,
    nearBottomLeft,
    nearBottomRight,
    nearTopLeft,
    nearTopRight,
    topLeft,
    topRight,
  } = getCurrentFarHandleCorners(selection);
  const vertices = [];

  pushFarHandleSegment(vertices, nearTopLeft, nearTopRight);
  pushFarHandleSegment(vertices, nearTopRight, nearBottomRight);
  pushFarHandleSegment(vertices, nearBottomRight, nearBottomLeft);
  pushFarHandleSegment(vertices, nearBottomLeft, nearTopLeft);
  pushFarHandleSegment(vertices, nearTopLeft, topLeft);
  pushFarHandleSegment(vertices, nearBottomLeft, bottomLeft);
  pushFarHandleSegment(vertices, nearTopRight, topRight);
  pushFarHandleSegment(vertices, nearBottomRight, bottomRight);

  return vertices;
}

function createFarHandleGeometry(positions) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  return geometry;
}

function createFarHandleGridGeometry(selection) {
  return createFarHandleGeometry(createFarHandleGridPositions(selection));
}

function createFarHandleGuideGeometry(selection) {
  return createFarHandleGeometry(createFarHandleGuidePositions(selection));
}

function updateFarHandleGridGeometry(selection) {
  selection.farHandleGridGeometry?.setPositions(
    createFarHandleGridPositions(selection),
  );
}

function updateFarHandleGuideGeometry(selection) {
  if (!selection.farHandleGuideGeometry) {
    return;
  }

  selection.farHandleGuideGeometry.setPositions(
    createFarHandleGuidePositions(selection),
  );
}

function getClampedClientPoint(event, domRect, target) {
  target.set(
    clamp(event.clientX, domRect.left, domRect.right),
    clamp(event.clientY, domRect.top, domRect.bottom),
  );
  return target;
}

function getClientSelectionRect(start, end, target = rectScratch) {
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

function updateOverlayRect(overlayEl, rectEl, clientRect) {
  if (!overlayEl || !rectEl) {
    return;
  }

  overlayEl.hidden = false;
  rectEl.style.left = `${clientRect.minX}px`;
  rectEl.style.top = `${clientRect.minY}px`;
  rectEl.style.width = `${Math.max(1, clientRect.maxX - clientRect.minX)}px`;
  rectEl.style.height = `${Math.max(1, clientRect.maxY - clientRect.minY)}px`;
}

function clearOverlay(overlayEl, rectEl) {
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

function normalizeDepthRange(camera, depthRange) {
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

function copyDepthRange(depthRange) {
  const nearDepth = Math.max(
    SCREEN_SELECTION_MIN_DEPTH_RANGE,
    Number(depthRange?.nearDepth) || SCREEN_SELECTION_MIN_DEPTH_RANGE,
  );
  const maxFarDepth = Math.max(
    nearDepth + SCREEN_SELECTION_MIN_DEPTH_RANGE,
    Number(depthRange?.maxFarDepth) ||
      Number(depthRange?.farDepth) ||
      nearDepth + SCREEN_SELECTION_MIN_DEPTH_RANGE,
  );
  return {
    farDepth: clamp(
      Number(depthRange?.farDepth) || maxFarDepth,
      nearDepth + SCREEN_SELECTION_MIN_DEPTH_RANGE,
      maxFarDepth,
    ),
    maxFarDepth,
    nearDepth,
  };
}

function createPlaneMatrix(sourcePlane) {
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

function createPlaneMatrixFromNormalAndPoint(normal, point) {
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

function normalizeFarPlaneAxes(normal, right, up) {
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
  nearCenter,
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

function createSelectionData({
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

function applySdfMatrix(sdf, matrixArray) {
  new Matrix4()
    .fromArray(matrixArray)
    .decompose(sdf.position, sdf.quaternion, sdf.scale);
  sdf.updateMatrix();
  sdf.updateMatrixWorld(true);
}

function createScreenSelectionSdf(matrixArray) {
  const sdf = new SplatEditSdf({
    type: SplatEditSdfType.PLANE,
    invert: true,
    color: SCREEN_SELECTION_EXCLUDE_COLOR.clone(),
    opacity: 1,
    radius: 0,
  });
  applySdfMatrix(sdf, matrixArray);
  return sdf;
}

function createScreenSelectionSdfs(planeMatrices) {
  return planeMatrices.map((matrix) => createScreenSelectionSdf(matrix));
}

function applyScreenSelectionSdfMatrices(selection) {
  if (
    !selection.sdfs ||
    selection.sdfs.length !== selection.planeMatrices.length
  ) {
    selection.sdfs?.forEach((sdf) => {
      sdf.removeFromParent();
    });
    selection.sdfs = createScreenSelectionSdfs(selection.planeMatrices);
    return;
  }

  selection.sdfs.forEach((sdf, index) => {
    applySdfMatrix(sdf, selection.planeMatrices[index]);
  });
}

function getSelectionTransformDelta(selection, currentTransformMatrix) {
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

function transformPlaneMatrix(matrixArray, transformMatrix) {
  return createPlaneMatrix(
    createPlaneFromMatrix(matrixArray).applyMatrix4(transformMatrix),
  );
}

function getFarDepthRatio(selection) {
  const depthRange = selection.depthRange;
  return depthRange.maxFarDepth > 0
    ? depthRange.farDepth / depthRange.maxFarDepth
    : 1;
}

function createFarHandleLineMaterial({ depthTest, linewidth, opacity = 1 }) {
  return new LineMaterial({
    color: SCREEN_SELECTION_FAR_HANDLE_COLOR,
    depthTest,
    depthWrite: depthTest,
    linewidth,
    opacity,
    transparent: opacity < 1,
  });
}

export function createScreenSelectionFarHandle(selection) {
  const handle = new Group();
  const solidMaterial = createFarHandleLineMaterial({
    depthTest: true,
    linewidth: SCREEN_SELECTION_FAR_HANDLE_LINE_WIDTH,
  });
  const overlayMaterial = createFarHandleLineMaterial({
    depthTest: false,
    linewidth: SCREEN_SELECTION_FAR_HANDLE_LINE_WIDTH,
    opacity: 0.35,
  });
  const solidGuideMaterial = createFarHandleLineMaterial({
    depthTest: true,
    linewidth: SCREEN_SELECTION_FAR_HANDLE_GUIDE_LINE_WIDTH,
  });
  const overlayGuideMaterial = createFarHandleLineMaterial({
    depthTest: false,
    linewidth: SCREEN_SELECTION_FAR_HANDLE_GUIDE_LINE_WIDTH,
    opacity: 0.35,
  });
  const gridGeometry = createFarHandleGridGeometry(selection);
  const guideGeometry = createFarHandleGuideGeometry(selection);
  const solidGrid = new LineSegments2(gridGeometry, solidMaterial);
  const overlayGrid = new LineSegments2(gridGeometry, overlayMaterial);
  const solidGuide = new LineSegments2(guideGeometry, solidGuideMaterial);
  const overlayGuide = new LineSegments2(guideGeometry, overlayGuideMaterial);

  handle.name = `Screen Selection ${selection.id} Far`;
  handle.renderOrder = SCREEN_SELECTION_FAR_HANDLE_RENDER_ORDER;
  handle.userData.screenSelectionFarHandle = true;
  handle.userData.screenSelectionId = selection.id;
  solidGrid.name = `${handle.name} Grid`;
  solidGrid.renderOrder = SCREEN_SELECTION_FAR_HANDLE_RENDER_ORDER;
  overlayGrid.name = `${handle.name} Grid Overlay`;
  overlayGrid.renderOrder = SCREEN_SELECTION_FAR_HANDLE_RENDER_ORDER + 1;
  solidGuide.name = `${handle.name} Guide`;
  solidGuide.renderOrder = SCREEN_SELECTION_FAR_HANDLE_RENDER_ORDER;
  overlayGuide.name = `${handle.name} Guide Overlay`;
  overlayGuide.renderOrder = SCREEN_SELECTION_FAR_HANDLE_RENDER_ORDER + 1;
  handle.add(solidGrid, solidGuide, overlayGrid, overlayGuide);
  selection.farHandle = handle;
  selection.farHandleGridGeometry = gridGeometry;
  selection.farHandleGridOverlay = overlayGrid;
  selection.farHandleGridSolid = solidGrid;
  selection.farHandleGuideGeometry = guideGeometry;
  selection.farHandleGuideOverlay = overlayGuide;
  selection.farHandleGuideSolid = solidGuide;
  updateScreenSelectionFarHandle(selection, true);
  return handle;
}

export function disposeScreenSelectionFarHandle(selection) {
  if (!selection?.farHandle) {
    return;
  }

  selection.farHandle.removeFromParent();
  selection.farHandle.traverse((object) => {
    if (object.material) {
      object.material.dispose();
    }
  });
  selection.farHandleGridGeometry?.dispose();
  selection.farHandleGuideGeometry?.dispose();
  selection.farHandle = null;
  selection.farHandleGridGeometry = null;
  selection.farHandleGridOverlay = null;
  selection.farHandleGridSolid = null;
  selection.farHandleGuideGeometry = null;
  selection.farHandleGuideOverlay = null;
  selection.farHandleGuideSolid = null;
}

export function getScreenSelectionFarDepthFromPosition(
  selection,
  position,
  currentTransformMatrix,
) {
  const delta = getSelectionTransformDelta(selection, currentTransformMatrix);
  selectionTransformInverseDeltaMatrix.copy(delta).invert();
  getSelectionForward(selection);
  cameraPosition.fromArray(selection.cameraPosition);
  return farPoint
    .copy(position)
    .applyMatrix4(selectionTransformInverseDeltaMatrix)
    .sub(cameraPosition)
    .dot(selectionForward);
}

export function updateScreenSelectionFarHandle(
  selection,
  active = false,
  currentTransformMatrix,
) {
  const handle = selection?.farHandle;
  if (!handle) {
    return;
  }

  const delta = getSelectionTransformDelta(selection, currentTransformMatrix);
  getSelectionForward(selection);
  cameraPosition.fromArray(selection.cameraPosition);
  farPlaneRight.fromArray(selection.farPlane.right).normalize();
  farPlaneUp.fromArray(selection.farPlane.up).normalize();
  farPlaneCenterOffset.fromArray(selection.farPlane.centerOffset);
  if (farPlaneCenterOffset.lengthSq() < 1e-12) {
    farPlaneCenterOffset
      .copy(selectionForward)
      .multiplyScalar(selection.depthRange.maxFarDepth);
  }
  farPoint
    .copy(farPlaneCenterOffset)
    .multiplyScalar(getFarDepthRatio(selection))
    .add(cameraPosition)
    .applyMatrix4(delta);
  selectionForward.transformDirection(delta).normalize();
  farPlaneRight.transformDirection(delta).normalize();
  farPlaneUp.transformDirection(delta).normalize();
  if (!normalizeFarPlaneAxes(selectionForward, farPlaneRight, farPlaneUp)) {
    return;
  }
  farPlaneRight.multiplyScalar(SCREEN_SELECTION_FAR_HANDLE_AXIS_DIRECTION);
  selectionForward.multiplyScalar(SCREEN_SELECTION_FAR_HANDLE_AXIS_DIRECTION);

  const matrix = new Matrix4().makeBasis(
    farPlaneRight,
    farPlaneUp,
    selectionForward,
  );
  handle.position.copy(farPoint);
  handle.quaternion.setFromRotationMatrix(matrix);
  handle.scale.set(1, 1, 1);

  updateFarHandleGridGeometry(selection);
  updateFarHandleGuideGeometry(selection);
  selection.farHandleGridOverlay?.scale.set(1, 1, 1);
  selection.farHandleGridSolid?.scale.set(1, 1, 1);
  selection.farHandleGuideOverlay?.scale.set(1, 1, 1);
  selection.farHandleGuideSolid?.scale.set(1, 1, 1);
  handle.visible = !!active;
  handle.updateMatrixWorld(true);
}

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

export function setScreenSelectionEditSelection(edit, selection, style) {
  const hidden = style === true || style === 'exclude';
  edit.sdfs = null;
  edit.clear();
  edit.invert = !!selection;
  edit.rgbaBlendMode = hidden
    ? SplatEditRgbaBlendMode.MULTIPLY
    : SplatEditRgbaBlendMode.SET_RGB;
  if (!selection) {
    return;
  }

  edit.name = hidden
    ? `Screen Selection ${selection.id} Exclude`
    : `Screen Selection ${selection.id} Preview`;
  selection.sdfs.forEach((sdf) => {
    sdf.invert = true;
    if (hidden) {
      sdf.color.copy(SCREEN_SELECTION_HIDDEN_COLOR);
      sdf.opacity = SCREEN_SELECTION_HIDDEN_ALPHA;
    } else {
      sdf.color.copy(SCREEN_SELECTION_EXCLUDE_COLOR);
      sdf.opacity = 1;
    }
    edit.add(sdf);
  });
}

export function createScreenSelectionEdit({ style, hidden, name }) {
  const isHidden = style === 'exclude' || hidden === true;
  return new SplatEdit({
    name,
    rgbaBlendMode: isHidden
      ? SplatEditRgbaBlendMode.MULTIPLY
      : SplatEditRgbaBlendMode.SET_RGB,
    sdfSmooth: 0,
    softEdge: 0,
    invert: false,
  });
}

export function createScreenSelectionPointerTracker({
  camera,
  domElement,
  getDepthRange,
  onSelectionCreated,
  overlayEl,
  rectEl,
}) {
  let active = false;
  let drag = null;

  function clearDrag() {
    drag = null;
    clearOverlay(overlayEl, rectEl);
  }

  function setActive(nextActive) {
    active = !!nextActive;
    if (!active) {
      clearDrag();
    }
  }

  function handlePointerDown(event) {
    if (!active || event.button !== 0) {
      return false;
    }

    const domRect = domElement.getBoundingClientRect();
    getClampedClientPoint(event, domRect, dragStart);
    dragCurrent.copy(dragStart);
    drag = {
      pointerId: event.pointerId,
      start: dragStart.clone(),
      current: dragCurrent.clone(),
    };
    updateOverlayRect(
      overlayEl,
      rectEl,
      getClientSelectionRect(drag.start, drag.current),
    );
    domElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePointerMove(event) {
    if (!active || !drag || event.pointerId !== drag.pointerId) {
      return false;
    }

    const domRect = domElement.getBoundingClientRect();
    getClampedClientPoint(event, domRect, drag.current);
    updateOverlayRect(
      overlayEl,
      rectEl,
      getClientSelectionRect(drag.start, drag.current),
    );
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePointerUp(event) {
    if (!active || !drag || event.pointerId !== drag.pointerId) {
      return false;
    }

    const selection = createSelectionData({
      camera,
      domElement,
      end: drag.current,
      getDepthRange,
      start: drag.start,
    });
    domElement.releasePointerCapture?.(event.pointerId);
    clearDrag();
    onSelectionCreated(selection);
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePointerCancel(event) {
    if (!active || !drag || event.pointerId !== drag.pointerId) {
      return false;
    }

    domElement.releasePointerCapture?.(event.pointerId);
    clearDrag();
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  return {
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    setActive,
  };
}
