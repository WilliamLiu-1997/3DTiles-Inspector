export function normalizeLocalResourceUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  if (value.startsWith('//')) {
    return `/${value.replace(/^\/+/, '')}`;
  }

  if (value.startsWith('/')) {
    return value.replace(/\/{2,}/g, '/');
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    try {
      const parsed = new URL(value);
      if (parsed.origin === window.location.origin) {
        parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/');
        return parsed.toString();
      }
    } catch (err) {
      return value;
    }
  }

  return value;
}

export function forceOpaqueMaterial(material) {
  if (!material) {
    return;
  }
  if (Array.isArray(material)) {
    material.forEach(forceOpaqueMaterial);
    return;
  }
  material.transparent = false;
}

export function forceOpaqueScene(root) {
  root.traverse((child) => {
    if (child.material) {
      forceOpaqueMaterial(child.material);
    }
  });
}

export function getFiniteMatrix4Array(value, name = 'matrix') {
  if (!Array.isArray(value) || value.length !== 16) {
    throw new Error(`${name} must be a 16-number matrix.`);
  }

  return value.map((entry, index) => {
    const number = Number(entry);
    if (!Number.isFinite(number)) {
      throw new Error(`${name}[${index}] must be a finite number.`);
    }
    return number;
  });
}

export function composeMatrix(target, matrix) {
  matrix.decompose(target.position, target.quaternion, target.scale);
  target.updateMatrix();
  target.updateMatrixWorld(true);
}

export function formatCoordinateInputValue(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : '';
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function exponentToGeometricErrorScale(exponent) {
  return 2 ** exponent;
}

export function formatGeometricErrorScale(value) {
  if (value < 0.1) {
    return value.toFixed(3);
  }

  return value.toFixed(2);
}

export function formatBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let next = Math.max(0, Number(value) || 0);
  let unitIndex = 0;

  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex++;
  }

  if (unitIndex === 0) {
    return `${Math.round(next)} ${units[unitIndex]}`;
  }

  const digits = next >= 100 ? 0 : next >= 10 ? 1 : 2;
  return `${next.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatInteger(value) {
  return Math.max(0, Math.round(Number(value) || 0)).toLocaleString('en-US');
}

export function setRaycasterFromCamera(raycaster, coords, camera) {
  const { origin, direction } = raycaster.ray;
  const nearZ = camera.reversedDepth ? 1 : -1;
  const farZ = camera.reversedDepth ? 0 : 1;

  origin.set(coords.x, coords.y, nearZ).unproject(camera);
  direction.set(coords.x, coords.y, farZ).unproject(camera).sub(origin);
  raycaster.near = 0;
  raycaster.far = direction.length();
  raycaster.camera = camera;
  direction.normalize();
}

export function mouseToCoords(clientX, clientY, element, target) {
  const rect = element.getBoundingClientRect();
  target.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  target.y = -((clientY - rect.top) / rect.height) * 2 + 1;
}
