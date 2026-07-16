import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Quaternion,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
} from 'three';
import {
  SCREEN_SELECTION_ACTION_EXCLUDE,
  SCREEN_SELECTION_ACTION_INCLUDE,
  createScreenSelection,
  createScreenSelectionEdit,
  createScreenSelectionFarHandle,
  createScreenSelectionPointerTracker,
  disposeScreenSelection,
  getScreenSelectionFarDepthFromPosition,
  getScreenSelectionPayload,
  setScreenSelectionShape,
  setScreenSelectionEditSelection,
  setScreenSelectionFarDepth,
  updateScreenSelectionWorldState,
} from './index.js';
import { applySphereSelectionSdf } from './sdf.js';
import {
  clearOverlay,
  createSelectionData,
} from './geometry.js';
import {
  SCREEN_EDIT_CORNER_HIT_SIZE,
  SCREEN_EDIT_CORNER_PARTS,
  SCREEN_EDIT_EDGE_HIT_SIZE,
  SCREEN_EDIT_EDGE_PARTS,
  SCREEN_EDIT_PART_POINT_INDICES,
  clampClientPoints,
  copyClientPoint,
  copyClientPoints,
  createScreenEditOverlay,
  getClientRectPoints,
  getPartPoint,
  isConvexClientQuad,
  pointSegmentDistanceSq,
} from './editOverlay.js';
import { updateCropControls } from '../dom/cropUi.js';
import { mouseToCoords, setRaycasterFromCamera } from '../utils.js';
import { getDepthAwareRenderOrder } from '../scene/renderOrder.js';

const CAMERA_POSITION_EPSILON_SQ = 1e-12;
const CAMERA_QUATERNION_EPSILON = 1e-10;
const CAMERA_PROJECTION_EPSILON = 1e-10;
const KEEP_SPHERE_CENTER_PICK_MAX_DISTANCE_PX = 2;
const KEEP_SPHERE_CENTER_PICK_MAX_DISTANCE_SQ =
  KEEP_SPHERE_CENTER_PICK_MAX_DISTANCE_PX ** 2;
const KEEP_SPHERE_RADIUS_TRACK_PIXELS_PER_EXPONENT = 90;
const KEEP_SPHERE_MIN_RADIUS = 1e-6;
const KEEP_SPHERE_WIREFRAME_COLOR = 0xffffff;
const KEEP_SPHERE_WIREFRAME_LATITUDE_SEGMENTS = 20;
const KEEP_SPHERE_WIREFRAME_LONGITUDE_SEGMENTS = 80;
const KEEP_SPHERE_WIREFRAME_MERIDIANS = 20;
const KEEP_SPHERE_WIREFRAME_OVERLAY_OPACITY = 0.35;
const KEEP_SPHERE_WIREFRAME_RENDER_ORDER = 1000001;
const RAYCAST_CROP_EPSILON = 1e-6;

function pushKeepSphereSegment(vertices, start, end) {
  vertices.push(start[0], start[1], start[2], end[0], end[1], end[2]);
}

function createKeepSphereWireframeGeometry() {
  const vertices = [];

  for (
    let latitudeIndex = 1;
    latitudeIndex < KEEP_SPHERE_WIREFRAME_LATITUDE_SEGMENTS;
    latitudeIndex++
  ) {
    const phi =
      (Math.PI * latitudeIndex) / KEEP_SPHERE_WIREFRAME_LATITUDE_SEGMENTS;
    const z = Math.cos(phi);
    const ringRadius = Math.sin(phi);

    for (
      let longitudeIndex = 0;
      longitudeIndex < KEEP_SPHERE_WIREFRAME_LONGITUDE_SEGMENTS;
      longitudeIndex++
    ) {
      const theta0 =
        (Math.PI * 2 * longitudeIndex) /
        KEEP_SPHERE_WIREFRAME_LONGITUDE_SEGMENTS;
      const theta1 =
        (Math.PI * 2 * (longitudeIndex + 1)) /
        KEEP_SPHERE_WIREFRAME_LONGITUDE_SEGMENTS;
      pushKeepSphereSegment(
        vertices,
        [
          Math.cos(theta0) * ringRadius,
          Math.sin(theta0) * ringRadius,
          z,
        ],
        [
          Math.cos(theta1) * ringRadius,
          Math.sin(theta1) * ringRadius,
          z,
        ],
      );
    }
  }

  for (
    let meridianIndex = 0;
    meridianIndex < KEEP_SPHERE_WIREFRAME_MERIDIANS;
    meridianIndex++
  ) {
    const theta =
      (Math.PI * 2 * meridianIndex) / KEEP_SPHERE_WIREFRAME_MERIDIANS;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);

    for (
      let latitudeIndex = 0;
      latitudeIndex < KEEP_SPHERE_WIREFRAME_LATITUDE_SEGMENTS;
      latitudeIndex++
    ) {
      const phi0 =
        (Math.PI * latitudeIndex) / KEEP_SPHERE_WIREFRAME_LATITUDE_SEGMENTS;
      const phi1 =
        (Math.PI * (latitudeIndex + 1)) /
        KEEP_SPHERE_WIREFRAME_LATITUDE_SEGMENTS;
      pushKeepSphereSegment(
        vertices,
        [
          cosTheta * Math.sin(phi0),
          sinTheta * Math.sin(phi0),
          Math.cos(phi0),
        ],
        [
          cosTheta * Math.sin(phi1),
          sinTheta * Math.sin(phi1),
          Math.cos(phi1),
        ],
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function createKeepSphereWireframeMaterial({ depthTest, opacity = 1 }) {
  return new LineBasicMaterial({
    color: KEEP_SPHERE_WIREFRAME_COLOR,
    depthTest,
    depthWrite: depthTest,
    opacity,
    transparent: opacity < 1,
  });
}

function isGaussianSplatObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.gaussianSplat) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

export function createCropController({
  camera,
  cameraController,
  domElement,
  overlayEl,
  rectEl,
  scene,
  screenSelectionSplatEdit,
  reversedDepthBuffer,
  setStatus,
  setTransformMode,
  syncTransformControlsState,
  transformControls,
  viewerElements,
  cancelOtherPositionPickModes,
  getCurrentRootTransformArray,
  getLocalFrameQuaternion,
  getTilesetBoundingSphere,
  getTiles,
}) {
  let selections = [];
  let pendingSelections = [];
  let nextSelectionId = 1;
  let activeSelectionId = null;
  let pendingMode = false;
  let pendingScreenEdit = null;
  let pendingEditDrag = null;
  let keepSphere = null;
  let keepSphereCenterPick = null;
  let keepSphereTrackDrag = null;
  let interactionLocked = false;
  let editCursor = '';
  let hasGaussianSplats = false;
  const sphere = new Sphere();
  const rootMatrix = new Matrix4();
  const rootInverseMatrix = new Matrix4();
  const sphereWorldCenter = new Vector3();
  const sphereLocalCenter = new Vector3();
  const sphereWorldQuaternion = new Quaternion();
  const keepSpherePickRaycaster = new Raycaster();
  const keepSpherePointerCoords = new Vector2();
  const keepSpherePickPoint = new Vector3();
  const raycastPlaneMatrix = new Matrix4();
  const raycastPlanePosition = new Vector3();
  const raycastPlaneQuaternion = new Quaternion();
  const raycastPlaneScale = new Vector3();
  const raycastPlaneNormal = new Vector3(0, 0, 1);
  const raycastSphereCenter = new Vector3();
  const cameraForward = new Vector3();
  const screenEditOverlay = createScreenEditOverlay({ overlayEl, rectEl });
  keepSpherePickRaycaster.params.Points.threshold = 0.1;

  function getActiveSelection() {
    if (activeSelectionId == null) {
      return null;
    }
    return findSelection(activeSelectionId)?.selection || null;
  }

  function isPointInsideScreenSelection(selection, point) {
    if (!selection?.planeMatrices) {
      return false;
    }

    for (const matrixArray of selection.planeMatrices) {
      raycastPlaneMatrix.fromArray(matrixArray);
      raycastPlaneMatrix.decompose(
        raycastPlanePosition,
        raycastPlaneQuaternion,
        raycastPlaneScale,
      );
      raycastPlaneNormal
        .set(0, 0, 1)
        .applyQuaternion(raycastPlaneQuaternion)
        .normalize();
      const distance =
        raycastPlaneNormal.dot(point) -
        raycastPlaneNormal.dot(raycastPlanePosition);
      if (distance > RAYCAST_CROP_EPSILON) {
        return false;
      }
    }
    return true;
  }

  function isPointInsideCropSphere(selection, point) {
    const radius = Number(selection?.worldRadius);
    if (
      !Array.isArray(selection?.worldCenter) ||
      !Number.isFinite(radius) ||
      radius <= 0
    ) {
      return true;
    }

    raycastSphereCenter.fromArray(selection.worldCenter);
    return (
      point.distanceToSquared(raycastSphereCenter) <=
      radius * radius + RAYCAST_CROP_EPSILON
    );
  }

  function isSplatPointVisibleForRaycast(point) {
    for (const selection of selections) {
      if (selection.id === activeSelectionId) {
        continue;
      }
      if (isPointInsideScreenSelection(selection, point)) {
        return false;
      }
    }

    if (
      keepSphere?.confirmed &&
      keepSphere.id !== activeSelectionId &&
      !isPointInsideCropSphere(keepSphere, point)
    ) {
      return false;
    }

    return true;
  }

  function getCurrentRootMatrix(target = rootMatrix) {
    return target.fromArray(getCurrentRootTransformArray());
  }

  function getCurrentRootScale() {
    const scale = getCurrentRootMatrix(rootMatrix).getMaxScaleOnAxis();
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  function updateKeepSphereWorldState(selection = keepSphere) {
    if (!selection) {
      return;
    }

    getCurrentRootMatrix(rootMatrix);
    sphereLocalCenter.fromArray(selection.localCenter);
    sphereWorldCenter.copy(sphereLocalCenter).applyMatrix4(rootMatrix);
    const rootScale = rootMatrix.getMaxScaleOnAxis();
    const safeScale = Number.isFinite(rootScale) && rootScale > 0 ? rootScale : 1;
    selection.worldCenter = sphereWorldCenter.toArray();
    if (typeof getLocalFrameQuaternion === 'function') {
      getLocalFrameQuaternion(sphereWorldCenter, sphereWorldQuaternion);
    } else {
      sphereWorldQuaternion.identity();
    }
    selection.worldQuaternion = sphereWorldQuaternion.toArray();
    selection.worldRadius = Math.max(
      KEEP_SPHERE_MIN_RADIUS,
      selection.localRadius * safeScale,
    );
    applySphereSelectionSdf(selection);
    updateKeepSphereWireframe(selection);
  }

  function setKeepSphereWorldCenter(worldCenter, { commit = false } = {}) {
    if (!keepSphere || !worldCenter) {
      return false;
    }

    getCurrentRootMatrix(rootMatrix);
    rootInverseMatrix.copy(rootMatrix).invert();
    sphereLocalCenter.copy(worldCenter).applyMatrix4(rootInverseMatrix);
    keepSphere.localCenter = sphereLocalCenter.toArray();
    updateKeepSphereWorldState();
    syncEditSdfs();
    syncTransformControlsState();
    refreshUi();

    if (commit) {
      setStatus(
        keepSphere.confirmed
          ? 'Moved crop sphere to the clicked tiles point. Click Save to persist, or select its row to deactivate.'
          : 'Moved pending crop sphere to the clicked tiles point. Adjust radius, then Confirm or Cancel.',
      );
    }

    return true;
  }

  function isKeepSphereActive() {
    return !!keepSphere && activeSelectionId === keepSphere.id;
  }

  function shouldTrackKeepSphereCenterPick(event) {
    if (interactionLocked) {
      return false;
    }
    if (!isKeepSphereActive()) {
      return false;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return false;
    }
    return event.isPrimary !== false;
  }

  function raycastKeepSphereCenterPick(event, target) {
    const tilesGroup = getTiles?.()?.group;
    if (!tilesGroup) {
      return false;
    }

    mouseToCoords(
      event.clientX,
      event.clientY,
      domElement,
      keepSpherePointerCoords,
    );
    setRaycasterFromCamera(
      keepSpherePickRaycaster,
      keepSpherePointerCoords,
      camera,
    );
    tilesGroup.updateMatrixWorld(true);

    const hits = keepSpherePickRaycaster.intersectObject(tilesGroup, true);
    for (const hit of hits) {
      if (!hit.point || !isRaycastHitVisible(hit)) {
        continue;
      }
      target.copy(hit.point);
      return true;
    }

    return false;
  }

  function createKeepSphereWireframe(selection) {
    const group = new Group();
    const geometry = createKeepSphereWireframeGeometry();
    const visibleMaterial = createKeepSphereWireframeMaterial({
      depthTest: true,
    });
    const overlayMaterial = createKeepSphereWireframeMaterial({
      depthTest: false,
      opacity: KEEP_SPHERE_WIREFRAME_OVERLAY_OPACITY,
    });
    const visibleWireframe = new LineSegments(geometry, visibleMaterial);
    const overlayWireframe = new LineSegments(geometry, overlayMaterial);
    const visibleRenderOrder = getDepthAwareRenderOrder(
      KEEP_SPHERE_WIREFRAME_RENDER_ORDER,
      reversedDepthBuffer,
    );
    const overlayRenderOrder = getDepthAwareRenderOrder(
      KEEP_SPHERE_WIREFRAME_RENDER_ORDER + 1,
      reversedDepthBuffer,
    );
    visibleWireframe.renderOrder = visibleRenderOrder;
    overlayWireframe.renderOrder = overlayRenderOrder;
    // Group.renderOrder becomes groupOrder and sorts before child renderOrder.
    // Leave the transform root at its default so controls can render last.
    group.add(visibleWireframe);
    group.add(overlayWireframe);
    group.userData.keepSphereHandle = true;
    group.userData.screenSelectionId = selection.id;
    selection.wireframe = group;
    selection.wireframeGeometry = geometry;
    scene.add(group);
    return group;
  }

  function updateKeepSphereWireframe(selection = keepSphere) {
    if (!selection) {
      return;
    }
    const wireframe = selection.wireframe || createKeepSphereWireframe(selection);
    wireframe.position.fromArray(selection.worldCenter);
    wireframe.quaternion.fromArray(selection.worldQuaternion);
    wireframe.scale.setScalar(selection.worldRadius);
    wireframe.visible =
      !interactionLocked && selection.id === activeSelectionId;
    wireframe.updateMatrix();
    wireframe.updateMatrixWorld(true);
  }

  function disposeKeepSphere(selection = keepSphere) {
    if (!selection) {
      return;
    }
    if (selection.edit) {
      setScreenSelectionEditSelection(selection.edit, null, true);
      selection.edit.removeFromParent();
      selection.edit = null;
    }
    selection.sdfs?.forEach((sdf) => {
      sdf.removeFromParent();
    });
    selection.sdfs = null;
    if (selection.wireframe) {
      selection.wireframe.traverse((object) => {
        object.material?.dispose?.();
      });
      selection.wireframeGeometry?.dispose?.();
      selection.wireframe.removeFromParent();
      selection.wireframe = null;
      selection.wireframeGeometry = null;
    }
  }

  function getEntries() {
    const entries = [
      ...selections.map((selection) => ({ style: 'exclude', selection })),
      ...pendingSelections.map((selection) => ({
        style: 'preview',
        selection,
      })),
    ];
    if (keepSphere) {
      entries.push({
        style: keepSphere.confirmed ? 'include' : 'preview',
        selection: keepSphere,
      });
    }
    return entries;
  }

  function setEditCursor(cursor) {
    const nextCursor = cursor || '';
    if (editCursor === nextCursor) {
      return;
    }
    domElement.style.cursor = nextCursor;
    editCursor = nextCursor;
  }

  function clearEditCursor() {
    setEditCursor('');
  }

  function getActivePendingEdit() {
    if (!pendingScreenEdit || activeSelectionId !== pendingScreenEdit.selectionId) {
      return null;
    }
    const match = pendingSelections.find(
      (selection) => selection.id === pendingScreenEdit.selectionId,
    );
    return match ? pendingScreenEdit : null;
  }

  function clearScreenEditOverlay() {
    screenEditOverlay.clear();
    clearEditCursor();
  }

  function syncPendingEditOverlay() {
    const edit = getActivePendingEdit();
    if (!edit) {
      clearScreenEditOverlay();
      if (!pendingMode) {
        clearOverlay(overlayEl, rectEl);
      }
      return;
    }

    screenEditOverlay.render(edit.clientPoints, { showGrid: false });
  }

  function createCameraPoseSnapshot() {
    camera.updateMatrixWorld(true);
    return {
      position: camera.position.toArray(),
      projectionMatrix: camera.projectionMatrix.toArray(),
      quaternion: camera.quaternion.toArray(),
    };
  }

  function projectionChanged(source, target) {
    if (!Array.isArray(source) || !Array.isArray(target)) {
      return true;
    }
    return source.some(
      (value, index) =>
        Math.abs(value - target[index]) > CAMERA_PROJECTION_EPSILON,
    );
  }

  function cameraPoseChanged(cameraPose) {
    if (!cameraPose) {
      return true;
    }

    camera.updateMatrixWorld(true);
    const dx = camera.position.x - cameraPose.position[0];
    const dy = camera.position.y - cameraPose.position[1];
    const dz = camera.position.z - cameraPose.position[2];
    if (dx * dx + dy * dy + dz * dz > CAMERA_POSITION_EPSILON_SQ) {
      return true;
    }

    const quaternion = cameraPose.quaternion;
    const quaternionDot = Math.abs(
      camera.quaternion.x * quaternion[0] +
        camera.quaternion.y * quaternion[1] +
        camera.quaternion.z * quaternion[2] +
        camera.quaternion.w * quaternion[3],
    );
    if (1 - Math.min(1, quaternionDot) > CAMERA_QUATERNION_EPSILON) {
      return true;
    }

    return projectionChanged(
      camera.projectionMatrix.toArray(),
      cameraPose.projectionMatrix,
    );
  }

  function clearPendingScreenEdit() {
    pendingScreenEdit = null;
    pendingEditDrag = null;
    syncPendingEditOverlay();
  }

  function freezePendingScreenEdit(showStatus = false) {
    const hadEdit = !!pendingScreenEdit;
    if (!hadEdit) {
      return false;
    }

    clearPendingScreenEdit();
    if (showStatus) {
      setStatus(
        'Screen selection shape fixed after camera movement. Drag the 3D far plane, then Confirm or Cancel.',
      );
    }
    return true;
  }

  function freezePendingScreenEditIfCameraChanged() {
    if (!pendingScreenEdit || pendingEditDrag) {
      return false;
    }
    if (!cameraPoseChanged(pendingScreenEdit.cameraPose)) {
      return false;
    }
    return freezePendingScreenEdit(true);
  }

  function createPendingScreenEdit(selection, clientRect) {
    pendingScreenEdit = {
      cameraPose: createCameraPoseSnapshot(),
      clientPoints: clampClientPoints(getClientRectPoints(clientRect), domElement),
      selectionId: selection.id,
    };
    syncPendingEditOverlay();
  }

  function syncWorldState() {
    const transform = getCurrentRootTransformArray();
    getEntries().forEach(({ selection }) => {
      if (selection.type === 'sphere') {
        updateKeepSphereWorldState(selection);
        return;
      }
      updateScreenSelectionWorldState(
        selection,
        transform,
        selection.id === activeSelectionId,
      );
    });
  }

  function syncEditSdfs() {
    syncWorldState();
    setScreenSelectionEditSelection(screenSelectionSplatEdit, null, false);
    const styled = [
      ...selections.map((selection) => ({
        style: selection.id === activeSelectionId ? 'preview' : 'exclude',
        selection,
      })),
      ...pendingSelections.map((selection) => ({
        style: 'preview',
        selection,
      })),
    ];
    if (keepSphere) {
      styled.push({
        style:
          keepSphere.confirmed && keepSphere.id !== activeSelectionId
            ? 'include'
            : 'preview',
        selection: keepSphere,
      });
    }

    styled.forEach(({ style, selection }) => {
      if (!selection.edit) {
        selection.edit = createScreenSelectionEdit({
          style,
          name: `Screen Selection ${selection.id}`,
        });
        scene.add(selection.edit);
      }
      selection.edit.ordering =
        style === 'preview' ? 1000000 + selection.id : selection.id;
      setScreenSelectionEditSelection(selection.edit, selection, style);
    });
  }

  function syncFarHandles() {
    const allEntries = getEntries();
    const entries = allEntries.filter(
      ({ selection }) => selection.type !== 'sphere',
    );
    if (
      activeSelectionId != null &&
      !allEntries.some(({ selection }) => selection.id === activeSelectionId)
    ) {
      activeSelectionId = null;
    }

    entries.forEach(({ selection }) => {
      if (!selection.farHandle) {
        scene.add(
          createScreenSelectionFarHandle(selection, reversedDepthBuffer),
        );
      }
    });
    syncWorldState();
  }

  function refreshUi() {
    updateCropControls({
      activeScreenSelectionId: activeSelectionId,
      elements: viewerElements,
      pendingScreenSelectionMode: pendingMode,
      screenSelections: selections,
      pendingScreenSelections: pendingSelections,
      onScreenSelectionRemove: handleSelectionRemove,
      onScreenSelectionSelect: handleSelectionSelect,
      keepSphere,
      onKeepSphereRemove: removeKeepSphere,
      onKeepSphereSelect: selectKeepSphere,
      tilesetHasGaussianSplats: hasGaussianSplats,
      interactionLocked,
    });
  }

  function getDepthRange() {
    if (!getTilesetBoundingSphere(sphere)) {
      return {
        far: camera.near + 100,
        near: camera.near,
      };
    }

    camera.getWorldDirection(cameraForward);
    const centerDepth = sphere.center
      .clone()
      .sub(camera.position)
      .dot(cameraForward);
    const sphereFarthestDistance =
      camera.position.distanceTo(sphere.center) + sphere.radius;
    const near = Math.max(camera.near, centerDepth - sphere.radius);
    return {
      far: sphereFarthestDistance,
      near,
    };
  }

  const pointerTracker = createScreenSelectionPointerTracker({
    camera,
    domElement,
    getDepthRange,
    onOverlayClear: clearScreenEditOverlay,
    onOverlayUpdate: (clientRect) => {
      screenEditOverlay.render(getClientRectPoints(clientRect), {
        showGrid: true,
      });
      return true;
    },
    onSelectionCreated: handleSelectionCreated,
    overlayEl,
    rectEl,
  });

  function createEditHit(part) {
    return { cursor: 'grab', part };
  }

  function getPendingEditHit(event) {
    if (freezePendingScreenEditIfCameraChanged()) {
      return null;
    }

    const edit = getActivePendingEdit();
    if (!edit) {
      return null;
    }

    const pointer = { x: event.clientX, y: event.clientY };
    for (const part of SCREEN_EDIT_CORNER_PARTS) {
      const point = getPartPoint(edit.clientPoints, part);
      const dx = pointer.x - point.x;
      const dy = pointer.y - point.y;
      if (dx * dx + dy * dy <= SCREEN_EDIT_CORNER_HIT_SIZE ** 2) {
        return createEditHit(part);
      }
    }

    for (const part of SCREEN_EDIT_EDGE_PARTS) {
      const [startIndex, endIndex] = SCREEN_EDIT_PART_POINT_INDICES[part];
      if (
        pointSegmentDistanceSq(
          pointer,
          edit.clientPoints[startIndex],
          edit.clientPoints[endIndex],
        ) <=
        SCREEN_EDIT_EDGE_HIT_SIZE ** 2
      ) {
        return createEditHit(part);
      }
    }

    return null;
  }

  function getPendingEditDragPoints(event) {
    const { part, startClientX, startClientY, startPoints } = pendingEditDrag;
    const domRect = domElement.getBoundingClientRect();
    const indices = SCREEN_EDIT_PART_POINT_INDICES[part] || [];
    let dx = event.clientX - startClientX;
    let dy = event.clientY - startClientY;

    indices.forEach((index) => {
      const point = startPoints[index];
      dx = Math.max(dx, domRect.left - point.x);
      dx = Math.min(dx, domRect.right - point.x);
      dy = Math.max(dy, domRect.top - point.y);
      dy = Math.min(dy, domRect.bottom - point.y);
    });

    return startPoints.map((point, index) =>
      indices.includes(index)
        ? {
            x: point.x + dx,
            y: point.y + dy,
          }
        : copyClientPoint(point),
    );
  }

  function updatePendingEditSelection(clientPoints) {
    const edit = getActivePendingEdit();
    if (!edit) {
      return false;
    }

    const match = findSelection(edit.selectionId);
    if (!match) {
      return false;
    }

    if (!isConvexClientQuad(clientPoints)) {
      return false;
    }

    const selectionData = createSelectionData({
      camera,
      clientPoints,
      domElement,
      getDepthRange,
    });
    if (!selectionData) {
      return false;
    }

    edit.clientPoints = copyClientPoints(clientPoints);
    setScreenSelectionShape(
      match.selection,
      selectionData,
      getCurrentRootTransformArray(),
    );
    syncPendingEditOverlay();
    syncTransformControlsState();
    return true;
  }

  function handlePendingEditPointerDown(event) {
    if (event.button !== 0) {
      return false;
    }

    const hit = getPendingEditHit(event);
    if (!hit) {
      return false;
    }

    pendingEditDrag = {
      part: hit.part,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPoints: copyClientPoints(pendingScreenEdit.clientPoints),
      updated: false,
    };
    domElement.setPointerCapture?.(event.pointerId);
    screenEditOverlay.setActivePart(hit.part);
    setEditCursor('grabbing');
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePendingEditPointerMove(event) {
    if (pendingEditDrag) {
      if (event.pointerId !== pendingEditDrag.pointerId) {
        return false;
      }

      pendingEditDrag.updated =
        updatePendingEditSelection(getPendingEditDragPoints(event)) ||
        pendingEditDrag.updated;
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    if (event.buttons) {
      return false;
    }

    const hit = getPendingEditHit(event);
    screenEditOverlay.setActivePart(hit?.part);
    setEditCursor(hit?.cursor || '');
    return false;
  }

  function handlePendingEditPointerUp(event) {
    if (!pendingEditDrag || event.pointerId !== pendingEditDrag.pointerId) {
      return false;
    }

    domElement.releasePointerCapture?.(event.pointerId);
    const updated = pendingEditDrag.updated;
    pendingEditDrag = null;
    const hit = getPendingEditHit(event);
    screenEditOverlay.setActivePart(hit?.part);
    setEditCursor(hit?.cursor || '');
    setStatus(
      updated
        ? 'Updated screen selection convex quadrilateral.'
        : 'Screen selection must stay convex.',
      !updated,
    );
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handlePendingEditPointerCancel(event) {
    if (!pendingEditDrag || event.pointerId !== pendingEditDrag.pointerId) {
      return false;
    }

    domElement.releasePointerCapture?.(event.pointerId);
    pendingEditDrag = null;
    screenEditOverlay.setActivePart(null);
    clearEditCursor();
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function handleKeepSphereCenterPickPointerDown(event) {
    if (!shouldTrackKeepSphereCenterPick(event)) {
      return false;
    }

    if (transformControls.enabled && transformControls.axis !== null) {
      return false;
    }

    if (!raycastKeepSphereCenterPick(event, keepSpherePickPoint)) {
      return false;
    }

    keepSphereCenterPick = {
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
      pointerId: event.pointerId,
      selectionId: keepSphere.id,
    };
    domElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return true;
  }

  function handleKeepSphereCenterPickPointerMove(event) {
    if (
      !keepSphereCenterPick ||
      event.pointerId !== keepSphereCenterPick.pointerId
    ) {
      return false;
    }

    const dx = event.clientX - keepSphereCenterPick.clientX;
    const dy = event.clientY - keepSphereCenterPick.clientY;
    if (dx * dx + dy * dy > KEEP_SPHERE_CENTER_PICK_MAX_DISTANCE_SQ) {
      keepSphereCenterPick.moved = true;
    }
    event.preventDefault();
    return true;
  }

  function handleKeepSphereCenterPickPointerUp(event) {
    if (
      !keepSphereCenterPick ||
      event.pointerId !== keepSphereCenterPick.pointerId
    ) {
      return false;
    }

    domElement.releasePointerCapture?.(event.pointerId);
    const pick = keepSphereCenterPick;
    keepSphereCenterPick = null;
    const shouldApply =
      !pick.moved &&
      keepSphere?.id === pick.selectionId &&
      activeSelectionId === pick.selectionId;
    if (shouldApply) {
      if (raycastKeepSphereCenterPick(event, keepSpherePickPoint)) {
        setKeepSphereWorldCenter(keepSpherePickPoint, { commit: true });
      } else {
        setStatus(
          'No tiles hit under cursor. Click the tiles to move the crop sphere.',
          true,
        );
      }
    }
    event.preventDefault();
    return true;
  }

  function handleKeepSphereCenterPickPointerCancel(event) {
    if (
      !keepSphereCenterPick ||
      event.pointerId !== keepSphereCenterPick.pointerId
    ) {
      return false;
    }

    keepSphereCenterPick = null;
    domElement.releasePointerCapture?.(event.pointerId);
    event.preventDefault();
    return true;
  }

  function setMode(active) {
    pendingMode =
      active && hasGaussianSplats && pendingSelections.length === 0;
    pointerTracker.setActive(pendingMode);
    if (pendingMode) {
      activeSelectionId = null;
      cancelOtherPositionPickModes();
      setTransformMode(null);
      syncEditSdfs();
      syncFarHandles();
    }
    cameraController.enabled = !transformControls.dragging;
    syncTransformControlsState();
    syncPendingEditOverlay();
    refreshUi();
  }

  function cancelMode() {
    if (!pendingMode) {
      return;
    }
    setMode(false);
  }

  function handleSelectionCreated(selectionData, clientRect) {
    if (pendingSelections.length > 0) {
      setMode(false);
      setStatus(
        'Confirm or Cancel the current screen selection before drawing another.',
        true,
      );
      return;
    }

    if (!selectionData) {
      setStatus('Screen selection was too small.', true);
      return;
    }

    const selection = createScreenSelection({
      action: SCREEN_SELECTION_ACTION_EXCLUDE,
      id: nextSelectionId++,
      transformMatrix: getCurrentRootTransformArray(),
      ...selectionData,
    });
    pendingSelections.push(selection);
    activeSelectionId = selection.id;
    setMode(false);
    createPendingScreenEdit(selection, clientRect);
    syncEditSdfs();
    syncFarHandles();
    syncTransformControlsState();
    refreshUi();
    setStatus(
      'Added screen exclude selection. Drag corner points or edges into a convex quadrilateral before moving the camera, then adjust the 3D far plane and Confirm or Cancel.',
    );
  }

  function formatKeepSphereSize(size) {
    const value = Number(size);
    if (!Number.isFinite(value)) {
      return '0';
    }
    const abs = Math.abs(value);
    if (abs > 0 && (abs < 0.001 || abs >= 1000000)) {
      return value.toExponential(3).replace(/\.?0+e/, 'e');
    }
    return (abs < 1 ? value.toFixed(3) : value.toFixed(2)).replace(
      /\.?0+$/,
      '',
    );
  }

  function createKeepSphere() {
    if (!hasGaussianSplats) {
      setStatus('Crop sphere is available for 3D Gaussian Splat tilesets only.', true);
      return;
    }
    if (keepSphere) {
      setStatus('Only one crop sphere can be active.', true);
      return;
    }
    if (!getTilesetBoundingSphere(sphere)) {
      setStatus('Tileset bounds are not ready yet.', true);
      return;
    }

    cancelMode();
    cancelOtherPositionPickModes();
    setTransformMode(null);

    getCurrentRootMatrix(rootMatrix);
    rootInverseMatrix.copy(rootMatrix).invert();
    const rootScale = getCurrentRootScale();
    const localRadius = Math.max(
      KEEP_SPHERE_MIN_RADIUS,
      sphere.radius / rootScale,
    );
    sphereLocalCenter.copy(sphere.center).applyMatrix4(rootInverseMatrix);
    keepSphere = {
      action: SCREEN_SELECTION_ACTION_INCLUDE,
      confirmed: false,
      id: nextSelectionId++,
      localBaseRadius: localRadius,
      localCenter: sphereLocalCenter.toArray(),
      localRadius,
      radiusExponent: 0,
      type: 'sphere',
      worldCenter: sphere.center.toArray(),
      worldRadius: sphere.radius,
    };
    activeSelectionId = keepSphere.id;
    updateKeepSphereWorldState();
    syncEditSdfs();
    syncFarHandles();
    syncTransformControlsState();
    refreshUi();
    setStatus(
      'Created crop sphere at the tileset center. Adjust size or move it, then Confirm or Cancel.',
    );
  }

  function confirmKeepSphere() {
    if (!keepSphere || keepSphere.confirmed) {
      return;
    }
    keepSphere.confirmed = true;
    activeSelectionId = null;
    keepSphereCenterPick = null;
    syncEditSdfs();
    syncFarHandles();
    syncTransformControlsState();
    refreshUi();
    setStatus('Confirmed crop sphere. Splats outside the sphere are hidden and will be removed on Save. Select its row to adjust it again.');
  }

  function cancelKeepSphere() {
    if (!keepSphere || keepSphere.confirmed) {
      return;
    }
    if (activeSelectionId === keepSphere.id) {
      activeSelectionId = null;
    }
    disposeKeepSphere(keepSphere);
    keepSphere = null;
    keepSphereCenterPick = null;
    keepSphereTrackDrag = null;
    syncEditSdfs();
    syncFarHandles();
    syncTransformControlsState();
    refreshUi();
    setStatus('Crop sphere cancelled.');
  }

  function removeKeepSphere() {
    if (!keepSphere) {
      return;
    }
    if (activeSelectionId === keepSphere.id) {
      activeSelectionId = null;
    }
    disposeKeepSphere(keepSphere);
    keepSphere = null;
    keepSphereCenterPick = null;
    keepSphereTrackDrag = null;
    syncEditSdfs();
    syncFarHandles();
    syncTransformControlsState();
    refreshUi();
    setStatus('Removed crop sphere.');
  }

  function selectKeepSphere() {
    if (!keepSphere) {
      return;
    }
    activeSelectionId = activeSelectionId === keepSphere.id ? null : keepSphere.id;
    if (activeSelectionId !== keepSphere.id) {
      keepSphereCenterPick = null;
    }
    setTransformMode(null);
    syncEditSdfs();
    syncFarHandles();
    syncTransformControlsState();
    refreshUi();
    setStatus(
      activeSelectionId === keepSphere?.id
        ? 'Drag the crop sphere transform controls or adjust size.'
        : 'Crop sphere deactivated.',
    );
  }

  function setKeepSphereRadiusExponent(exponent, { commit = false } = {}) {
    if (!keepSphere || interactionLocked) {
      return false;
    }
    const nextExponent = Number(exponent);
    if (!Number.isFinite(nextExponent)) {
      return false;
    }
    const nextScale = 2 ** nextExponent;
    const nextLocalRadius = keepSphere.localBaseRadius * nextScale;
    if (!Number.isFinite(nextLocalRadius)) {
      return false;
    }
    keepSphere.radiusExponent = nextExponent;
    keepSphere.localRadius = Math.max(
      KEEP_SPHERE_MIN_RADIUS,
      nextLocalRadius,
    );
    updateKeepSphereWorldState();
    syncEditSdfs();
    refreshUi();
    if (commit) {
      setStatus(
        `Crop sphere size set to ${formatKeepSphereSize(keepSphere.worldRadius)}.`,
      );
    }
    return true;
  }

  function setKeepSphereSizeValue(value, { commit = false } = {}) {
    const nextWorldRadius = Number(value);
    if (
      !keepSphere ||
      interactionLocked ||
      !Number.isFinite(nextWorldRadius) ||
      nextWorldRadius <= 0
    ) {
      return false;
    }
    const rootScale = getCurrentRootScale();
    const nextLocalRadius = nextWorldRadius / rootScale;
    const nextExponent = Math.log2(nextLocalRadius / keepSphere.localBaseRadius);
    if (!setKeepSphereRadiusExponent(nextExponent)) {
      return false;
    }
    if (commit) {
      setStatus(
        `Crop sphere size set to ${formatKeepSphereSize(keepSphere.worldRadius)}.`,
      );
    }
    return true;
  }

  function beginKeepSphereRadiusTrackDrag(clientX) {
    if (!keepSphere || interactionLocked) {
      return false;
    }
    keepSphereTrackDrag = {
      startClientX: clientX,
      startExponent: keepSphere.radiusExponent,
    };
    viewerElements.keepSphereRadiusTrackEl?.style.setProperty(
      '--scale-track-offset',
      '0px',
    );
    return true;
  }

  function setKeepSphereRadiusFromTrackClientX(clientX) {
    if (!keepSphere || !keepSphereTrackDrag || interactionLocked) {
      return false;
    }
    const deltaX = clientX - keepSphereTrackDrag.startClientX;
    viewerElements.keepSphereRadiusTrackEl?.style.setProperty(
      '--scale-track-offset',
      `${deltaX}px`,
    );
    return setKeepSphereRadiusExponent(
      keepSphereTrackDrag.startExponent +
        deltaX / KEEP_SPHERE_RADIUS_TRACK_PIXELS_PER_EXPONENT,
    );
  }

  function endKeepSphereRadiusTrackDrag({ commit = false } = {}) {
    if (!keepSphereTrackDrag) {
      return false;
    }
    keepSphereTrackDrag = null;
    viewerElements.keepSphereRadiusTrackEl?.style.setProperty(
      '--scale-track-offset',
      '0px',
    );
    if (commit && keepSphere) {
      setStatus(
        `Crop sphere size set to ${formatKeepSphereSize(keepSphere.worldRadius)}.`,
      );
    }
    return true;
  }

  function nudgeKeepSphereRadiusExponent(delta) {
    if (interactionLocked) {
      return false;
    }
    return setKeepSphereRadiusExponent(
      (keepSphere?.radiusExponent || 0) + delta,
      { commit: true },
    );
  }

  function toggle() {
    if (!hasGaussianSplats) {
      setStatus(
        'Screen selection is available for 3D Gaussian Splat tilesets only.',
        true,
      );
      return;
    }

    if (pendingMode) {
      setMode(false);
      setStatus('Screen selection paused.');
      return;
    }

    if (pendingSelections.length > 0) {
      setStatus(
        'Confirm or Cancel the current screen selection before drawing another.',
        true,
      );
      return;
    }

    setMode(true);
    setStatus('Drag one screen exclude rectangle.');
  }

  function confirm() {
    if (pendingSelections.length === 0) {
      return;
    }

    const count = pendingSelections.length;
    selections.push(...pendingSelections);
    clearPendingScreenEdit();
    pendingSelections = [];
    activeSelectionId = null;
    setMode(false);
    syncEditSdfs();
    syncFarHandles();
    syncTransformControlsState();
    refreshUi();
    setStatus(
      `Confirmed ${count} screen selection${count === 1 ? '' : 's'}. Click its row to adjust the 3D far plane, or Save to apply.`,
    );
  }

  function cancel() {
    const hadMode = pendingMode;
    const hadSelection = pendingSelections.length > 0;
    cancelMode();
    if (
      pendingSelections.some(
        (selection) => selection.id === activeSelectionId,
      )
    ) {
      activeSelectionId = null;
    }
    clearPendingScreenEdit();
    pendingSelections.forEach(disposeScreenSelection);
    pendingSelections = [];
    syncEditSdfs();
    syncFarHandles();
    refreshUi();
    syncTransformControlsState();
    if (hadMode || hadSelection) {
      setStatus('Screen selection cancelled.');
    }
  }

  function findSelection(selectionId) {
    const id = Number(selectionId);
    if (keepSphere?.id === id) {
      return { confirmed: keepSphere.confirmed, selection: keepSphere };
    }
    let selection = selections.find((entry) => entry.id === id);
    if (selection) {
      return { confirmed: true, selection };
    }

    selection = pendingSelections.find((entry) => entry.id === id);
    return selection ? { confirmed: false, selection } : null;
  }

  function updateFarDepth(selectionId, farDepth, commit) {
    const match = findSelection(selectionId);
    if (!match) {
      return;
    }

    setScreenSelectionFarDepth(
      match.selection,
      farDepth,
      getCurrentRootTransformArray(),
    );
    syncEditSdfs();
    syncFarHandles();

    if (commit) {
      refreshUi();
      setStatus('Updated screen selection far plane.');
    }
  }

  function handleTransformControlObjectChange(object) {
    if (interactionLocked) {
      return !!(
        object?.userData?.keepSphereHandle ||
        object?.userData?.screenSelectionFarHandle
      );
    }

    if (object?.userData?.keepSphereHandle) {
      if (!keepSphere || object.userData.screenSelectionId !== keepSphere.id) {
        return true;
      }
      getCurrentRootMatrix(rootMatrix);
      rootInverseMatrix.copy(rootMatrix).invert();
      sphereLocalCenter.copy(object.position).applyMatrix4(rootInverseMatrix);
      keepSphere.localCenter = sphereLocalCenter.toArray();
      updateKeepSphereWorldState();
      syncEditSdfs();
      refreshUi();
      return true;
    }

    if (!object?.userData?.screenSelectionFarHandle) {
      return false;
    }

    const match = findSelection(object.userData.screenSelectionId);
    if (!match) {
      return true;
    }

    updateFarDepth(
      match.selection.id,
      getScreenSelectionFarDepthFromPosition(
        match.selection,
        object.position,
        getCurrentRootTransformArray(),
      ),
      false,
    );
    refreshUi();
    return true;
  }

  function handleSelectionSelect(selectionId) {
    const match = findSelection(selectionId);
    if (!match) {
      return;
    }

    const wasActive = activeSelectionId === match.selection.id;
    activeSelectionId = wasActive ? null : match.selection.id;
    setTransformMode(null);
    syncEditSdfs();
    syncFarHandles();
    syncPendingEditOverlay();
    refreshUi();
    syncTransformControlsState();
    const canEditPendingRect = !wasActive && !!getActivePendingEdit();
    setStatus(
      wasActive
        ? 'Screen selection deactivated.'
        : canEditPendingRect
          ? 'Drag corner points or edges into a convex quadrilateral before moving the camera, or drag the 3D far plane to adjust depth.'
        : 'Drag the 3D far plane handle to adjust screen selection depth.',
    );
  }

  function removeFromList(list, selectionId) {
    const id = Number(selectionId);
    const index = list.findIndex((selection) => selection.id === id);
    if (index === -1) {
      return false;
    }

    const [selection] = list.splice(index, 1);
    disposeScreenSelection(selection);
    return true;
  }

  function handleSelectionRemove(selectionId) {
    const removed =
      removeFromList(selections, selectionId) ||
      removeFromList(pendingSelections, selectionId);
    if (!removed) {
      return;
    }

    if (Number(selectionId) === activeSelectionId) {
      activeSelectionId = null;
    }
    if (Number(selectionId) === pendingScreenEdit?.selectionId) {
      clearPendingScreenEdit();
    }
    syncEditSdfs();
    syncFarHandles();
    refreshUi();
    syncTransformControlsState();
    setStatus('Removed screen selection.');
  }

  function getPayload() {
    syncWorldState();
    const payload = selections.map(getScreenSelectionPayload);
    if (keepSphere?.confirmed) {
      payload.push(getScreenSelectionPayload(keepSphere));
    }
    return payload;
  }

  function clearAll() {
    cancelMode();
    selections.forEach(disposeScreenSelection);
    pendingSelections.forEach(disposeScreenSelection);
    disposeKeepSphere(keepSphere);
    selections = [];
    pendingSelections = [];
    keepSphere = null;
    keepSphereCenterPick = null;
    keepSphereTrackDrag = null;
    activeSelectionId = null;
    clearPendingScreenEdit();
    syncEditSdfs();
    syncFarHandles();
    refreshUi();
    syncTransformControlsState();
  }

  function setHasGaussianSplats(value) {
    hasGaussianSplats = !!value;
    refreshUi();
  }

  function setInteractionLocked(value) {
    const locked = !!value;
    if (interactionLocked === locked) {
      return;
    }

    interactionLocked = locked;
    if (interactionLocked) {
      keepSphereCenterPick = null;
      keepSphereTrackDrag = null;
      viewerElements.keepSphereRadiusTrackEl?.classList.remove('dragging');
      viewerElements.keepSphereRadiusTrackEl?.style.setProperty(
        '--scale-track-offset',
        '0px',
      );
    }
    syncWorldState();
    refreshUi();
    syncTransformControlsState();
  }

  function deactivate() {
    activeSelectionId = null;
    keepSphereCenterPick = null;
    syncEditSdfs();
    syncFarHandles();
    syncPendingEditOverlay();
    cancelMode();
    refreshUi();
  }

  function notifyTransformModeChanged() {
    if (activeSelectionId == null) {
      return;
    }
    activeSelectionId = null;
    syncEditSdfs();
    syncFarHandles();
    syncPendingEditOverlay();
    refreshUi();
  }

  function shouldCapturePointerDown(event) {
    return (
      event.button === 0 &&
      (pendingMode || getPendingEditHit(event) !== null)
    );
  }

  function handlePointerDown(event) {
    if (pointerTracker.handlePointerDown(event)) {
      return true;
    }
    if (handlePendingEditPointerDown(event)) {
      return true;
    }
    return handleKeepSphereCenterPickPointerDown(event);
  }

  function handlePointerMove(event) {
    if (handleKeepSphereCenterPickPointerMove(event)) {
      return true;
    }
    if (pointerTracker.handlePointerMove(event)) {
      return true;
    }
    return handlePendingEditPointerMove(event);
  }

  function handlePointerUp(event) {
    if (handleKeepSphereCenterPickPointerUp(event)) {
      return true;
    }
    if (pointerTracker.handlePointerUp(event)) {
      return true;
    }
    return handlePendingEditPointerUp(event);
  }

  function handlePointerCancel(event) {
    if (handleKeepSphereCenterPickPointerCancel(event)) {
      return true;
    }
    if (pointerTracker.handlePointerCancel(event)) {
      return true;
    }
    return handlePendingEditPointerCancel(event);
  }

  function isRaycastHitVisible(intersection) {
    if (!hasGaussianSplats || !isGaussianSplatObject(intersection?.object)) {
      return true;
    }
    if (!intersection?.point) {
      return true;
    }
    return isSplatPointVisibleForRaycast(intersection.point);
  }

  cameraController.addEventListener(
    'update',
    freezePendingScreenEditIfCameraChanged,
  );
  cameraController.addEventListener(
    'finish',
    freezePendingScreenEditIfCameraChanged,
  );

  return {
    cancel,
    cancelMode,
    clearAll,
    confirm,
    deactivate,
    getActiveSelection,
    getPayload,
    getPendingMode: () => pendingMode,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleSelectionRemove,
    handleSelectionSelect,
    handleTransformControlObjectChange,
    isRaycastHitVisible,
    hasPendingSelections: () =>
      pendingSelections.length > 0 || (keepSphere && !keepSphere.confirmed),
    beginKeepSphereRadiusTrackDrag,
    cancelKeepSphere,
    confirmKeepSphere,
    createKeepSphere,
    endKeepSphereRadiusTrackDrag,
    nudgeKeepSphereRadiusExponent,
    notifyTransformModeChanged,
    setKeepSphereRadiusFromTrackClientX,
    setKeepSphereSizeValue,
    setHasGaussianSplats,
    setInteractionLocked,
    isInteractionLocked: () => interactionLocked,
    shouldCapturePointerDown,
    syncWorldState,
    toggle,
  };
}
