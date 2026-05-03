import { updateOverlayRect } from './geometry.js';

export const SCREEN_EDIT_EDGE_HIT_SIZE = 8;
export const SCREEN_EDIT_CORNER_HIT_SIZE = 12;
const SCREEN_EDIT_EDGE_HANDLE_MAX_LENGTH = 26;
const SCREEN_EDIT_EDGE_HANDLE_MIN_LENGTH = 6;
const SCREEN_EDIT_GRID_DIVISIONS = 8;
const SCREEN_EDIT_MIN_CONVEX_CROSS_ABS = 1e-3;

export const SCREEN_EDIT_HANDLE_PARTS = [
  'top-left',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
];
export const SCREEN_EDIT_CORNER_PARTS = [
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
];
export const SCREEN_EDIT_EDGE_PARTS = ['top', 'right', 'bottom', 'left'];
export const SCREEN_EDIT_PART_POINT_INDICES = {
  'bottom-left': [3],
  'bottom-right': [2],
  bottom: [2, 3],
  left: [3, 0],
  right: [1, 2],
  top: [0, 1],
  'top-left': [0],
  'top-right': [1],
};

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function copyClientPoint(point) {
  return {
    x: Number(point?.x) || 0,
    y: Number(point?.y) || 0,
  };
}

export function copyClientPoints(points) {
  return points.map(copyClientPoint);
}

function getClientPointsBounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    minX: Math.min(...xs),
    minY: Math.min(...ys),
  };
}

export function getClientRectPoints(rect) {
  return [
    { x: Number(rect?.minX) || 0, y: Number(rect?.minY) || 0 },
    { x: Number(rect?.maxX) || 0, y: Number(rect?.minY) || 0 },
    { x: Number(rect?.maxX) || 0, y: Number(rect?.maxY) || 0 },
    { x: Number(rect?.minX) || 0, y: Number(rect?.maxY) || 0 },
  ];
}

function clampClientPoint(point, domRect) {
  return {
    x: clampValue(point.x, domRect.left, domRect.right),
    y: clampValue(point.y, domRect.top, domRect.bottom),
  };
}

export function clampClientPoints(points, domElement) {
  const domRect = domElement.getBoundingClientRect();
  return points.map((point) => clampClientPoint(point, domRect));
}

function getPointTurnCross(a, b, c) {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

export function isConvexClientQuad(points) {
  if (!Array.isArray(points) || points.length !== 4) {
    return false;
  }

  let turnSign = 0;
  for (let index = 0; index < points.length; index++) {
    const cross = getPointTurnCross(
      points[index],
      points[(index + 1) % points.length],
      points[(index + 2) % points.length],
    );
    if (Math.abs(cross) <= SCREEN_EDIT_MIN_CONVEX_CROSS_ABS) {
      return false;
    }

    const nextSign = Math.sign(cross);
    if (turnSign === 0) {
      turnSign = nextSign;
    } else if (nextSign !== turnSign) {
      return false;
    }
  }

  return true;
}

export function getPartPoint(points, part) {
  const indices = SCREEN_EDIT_PART_POINT_INDICES[part] || [];
  if (indices.length === 0) {
    return { x: 0, y: 0 };
  }
  const x =
    indices.reduce((total, index) => total + points[index].x, 0) /
    indices.length;
  const y =
    indices.reduce((total, index) => total + points[index].y, 0) /
    indices.length;
  return { x, y };
}

function getPartAngle(points, part) {
  const indices = SCREEN_EDIT_PART_POINT_INDICES[part] || [];
  if (indices.length !== 2) {
    return null;
  }

  const start = points[indices[0]];
  const end = points[indices[1]];
  return Math.atan2(end.y - start.y, end.x - start.x);
}

function getPartLength(points, part) {
  const indices = SCREEN_EDIT_PART_POINT_INDICES[part] || [];
  if (indices.length !== 2) {
    return null;
  }

  const start = points[indices[0]];
  const end = points[indices[1]];
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function interpolatePoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function updateScreenEditGrid(grid, localPoints, visible) {
  if (!grid) {
    return;
  }

  grid.replaceChildren();
  grid.hidden = !visible;
  if (!visible) {
    return;
  }

  const [topLeft, topRight, bottomRight, bottomLeft] = localPoints;
  for (let index = 1; index < SCREEN_EDIT_GRID_DIVISIONS; index++) {
    const t = index / SCREEN_EDIT_GRID_DIVISIONS;
    const top = interpolatePoint(topLeft, topRight, t);
    const bottom = interpolatePoint(bottomLeft, bottomRight, t);
    const left = interpolatePoint(topLeft, bottomLeft, t);
    const right = interpolatePoint(topRight, bottomRight, t);
    const verticalLine = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'line',
    );
    const horizontalLine = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'line',
    );
    verticalLine.setAttribute('x1', String(top.x));
    verticalLine.setAttribute('y1', String(top.y));
    verticalLine.setAttribute('x2', String(bottom.x));
    verticalLine.setAttribute('y2', String(bottom.y));
    horizontalLine.setAttribute('x1', String(left.x));
    horizontalLine.setAttribute('y1', String(left.y));
    horizontalLine.setAttribute('x2', String(right.x));
    horizontalLine.setAttribute('y2', String(right.y));
    grid.append(verticalLine, horizontalLine);
  }
}

function ensureEditableRectHandles(rectEl) {
  if (!rectEl || rectEl.dataset.editHandlesReady === 'true') {
    return;
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const polygon = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'polygon',
  );
  const grid = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.classList.add('screen-selection-edit-svg');
  grid.classList.add('screen-selection-edit-grid');
  polygon.classList.add('screen-selection-edit-polygon');
  svg.append(polygon, grid);
  rectEl.appendChild(svg);

  SCREEN_EDIT_HANDLE_PARTS.forEach((part) => {
    const handle = document.createElement('span');
    handle.classList.add(
      'screen-selection-edit-handle',
      `screen-selection-edit-${part}`,
    );
    handle.dataset.editPart = part;
    rectEl.appendChild(handle);
  });
  rectEl.dataset.editHandlesReady = 'true';
}

export function pointSegmentDistanceSq(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-12) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }

  const t = clampValue(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq,
    0,
    1,
  );
  const x = start.x + dx * t;
  const y = start.y + dy * t;
  const px = point.x - x;
  const py = point.y - y;
  return px * px + py * py;
}

export function createScreenEditOverlay({ overlayEl, rectEl }) {
  function render(clientPoints, { showGrid = false } = {}) {
    ensureEditableRectHandles(rectEl);
    rectEl?.classList.add('editable');
    rectEl?.classList.toggle('drawing', showGrid);
    const bounds = getClientPointsBounds(clientPoints);
    updateOverlayRect(overlayEl, rectEl, bounds);

    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const localPoints = clientPoints.map((point) => ({
      x: point.x - bounds.minX,
      y: point.y - bounds.minY,
    }));
    const svg = rectEl?.querySelector('.screen-selection-edit-svg');
    const polygon = rectEl?.querySelector('.screen-selection-edit-polygon');
    const grid = rectEl?.querySelector('.screen-selection-edit-grid');
    svg?.setAttribute('viewBox', `0 0 ${width} ${height}`);
    polygon?.setAttribute(
      'points',
      localPoints.map((point) => `${point.x},${point.y}`).join(' '),
    );
    updateScreenEditGrid(grid, localPoints, showGrid);

    SCREEN_EDIT_HANDLE_PARTS.forEach((part) => {
      const point = getPartPoint(localPoints, part);
      const handle = rectEl?.querySelector(`[data-edit-part="${part}"]`);
      if (!handle) {
        return;
      }
      handle.style.left = `${point.x}px`;
      handle.style.top = `${point.y}px`;
      const angle = getPartAngle(localPoints, part);
      const length = getPartLength(localPoints, part);
      if (length != null) {
        handle.style.width = `${Math.max(
          0,
          Math.min(SCREEN_EDIT_EDGE_HANDLE_MAX_LENGTH, length - 2),
        )}px`;
        handle.style.height = `${
          length <= SCREEN_EDIT_EDGE_HANDLE_MIN_LENGTH ? 2 : 4
        }px`;
      } else {
        handle.style.width = '';
        handle.style.height = '';
      }
      handle.style.transform =
        angle == null
          ? 'translate(-50%, -50%)'
          : `translate(-50%, -50%) rotate(${angle}rad)`;
    });
  }

  function clear() {
    rectEl?.classList.remove('drawing', 'editable');
  }

  return {
    clear,
    render,
  };
}
