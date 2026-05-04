import {
  MathUtils,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three';
import { CAMERA_CENTER_MODE_DISTANCE_SQ } from '../config.js';

const _matrix = new Matrix4();
const _matrix1 = new Matrix4();
const _flyDirectionStart = new Vector3();
const _flyDirectionEnd = new Vector3();
const _flyDirection = new Vector3();
const _flyAxis = new Vector3();
const _flyWorldNorth = new Vector3(0, 0, 1);
const _flyWorldRight = new Vector3(1, 0, 0);
const _flyCenterNorth = new Vector3(0, 1, 0);
const _flyCenterUp = new Vector3(0, 0, 1);
const _flyWorldUp = new Vector3(0, 1, 0);
const _flyUp = new Vector3();
const _flyEast = new Vector3();
const _flyNorth = new Vector3();
const _flyForward = new Vector3();
const _flyRight = new Vector3();
const _flyBackward = new Vector3();
const _flyCameraUp = new Vector3();
const _flyCameraRight = new Vector3();
const _flyReferenceUp = new Vector3();
const _flyReferenceRight = new Vector3();
const _flyQuaternion = new Quaternion();
const _ellipsoidRadii = new Vector3(
  6378137.0,
  6378137.0,
  6356752.3142451793,
);
const _oneOverRadiiSquared = new Vector3(
  1 / (_ellipsoidRadii.x * _ellipsoidRadii.x),
  1 / (_ellipsoidRadii.y * _ellipsoidRadii.y),
  1 / (_ellipsoidRadii.z * _ellipsoidRadii.z),
);
const _geoEast = new Vector3();
const _geoNorth = new Vector3();
const _geoUp = new Vector3();
const UPRIGHT_ROLL_THRESHOLD = MathUtils.degToRad(5);
const ROLL_UNDEFINED_DOT_THRESHOLD = Math.cos(MathUtils.degToRad(5));
const HEADING_RIGHT_DEGENERATE_EPSILON = 1e-6;

function eastNorthUpToFixedFrame(origin) {
  _geoUp.copy(origin).multiply(_oneOverRadiiSquared).normalize();
  _geoEast.set(0, 0, 1).cross(_geoUp).normalize();
  _geoNorth.copy(_geoUp).cross(_geoEast).normalize();

  return _matrix.set(
    _geoEast.x,
    _geoNorth.x,
    _geoUp.x,
    origin.x,
    _geoEast.y,
    _geoNorth.y,
    _geoUp.y,
    origin.y,
    _geoEast.z,
    _geoNorth.z,
    _geoUp.z,
    origin.z,
    0,
    0,
    0,
    1,
  );
}

export function createCameraFlight(
  camera,
  position,
  target,
  options = {},
) {
  const duration = options.duration ?? 2500;
  const endPosition = position.clone();
  const endQuaternion = getEndQuaternion(endPosition, target, options);
  const endPose = getUprightHeadingPitchAtPose(endPosition, endQuaternion);
  const endRoll = getRollAtPose(endPosition, endQuaternion);
  const endZoom =
    camera instanceof OrthographicCamera
      ? Math.max(options.endZoom ?? camera.zoom, 1e-6)
      : null;
  return buildFlightState(camera, {
    duration,
    endPosition,
    endQuaternion,
    endZoom,
    endHeading: endPose.heading,
    endPitch: endPose.pitch,
    endRoll,
  });
}

export function createCameraPoseFlight(
  camera,
  position,
  options,
) {
  const duration = options.duration ?? 2500;
  const endPosition = position.clone();
  const endQuaternion = getHeadingPitchRollQuaternion(
    endPosition,
    options.heading,
    options.pitch,
    options.roll ?? 0,
  );
  const endRoll = options.roll ?? getRollAtPose(endPosition, endQuaternion);
  const endZoom =
    camera instanceof OrthographicCamera
      ? Math.max(options.endZoom ?? camera.zoom, 1e-6)
      : null;
  return buildFlightState(camera, {
    duration,
    endPosition,
    endQuaternion,
    endZoom,
    endHeading: options.heading,
    endPitch: options.pitch,
    endRoll,
  });
}

export function getFlyToParamsFromBoundingSphere(
  camera,
  target,
  radius,
  options = {},
) {
  const safeRadius = Math.max(radius, 1);
  let offsetDistance = safeRadius;
  let endZoom = options.endZoom;
  if (camera instanceof PerspectiveCamera) {
    const verticalFov = MathUtils.degToRad(camera.fov);
    const horizontalFov =
      2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const minHalfFov = Math.max(0.1, Math.min(verticalFov, horizontalFov) / 2);
    offsetDistance = safeRadius / Math.sin(minHalfFov) + safeRadius * 0.75;
  } else if (camera instanceof OrthographicCamera) {
    const visibleHeight = Math.max(safeRadius * 2.8, 1);
    endZoom = (camera.top - camera.bottom) / visibleHeight;
    offsetDistance = Math.max(safeRadius * 2, visibleHeight * 0.5);
  }

  const position = getBoundingSphereFlyToPosition(
    camera,
    target,
    offsetDistance,
    options,
  );

  return {
    position,
    target: target.clone(),
    options: {
      ...options,
      endZoom,
    },
  };
}

export function flyTo(
  camera,
  flight,
  time,
) {
  if (flight.startTime === null) {
    flight.startTime = time;
  }

  const rawT = MathUtils.clamp(
    (time - flight.startTime) / flight.duration,
    0,
    1,
  );
  const easedT =
    rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

  const position = getFlyToPosition(flight, easedT);
  const quaternion = flight.maintainUpright
    ? getUprightInterpolatedQuaternion(flight, position, easedT)
    : _flyQuaternion.slerpQuaternions(
        flight.startQuaternion,
        flight.endQuaternion,
        easedT,
      );
  const zoom =
    flight.startZoom !== null && flight.endZoom !== null
      ? MathUtils.lerp(flight.startZoom, flight.endZoom, easedT)
      : null;

  applyFlyToPose(camera, position, quaternion, zoom);
  return rawT === 1;
}

function getFlyToPosition(flight, t) {
  const { startPosition, endPosition, arcHeight } = flight;
  const startLength = startPosition.length();
  const endLength = endPosition.length();

  if (startLength < 1e-6 || endLength < 1e-6) {
    return _flyDirection.lerpVectors(startPosition, endPosition, t);
  }

  _flyDirectionStart.copy(startPosition).divideScalar(startLength);
  _flyDirectionEnd.copy(endPosition).divideScalar(endLength);

  const angle = _flyDirectionStart.angleTo(_flyDirectionEnd);
  if (angle > 1e-5) {
    if (angle < Math.PI - 1e-5) {
      _flyAxis.crossVectors(_flyDirectionStart, _flyDirectionEnd).normalize();
    } else {
      _flyAxis.crossVectors(_flyDirectionStart, _flyWorldUp);
      if (_flyAxis.lengthSq() < 1e-6) {
        _flyAxis.crossVectors(_flyDirectionStart, _flyWorldNorth);
      }
      _flyAxis.normalize();
    }
    _flyDirection
      .copy(_flyDirectionStart)
      .applyAxisAngle(_flyAxis, angle * t)
      .normalize();
  } else {
    _flyDirection.copy(_flyDirectionStart);
  }

  const radius =
    MathUtils.lerp(startLength, endLength, t) +
    Math.sin(Math.PI * t) * arcHeight;
  return _flyDirection.multiplyScalar(radius);
}

function getUprightInterpolatedQuaternion(
  flight,
  position,
  t,
) {
  const heading = lerpAngle(flight.startHeading, flight.endHeading, t);
  const pitch = MathUtils.lerp(flight.startPitch, flight.endPitch, t);
  return getHeadingPitchRollQuaternion(position, heading, pitch, 0);
}

function buildFlightState(
  camera,
  {
    duration,
    endPosition,
    endQuaternion,
    endZoom,
    endHeading,
    endPitch,
    endRoll,
  },
) {
  const startPosition = camera.position.clone();
  const startQuaternion = camera.quaternion.clone();
  const startPose = getUprightHeadingPitchAtPose(
    startPosition,
    startQuaternion,
  );
  const startRoll = getRollAtPose(startPosition, startQuaternion);
  const startZoom = camera instanceof OrthographicCamera ? camera.zoom : null;

  if (
    isImmediateFlight(
      duration,
      startPosition,
      endPosition,
      startQuaternion,
      endQuaternion,
      startZoom,
      endZoom,
    )
  ) {
    applyFlyToPose(camera, endPosition, endQuaternion, endZoom);
    return null;
  }

  return {
    startTime: null,
    duration,
    startPosition,
    endPosition,
    startQuaternion,
    endQuaternion,
    startZoom,
    endZoom,
    arcHeight: getArcHeight(startPosition, endPosition),
    maintainUpright: shouldMaintainUpright(startRoll, endRoll),
    startHeading: startPose.heading,
    endHeading,
    startPitch: startPose.pitch,
    endPitch,
  };
}

function isImmediateFlight(
  duration,
  startPosition,
  endPosition,
  startQuaternion,
  endQuaternion,
  startZoom,
  endZoom,
) {
  return (
    duration <= 0 ||
    (startPosition.distanceToSquared(endPosition) < 1e-6 &&
      startQuaternion.angleTo(endQuaternion) < 1e-6 &&
      (startZoom === null ||
        endZoom === null ||
        Math.abs(startZoom - endZoom) < 1e-6))
  );
}

function getArcHeight(startPosition, endPosition) {
  const chordLength = startPosition.distanceTo(endPosition);
  return Math.max(
    chordLength * 0.35,
    Math.abs(endPosition.length() - startPosition.length()) * 0.5,
    500,
  );
}

function shouldMaintainUpright(startRoll, endRoll) {
  return (
    Math.abs(startRoll) <= UPRIGHT_ROLL_THRESHOLD &&
    Math.abs(endRoll) <= UPRIGHT_ROLL_THRESHOLD
  );
}

function getLookAtQuaternion(position, target) {
  if (isCenterModePosition(position)) {
    _matrix.lookAt(position, target, _flyCenterUp);
    return new Quaternion().setFromRotationMatrix(_matrix);
  }

  _flyUp.copy(target);
  if (_flyUp.lengthSq() < 1e-6) {
    _flyUp.copy(_flyWorldUp);
  } else {
    _flyUp.normalize();
  }

  _flyEast.crossVectors(_flyWorldNorth, _flyUp);
  if (_flyEast.lengthSq() < 1e-6) {
    _flyEast.crossVectors(_flyWorldUp, _flyUp);
  }
  if (_flyEast.lengthSq() < 1e-6) {
    _flyEast.set(1, 0, 0);
  }
  _flyEast.normalize();
  _flyUp.crossVectors(_flyUp, _flyEast).normalize();

  _matrix.lookAt(position, target, _flyUp);
  return new Quaternion().setFromRotationMatrix(_matrix);
}

function getForwardFromQuaternion(quaternion, target) {
  return target.set(0, 0, -1).applyQuaternion(quaternion).normalize();
}

function getUprightHeadingPitchAtPose(
  position,
  quaternion,
) {
  if (isCenterModePosition(position)) {
    const forward = getForwardFromQuaternion(quaternion, _flyForward);
    _flyCameraRight.set(1, 0, 0).applyQuaternion(quaternion);
    _flyReferenceRight.copy(_flyCameraRight).projectOnPlane(_flyCenterUp);

    let heading = 0;
    if (_flyReferenceRight.lengthSq() > HEADING_RIGHT_DEGENERATE_EPSILON) {
      _flyReferenceRight.normalize();
      heading = Math.atan2(
        -_flyReferenceRight.dot(_flyCenterNorth),
        _flyReferenceRight.dot(_flyWorldRight),
      );
    } else {
      const horizontalForward = _flyDirection
        .copy(forward)
        .projectOnPlane(_flyCenterUp);
      if (horizontalForward.lengthSq() > HEADING_RIGHT_DEGENERATE_EPSILON) {
        horizontalForward.normalize();
        heading = Math.atan2(
          horizontalForward.dot(_flyWorldRight),
          horizontalForward.dot(_flyCenterNorth),
        );
      }
    }

    return {
      heading,
      pitch: Math.asin(MathUtils.clamp(forward.dot(_flyCenterUp), -1, 1)),
    };
  }

  if (position.lengthSq() < 1e-6) {
    return {
      heading: 0,
      pitch: 0,
    };
  }

  const forward = getForwardFromQuaternion(quaternion, _flyForward);
  getLocalFrame(position);

  _flyCameraRight.set(1, 0, 0).applyQuaternion(quaternion);
  _flyReferenceRight.copy(_flyCameraRight).projectOnPlane(_flyUp);

  let heading = 0;
  if (_flyReferenceRight.lengthSq() > HEADING_RIGHT_DEGENERATE_EPSILON) {
    _flyReferenceRight.normalize();
    heading = Math.atan2(
      -_flyReferenceRight.dot(_flyNorth),
      _flyReferenceRight.dot(_flyEast),
    );
  } else {
    const horizontalForward = _flyDirection
      .copy(forward)
      .projectOnPlane(_flyUp);
    if (horizontalForward.lengthSq() > HEADING_RIGHT_DEGENERATE_EPSILON) {
      horizontalForward.normalize();
      heading = Math.atan2(
        horizontalForward.dot(_flyEast),
        horizontalForward.dot(_flyNorth),
      );
    }
  }

  return {
    heading,
    pitch: Math.asin(MathUtils.clamp(forward.dot(_flyUp), -1, 1)),
  };
}

function getRollAtPose(position, quaternion) {
  const forward = getForwardFromQuaternion(quaternion, _flyForward);
  if (isCenterModePosition(position)) {
    if (Math.abs(forward.dot(_flyCenterUp)) >= ROLL_UNDEFINED_DOT_THRESHOLD) {
      return 0;
    }

    getReferenceBasis(
      forward,
      _flyWorldRight,
      _flyCenterUp,
      _flyReferenceRight,
      _flyReferenceUp,
    );
  } else {
    if (position.lengthSq() < 1e-6) {
      return 0;
    }

    getLocalFrame(position);
    if (Math.abs(forward.dot(_flyUp)) >= ROLL_UNDEFINED_DOT_THRESHOLD) {
      return 0;
    }

    getReferenceBasis(
      forward,
      _flyEast,
      _flyUp,
      _flyReferenceRight,
      _flyReferenceUp,
    );
  }

  _flyReferenceUp.projectOnPlane(forward);
  _flyCameraUp.set(0, 1, 0).applyQuaternion(quaternion).projectOnPlane(forward);

  if (_flyReferenceUp.lengthSq() < 1e-6 || _flyCameraUp.lengthSq() < 1e-6) {
    return 0;
  }

  _flyReferenceUp.normalize();
  _flyCameraUp.normalize();

  return Math.atan2(
    _flyDirection.crossVectors(_flyReferenceUp, _flyCameraUp).dot(forward),
    _flyReferenceUp.dot(_flyCameraUp),
  );
}

function getEndQuaternion(
  position,
  target,
  options,
) {
  const { heading, pitch, roll } = options;
  if (heading === undefined && pitch === undefined && roll === undefined) {
    return getLookAtQuaternion(position, target);
  }

  if (heading === undefined && pitch === undefined) {
    const quaternion = getLookAtQuaternion(position, target);
    if (roll) {
      _flyForward.subVectors(target, position).normalize();
      quaternion.multiply(_flyQuaternion.setFromAxisAngle(_flyForward, roll));
    }
    return quaternion;
  }

  return getHeadingPitchRollQuaternion(
    isCenterModePosition(position) ? position : target,
    heading ?? 0,
    pitch ?? -Math.PI / 2,
    roll ?? 0,
  );
}

function getBoundingSphereFlyToPosition(
  camera,
  target,
  range,
  options,
) {
  const { heading, pitch } = options;
  if (heading === undefined && pitch === undefined) {
    const direction =
      target.lengthSq() > 1e-6
        ? _flyDirection.copy(target).normalize()
        : camera.position.lengthSq() > 1e-6
          ? _flyDirection.copy(camera.position).normalize()
          : _flyDirection.set(0, -1, 0);
    return direction.multiplyScalar(range).add(target);
  }

  const resolvedHeading = heading ?? 0;
  const resolvedPitch = pitch ?? -Math.PI / 2;
  const centerForward = getCenterModeHeadingPitchRollForward(
    resolvedHeading,
    resolvedPitch,
  );
  const centerPosition = _flyDirection
    .copy(target)
    .addScaledVector(centerForward, -range);
  if (isCenterModePosition(centerPosition)) {
    return centerPosition;
  }

  const forward = getHeadingPitchRollForward(
    target,
    resolvedHeading,
    resolvedPitch,
  );
  return _flyDirection.copy(target).addScaledVector(forward, -range);
}

function getHeadingPitchRollQuaternion(
  referencePoint,
  heading,
  pitch,
  roll,
) {
  if (isCenterModePosition(referencePoint)) {
    getCenterModeHeadingPitchRollBasis(heading, pitch, roll);
    _matrix1.makeBasis(_flyRight, _flyUp, _flyBackward);
    return new Quaternion().setFromRotationMatrix(_matrix1);
  }

  if (referencePoint.lengthSq() < 1e-6) {
    return new Quaternion();
  }

  getHeadingPitchRollBasis(referencePoint, heading, pitch, roll);
  _matrix1.makeBasis(_flyRight, _flyUp, _flyBackward);
  return new Quaternion().setFromRotationMatrix(_matrix1);
}

function getHeadingPitchRollForward(
  referencePoint,
  heading,
  pitch,
) {
  if (isCenterModePosition(referencePoint)) {
    return getCenterModeHeadingPitchRollForward(heading, pitch);
  }

  if (referencePoint.lengthSq() < 1e-6) {
    return _flyForward.set(0, 0, -1);
  }

  getLocalFrame(referencePoint);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosHeading = Math.cos(heading);
  const sinHeading = Math.sin(heading);

  _flyForward
    .copy(_flyNorth)
    .multiplyScalar(cosHeading * cosPitch)
    .addScaledVector(_flyEast, sinHeading * cosPitch)
    .addScaledVector(_flyUp, sinPitch)
    .normalize();

  return _flyForward;
}

function getCenterModeHeadingPitchRollForward(
  heading,
  pitch,
) {
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosHeading = Math.cos(heading);
  const sinHeading = Math.sin(heading);

  _flyForward.set(
    sinHeading * cosPitch,
    cosHeading * cosPitch,
    sinPitch,
  );

  return _flyForward.normalize();
}

function getHeadingPitchRollBasis(
  referencePoint,
  heading,
  pitch,
  roll,
) {
  if (isCenterModePosition(referencePoint)) {
    getCenterModeHeadingPitchRollBasis(heading, pitch, roll);
    return;
  }

  getHeadingPitchRollForward(referencePoint, heading, pitch);

  _flyRight
    .copy(_flyEast)
    .multiplyScalar(Math.cos(heading))
    .addScaledVector(_flyNorth, -Math.sin(heading))
    .normalize();
  _flyUp.crossVectors(_flyRight, _flyForward).normalize();

  if (roll !== 0) {
    _flyRight.applyAxisAngle(_flyForward, roll).normalize();
    _flyUp.applyAxisAngle(_flyForward, roll).normalize();
  }

  _flyBackward.copy(_flyForward).negate();
}

function getCenterModeHeadingPitchRollBasis(
  heading,
  pitch,
  roll,
) {
  getCenterModeHeadingPitchRollForward(heading, pitch);

  _flyRight
    .copy(_flyWorldRight)
    .multiplyScalar(Math.cos(heading))
    .addScaledVector(_flyCenterNorth, -Math.sin(heading))
    .normalize();
  _flyUp.crossVectors(_flyRight, _flyForward).normalize();

  if (roll !== 0) {
    _flyRight.applyAxisAngle(_flyForward, roll).normalize();
    _flyUp.applyAxisAngle(_flyForward, roll).normalize();
  }

  _flyBackward.copy(_flyForward).negate();
}

function getLocalFrame(target) {
  _matrix1.copy(eastNorthUpToFixedFrame(target));
  _flyEast.setFromMatrixColumn(_matrix1, 0).normalize();
  _flyNorth.setFromMatrixColumn(_matrix1, 1).normalize();
  _flyUp.setFromMatrixColumn(_matrix1, 2).normalize();
}

function isCenterModePosition(position) {
  return position.lengthSq() <= CAMERA_CENTER_MODE_DISTANCE_SQ;
}

function getReferenceBasis(
  forward,
  east,
  up,
  rightTarget,
  upTarget,
) {
  rightTarget.crossVectors(forward, up);
  if (rightTarget.lengthSq() < 1e-6) {
    rightTarget.copy(east).projectOnPlane(forward);
    if (rightTarget.lengthSq() < 1e-6) {
      rightTarget.set(1, 0, 0).projectOnPlane(forward);
    }
  }
  rightTarget.normalize();
  upTarget.crossVectors(rightTarget, forward).normalize();
}

function lerpAngle(start, end, t) {
  let delta = end - start;
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }

  return start + delta * t;
}

function applyFlyToPose(
  camera,
  position,
  quaternion,
  zoom = null,
) {
  camera.position.copy(position);
  camera.quaternion.copy(quaternion);

  if (camera instanceof OrthographicCamera && zoom !== null) {
    camera.zoom = Math.max(zoom, 1e-6);
    camera.updateProjectionMatrix();
  }

  camera.updateMatrixWorld();
}
