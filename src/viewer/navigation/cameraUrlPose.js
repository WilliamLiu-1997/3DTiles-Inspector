const CAMERA_POSE_PARAM = 'camerapose';
const CAMERA_POSE_ALIAS_PARAM = 'cameraPose';
const CAMERA_POSE_COMPONENT_COUNT = 7;
const CAMERA_POSE_COMPONENT_COUNT_WITH_ZOOM = 8;
const CAMERA_POSE_UPDATE_INTERVAL_MS = 100;
const CAMERA_POSE_VALUE_SEPARATOR = '_';

function formatPoseNumber(value) {
  const fixed = value.toFixed(9);
  const trimmed = fixed
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '');

  return trimmed === '-0' ? '0' : trimmed;
}

function serializeCameraPose(camera) {
  camera.updateMatrixWorld(true);

  const values = [
    camera.position.x,
    camera.position.y,
    camera.position.z,
    camera.quaternion.x,
    camera.quaternion.y,
    camera.quaternion.z,
    camera.quaternion.w,
  ];

  if (camera.isOrthographicCamera) {
    values.push(camera.zoom);
  }

  if (!values.every(Number.isFinite)) {
    return null;
  }

  return values.map(formatPoseNumber).join(CAMERA_POSE_VALUE_SEPARATOR);
}

function getCameraPoseParam(url) {
  return (
    url.searchParams.get(CAMERA_POSE_PARAM) ??
    url.searchParams.get(CAMERA_POSE_ALIAS_PARAM)
  );
}

function parseCameraPose(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const parts = value.trim().split(/[,_\s]+/).filter(Boolean);
  if (
    parts.length !== CAMERA_POSE_COMPONENT_COUNT &&
    parts.length !== CAMERA_POSE_COMPONENT_COUNT_WITH_ZOOM
  ) {
    return null;
  }

  const values = parts.map(Number);
  if (!values.every(Number.isFinite)) {
    return null;
  }

  const quaternionLength = Math.hypot(
    values[3],
    values[4],
    values[5],
    values[6],
  );
  if (quaternionLength <= 1e-12) {
    return null;
  }

  const zoom = values.length === CAMERA_POSE_COMPONENT_COUNT_WITH_ZOOM
    ? values[7]
    : null;
  if (zoom !== null && zoom <= 0) {
    return null;
  }

  return {
    position: values.slice(0, 3),
    quaternion: values.slice(3, 7),
    zoom,
  };
}

function replaceCameraPoseUrl(serializedPose) {
  const url = new URL(window.location.href);
  url.searchParams.delete(CAMERA_POSE_ALIAS_PARAM);
  url.searchParams.set(CAMERA_POSE_PARAM, serializedPose);
  window.history.replaceState(window.history.state, '', url.href);
}

function getInvalidCameraPoseMessage() {
  return 'Invalid camerapose URL parameter ignored. Expected x_y_z_qx_qy_qz_qw.';
}

export function createCameraUrlPoseController({
  camera,
  cameraController,
  setStatus,
}) {
  let lastSerializedPose = null;
  let lastUrlWriteTime = 0;

  function applyPose(pose) {
    camera.position.fromArray(pose.position);
    camera.quaternion.fromArray(pose.quaternion).normalize();

    if (pose.zoom !== null && camera.isOrthographicCamera) {
      camera.zoom = Math.max(pose.zoom, 1e-6);
      camera.updateProjectionMatrix();
    }

    camera.updateMatrixWorld(true);
    cameraController.setCamera(camera);
  }

  function applyFromUrl({ showStatus = false } = {}) {
    const url = new URL(window.location.href);
    const value = getCameraPoseParam(url);
    if (value === null) {
      return false;
    }

    const pose = parseCameraPose(value);
    if (!pose) {
      if (showStatus && setStatus) {
        setStatus(getInvalidCameraPoseMessage(), true);
      }
      return false;
    }

    applyPose(pose);
    lastSerializedPose = serializeCameraPose(camera);
    lastUrlWriteTime = performance.now();
    if (lastSerializedPose) {
      replaceCameraPoseUrl(lastSerializedPose);
    }
    if (showStatus && setStatus) {
      setStatus('Applied camera pose from URL.');
    }
    return true;
  }

  function flush() {
    const serializedPose = serializeCameraPose(camera);
    if (!serializedPose || serializedPose === lastSerializedPose) {
      return;
    }

    replaceCameraPoseUrl(serializedPose);
    lastSerializedPose = serializedPose;
    lastUrlWriteTime = performance.now();
  }

  function update(time = performance.now()) {
    if (time - lastUrlWriteTime < CAMERA_POSE_UPDATE_INTERVAL_MS) {
      return;
    }
    flush();
  }

  return {
    applyFromUrl,
    flush,
    update,
  };
}
