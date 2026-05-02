import { TransformControls } from 'three/addons/controls/TransformControls.js';

export function createViewerTransformControls({
  camera,
  cameraController,
  domElement,
  scene,
  transformHandle,
  callbacks,
  getActiveTransformTarget,
  getCropTransformSnapshot,
  getSelectedCropBox,
  getSyncingTransformHandle,
  setCropTransformSnapshot,
}) {
  const transformControls = new TransformControls(camera, domElement);
  const transformControlsHelper =
    typeof transformControls.getHelper === 'function'
      ? transformControls.getHelper()
      : null;

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

    if (getActiveTransformTarget() === 'crop') {
      callbacks.onCropObjectChange();
      return;
    }

    transformHandle.updateMatrix();
    transformHandle.updateMatrixWorld(true);
    callbacks.onRootObjectChange(transformHandle.matrix);
  });
  transformControls.addEventListener('mouseDown', () => {
    if (getActiveTransformTarget() === 'crop' && getSelectedCropBox()) {
      setCropTransformSnapshot(callbacks.createCropSnapshot());
    }
  });
  transformControls.addEventListener('mouseUp', () => {
    const cropTransformSnapshot = getCropTransformSnapshot();
    if (getActiveTransformTarget() !== 'crop' || !cropTransformSnapshot) {
      setCropTransformSnapshot(null);
      return;
    }

    if (!callbacks.snapshotsEqual(cropTransformSnapshot)) {
      callbacks.pushCropUndoSnapshot(cropTransformSnapshot);
    }
    setCropTransformSnapshot(null);
  });
  if (transformControlsHelper) {
    scene.add(transformControlsHelper);
  }

  return {
    transformControls,
    transformControlsHelper,
  };
}
