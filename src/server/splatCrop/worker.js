const { parentPort } = require('worker_threads');

let modulesPromise = null;

function getModules() {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import('three'),
      import('@sparkjsdev/spark'),
    ]).then(([threeModule, sparkModule]) => ({
      THREE: threeModule,
      SpzReader: sparkModule.SpzReader,
      SpzWriter: sparkModule.SpzWriter,
    }));
  }
  return modulesPromise;
}

function copyShArray(source, width, index) {
  if (!source) {
    return undefined;
  }
  return source.subarray(index * width, index * width + width);
}

function createSplatArrays(spz) {
  const centers = new Float64Array(spz.numSplats * 3);
  const alphas = new Float64Array(spz.numSplats);
  const rgbs = new Float64Array(spz.numSplats * 3);
  const scales = new Float64Array(spz.numSplats * 3);
  const quats = new Float64Array(spz.numSplats * 4);
  const sh1Values =
    spz.shDegree >= 1 ? new Float32Array(spz.numSplats * 9) : null;
  const sh2Values =
    spz.shDegree >= 2 ? new Float32Array(spz.numSplats * 15) : null;
  const sh3Values =
    spz.shDegree >= 3 ? new Float32Array(spz.numSplats * 21) : null;

  return {
    alphas,
    centers,
    quats,
    rgbs,
    scales,
    sh1Values,
    sh2Values,
    sh3Values,
  };
}

async function readSpzData(spz) {
  const data = createSplatArrays(spz);
  await spz.parseSplats(
    (index, x, y, z) => {
      data.centers[index * 3] = x;
      data.centers[index * 3 + 1] = y;
      data.centers[index * 3 + 2] = z;
    },
    (index, alpha) => {
      data.alphas[index] = alpha;
    },
    (index, r, g, b) => {
      data.rgbs[index * 3] = r;
      data.rgbs[index * 3 + 1] = g;
      data.rgbs[index * 3 + 2] = b;
    },
    (index, scaleX, scaleY, scaleZ) => {
      data.scales[index * 3] = scaleX;
      data.scales[index * 3 + 1] = scaleY;
      data.scales[index * 3 + 2] = scaleZ;
    },
    (index, quatX, quatY, quatZ, quatW) => {
      data.quats[index * 4] = quatX;
      data.quats[index * 4 + 1] = quatY;
      data.quats[index * 4 + 2] = quatZ;
      data.quats[index * 4 + 3] = quatW;
    },
    (index, sh1, sh2, sh3) => {
      if (data.sh1Values && sh1) {
        data.sh1Values.set(sh1, index * 9);
      }
      if (data.sh2Values && sh2) {
        data.sh2Values.set(sh2, index * 15);
      }
      if (data.sh3Values && sh3) {
        data.sh3Values.set(sh3, index * 21);
      }
    },
  );
  return data;
}

function buildSourceToScreenSelections(
  THREE,
  screenSelections,
  descriptors,
) {
  const sourceToScreenSelections = [];
  screenSelections.forEach((selection) => {
    const viewProjectionMatrix = new THREE.Matrix4().fromArray(
      selection.viewProjectionMatrix,
    );
    descriptors.forEach((descriptor) => {
      const sourceToWorldMatrix = new THREE.Matrix4().fromArray(
        descriptor.sourceToWorldMatrix,
      );
      sourceToScreenSelections.push({
        planes: selection.planeMatrices
          ? buildSourceSpacePlanes(
              THREE,
              selection.planeMatrices,
              sourceToWorldMatrix,
            )
          : null,
        matrix: viewProjectionMatrix
          .clone()
          .multiply(sourceToWorldMatrix),
        rect: selection.rect,
      });
    });
  });
  return sourceToScreenSelections;
}

function createPlaneFromMatrix(THREE, matrixArray) {
  const matrix = new THREE.Matrix4().fromArray(matrixArray);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const normal = new THREE.Vector3(0, 0, 1);
  matrix.decompose(position, quaternion, scale);
  normal.applyQuaternion(quaternion).normalize();
  return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, position);
}

function buildSourceSpacePlanes(THREE, planeMatrices, sourceToWorldMatrix) {
  const worldToSourceMatrix = sourceToWorldMatrix.clone().invert();
  return planeMatrices.map((matrixArray) =>
    createPlaneFromMatrix(THREE, matrixArray).applyMatrix4(
      worldToSourceMatrix,
    ),
  );
}

function centerIsInsideScreenSelection(center, clip, selection) {
  if (selection.planes) {
    return selection.planes.every((plane) => plane.distanceToPoint(center) <= 0);
  }

  clip.set(center.x, center.y, center.z, 1).applyMatrix4(selection.matrix);
  if (!Number.isFinite(clip.w) || clip.w <= 0) {
    return false;
  }

  const inverseW = 1 / clip.w;
  const x = clip.x * inverseW;
  const y = clip.y * inverseW;
  const z = clip.z * inverseW;
  const rect = selection.rect;
  return (
    x >= rect.minX &&
    x <= rect.maxX &&
    y >= rect.minY &&
    y <= rect.maxY &&
    z >= -1 &&
    z <= 1
  );
}

function centerIsSelectedForDeletion(
  center,
  clip,
  sourceToScreenSelections,
) {
  for (const selection of sourceToScreenSelections) {
    if (centerIsInsideScreenSelection(center, clip, selection)) {
      return true;
    }
  }
  return false;
}

function collectSurvivorIndices(
  THREE,
  splatData,
  splatCount,
  sourceToScreenSelections,
) {
  const center = new THREE.Vector3();
  const clip = new THREE.Vector4();
  const survivors = [];
  for (let index = 0; index < splatCount; index++) {
    center.set(
      splatData.centers[index * 3],
      splatData.centers[index * 3 + 1],
      splatData.centers[index * 3 + 2],
    );
    const selectedForDeletion = centerIsSelectedForDeletion(
      center,
      clip,
      sourceToScreenSelections,
    );
    if (!selectedForDeletion) {
      survivors.push(index);
    }
  }
  return survivors;
}

function createBounds() {
  return {
    max: [-Infinity, -Infinity, -Infinity],
    min: [Infinity, Infinity, Infinity],
  };
}

function getProjectionMatrices(THREE, descriptors) {
  return descriptors.map((descriptor) =>
    new THREE.Matrix4().fromArray(
      descriptor.sourceToProjectionMatrix ||
        descriptor.sourceToWorldMatrix,
    ),
  );
}

function getSurvivorProjectedBounds(
  THREE,
  splatData,
  survivors,
  descriptors,
) {
  if (survivors.length === 0) {
    return null;
  }

  const projectionMatrices = getProjectionMatrices(THREE, descriptors);
  const bounds = createBounds();
  const projected = new THREE.Vector3();
  survivors.forEach((index) => {
    projectionMatrices.forEach((matrix) => {
      projected
        .set(
          splatData.centers[index * 3],
          splatData.centers[index * 3 + 1],
          splatData.centers[index * 3 + 2],
        )
        .applyMatrix4(matrix);
      bounds.min[0] = Math.min(bounds.min[0], projected.x);
      bounds.min[1] = Math.min(bounds.min[1], projected.y);
      bounds.min[2] = Math.min(bounds.min[2], projected.z);
      bounds.max[0] = Math.max(bounds.max[0], projected.x);
      bounds.max[1] = Math.max(bounds.max[1], projected.y);
      bounds.max[2] = Math.max(bounds.max[2], projected.z);
    });
  });
  return bounds;
}

async function writeSurvivingSpzBytes(SpzWriter, spz, splatData, survivors) {
  const writer = new SpzWriter({
    numSplats: survivors.length,
    shDegree: spz.shDegree,
    fractionalBits: spz.fractionalBits,
    flagAntiAlias: spz.flagAntiAlias,
  });

  survivors.forEach((sourceIndex, targetIndex) => {
    writer.setCenter(
      targetIndex,
      splatData.centers[sourceIndex * 3],
      splatData.centers[sourceIndex * 3 + 1],
      splatData.centers[sourceIndex * 3 + 2],
    );
    writer.setAlpha(targetIndex, splatData.alphas[sourceIndex]);
    writer.setRgb(
      targetIndex,
      splatData.rgbs[sourceIndex * 3],
      splatData.rgbs[sourceIndex * 3 + 1],
      splatData.rgbs[sourceIndex * 3 + 2],
    );
    writer.setScale(
      targetIndex,
      splatData.scales[sourceIndex * 3],
      splatData.scales[sourceIndex * 3 + 1],
      splatData.scales[sourceIndex * 3 + 2],
    );
    writer.setQuat(
      targetIndex,
      splatData.quats[sourceIndex * 4],
      splatData.quats[sourceIndex * 4 + 1],
      splatData.quats[sourceIndex * 4 + 2],
      splatData.quats[sourceIndex * 4 + 3],
    );
    if (spz.shDegree > 0) {
      writer.setSh(
        targetIndex,
        copyShArray(splatData.sh1Values, 9, sourceIndex),
        copyShArray(splatData.sh2Values, 15, sourceIndex),
        copyShArray(splatData.sh3Values, 21, sourceIndex),
      );
    }
  });

  return Buffer.from(await writer.finalize());
}

function throwUnsupportedLodError() {
  const err = new Error(
    'SPZ files with built-in LOD flags are not supported for crop deletion yet.',
  );
  err.name = 'InspectorError';
  throw err;
}

async function rewriteSpzBytes({
  bytes,
  descriptors,
  screenSelections,
}) {
  const { THREE, SpzReader, SpzWriter } = await getModules();
  const spz = new SpzReader({ fileBytes: Buffer.from(bytes) });
  await spz.parseHeader();
  if (spz.flagLod) {
    throwUnsupportedLodError();
  }

  const splatData = await readSpzData(spz);
  const sourceToScreenSelections = buildSourceToScreenSelections(
    THREE,
    screenSelections || [],
    descriptors,
  );
  const survivors = collectSurvivorIndices(
    THREE,
    splatData,
    spz.numSplats,
    sourceToScreenSelections,
  );
  const deleted = spz.numSplats - survivors.length;
  const bounds = getSurvivorProjectedBounds(
    THREE,
    splatData,
    survivors,
    descriptors,
  );
  if (survivors.length === 0) {
    return { bounds, bytes: null, deleted, empty: true };
  }
  if (deleted === 0) {
    return { bounds, bytes: null, deleted: 0, empty: false };
  }

  return {
    bounds,
    bytes: await writeSurvivingSpzBytes(SpzWriter, spz, splatData, survivors),
    deleted,
    empty: false,
  };
}

parentPort.on('message', async (message) => {
  try {
    if (message.type !== 'rewriteSpzBytes') {
      throw new Error(`Unsupported worker message type: ${message.type}`);
    }

    const result = await rewriteSpzBytes(message.payload);
    let bytes = null;
    const transferList = [];
    if (result.bytes) {
      bytes = Uint8Array.from(result.bytes);
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
