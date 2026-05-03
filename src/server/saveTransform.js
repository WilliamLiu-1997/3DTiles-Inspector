const fs = require('fs');
const path = require('path');

const { InspectorError } = require('../errors');
const {
  cloneIdentityMatrix4,
  multiplyMatrix4,
  normalizeMatrix4Array,
} = require('./matrix4');
const { readJsonFile, writeJsonAtomic } = require('./fileUtils');
const { deleteSplatsInNormalizedSelections } = require('./splatCrop');

function normalizePositiveFinite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new InspectorError(`${name} must be a finite number greater than 0.`);
  }
  return number;
}

function scaleGeometricErrorValue(
  target,
  key,
  geometricErrorScale,
  geometricErrorLayerScale,
  leafGeometricError,
  label,
) {
  if (target[key] == null) {
    return;
  }

  const number = Number(target[key]);
  if (!Number.isFinite(number)) {
    throw new InspectorError(`${label} must be a finite number.`);
  }

  if (!Number.isFinite(leafGeometricError)) {
    throw new InspectorError(`${label} leaf geometricError must be finite.`);
  }

  const adjusted =
    leafGeometricError +
    (number - leafGeometricError) * geometricErrorLayerScale;
  const next = adjusted * geometricErrorScale;
  if (!Number.isFinite(next)) {
    throw new InspectorError(`${label} scaled value must be finite.`);
  }

  target[key] = next;
}

function assertTilesetPathInsideRoot(resolvedPath, rootDir) {
  if (
    resolvedPath !== rootDir &&
    !resolvedPath.startsWith(`${rootDir}${path.sep}`)
  ) {
    throw new InspectorError(
      `Nested tileset path escapes the viewer root: ${resolvedPath}`,
    );
  }
}

function getLocalJsonReferencePath(baseDir, uri) {
  if (typeof uri !== 'string' || uri.length === 0) {
    return null;
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(uri) || uri.startsWith('//')) {
    return null;
  }

  const normalized = uri.split('#', 1)[0].split('?', 1)[0];
  if (!/\.json$/i.test(normalized)) {
    return null;
  }

  return path.resolve(baseDir, normalized.replace(/\//g, path.sep));
}

function getLocalExternalTilesetPaths(tile, baseDir) {
  const paths = [];
  if (!tile || typeof tile !== 'object') {
    return paths;
  }

  if (tile.content && typeof tile.content === 'object') {
    const filePath = getLocalJsonReferencePath(
      baseDir,
      tile.content.uri || tile.content.url,
    );
    if (filePath) {
      paths.push(filePath);
    }
  }

  if (Array.isArray(tile.contents)) {
    tile.contents.forEach((entry) => {
      if (entry && typeof entry === 'object') {
        const filePath = getLocalJsonReferencePath(
          baseDir,
          entry.uri || entry.url,
        );
        if (filePath) {
          paths.push(filePath);
        }
      }
    });
  }

  return paths;
}

function getTilesetRootLeafGeometricError(
  tilesetPath,
  rootDir,
  leafGeometricErrorCache,
  stack,
) {
  const resolvedPath = path.resolve(tilesetPath);
  if (leafGeometricErrorCache.has(resolvedPath)) {
    return leafGeometricErrorCache.get(resolvedPath);
  }

  if (stack.has(resolvedPath)) {
    return 0;
  }

  assertTilesetPathInsideRoot(resolvedPath, rootDir);

  if (!fs.existsSync(resolvedPath)) {
    throw new InspectorError(
      `Referenced nested tileset does not exist: ${resolvedPath}`,
    );
  }

  const tileset = readJsonFile(resolvedPath);
  if (!tileset || typeof tileset !== 'object' || !tileset.root) {
    throw new InspectorError(`${resolvedPath} must contain a root object.`);
  }

  stack.add(resolvedPath);
  const leafGeometricError = getTileLeafGeometricError(
    tileset.root,
    path.dirname(resolvedPath),
    rootDir,
    leafGeometricErrorCache,
    stack,
  );
  stack.delete(resolvedPath);
  leafGeometricErrorCache.set(resolvedPath, leafGeometricError);
  return leafGeometricError;
}

function getTileLeafGeometricError(
  tile,
  baseDir,
  rootDir,
  leafGeometricErrorCache,
  stack,
) {
  if (!tile || typeof tile !== 'object') {
    return 0;
  }

  const ownGeometricError = Number(tile.geometricError);
  if (!Number.isFinite(ownGeometricError)) {
    return 0;
  }

  let leafGeometricError = null;
  if (Array.isArray(tile.children)) {
    tile.children.forEach((child) => {
      const childLeafGeometricError = getTileLeafGeometricError(
        child,
        baseDir,
        rootDir,
        leafGeometricErrorCache,
        stack,
      );
      leafGeometricError =
        leafGeometricError === null
          ? childLeafGeometricError
          : Math.min(leafGeometricError, childLeafGeometricError);
    });
  }

  getLocalExternalTilesetPaths(tile, baseDir).forEach((childTilesetPath) => {
    const childLeafGeometricError = getTilesetRootLeafGeometricError(
      childTilesetPath,
      rootDir,
      leafGeometricErrorCache,
      stack,
    );
    leafGeometricError =
      leafGeometricError === null
        ? childLeafGeometricError
        : Math.min(leafGeometricError, childLeafGeometricError);
  });

  return leafGeometricError === null ? ownGeometricError : leafGeometricError;
}

function scaleTilesetGeometricErrors(
  tile,
  geometricErrorScale,
  geometricErrorLayerScale,
  leafGeometricError,
  pathLabel = 'tileset.root',
) {
  if (!tile || typeof tile !== 'object') {
    return;
  }

  scaleGeometricErrorValue(
    tile,
    'geometricError',
    geometricErrorScale,
    geometricErrorLayerScale,
    leafGeometricError,
    `${pathLabel}.geometricError`,
  );

  if (!Array.isArray(tile.children)) {
    return;
  }

  tile.children.forEach((child, index) => {
    scaleTilesetGeometricErrors(
      child,
      geometricErrorScale,
      geometricErrorLayerScale,
      leafGeometricError,
      `${pathLabel}.children[${index}]`,
    );
  });
}

function collectExternalTilesetPaths(tile, baseDir, results) {
  if (!tile || typeof tile !== 'object') {
    return;
  }

  getLocalExternalTilesetPaths(tile, baseDir).forEach((filePath) => {
    results.add(filePath);
  });

  if (!Array.isArray(tile.children)) {
    return;
  }

  tile.children.forEach((child) => {
    collectExternalTilesetPaths(child, baseDir, results);
  });
}

function updateTilesetJsonFile(
  tilesetPath,
  {
    geometricErrorLayerScale,
    geometricErrorScale,
    rootDir,
    rootTransform = null,
    leafGeometricErrorCache = new Map(),
    globalLeafGeometricError = null,
  },
  visited = new Set(),
) {
  const resolvedPath = path.resolve(tilesetPath);
  if (visited.has(resolvedPath)) {
    return null;
  }
  visited.add(resolvedPath);

  assertTilesetPathInsideRoot(resolvedPath, rootDir);

  if (!fs.existsSync(resolvedPath)) {
    throw new InspectorError(
      `Referenced nested tileset does not exist: ${resolvedPath}`,
    );
  }

  const tileset = readJsonFile(resolvedPath);
  if (!tileset || typeof tileset !== 'object' || !tileset.root) {
    throw new InspectorError(`${resolvedPath} must contain a root object.`);
  }

  if (rootTransform) {
    tileset.root.transform = rootTransform.slice();
  }

  const tilesetDir = path.dirname(resolvedPath);
  const effectiveLeafGeometricError =
    globalLeafGeometricError == null
      ? getTileLeafGeometricError(
          tileset.root,
          tilesetDir,
          rootDir,
          leafGeometricErrorCache,
          new Set(),
        )
      : globalLeafGeometricError;

  scaleGeometricErrorValue(
    tileset,
    'geometricError',
    geometricErrorScale,
    geometricErrorLayerScale,
    effectiveLeafGeometricError,
    `${resolvedPath}.geometricError`,
  );
  scaleTilesetGeometricErrors(
    tileset.root,
    geometricErrorScale,
    geometricErrorLayerScale,
    effectiveLeafGeometricError,
    `${resolvedPath}.root`,
  );
  writeJsonAtomic(resolvedPath, tileset);

  const nestedTilesets = new Set();
  collectExternalTilesetPaths(tileset.root, tilesetDir, nestedTilesets);
  nestedTilesets.forEach((childTilesetPath) => {
    updateTilesetJsonFile(
      childTilesetPath,
      {
        geometricErrorLayerScale,
        geometricErrorScale,
        leafGeometricErrorCache,
        globalLeafGeometricError: effectiveLeafGeometricError,
        rootDir,
      },
      visited,
    );
  });

  return tileset;
}

async function saveViewerTransform(
  rootTilesetPath,
  editMatrix,
  {
    geometricErrorLayerScale = 1,
    geometricErrorScale = 1,
    onProgress = null,
    splatScreenSelections = [],
  } = {},
) {
  const emitProgress = (progress) => {
    if (typeof onProgress !== 'function') {
      return;
    }

    const percent = Number(progress.percent);
    onProgress({
      ...progress,
      percent: Number.isFinite(percent)
        ? Math.min(100, Math.max(0, percent))
        : undefined,
      type: 'progress',
    });
  };

  emitProgress({
    message: 'Preparing save...',
    percent: 5,
    phase: 'prepare',
  });

  const normalizedEdit = normalizeMatrix4Array(editMatrix, 'transform');
  const normalizedGeometricErrorScale = normalizePositiveFinite(
    geometricErrorScale,
    'geometricErrorScale',
  );
  const normalizedGeometricErrorLayerScale = normalizePositiveFinite(
    geometricErrorLayerScale,
    'geometricErrorLayerScale',
  );
  const tilesetPath = path.resolve(rootTilesetPath);
  const rootDir = path.dirname(tilesetPath);

  if (!fs.existsSync(tilesetPath)) {
    throw new InspectorError(
      `Cannot save viewer transform because ${tilesetPath} does not exist.`,
    );
  }

  const tileset = readJsonFile(tilesetPath);
  if (!tileset || typeof tileset !== 'object' || !tileset.root) {
    throw new InspectorError(
      `Root tileset JSON must contain a root object: ${tilesetPath}`,
    );
  }

  const currentRoot = Array.isArray(tileset.root.transform)
    ? normalizeMatrix4Array(tileset.root.transform, 'tileset.root.transform')
    : cloneIdentityMatrix4();
  const nextRoot = multiplyMatrix4(normalizedEdit, currentRoot);
  const hasCrop = splatScreenSelections.length > 0;
  const cropResult = await deleteSplatsInNormalizedSelections(
    tilesetPath,
    nextRoot,
    splatScreenSelections,
    {
      onProgress: (progress) => {
        const cropPercent = Number(progress.percent);
        emitProgress({
          ...progress,
          percent: Number.isFinite(cropPercent)
            ? 10 + cropPercent * 0.75
            : undefined,
        });
      },
    },
  );

  emitProgress({
    message: 'Updating tileset JSON...',
    percent: hasCrop ? 88 : 55,
    phase: 'tileset',
  });

  updateTilesetJsonFile(tilesetPath, {
    geometricErrorLayerScale: normalizedGeometricErrorLayerScale,
    geometricErrorScale: normalizedGeometricErrorScale,
    rootDir,
    rootTransform: nextRoot,
  });

  const summaryPath = path.join(rootDir, 'build_summary.json');
  if (fs.existsSync(summaryPath)) {
    emitProgress({
      message: 'Updating build summary...',
      percent: 94,
      phase: 'summary',
    });
    const summary = readJsonFile(summaryPath);
    const previousGeometricErrorScale =
      summary.viewer_geometric_error_scale == null
        ? 1
        : normalizePositiveFinite(
            summary.viewer_geometric_error_scale,
            'build_summary.viewer_geometric_error_scale',
          );
    summary.root_transform = nextRoot.slice();
    summary.root_transform_source = 'transform';
    summary.root_coordinate = null;
    summary.viewer_geometric_error_scale =
      previousGeometricErrorScale * normalizedGeometricErrorScale;
    const previousGeometricErrorLayerScale =
      summary.viewer_geometric_error_layer_scale == null
        ? 1
        : normalizePositiveFinite(
            summary.viewer_geometric_error_layer_scale,
            'build_summary.viewer_geometric_error_layer_scale',
          );
    summary.viewer_geometric_error_layer_scale =
      previousGeometricErrorLayerScale * normalizedGeometricErrorLayerScale;
    writeJsonAtomic(summaryPath, summary);
  }

  emitProgress({
    message: 'Save complete.',
    percent: 100,
    phase: 'complete',
  });

  return {
    transform: nextRoot,
    deletedSplats: cropResult.deletedSplats,
    processedSplatResources: cropResult.processedSplatResources,
  };
}

module.exports = {
  normalizePositiveFinite,
  saveViewerTransform,
};
