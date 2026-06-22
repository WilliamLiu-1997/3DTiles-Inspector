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

export function createSphereSelectionSdf(selection) {
  const sdf = new SplatEditSdf({
    type: SplatEditSdfType.SPHERE,
    invert: false,
    color: SCREEN_SELECTION_EXCLUDE_COLOR.clone(),
    opacity: 1,
    radius: Number(selection?.worldRadius) || 0,
  });
  if (Array.isArray(selection?.worldCenter)) {
    sdf.position.fromArray(selection.worldCenter);
  }
  sdf.updateMatrix();
  sdf.updateMatrixWorld(true);
  return sdf;
}

export function applySphereSelectionSdf(selection) {
  if (!selection) {
    return;
  }
  if (!Array.isArray(selection.sdfs) || selection.sdfs.length !== 1) {
    selection.sdfs?.forEach((sdf) => {
      sdf.removeFromParent();
    });
    selection.sdfs = [createSphereSelectionSdf(selection)];
    return;
  }

  const sdf = selection.sdfs[0];
  sdf.type = SplatEditSdfType.SPHERE;
  sdf.invert = false;
  sdf.radius = Number(selection.worldRadius) || 0;
  if (Array.isArray(selection.worldCenter)) {
    sdf.position.fromArray(selection.worldCenter);
  }
  sdf.scale.setScalar(1);
  sdf.updateMatrix();
  sdf.updateMatrixWorld(true);
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
  const hidden = style === true || style === 'exclude' || style === 'include';
  const sphere = selection?.type === 'sphere';
  edit.sdfs = null;
  edit.clear();
  edit.invert = sphere ? hidden : !!selection;
  edit.rgbaBlendMode = hidden
    ? SplatEditRgbaBlendMode.MULTIPLY
    : SplatEditRgbaBlendMode.SET_RGB;
  if (!selection) {
    return;
  }

  edit.name = hidden
    ? sphere
      ? `Crop Sphere ${selection.id} Include`
      : `Screen Selection ${selection.id} Exclude`
    : sphere
      ? `Crop Sphere ${selection.id} Preview`
      : `Screen Selection ${selection.id} Preview`;
  selection.sdfs.forEach((sdf) => {
    sdf.invert = sphere ? false : true;
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
  const isHidden = style === 'exclude' || style === 'include' || hidden === true;
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
