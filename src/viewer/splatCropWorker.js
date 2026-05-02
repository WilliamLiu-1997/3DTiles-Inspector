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

async function rewriteSpzBytes({ bytes, cropBoxMatrices, descriptors }) {
  const { THREE, SpzReader, SpzWriter } = await getModules();
  const spz = new SpzReader({ fileBytes: Buffer.from(bytes) });
  await spz.parseHeader();
  if (spz.flagLod) {
    const err = new Error(
      'SPZ files with built-in LOD flags are not supported for crop deletion yet.',
    );
    err.name = 'InspectorError';
    throw err;
  }

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

  await spz.parseSplats(
    (index, x, y, z) => {
      centers[index * 3] = x;
      centers[index * 3 + 1] = y;
      centers[index * 3 + 2] = z;
    },
    (index, alpha) => {
      alphas[index] = alpha;
    },
    (index, r, g, b) => {
      rgbs[index * 3] = r;
      rgbs[index * 3 + 1] = g;
      rgbs[index * 3 + 2] = b;
    },
    (index, scaleX, scaleY, scaleZ) => {
      scales[index * 3] = scaleX;
      scales[index * 3 + 1] = scaleY;
      scales[index * 3 + 2] = scaleZ;
    },
    (index, quatX, quatY, quatZ, quatW) => {
      quats[index * 4] = quatX;
      quats[index * 4 + 1] = quatY;
      quats[index * 4 + 2] = quatZ;
      quats[index * 4 + 3] = quatW;
    },
    (index, sh1, sh2, sh3) => {
      if (sh1Values && sh1) {
        sh1Values.set(sh1, index * 9);
      }
      if (sh2Values && sh2) {
        sh2Values.set(sh2, index * 15);
      }
      if (sh3Values && sh3) {
        sh3Values.set(sh3, index * 21);
      }
    },
  );

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

  const center = new THREE.Vector3();
  const local = new THREE.Vector3();
  const survivors = [];
  for (let index = 0; index < spz.numSplats; index++) {
    center.set(
      centers[index * 3],
      centers[index * 3 + 1],
      centers[index * 3 + 2],
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

  const deleted = spz.numSplats - survivors.length;
  if (survivors.length === 0) {
    return { bytes: null, deleted, empty: true };
  }

  if (deleted === 0) {
    return { bytes: null, deleted: 0, empty: false };
  }

  const writer = new SpzWriter({
    numSplats: survivors.length,
    shDegree: spz.shDegree,
    fractionalBits: spz.fractionalBits,
    flagAntiAlias: spz.flagAntiAlias,
  });

  survivors.forEach((sourceIndex, targetIndex) => {
    writer.setCenter(
      targetIndex,
      centers[sourceIndex * 3],
      centers[sourceIndex * 3 + 1],
      centers[sourceIndex * 3 + 2],
    );
    writer.setAlpha(targetIndex, alphas[sourceIndex]);
    writer.setRgb(
      targetIndex,
      rgbs[sourceIndex * 3],
      rgbs[sourceIndex * 3 + 1],
      rgbs[sourceIndex * 3 + 2],
    );
    writer.setScale(
      targetIndex,
      scales[sourceIndex * 3],
      scales[sourceIndex * 3 + 1],
      scales[sourceIndex * 3 + 2],
    );
    writer.setQuat(
      targetIndex,
      quats[sourceIndex * 4],
      quats[sourceIndex * 4 + 1],
      quats[sourceIndex * 4 + 2],
      quats[sourceIndex * 4 + 3],
    );
    if (spz.shDegree > 0) {
      writer.setSh(
        targetIndex,
        copyShArray(sh1Values, 9, sourceIndex),
        copyShArray(sh2Values, 15, sourceIndex),
        copyShArray(sh3Values, 21, sourceIndex),
      );
    }
  });

  return {
    bytes: Buffer.from(await writer.finalize()),
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
