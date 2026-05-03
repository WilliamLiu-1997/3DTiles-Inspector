import { Matrix4 } from 'three';
import {
  SplatEdit,
  SplatEditRgbaBlendMode,
  SplatEditSdf,
  SplatEditSdfType,
} from '@sparkjsdev/spark';

import {
  SCREEN_SELECTION_EXCLUDE_COLOR,
  SCREEN_SELECTION_HIDDEN_ALPHA,
  SCREEN_SELECTION_HIDDEN_COLOR,
} from './state.js';

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

export function createScreenSelectionSdfs(planeMatrices) {
  return planeMatrices.map((matrix) => createScreenSelectionSdf(matrix));
}

export function applyScreenSelectionSdfMatrices(selection) {
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
