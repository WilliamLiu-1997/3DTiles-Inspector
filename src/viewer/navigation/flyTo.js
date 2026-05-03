import { Raycaster, Sphere, Vector2, Vector3 } from 'three';
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

  function frameTileset() {
    if (!getTilesetBoundingSphere(sphere)) {
      return false;
    }

    const pose = geoCamera.getFlyToPoseFromBoundingSphere(
      sphere.center,
      sphere.radius,
      moveToTilesPose,
    );
    camera.position.copy(pose.position);
    camera.quaternion.copy(pose.quaternion);
    camera.updateMatrixWorld(true);
    cameraController.setCamera(camera);
    return true;
  }

  function moveCameraToTiles() {
    if (frameTileset()) {
      setStatus('Moved camera to the tileset.');
    } else {
      setStatus('Tileset is not ready to frame yet.', true);
    }
  }

  function moveCameraToCoordinate(coordinate) {
    geoCamera.getCoordinateWorldPosition(
      coordinate.latitude,
      coordinate.longitude,
      coordinate.height,
      coordinateWorldPosition,
    );
    const pose = geoCamera.getFlyToPoseFromBoundingSphere(
      coordinateWorldPosition,
      moveToCoordinateRadius,
      moveToTilesPose,
    );
    camera.position.copy(pose.position);
    camera.quaternion.copy(pose.quaternion);
    camera.updateMatrixWorld(true);
    cameraController.setCamera(camera);
    setStatus('Moved camera to the specified coordinate.');
  }

  return {
    applyTilesSetPositionFromPointerEvent,
    frameTileset,
    getActiveEllipsoid,
    moveCameraToCoordinate,
    moveCameraToTiles,
    pickCoordinateFromPointerEvent,
  };
}
