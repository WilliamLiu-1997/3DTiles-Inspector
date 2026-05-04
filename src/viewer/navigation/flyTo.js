import { Raycaster, Sphere, Vector2, Vector3 } from 'three';
import {
  createCameraFlight,
  flyTo as applyCameraFlyTo,
  getFlyToParamsFromBoundingSphere,
} from './cameraFlyTo.js';
import { mouseToCoords, setRaycasterFromCamera } from '../utils.js';

export function createFlyToController({
  camera,
  cameraController,
  domElement,
  geoCamera,
  globeController,
  moveToTilesPose,
  moveToCoordinateRadius,
  setStatus,
  applyTilesPlacementFromCoordinate,
  getTiles,
  getTilesetBoundingSphere,
}) {
  const coordinateWorldPosition = new Vector3();
  const pointerCoords = new Vector2();
  const pickRaycaster = new Raycaster();
  const pickTargets = [];
  const sphere = new Sphere();
  let activeCameraFlight = null;
  let activeCameraFlightStatus = '';

  function getActiveEllipsoid() {
    return getTiles()?.ellipsoid || globeController.getEllipsoid();
  }

  function raycastPickWorldPosition(target) {
    pickTargets.length = 0;

    const tiles = getTiles();
    if (tiles?.group) {
      pickTargets.push(tiles.group);
    }

    const globeTiles = globeController.getTiles();
    if (globeTiles?.group) {
      pickTargets.push(globeTiles.group);
    }

    if (pickTargets.length === 0) {
      return false;
    }

    for (const root of pickTargets) {
      root.updateMatrixWorld(true);
    }

    const [hit] = pickRaycaster.intersectObjects(pickTargets, true);
    if (!hit) {
      return false;
    }

    target.copy(hit.point);
    return true;
  }

  function pickWorldPositionFromPointerEvent(event, target) {
    mouseToCoords(event.clientX, event.clientY, domElement, pointerCoords);
    setRaycasterFromCamera(pickRaycaster, pointerCoords, camera);

    if (raycastPickWorldPosition(target)) {
      return true;
    }

    const ellipsoid = getActiveEllipsoid();
    return !!ellipsoid && ellipsoid.intersectRay(pickRaycaster.ray, target);
  }

  function pickCoordinateFromPointerEvent(event) {
    if (!pickWorldPositionFromPointerEvent(event, coordinateWorldPosition)) {
      return null;
    }

    return geoCamera.getCartographicFromWorldPosition(coordinateWorldPosition);
  }

  function startCameraFlight(
    position,
    target,
    options = {},
    { activeStatus = 'Moving camera.', doneStatus = 'Moved camera.' } = {},
  ) {
    cameraController.setCamera(camera);
    activeCameraFlight = createCameraFlight(camera, position, target, options);
    activeCameraFlightStatus = doneStatus;
    if (!activeCameraFlight) {
      cameraController.setCamera(camera);
      setStatus(doneStatus);
      return;
    }

    setStatus(activeStatus);
  }

  function startBoundingSphereFlight(
    target,
    radius,
    options = {},
    status = {},
  ) {
    const flyToParams = getFlyToParamsFromBoundingSphere(
      camera,
      target,
      radius,
      options,
    );
    startCameraFlight(
      flyToParams.position,
      flyToParams.target,
      flyToParams.options,
      status,
    );
  }

  function update(time = performance.now()) {
    if (!activeCameraFlight) {
      return false;
    }

    const done = applyCameraFlyTo(camera, activeCameraFlight, time);
    if (done) {
      activeCameraFlight = null;
      setStatus(activeCameraFlightStatus);
      activeCameraFlightStatus = '';
    }
    return true;
  }

  async function applyTilesSetPositionFromPointerEvent(event) {
    const coordinate = pickCoordinateFromPointerEvent(event);
    if (!coordinate) {
      setStatus(
        'No globe, terrain, or tiles hit under cursor. Click the globe, terrain, or tiles to place the tileset root.',
        true,
      );
      return null;
    }

    try {
      await applyTilesPlacementFromCoordinate(
        coordinate.latitude,
        coordinate.longitude,
        coordinate.height,
      );
      return coordinate;
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err), true);
      return null;
    }
  }

  function frameTileset({
    activeStatus = 'Moving camera to the tileset.',
    doneStatus = 'Moved camera to the tileset.',
  } = {}) {
    if (!getTilesetBoundingSphere(sphere)) {
      return false;
    }

    startBoundingSphereFlight(
      sphere.center,
      sphere.radius / 2,
      moveToTilesPose,
      {
        activeStatus,
        doneStatus,
      },
    );
    return true;
  }

  function moveCameraToTiles() {
    if (frameTileset()) {
      return;
    }

    setStatus('Tileset is not ready to frame yet.', true);
  }

  function moveCameraToCoordinate(coordinate) {
    geoCamera.getCoordinateWorldPosition(
      coordinate.latitude,
      coordinate.longitude,
      coordinate.height,
      coordinateWorldPosition,
    );
    startBoundingSphereFlight(
      coordinateWorldPosition,
      moveToCoordinateRadius,
      moveToTilesPose,
      {
        activeStatus: 'Moving camera to the specified coordinate.',
        doneStatus: 'Moved camera to the specified coordinate.',
      },
    );
  }

  return {
    applyTilesSetPositionFromPointerEvent,
    frameTileset,
    getActiveEllipsoid,
    moveCameraToCoordinate,
    moveCameraToTiles,
    pickCoordinateFromPointerEvent,
    update,
  };
}
