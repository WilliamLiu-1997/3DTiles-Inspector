import { Color, Matrix4, Plane, Vector2, Vector3 } from 'three';

export const SCREEN_SELECTION_ACTION_EXCLUDE = 'exclude';

export const SCREEN_SELECTION_EXCLUDE_COLOR = new Color(1, 0.82, 0);
export const SCREEN_SELECTION_HIDDEN_COLOR = new Color(1, 1, 1);
export const SCREEN_SELECTION_HIDDEN_ALPHA = 0;
export const SCREEN_SELECTION_FAR_HANDLE_COLOR = 0xffffff;
export const SCREEN_SELECTION_FAR_HANDLE_AXIS_DIRECTION = -1;
export const SCREEN_SELECTION_FAR_HANDLE_RENDER_ORDER = 1000000;
export const SCREEN_SELECTION_FAR_HANDLE_GRID_DIVISIONS = 8;
export const SCREEN_SELECTION_FAR_HANDLE_GUIDE_LINE_WIDTH = 0.5;
export const SCREEN_SELECTION_FAR_HANDLE_LINE_WIDTH = 1;
export const SCREEN_SELECTION_MIN_DRAG_DISTANCE_SQ = 16;
export const SCREEN_SELECTION_MIN_DEPTH_RANGE = 0.001;

export const WORLD_Z = new Vector3(0, 0, 1);
export const UNIT_SCALE = new Vector3(1, 1, 1);

export const IDENTITY_MATRIX4 = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

export const dragStart = new Vector2();
export const dragCurrent = new Vector2();
export const rectScratch = {
  maxX: 0,
  maxY: 0,
  minX: 0,
  minY: 0,
};
export const unprojectPoint = new Vector3();
export const rayDirection = new Vector3();
export const cameraForward = new Vector3();
export const cameraPosition = new Vector3();
export const selectionForward = new Vector3();
export const farPoint = new Vector3();
export const farPlaneRight = new Vector3();
export const farPlaneUp = new Vector3();
export const farPlaneNormal = new Vector3();
export const farPlaneCenterOffset = new Vector3();
export const farPlaneCornerOffset = new Vector3();
export const plane = new Plane();
export const selectionCurrentTransformMatrix = new Matrix4();
export const selectionReferenceTransformMatrix = new Matrix4();
export const selectionReferenceInverseMatrix = new Matrix4();
export const selectionTransformDeltaMatrix = new Matrix4();
export const selectionTransformInverseDeltaMatrix = new Matrix4();
export const transformedPlane = new Plane();

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function copyRect(rect) {
  return {
    maxX: rect.maxX,
    maxY: rect.maxY,
    minX: rect.minX,
    minY: rect.minY,
  };
}

export function copyVectorArray(value, fallback = [0, 0, 0]) {
  return Array.isArray(value) && value.length === 3
    ? value.slice()
    : fallback.slice();
}

export function copyMatrix4Array(value, fallback = IDENTITY_MATRIX4) {
  return Array.isArray(value) && value.length === 16
    ? value.map(Number)
    : fallback.slice();
}

export function copyPlaneCorners(value, width, height) {
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

export function copyFarPlane(value) {
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

export function copyDepthRange(depthRange) {
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

export function getSelectionForward(selection, target = selectionForward) {
  target.fromArray(copyVectorArray(selection?.selectionForward, [0, 0, -1]));
  if (target.lengthSq() < 1e-12) {
    target.set(0, 0, -1);
  }
  return target.normalize();
}

export function getFarDepthRatio(selection) {
  const depthRange = selection.depthRange;
  return depthRange.maxFarDepth > 0
    ? depthRange.farDepth / depthRange.maxFarDepth
    : 1;
}
