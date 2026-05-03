import { TransformControls } from 'three/addons/controls/TransformControls.js';

const TRANSFORM_CONTROL_RENDER_ORDER = 1000002;

function forceOverlayMaterial(material) {
  if (!material) {
    return;
  }

  if (Array.isArray(material)) {
    material.forEach(forceOverlayMaterial);
    return;
  }

  material.depthTest = false;
  material.depthWrite = false;
  material.needsUpdate = true;
}

function forceOverlayRendering(object) {
  object.renderOrder = TRANSFORM_CONTROL_RENDER_ORDER;
  object.traverse((entry) => {
    entry.renderOrder = TRANSFORM_CONTROL_RENDER_ORDER;
    forceOverlayMaterial(entry.material);
  });
}

export function createViewerTransformControls({
  camera,
  cameraController,
  domElement,
  scene,
  transformHandle,
  callbacks,
  getSyncingTransformHandle,
}) {
  const transformControls = new TransformControls(camera, domElement);
  const transformControlsHelper =
    typeof transformControls.getHelper === 'function'
      ? transformControls.getHelper()
      : null;

  if (transformControlsHelper) {
    forceOverlayRendering(transformControlsHelper);
  }
  transformControls.setMode('translate');
  transformControls.setSpace('local');
  transformControls.size = 0.95;
  transformControls.addEventListener('dragging-changed', ({ value }) => {
    cameraController.enabled = !value;
  });
  transformControls.addEventListener('objectChange', () => {
    if (getSyncingTransformHandle()) {
      return;
    }

    if (callbacks.onObjectChange?.(transformControls.object)) {
      return;
    }

    transformHandle.updateMatrix();
    transformHandle.updateMatrixWorld(true);
    callbacks.onRootObjectChange(transformHandle.matrix);
  });
  if (transformControlsHelper) {
    scene.add(transformControlsHelper);
  }

  return {
    transformControls,
    transformControlsHelper,
  };
}
