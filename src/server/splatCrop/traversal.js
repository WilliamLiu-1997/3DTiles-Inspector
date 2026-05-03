const fs = require('fs');
const path = require('path');

const { InspectorError } = require('../../errors');
const {
  addReplacement,
  applyBufferReplacements,
  assertPathInsideRoot,
  getBufferViewSlice,
  isRemoteOrProtocolUri,
  loadGltfResource,
  resolveLocalUri,
  saveGltfResource,
  stripUriSuffix,
  writeJsonAtomic,
} = require('./gltfResource');
const {
  collectGaussianPrimitiveDescriptors,
  getTileWorldTransform,
  hasScenePrimitives,
  removeMeshPrimitives,
} = require('./gaussianPrimitives');

function getContentSlots(tile) {
  const slots = [];
  if (tile && typeof tile.content === 'object' && tile.content) {
    slots.push({ content: tile.content, type: 'content' });
  }
  if (Array.isArray(tile?.contents)) {
    tile.contents.forEach((content) => {
      if (content && typeof content === 'object') {
        slots.push({ content, type: 'contents' });
      }
    });
  }
  return slots;
}

function getContentUri(content) {
  return content.uri || content.url;
}

function removeContentSlot(tile, slot) {
  if (slot.type === 'content') {
    if (tile.content === slot.content) {
      delete tile.content;
      return true;
    }
    return false;
  }

  if (!Array.isArray(tile.contents)) {
    return false;
  }

  const index = tile.contents.indexOf(slot.content);
  if (index === -1) {
    return false;
  }

  tile.contents.splice(index, 1);
  if (tile.contents.length === 0) {
    delete tile.contents;
  }
  return true;
}

function tileHasContent(tile) {
  return (
    !!(tile && typeof tile.content === 'object' && tile.content) ||
    (Array.isArray(tile?.contents) && tile.contents.length > 0)
  );
}

function tileIsEmpty(tile) {
  return (
    !tileHasContent(tile) &&
    (!Array.isArray(tile?.children) || tile.children.length === 0)
  );
}

function readTilesetJson(filePath) {
  const tileset = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!tileset || typeof tileset !== 'object' || !tileset.root) {
    throw new InspectorError(`${filePath} must contain a root object.`);
  }
  return tileset;
}

function serializeRewriteDescriptors(descriptors) {
  return descriptors.map((descriptor) => ({
    sourceToWorldMatrix: descriptor.sourceToWorldMatrix.toArray(),
  }));
}

function rewriteSpzBytesInWorker({
  bytes,
  descriptors,
  screenSelections,
  workerPool,
}) {
  const workerBytes = Uint8Array.from(bytes);
  return workerPool.run(
    {
      bytes: workerBytes,
      descriptors: serializeRewriteDescriptors(descriptors),
      screenSelections,
    },
    [workerBytes.buffer],
  );
}

function runWithResourceLock(resourceLocks, resourcePath, task) {
  const previous = resourceLocks.get(resourcePath) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  resourceLocks.set(resourcePath, next.catch(() => undefined));
  return next;
}

function collectCandidateSplatResources({
  resourcePaths = new Set(),
  rootDir,
  tileset = null,
  tilesetPath,
  visitedTilesets = new Set(),
}) {
  const resolvedTilesetPath = assertPathInsideRoot(
    tilesetPath,
    rootDir,
    'Nested tileset path',
  );
  if (visitedTilesets.has(resolvedTilesetPath)) {
    return resourcePaths;
  }
  visitedTilesets.add(resolvedTilesetPath);

  const tilesetJson = tileset || readTilesetJson(resolvedTilesetPath);
  const tilesetDir = path.dirname(resolvedTilesetPath);
  const visitTile = (tile) => {
    getContentSlots(tile).forEach((slot) => {
      const uri = getContentUri(slot.content);
      if (typeof uri !== 'string' || uri.length === 0) {
        return;
      }
      if (isRemoteOrProtocolUri(uri)) {
        throw new InspectorError(
          `Remote content is not supported for crop save: ${uri}`,
        );
      }

      const extension = path.extname(stripUriSuffix(uri)).toLowerCase();
      if (extension === '.json') {
        collectCandidateSplatResources({
          resourcePaths,
          rootDir,
          tilesetPath: resolveLocalUri(
            tilesetDir,
            rootDir,
            uri,
            'Nested tileset content URI',
          ),
          visitedTilesets,
        });
        return;
      }
      if (extension === '.gltf' || extension === '.glb') {
        resourcePaths.add(
          resolveLocalUri(tilesetDir, rootDir, uri, 'Splat content URI'),
        );
      }
    });

    if (Array.isArray(tile?.children)) {
      tile.children.forEach(visitTile);
    }
  };

  visitTile(tilesetJson.root);
  return resourcePaths;
}

function markSplatResourceProgress(context, resourcePath) {
  const progress = context.progress;
  if (
    !progress ||
    typeof progress.onProgress !== 'function' ||
    progress.processedResourcePaths.has(resourcePath)
  ) {
    return;
  }

  progress.processedResourcePaths.add(resourcePath);
  progress.completedResources += 1;
  const totalResources = progress.totalResources;
  const percent =
    totalResources > 0
      ? (progress.completedResources / totalResources) * 100
      : 100;

  progress.onProgress({
    completedResources: progress.completedResources,
    message:
      totalResources > 0
        ? `Deleting cropped splats (${progress.completedResources}/${totalResources} resources)...`
        : 'Deleting cropped splats...',
    percent,
    phase: 'crop',
    totalResources,
  });
}

async function processGltfResource({
  THREE,
  filePath,
  rootDir,
  tileSceneMatrix,
  screenSelections,
  workerPool,
}) {
  const resource = loadGltfResource(filePath, rootDir);
  const descriptors = collectGaussianPrimitiveDescriptors(
    THREE,
    resource.json,
    tileSceneMatrix,
  );
  if (descriptors.length === 0) {
    return {
      deletedSplats: 0,
      empty: !hasScenePrimitives(resource.json),
      processed: false,
    };
  }

  const byBufferView = new Map();
  descriptors.forEach((descriptor) => {
    if (!byBufferView.has(descriptor.bufferView)) {
      byBufferView.set(descriptor.bufferView, []);
    }
    byBufferView.get(descriptor.bufferView).push(descriptor);
  });

  const replacementsByBuffer = new Map();
  const emptyDescriptors = [];
  let deletedSplats = 0;
  const rewriteTasks = [];

  for (const [bufferViewIndex, viewDescriptors] of byBufferView) {
    const slice = getBufferViewSlice(resource, bufferViewIndex);
    rewriteTasks.push({
      bufferViewIndex,
      slice,
      viewDescriptors,
      promise: rewriteSpzBytesInWorker({
        bytes: slice.bytes,
        descriptors: viewDescriptors,
        screenSelections,
        workerPool,
      }),
    });
  }

  const rewriteResults = await Promise.all(
    rewriteTasks.map(async (task) => ({
      ...task,
      rewrite: await task.promise,
    })),
  );

  for (const {
    bufferViewIndex,
    rewrite,
    slice,
    viewDescriptors,
  } of rewriteResults) {
    deletedSplats += rewrite.deleted;
    if (rewrite.empty) {
      emptyDescriptors.push(...viewDescriptors);
      continue;
    }
    if (!rewrite.bytes) {
      continue;
    }

    if (!replacementsByBuffer.has(slice.bufferIndex)) {
      replacementsByBuffer.set(slice.bufferIndex, []);
    }
    addReplacement(replacementsByBuffer.get(slice.bufferIndex), {
      bufferViewIndex,
      start: slice.start,
      end: slice.end,
      bytes: rewrite.bytes,
    });
  }

  let modified = false;
  if (emptyDescriptors.length > 0) {
    modified = removeMeshPrimitives(resource, emptyDescriptors) > 0 || modified;
  }
  for (const [bufferIndex, replacements] of replacementsByBuffer) {
    modified = applyBufferReplacements(resource, bufferIndex, replacements) || modified;
  }

  const empty = !hasScenePrimitives(resource.json);
  if (modified) {
    saveGltfResource(resource);
  }

  return {
    deletedSplats,
    empty,
    processed: descriptors.length > 0,
  };
}

function createContentSlotResult(slot, overrides = {}) {
  return {
    deletedSplats: 0,
    processedSplatResources: 0,
    removeSlot: false,
    slot,
    ...overrides,
  };
}

function addContentResultToTraversal(context, result) {
  context.deletedSplats += result.deletedSplats;
  context.processedSplatResources += result.processedSplatResources;
}

function withProcessedResourceCount(context, resourcePath, result) {
  const processedSplatResource =
    result.processed && !context.processedResources.has(resourcePath) ? 1 : 0;
  if (processedSplatResource) {
    context.processedResources.add(resourcePath);
  }
  return {
    ...result,
    processedSplatResource,
  };
}

async function processLockedSplatResource(context, resourcePath, tileSceneMatrix) {
  const cachedEmptyResource = context.emptySplatResources.get(resourcePath);
  if (cachedEmptyResource) {
    const result = withProcessedResourceCount(context, resourcePath, {
      deletedSplats: 0,
      empty: true,
      processed: cachedEmptyResource.processed,
    });
    markSplatResourceProgress(context, resourcePath);
    return result;
  }

  const result = await processGltfResource({
    THREE: context.THREE,
    filePath: resourcePath,
    rootDir: context.rootDir,
    tileSceneMatrix,
    screenSelections: context.screenSelections,
    workerPool: context.workerPool,
  });
  if (result.empty) {
    context.emptySplatResources.set(resourcePath, {
      processed: result.processed,
    });
  }
  const countedResult = withProcessedResourceCount(context, resourcePath, result);
  markSplatResourceProgress(context, resourcePath);
  return countedResult;
}

async function processGltfContentSlot(context, slot, uri, tileTransform) {
  const resourcePath = resolveLocalUri(
    context.tilesetDir,
    context.rootDir,
    uri,
    'Splat content URI',
  );
  const tileSceneMatrix = tileTransform.clone().multiply(context.upRotationMatrix);
  const resourceResult = await runWithResourceLock(
    context.resourceLocks,
    resourcePath,
    () => processLockedSplatResource(context, resourcePath, tileSceneMatrix),
  );

  return createContentSlotResult(slot, {
    deletedSplats: resourceResult.deletedSplats,
    processedSplatResources: resourceResult.processedSplatResource,
    removeSlot: resourceResult.empty,
  });
}

async function processNestedTilesetContentSlot(
  context,
  slot,
  uri,
  tileTransform,
) {
  const childTilesetPath = resolveLocalUri(
    context.tilesetDir,
    context.rootDir,
    uri,
    'Nested tileset content URI',
  );
  const childResult = await traverseTileset({
    THREE: context.THREE,
    tilesetPath: childTilesetPath,
    rootDir: context.rootDir,
    upRotationMatrix: context.upRotationMatrix,
    rootTransform: null,
    screenSelections: context.screenSelections,
    parentTransform: tileTransform,
    visitedTilesets: context.visitedTilesets,
    processedResources: context.processedResources,
    emptySplatResources: context.emptySplatResources,
    progress: context.progress,
    resourceLocks: context.resourceLocks,
    workerPool: context.workerPool,
  });

  return createContentSlotResult(slot, {
    deletedSplats: childResult.deletedSplats,
    processedSplatResources: childResult.processedSplatResources,
    removeSlot: childResult.rootEmpty,
  });
}

async function processContentSlot(context, slot, tileTransform) {
  const uri = getContentUri(slot.content);
  if (typeof uri !== 'string' || uri.length === 0) {
    return createContentSlotResult(slot);
  }

  if (isRemoteOrProtocolUri(uri)) {
    throw new InspectorError(`Remote content is not supported for crop save: ${uri}`);
  }

  const extension = path.extname(stripUriSuffix(uri)).toLowerCase();
  if (extension === '.json') {
    return processNestedTilesetContentSlot(context, slot, uri, tileTransform);
  }
  if (extension === '.gltf' || extension === '.glb') {
    return processGltfContentSlot(context, slot, uri, tileTransform);
  }

  return createContentSlotResult(slot);
}

function applyContentResultsToTile(context, tile, contentResults) {
  contentResults.forEach((result) => {
    addContentResultToTraversal(context, result);
    if (result.removeSlot && removeContentSlot(tile, result.slot)) {
      context.tilesetModified = true;
    }
  });
}

async function pruneEmptyChildren(context, tile, tileTransform) {
  if (!Array.isArray(tile.children)) {
    return;
  }

  const children = tile.children.slice();
  const childResults = await Promise.all(
    children.map(async (child) => ({
      child,
      result: await visitTilesetTile(context, child, tileTransform, false),
    })),
  );
  const keptChildren = [];
  childResults.forEach(({ child, result }) => {
    if (result.empty) {
      context.tilesetModified = true;
    } else {
      keptChildren.push(child);
    }
  });

  if (keptChildren.length === 0) {
    if (tile.children.length > 0) {
      context.tilesetModified = true;
    }
    delete tile.children;
  } else if (keptChildren.length !== tile.children.length) {
    tile.children = keptChildren;
  }
}

async function visitTilesetTile(context, tile, inheritedTransform, isRootTile) {
  const tileTransform =
    isRootTile && context.rootTransform
      ? new context.THREE.Matrix4().fromArray(context.rootTransform)
      : getTileWorldTransform(context.THREE, tile, inheritedTransform);
  const contentResults = await Promise.all(
    getContentSlots(tile).map((slot) =>
      processContentSlot(context, slot, tileTransform),
    ),
  );

  applyContentResultsToTile(context, tile, contentResults);
  await pruneEmptyChildren(context, tile, tileTransform);
  return { empty: tileIsEmpty(tile) };
}

async function traverseTileset({
  THREE,
  tilesetPath,
  tileset = null,
  rootDir,
  upRotationMatrix,
  rootTransform,
  screenSelections,
  parentTransform,
  visitedTilesets,
  processedResources,
  emptySplatResources,
  progress,
  resourceLocks,
  workerPool,
}) {
  const resolvedTilesetPath = assertPathInsideRoot(
    tilesetPath,
    rootDir,
    'Nested tileset path',
  );
  if (visitedTilesets.has(resolvedTilesetPath)) {
    return {
      deletedSplats: 0,
      processedSplatResources: 0,
      rootEmpty: false,
    };
  }
  visitedTilesets.add(resolvedTilesetPath);

  const tilesetJson = tileset || readTilesetJson(resolvedTilesetPath);
  if (!tilesetJson || typeof tilesetJson !== 'object' || !tilesetJson.root) {
    throw new InspectorError(`${resolvedTilesetPath} must contain a root object.`);
  }

  const context = {
    THREE,
    deletedSplats: 0,
    emptySplatResources,
    progress,
    processedResources,
    processedSplatResources: 0,
    resourceLocks,
    rootDir,
    rootTransform,
    screenSelections,
    tilesetDir: path.dirname(resolvedTilesetPath),
    tilesetModified: false,
    upRotationMatrix,
    visitedTilesets,
    workerPool,
  };
  const rootResult = await visitTilesetTile(
    context,
    tilesetJson.root,
    parentTransform,
    true,
  );

  if (context.tilesetModified) {
    writeJsonAtomic(resolvedTilesetPath, tilesetJson);
  }
  return {
    deletedSplats: context.deletedSplats,
    processedSplatResources: context.processedSplatResources,
    rootEmpty: rootResult.empty,
  };
}

module.exports = {
  collectCandidateSplatResources,
  readTilesetJson,
  traverseTileset,
};
