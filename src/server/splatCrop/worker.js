const { parentPort } = require('worker_threads');
const {
  parseSpzPacket,
  writeSurvivingSpzBytes,
} = require('./spzSubsetWriter');

const SPZ_POSITION_STRIDE = 9;

function multiplyMatrix4(left, right) {
  const out = new Float64Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        sum += left[i * 4 + row] * right[column * 4 + i];
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function normalizePlaneValues(nx, ny, nz, constant, target, offset) {
  const length = Math.hypot(nx, ny, nz);
  if (!Number.isFinite(length) || length <= 0) {
    throw new Error('Invalid screen selection plane matrix.');
  }

  const inverseLength = 1 / length;
  target[offset] = nx * inverseLength;
  target[offset + 1] = ny * inverseLength;
  target[offset + 2] = nz * inverseLength;
  target[offset + 3] = constant * inverseLength;
}

function writeSourceSpacePlane(target, offset, planeMatrix, sourceToWorld) {
  const nx = planeMatrix[8];
  const ny = planeMatrix[9];
  const nz = planeMatrix[10];
  if (
    !Number.isFinite(nx) ||
    !Number.isFinite(ny) ||
    !Number.isFinite(nz) ||
    (nx === 0 && ny === 0 && nz === 0)
  ) {
    throw new Error('Invalid screen selection plane matrix.');
  }

  const constant = -(
    nx * planeMatrix[12] +
    ny * planeMatrix[13] +
    nz * planeMatrix[14]
  );

  normalizePlaneValues(
    sourceToWorld[0] * nx +
      sourceToWorld[1] * ny +
      sourceToWorld[2] * nz +
      sourceToWorld[3] * constant,
    sourceToWorld[4] * nx +
      sourceToWorld[5] * ny +
      sourceToWorld[6] * nz +
      sourceToWorld[7] * constant,
    sourceToWorld[8] * nx +
      sourceToWorld[9] * ny +
      sourceToWorld[10] * nz +
      sourceToWorld[11] * constant,
    sourceToWorld[12] * nx +
      sourceToWorld[13] * ny +
      sourceToWorld[14] * nz +
      sourceToWorld[15] * constant,
    target,
    offset,
  );
}

function buildSourceToScreenSelections(screenSelections, descriptors) {
  const sourceToScreenSelections = [];
  for (let i = 0; i < screenSelections.length; i++) {
    const selection = screenSelections[i];
    for (let j = 0; j < descriptors.length; j++) {
      const descriptor = descriptors[j];
      const sourceToWorldMatrix = descriptor.sourceToWorldMatrix;
      if (selection.planeMatrices) {
        sourceToScreenSelections.push({
          planes: buildSourceSpacePlaneValues(
            selection.planeMatrices,
            sourceToWorldMatrix,
          ),
        });
      } else {
        const rect = selection.rect;
        sourceToScreenSelections.push({
          matrix: multiplyMatrix4(
            selection.viewProjectionMatrix,
            sourceToWorldMatrix,
          ),
          maxX: rect.maxX,
          maxY: rect.maxY,
          minX: rect.minX,
          minY: rect.minY,
        });
      }
    }
  }
  return sourceToScreenSelections;
}

function buildSourceSpacePlaneValues(planeMatrices, sourceToWorldMatrix) {
  const values = new Float64Array(planeMatrices.length * 4);
  for (let i = 0; i < planeMatrices.length; i++) {
    writeSourceSpacePlane(
      values,
      i * 4,
      planeMatrices[i],
      sourceToWorldMatrix,
    );
  }
  return values;
}

function centerIsInsideScreenSelection(x, y, z, selection) {
  if (selection.planes) {
    const planes = selection.planes;
    for (let i = 0; i < planes.length; i += 4) {
      if (
        planes[i] * x +
          planes[i + 1] * y +
          planes[i + 2] * z +
          planes[i + 3] >
        0
      ) {
        return false;
      }
    }
    return true;
  }

  const e = selection.matrix;
  const clipW = e[3] * x + e[7] * y + e[11] * z + e[15];
  if (!Number.isFinite(clipW) || clipW <= 0) {
    return false;
  }

  const inverseW = 1 / clipW;
  const projectedX =
    (e[0] * x + e[4] * y + e[8] * z + e[12]) * inverseW;
  const projectedY =
    (e[1] * x + e[5] * y + e[9] * z + e[13]) * inverseW;
  const projectedZ =
    (e[2] * x + e[6] * y + e[10] * z + e[14]) * inverseW;
  return (
    projectedX >= selection.minX &&
    projectedX <= selection.maxX &&
    projectedY >= selection.minY &&
    projectedY <= selection.maxY &&
    projectedZ >= -1 &&
    projectedZ <= 1
  );
}

function centerIsSelectedForDeletion(
  x,
  y,
  z,
  sourceToScreenSelections,
) {
  for (let i = 0; i < sourceToScreenSelections.length; i++) {
    if (
      centerIsInsideScreenSelection(
        x,
        y,
        z,
        sourceToScreenSelections[i],
      )
    ) {
      return true;
    }
  }
  return false;
}

function createBounds() {
  return {
    max: [-Infinity, -Infinity, -Infinity],
    min: [Infinity, Infinity, Infinity],
  };
}

function buildProjectionMatrixValues(descriptors) {
  const values = new Float64Array(descriptors.length * 16);
  for (let i = 0; i < descriptors.length; i++) {
    const descriptor = descriptors[i];
    values.set(
      descriptor.sourceToProjectionMatrix ||
        descriptor.sourceToWorldMatrix,
      i * 16,
    );
  }
  return values;
}

function expandProjectedBounds(bounds, x, y, z, matrices) {
  const min = bounds.min;
  const max = bounds.max;
  let expanded = false;
  for (let offset = 0; offset < matrices.length; offset += 16) {
    const clipW =
      matrices[offset + 3] * x +
      matrices[offset + 7] * y +
      matrices[offset + 11] * z +
      matrices[offset + 15];
    if (!Number.isFinite(clipW) || clipW <= 0) {
      continue;
    }

    const inverseW = 1 / clipW;
    const projectedX =
      (matrices[offset] * x +
        matrices[offset + 4] * y +
        matrices[offset + 8] * z +
        matrices[offset + 12]) *
      inverseW;
    const projectedY =
      (matrices[offset + 1] * x +
        matrices[offset + 5] * y +
        matrices[offset + 9] * z +
        matrices[offset + 13]) *
      inverseW;
    const projectedZ =
      (matrices[offset + 2] * x +
        matrices[offset + 6] * y +
        matrices[offset + 10] * z +
        matrices[offset + 14]) *
      inverseW;
    if (
      !Number.isFinite(projectedX) ||
      !Number.isFinite(projectedY) ||
      !Number.isFinite(projectedZ)
    ) {
      continue;
    }

    if (projectedX < min[0]) min[0] = projectedX;
    if (projectedY < min[1]) min[1] = projectedY;
    if (projectedZ < min[2]) min[2] = projectedZ;
    if (projectedX > max[0]) max[0] = projectedX;
    if (projectedY > max[1]) max[1] = projectedY;
    if (projectedZ > max[2]) max[2] = projectedZ;
    expanded = true;
  }
  return expanded;
}

function analyzeSplats(parsed, sourceToScreenSelections, projectionMatrices) {
  const { raw, sourceCount, fractionalBits, layout } = parsed;
  const inverseFixed = 1 / 2 ** fractionalBits;
  const survivors = new Uint32Array(sourceCount);
  let survivorCount = 0;
  const bounds = createBounds();
  let hasBounds = false;

  let readOffset = layout.positionsOffset;
  for (let index = 0; index < sourceCount; index++) {
    const x =
      (((raw[readOffset + 2] << 24) |
        (raw[readOffset + 1] << 16) |
        (raw[readOffset] << 8)) >>
        8) * inverseFixed;
    const y =
      (((raw[readOffset + 5] << 24) |
        (raw[readOffset + 4] << 16) |
        (raw[readOffset + 3] << 8)) >>
        8) * inverseFixed;
    const z =
      (((raw[readOffset + 8] << 24) |
        (raw[readOffset + 7] << 16) |
        (raw[readOffset + 6] << 8)) >>
        8) * inverseFixed;

    if (
      !centerIsSelectedForDeletion(
        x,
        y,
        z,
        sourceToScreenSelections,
      )
    ) {
      survivors[survivorCount] = index;
      survivorCount += 1;
      hasBounds =
        expandProjectedBounds(bounds, x, y, z, projectionMatrices) ||
        hasBounds;
    }
    readOffset += SPZ_POSITION_STRIDE;
  }

  return {
    bounds: hasBounds ? bounds : null,
    survivors: survivors.subarray(0, survivorCount),
  };
}

function rewriteSpzBytes({
  bytes,
  descriptors,
  screenSelections,
}) {
  const parsed = parseSpzPacket(bytes);
  const sourceToScreenSelections = buildSourceToScreenSelections(
    screenSelections || [],
    descriptors,
  );
  const projectionMatrices = buildProjectionMatrixValues(descriptors);
  const { bounds, survivors } = analyzeSplats(
    parsed,
    sourceToScreenSelections,
    projectionMatrices,
  );
  const deleted = parsed.sourceCount - survivors.length;
  if (survivors.length === 0) {
    return {
      bounds,
      bytes: null,
      deleted,
      empty: true,
      splatCount: parsed.sourceCount,
      survivorCount: 0,
    };
  }
  if (deleted === 0) {
    return {
      bounds,
      bytes: null,
      deleted: 0,
      empty: false,
      splatCount: parsed.sourceCount,
      survivorCount: survivors.length,
    };
  }

  return {
    bounds,
    bytes: writeSurvivingSpzBytes(parsed, survivors),
    deleted,
    empty: false,
    splatCount: parsed.sourceCount,
    survivorCount: survivors.length,
  };
}

function getTransferableBytes(buffer) {
  // Pooled Buffers share larger ArrayBuffers; copy those instead of detaching the pool.
  if (
    buffer.byteOffset === 0 &&
    buffer.byteLength === buffer.buffer.byteLength
  ) {
    return new Uint8Array(buffer.buffer);
  }
  return Uint8Array.from(buffer);
}

parentPort.on('message', async (message) => {
  try {
    if (message.type !== 'rewriteSpzBytes') {
      throw new Error(`Unsupported worker message type: ${message.type}`);
    }

    const result = rewriteSpzBytes(message.payload);
    let bytes = null;
    const transferList = [];
    if (result.bytes) {
      bytes = getTransferableBytes(result.bytes);
      transferList.push(bytes.buffer);
    }

    parentPort.postMessage(
      {
        id: message.id,
        result: {
          bounds: result.bounds,
          bytes,
          deleted: result.deleted,
          empty: result.empty,
          splatCount: result.splatCount,
          survivorCount: result.survivorCount,
        },
      },
      transferList,
    );
  } catch (err) {
    parentPort.postMessage({
      error: {
        message: err && err.message ? err.message : String(err),
        name: err && err.name ? err.name : 'Error',
        stack: err && err.stack ? err.stack : undefined,
      },
      id: message.id,
    });
  }
});
