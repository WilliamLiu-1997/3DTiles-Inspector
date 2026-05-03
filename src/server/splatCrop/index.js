const path = require('path');

const { normalizeMatrix4Array, normalizeSplatScreenSelections } = require('./normalize');
const { SPLAT_CROP_WORKER_COUNT, SplatCropWorkerPool } = require('./workerPool');
const { assertPathInsideRoot } = require('./gltfResource');
const { getRootUpRotationMatrix } = require('./gaussianPrimitives');
const {
  collectCandidateSplatResources,
  readTilesetJson,
  traverseTileset,
} = require('./traversal');

const IDENTITY_MATRIX4 = Object.freeze([
  1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0,
  1.0,
]);

let splatCropModulesPromise = null;

function getSplatCropModules() {
  if (!splatCropModulesPromise) {
    splatCropModulesPromise = import('three').then((threeModule) => ({
      THREE: threeModule,
    }));
  }
  return splatCropModulesPromise;
}

async function deleteSplatsInNormalizedSelections(
  rootTilesetPath,
  rootTransform,
  normalizedScreenSelections = [],
  { onProgress = null, tileReadStreamsClosed = false } = {},
) {
  if (normalizedScreenSelections.length === 0) {
    return {
      deletedSplats: 0,
      processedSplatResources: 0,
    };
  }

  const tilesetPath = path.resolve(rootTilesetPath);
  const rootDir = path.dirname(tilesetPath);
  assertPathInsideRoot(tilesetPath, rootDir, 'Root tileset path');

  const { THREE } = await getSplatCropModules();
  const rootTileset = readTilesetJson(tilesetPath);
  const totalResources = collectCandidateSplatResources({
    rootDir,
    tileset: rootTileset,
    tilesetPath,
  }).size;
  if (typeof onProgress === 'function') {
    const readStreamHint = tileReadStreamsClosed
      ? ' Tile read streams closed.'
      : '';
    onProgress({
      completedResources: 0,
      message:
        totalResources > 0
          ? `Deleting cropped splats (0/${totalResources} resources)...${readStreamHint}`
          : `Deleting cropped splats...${readStreamHint}`,
      percent: totalResources > 0 ? 0 : 100,
      phase: 'crop',
      totalResources,
    });
  }
  const upRotationMatrix = getRootUpRotationMatrix(THREE, rootTileset);
  const screenSelections = normalizedScreenSelections.map((selection) => ({
    action: selection.action,
    planeMatrices: selection.planeMatrices
      ? selection.planeMatrices.map((matrix) => matrix.slice())
      : null,
    rect: { ...selection.rect },
    viewProjectionMatrix: selection.viewProjectionMatrix.slice(),
  }));
  const workerPool = new SplatCropWorkerPool(SPLAT_CROP_WORKER_COUNT);

  try {
    return await traverseTileset({
      THREE,
      tilesetPath,
      tileset: rootTileset,
      rootDir,
      upRotationMatrix,
      rootTransform:
        rootTransform == null
          ? IDENTITY_MATRIX4
          : normalizeMatrix4Array(rootTransform, 'rootTransform'),
      screenSelections,
      parentTransform: null,
      visitedTilesets: new Set(),
      processedResources: new Set(),
      emptySplatResources: new Map(),
      progress: {
        completedResources: 0,
        onProgress,
        processedResourcePaths: new Set(),
        tileReadStreamsClosed,
        totalResources,
      },
      resourceLocks: new Map(),
      workerPool,
    });
  } finally {
    await workerPool.close();
  }
}

module.exports = {
  deleteSplatsInNormalizedSelections,
  normalizeSplatScreenSelections,
};
