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

function buildSourceToBoxMatrices(THREE, cropBoxMatrices, descriptors) {
  const sourceToBoxMatrices = [];
  cropBoxMatrices.forEach((boxMatrixArray) => {
    const boxInverse = new THREE.Matrix4().fromArray(boxMatrixArray).invert();
    descriptors.forEach((descriptor) => {
      sourceToBoxMatrices.push(
        boxInverse
          .clone()
          .multiply(
            new THREE.Matrix4().fromArray(descriptor.sourceToWorldMatrix),
          ),
      );
    });
  });
  return sourceToBoxMatrices;
}

function collectSurvivorIndices(THREE, splatData, splatCount, sourceToBoxMatrices) {
  const center = new THREE.Vector3();
  const local = new THREE.Vector3();
  const survivors = [];
  for (let index = 0; index < splatCount; index++) {
    center.set(
      splatData.centers[index * 3],
      splatData.centers[index * 3 + 1],
      splatData.centers[index * 3 + 2],
    );
    let inside = false;
    for (const matrix of sourceToBoxMatrices) {
      local.copy(center).applyMatrix4(matrix);
      if (
        Math.abs(local.x) <= 1 &&
        Math.abs(local.y) <= 1 &&
        Math.abs(local.z) <= 1
      ) {
        inside = true;
        break;
      }
    }
    if (!inside) {
      survivors.push(index);
    }
  }
  return survivors;
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

async function rewriteSpzBytes({ bytes, cropBoxMatrices, descriptors }) {
  const { THREE, SpzReader, SpzWriter } = await getModules();
  const spz = new SpzReader({ fileBytes: Buffer.from(bytes) });
  await spz.parseHeader();
  if (spz.flagLod) {
    throwUnsupportedLodError();
  }

  const splatData = await readSpzData(spz);
  const sourceToBoxMatrices = buildSourceToBoxMatrices(
    THREE,
    cropBoxMatrices,
    descriptors,
  );
  const survivors = collectSurvivorIndices(
    THREE,
    splatData,
    spz.numSplats,
    sourceToBoxMatrices,
  );
  const deleted = spz.numSplats - survivors.length;
  if (survivors.length === 0) {
    return { bytes: null, deleted, empty: true };
  }
  if (deleted === 0) {
    return { bytes: null, deleted: 0, empty: false };
  }

  return {
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
