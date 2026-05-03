import { Group, Matrix4 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

import {
  SCREEN_SELECTION_FAR_HANDLE_AXIS_DIRECTION,
  SCREEN_SELECTION_FAR_HANDLE_COLOR,
  SCREEN_SELECTION_FAR_HANDLE_GRID_DIVISIONS,
  SCREEN_SELECTION_FAR_HANDLE_GUIDE_LINE_WIDTH,
  SCREEN_SELECTION_FAR_HANDLE_LINE_WIDTH,
  SCREEN_SELECTION_FAR_HANDLE_RENDER_ORDER,
  cameraPosition,
  farPlaneCenterOffset,
  farPlaneRight,
  farPlaneUp,
  farPoint,
  getFarDepthRatio,
  getSelectionForward,
  selectionForward,
  selectionTransformInverseDeltaMatrix,
} from './state.js';
import {
  getSelectionTransformDelta,
  normalizeFarPlaneAxes,
} from './geometry.js';

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
