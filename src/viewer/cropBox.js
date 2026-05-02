import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  Group,
  Matrix4,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { SplatEditSdf, SplatEditSdfType } from '@sparkjsdev/spark';
import { composeMatrix } from './viewerUtils.js';

export const CROP_BOX_MIN_HALF_SIZE = 0.01;
export const CROP_BOX_DEFAULT_HALF_SIZE = 10;
export const DEFAULT_CROP_TRANSFORM_MODE = 'scale';

const CROP_BOX_SELECTED_COLOR = 0xffcf33;
const CROP_BOX_DEFAULT_COLOR = 0x8f8f8f;
const CROP_BOX_LINE_WIDTH = 1.5;
const CROP_BOX_SELECTED_LINE_WIDTH = 2;
const CROP_BOX_OVERLAY_OPACITY = 0.1;
const CROP_BOX_SELECTED_OVERLAY_OPACITY = 0.2;

export function createCropBoxLineGeometry() {
  const boxGeometry = new BoxGeometry(2, 2, 2);
  const edgesGeometry = new EdgesGeometry(boxGeometry);
  const lineGeometry = new LineSegmentsGeometry().fromEdgesGeometry(
    edgesGeometry,
  );
  boxGeometry.dispose();
  edgesGeometry.dispose();
  return lineGeometry;
}

export function syncCropBoxSdf(box) {
  box.root.updateMatrix();
  box.root.updateMatrixWorld(true);
  box.root.matrixWorld.decompose(
    box.sdf.position,
    box.sdf.quaternion,
    box.sdf.scale,
  );
  box.sdf.updateMatrix();
  box.sdf.updateMatrixWorld(true);
}

export function normalizeCropBoxTransform(box) {
  box.root.scale.set(
    Math.max(Math.abs(box.root.scale.x), CROP_BOX_MIN_HALF_SIZE),
    Math.max(Math.abs(box.root.scale.y), CROP_BOX_MIN_HALF_SIZE),
    Math.max(Math.abs(box.root.scale.z), CROP_BOX_MIN_HALF_SIZE),
  );
  box.root.updateMatrix();
  box.root.updateMatrixWorld(true);
}

export function setCropBoxSelectedStyle(box, selected) {
  const color = selected ? CROP_BOX_SELECTED_COLOR : CROP_BOX_DEFAULT_COLOR;
  const linewidth = selected
    ? CROP_BOX_SELECTED_LINE_WIDTH
    : CROP_BOX_LINE_WIDTH;

  box.edges.material.color.setHex(color);
  box.edges.material.linewidth = linewidth;
  box.overlayEdges.material.color.setHex(color);
  box.overlayEdges.material.opacity = selected
    ? CROP_BOX_SELECTED_OVERLAY_OPACITY
    : CROP_BOX_OVERLAY_OPACITY;
  box.overlayEdges.material.linewidth = linewidth;
}

export function createCropBox({ id, matrix, lineGeometry }) {
  const root = new Group();
  root.name = `Crop Box ${id}`;
  root.userData.cropBoxId = id;

  const edges = new LineSegments2(
    lineGeometry,
    new LineMaterial({
      color: CROP_BOX_DEFAULT_COLOR,
      linewidth: CROP_BOX_LINE_WIDTH,
      transparent: false,
    }),
  );
  edges.userData.cropBoxId = id;

  const overlayEdges = new LineSegments2(
    lineGeometry,
    new LineMaterial({
      color: CROP_BOX_DEFAULT_COLOR,
      depthTest: false,
      depthWrite: false,
      linewidth: CROP_BOX_LINE_WIDTH,
      opacity: CROP_BOX_OVERLAY_OPACITY,
      transparent: true,
    }),
  );
  overlayEdges.renderOrder = Infinity;
  overlayEdges.userData.cropBoxId = id;
  root.add(edges);
  root.add(overlayEdges);

  const sdf = new SplatEditSdf({
    type: SplatEditSdfType.BOX,
    color: new Color(0xffffff),
    opacity: 0,
    radius: 0,
  });

  const box = {
    edges,
    id,
    overlayEdges,
    root,
    sdf,
  };

  composeMatrix(root, new Matrix4().fromArray(matrix));
  normalizeCropBoxTransform(box);
  syncCropBoxSdf(box);
  return box;
}

export function disposeCropBox(box) {
  box.sdf.removeFromParent();
  box.root.removeFromParent();
  box.edges.material.dispose();
  box.overlayEdges.material.dispose();
}
