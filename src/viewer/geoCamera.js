import {
  MathUtils,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three';

const WORLD_RIGHT = new Vector3(1, 0, 0);
const CENTER_NORTH = new Vector3(0, 1, 0);

export function createGeoCameraController({
  camera,
  centerModeDistanceSq,
  getActiveEllipsoid,
}) {
  const cartographicTarget = {
    height: 0,
    lat: 0,
    lon: 0,
  };
  const basis = new Matrix4();
  const position = new Vector3();
  const east = new Vector3();
  const north = new Vector3();
  const up = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const backward = new Vector3();
  const quaternion = new Quaternion();

  function isCenterModePosition(value) {
    return value.lengthSq() <= centerModeDistanceSq;
  }

  function getLocalFrame(referencePoint) {
    const ellipsoid = getActiveEllipsoid();
    ellipsoid.getPositionToCartographic(referencePoint, cartographicTarget);
    ellipsoid.getEastNorthUpFrame(
      cartographicTarget.lat,
      cartographicTarget.lon,
      cartographicTarget.height,
      basis,
    );
    east.setFromMatrixColumn(basis, 0).normalize();
    north.setFromMatrixColumn(basis, 1).normalize();
    up.setFromMatrixColumn(basis, 2).normalize();
  }

  function getCoordinateWorldPosition(latitude, longitude, height, target) {
    const ellipsoid = getActiveEllipsoid();
    return ellipsoid.getCartographicToPosition(
      MathUtils.degToRad(latitude),
      MathUtils.degToRad(longitude),
      height,
      target,
    );
  }

  function getCoordinateTransform(latitude, longitude, height, target) {
    const ellipsoid = getActiveEllipsoid();
    return ellipsoid.getEastNorthUpFrame(
      MathUtils.degToRad(latitude),
      MathUtils.degToRad(longitude),
      height,
      target,
    );
  }

  function getCartographicFromWorldPosition(worldPosition) {
    const ellipsoid = getActiveEllipsoid();
    if (!ellipsoid) {
      return null;
    }

    ellipsoid.getPositionToCartographic(worldPosition, cartographicTarget);
    return {
      height: cartographicTarget.height,
      latitude: MathUtils.radToDeg(cartographicTarget.lat),
      longitude: MathUtils.radToDeg(cartographicTarget.lon),
    };
  }

  function getLocalFrameQuaternion(referencePoint, target) {
    if (
      referencePoint.lengthSq() < centerModeDistanceSq ||
      !getActiveEllipsoid()
    ) {
      return target.identity();
    }

    getLocalFrame(referencePoint);
    basis.makeBasis(east, north, up);
    return target.setFromRotationMatrix(basis);
  }

  function getCameraDistanceForBoundingSphere(radius) {
    const verticalHalfFov = MathUtils.degToRad(camera.fov) * 0.5;
    const horizontalHalfFov = Math.atan(
      Math.tan(verticalHalfFov) * camera.aspect,
    );
    const limitingHalfFov = Math.max(
      Math.min(verticalHalfFov, horizontalHalfFov),
      1e-3,
    );

    return Math.max(radius / Math.sin(limitingHalfFov), 1);
  }

  function getCenterModeHeadingPitchRollForward(heading, pitch) {
    const cosPitch = Math.cos(pitch);
    forward.set(
      Math.sin(heading) * cosPitch,
      Math.cos(heading) * cosPitch,
      Math.sin(pitch),
    );
    return forward.normalize();
  }

  function getHeadingPitchRollForward(referencePoint, heading, pitch) {
    if (isCenterModePosition(referencePoint)) {
      return getCenterModeHeadingPitchRollForward(heading, pitch);
    }
    if (referencePoint.lengthSq() < 1e-6) {
      return forward.set(0, 0, -1);
    }

    getLocalFrame(referencePoint);

    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const cosHeading = Math.cos(heading);
    const sinHeading = Math.sin(heading);

    forward
      .copy(north)
      .multiplyScalar(cosHeading * cosPitch)
      .addScaledVector(east, sinHeading * cosPitch)
      .addScaledVector(up, sinPitch)
      .normalize();

    return forward;
  }

  function getCenterModeHeadingPitchRollBasis(heading, pitch, roll) {
    getCenterModeHeadingPitchRollForward(heading, pitch);

    right
      .copy(WORLD_RIGHT)
      .multiplyScalar(Math.cos(heading))
      .addScaledVector(CENTER_NORTH, -Math.sin(heading))
      .normalize();
    up.crossVectors(right, forward).normalize();

    if (roll !== 0) {
      right.applyAxisAngle(forward, roll).normalize();
      up.applyAxisAngle(forward, roll).normalize();
    }

    backward.copy(forward).negate();
  }

  function getHeadingPitchRollQuaternion(referencePoint, heading, pitch, roll) {
    if (isCenterModePosition(referencePoint)) {
      getCenterModeHeadingPitchRollBasis(heading, pitch, roll);
    } else if (referencePoint.lengthSq() < 1e-6) {
      quaternion.identity();
      return quaternion;
    } else {
      getHeadingPitchRollForward(referencePoint, heading, pitch);
      right
        .copy(east)
        .multiplyScalar(Math.cos(heading))
        .addScaledVector(north, -Math.sin(heading))
        .normalize();
      up.crossVectors(right, forward).normalize();

      if (roll !== 0) {
        right.applyAxisAngle(forward, roll).normalize();
        up.applyAxisAngle(forward, roll).normalize();
      }

      backward.copy(forward).negate();
    }

    basis.makeBasis(right, up, backward);
    return quaternion.setFromRotationMatrix(basis);
  }

  function getBoundingSphereFlyToPosition(target, range, options) {
    const { heading, pitch } = options;
    if (heading === undefined && pitch === undefined) {
      const direction =
        target.lengthSq() > 1e-6
          ? position.copy(target).normalize()
          : camera.position.lengthSq() > 1e-6
            ? position.copy(camera.position).normalize()
            : position.set(0, -1, 0);
      return direction.multiplyScalar(range).add(target);
    }

    const resolvedHeading = heading ?? 0;
    const resolvedPitch = pitch ?? -Math.PI / 2;
    const centerForward = getCenterModeHeadingPitchRollForward(
      resolvedHeading,
      resolvedPitch,
    );
    const centerPosition = position
      .copy(target)
      .addScaledVector(centerForward, -range);
    if (isCenterModePosition(centerPosition)) {
      return centerPosition;
    }

    const resolvedForward = getHeadingPitchRollForward(
      target,
      resolvedHeading,
      resolvedPitch,
    );
    return position.copy(target).addScaledVector(resolvedForward, -range);
  }

  function getFlyToPoseFromBoundingSphere(target, radius, options) {
    const safeRadius = Math.max(radius, 1);
    let offsetDistance = safeRadius;

    if (camera instanceof PerspectiveCamera) {
      const verticalFov = MathUtils.degToRad(camera.fov);
      const horizontalFov =
        2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
      const minHalfFov = Math.max(
        0.1,
        Math.min(verticalFov, horizontalFov) / 2,
      );
      offsetDistance = safeRadius / Math.sin(minHalfFov) + safeRadius * 0.75;
    } else {
      offsetDistance = getCameraDistanceForBoundingSphere(safeRadius);
    }

    const nextPosition = getBoundingSphereFlyToPosition(
      target,
      offsetDistance,
      options,
    );
    const nextQuaternion = getHeadingPitchRollQuaternion(
      isCenterModePosition(nextPosition) ? nextPosition : target,
      options.heading ?? 0,
      options.pitch ?? -Math.PI / 2,
      options.roll ?? 0,
    );

    return {
      position: nextPosition,
      quaternion: nextQuaternion,
    };
  }

  return {
    getCartographicFromWorldPosition,
    getCoordinateTransform,
    getCoordinateWorldPosition,
    getFlyToPoseFromBoundingSphere,
    getLocalFrameQuaternion,
  };
}
