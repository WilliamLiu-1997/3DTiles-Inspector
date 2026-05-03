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
  getTileLocalTransform,
  hasNonGaussianScenePrimitives,
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

function createBounds() {
  return {
    max: [-Infinity, -Infinity, -Infinity],
    min: [Infinity, Infinity, Infinity],
  };
}

function boundsHasValues(bounds) {
  return (
    !!bounds &&
    bounds.min.every(Number.isFinite) &&
    bounds.max.every(Number.isFinite)
  );
}

function expandBoundsByPoint(bounds, point) {
  bounds.min[0] = Math.min(bounds.min[0], point.x);
  bounds.min[1] = Math.min(bounds.min[1], point.y);
  bounds.min[2] = Math.min(bounds.min[2], point.z);
  bounds.max[0] = Math.max(bounds.max[0], point.x);
  bounds.max[1] = Math.max(bounds.max[1], point.y);
  bounds.max[2] = Math.max(bounds.max[2], point.z);
}

function expandBoundsByBounds(target, source) {
  if (!boundsHasValues(source)) {
    return false;
  }

  for (let axis = 0; axis < 3; axis++) {
    target.min[axis] = Math.min(target.min[axis], source.min[axis]);
    target.max[axis] = Math.max(target.max[axis], source.max[axis]);
  }
  return true;
}

function unionBounds(bounds) {
  const target = createBounds();
  let hasBounds = false;
  bounds.forEach((entry) => {
    hasBounds = expandBoundsByBounds(target, entry) || hasBounds;
  });
  return hasBounds ? target : null;
}

function getBoxHalfAxes(THREE, box) {
  if (!Array.isArray(box) || box.length !== 12) {
    return null;
  }

  const axes = [
    new THREE.Vector3(box[3], box[4], box[5]),
    new THREE.Vector3(box[6], box[7], box[8]),
    new THREE.Vector3(box[9], box[10], box[11]),
  ];
  if (axes.some((axis) => !Number.isFinite(axis.lengthSq()))) {
    return null;
  }

  return axes;
}

function getProjectionFromBox(THREE, box) {
  const halfAxes = getBoxHalfAxes(THREE, box);
  if (!halfAxes) {
    return null;
  }

  const unitAxes = halfAxes.map((axis) => axis.clone());
  for (const axis of unitAxes) {
    if (axis.lengthSq() <= Number.EPSILON) {
      return null;
    }
    axis.normalize();
  }

  const basis = new THREE.Matrix4().makeBasis(
    unitAxes[0],
    unitAxes[1],
    unitAxes[2],
  );
  if (Math.abs(basis.determinant()) <= Number.EPSILON) {
    return null;
  }

  return {
    basis,
    inverseBasis: basis.clone().invert(),
    unitAxes,
  };
}

function createIdentityProjection(THREE) {
  return {
    basis: new THREE.Matrix4(),
    inverseBasis: new THREE.Matrix4(),
    unitAxes: [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ],
  };
}

function getTileProjection(THREE, tile) {
  return (
    getProjectionFromBox(THREE, tile?.boundingVolume?.box) ||
    createIdentityProjection(THREE)
  );
}

function projectedBoundsToBox(THREE, projectedBounds, projection) {
  const center = new THREE.Vector3(
    (projectedBounds.min[0] + projectedBounds.max[0]) / 2,
    (projectedBounds.min[1] + projectedBounds.max[1]) / 2,
    (projectedBounds.min[2] + projectedBounds.max[2]) / 2,
  ).applyMatrix4(projection.basis);
  const halfSizes = [
    (projectedBounds.max[0] - projectedBounds.min[0]) / 2,
    (projectedBounds.max[1] - projectedBounds.min[1]) / 2,
    (projectedBounds.max[2] - projectedBounds.min[2]) / 2,
  ];
  const halfAxes = projection.unitAxes.map((axis, index) =>
    axis.clone().multiplyScalar(halfSizes[index]),
  );

  return [
    center.x,
    center.y,
    center.z,
    halfAxes[0].x,
    halfAxes[0].y,
    halfAxes[0].z,
    halfAxes[1].x,
    halfAxes[1].y,
    halfAxes[1].z,
    halfAxes[2].x,
    halfAxes[2].y,
    halfAxes[2].z,
  ];
}

function expandProjectedBoundsByBox(THREE, target, box, projection) {
  const halfAxes = getBoxHalfAxes(THREE, box);
  if (!halfAxes) {
    return false;
  }

  const center = new THREE.Vector3(box[0], box[1], box[2]);
  const point = new THREE.Vector3();
  let expanded = false;
  for (const xSign of [-1, 1]) {
    for (const ySign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        point
          .copy(center)
          .addScaledVector(halfAxes[0], xSign)
          .addScaledVector(halfAxes[1], ySign)
          .addScaledVector(halfAxes[2], zSign)
          .applyMatrix4(projection.inverseBasis);
        expandBoundsByPoint(target, point);
        expanded = true;
      }
    }
  }
  return expanded;
}

function transformVectorByMatrix(THREE, vector, matrix) {
  const e = matrix.elements;
  return new THREE.Vector3(
    e[0] * vector.x + e[4] * vector.y + e[8] * vector.z,
    e[1] * vector.x + e[5] * vector.y + e[9] * vector.z,
    e[2] * vector.x + e[6] * vector.y + e[10] * vector.z,
  );
}

function transformBox(THREE, box, matrix) {
  const halfAxes = getBoxHalfAxes(THREE, box);
  if (!halfAxes) {
    return null;
  }

  const center = new THREE.Vector3(box[0], box[1], box[2]).applyMatrix4(matrix);
  const transformedHalfAxes = halfAxes.map((axis) =>
    transformVectorByMatrix(THREE, axis, matrix),
  );
  return [
    center.x,
    center.y,
    center.z,
    transformedHalfAxes[0].x,
    transformedHalfAxes[0].y,
    transformedHalfAxes[0].z,
    transformedHalfAxes[1].x,
    transformedHalfAxes[1].y,
    transformedHalfAxes[1].z,
    transformedHalfAxes[2].x,
    transformedHalfAxes[2].y,
    transformedHalfAxes[2].z,
  ];
}

function setTileBoundingVolumeFromProjectedBounds(
  THREE,
  tile,
  projectedBounds,
  projection,
) {
  if (!boundsHasValues(projectedBounds)) {
    return false;
  }
  tile.boundingVolume = {
    box: projectedBoundsToBox(THREE, projectedBounds, projection),
  };
  return true;
}

function serializeRewriteDescriptors(descriptors) {
  return descriptors.map((descriptor) => ({
    sourceToProjectionMatrix: descriptor.sourceToProjectionMatrix.toArray(),
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
  tileProjectionMatrix,
  tileSceneMatrix,
  screenSelections,
  workerPool,
}) {
  const resource = loadGltfResource(filePath, rootDir);
  const descriptors = collectGaussianPrimitiveDescriptors(
    THREE,
    resource.json,
    tileSceneMatrix,
    tileProjectionMatrix,
  );
  if (descriptors.length === 0) {
    const empty = !hasScenePrimitives(resource.json);
    return {
      bounds: null,
      boundsKnown: empty,
      deletedSplats: 0,
      empty,
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
  const resourceBounds = createBounds();
  let hasResourceBounds = false;
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
    if (rewrite.bounds) {
      hasResourceBounds =
        expandBoundsByBounds(resourceBounds, rewrite.bounds) || hasResourceBounds;
    }
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
  const boundsKnown = empty || !hasNonGaussianScenePrimitives(resource.json);
  if (modified) {
    saveGltfResource(resource);
  }

  return {
    bounds: hasResourceBounds ? resourceBounds : null,
    boundsKnown,
    deletedSplats,
    empty,
    processed: descriptors.length > 0,
  };
}

function createContentSlotResult(slot, overrides = {}) {
  return {
    bounds: null,
    boundsKnown: true,
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

async function processLockedSplatResource(
  context,
  resourcePath,
  tileSceneMatrix,
  tileProjectionMatrix,
) {
  const cachedEmptyResource = context.emptySplatResources.get(resourcePath);
  if (cachedEmptyResource) {
    const result = withProcessedResourceCount(context, resourcePath, {
      bounds: null,
      boundsKnown: true,
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
    tileProjectionMatrix,
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

async function processGltfContentSlot(
  context,
  slot,
  uri,
  tileTransform,
  tileProjection,
) {
  const resourcePath = resolveLocalUri(
    context.tilesetDir,
    context.rootDir,
    uri,
    'Splat content URI',
  );
  const tileSceneMatrix = tileTransform.clone().multiply(context.upRotationMatrix);
  const tileProjectionMatrix = tileProjection.inverseBasis
    .clone()
    .multiply(context.upRotationMatrix);
  const resourceResult = await runWithResourceLock(
    context.resourceLocks,
    resourcePath,
    () =>
      processLockedSplatResource(
        context,
        resourcePath,
        tileSceneMatrix,
        tileProjectionMatrix,
      ),
  );

  return createContentSlotResult(slot, {
    bounds: resourceResult.bounds,
    boundsKnown: resourceResult.boundsKnown,
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
  tileProjection,
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

  const bounds = createBounds();
  return createContentSlotResult(slot, {
    bounds: expandProjectedBoundsByBox(
      context.THREE,
      bounds,
      childResult.boxInParent,
      tileProjection,
    )
      ? bounds
      : null,
    boundsKnown: childResult.boundsKnown,
    deletedSplats: childResult.deletedSplats,
    processedSplatResources: childResult.processedSplatResources,
    removeSlot: childResult.rootEmpty,
  });
}

async function processContentSlot(context, slot, tileTransform, tileProjection) {
  const uri = getContentUri(slot.content);
  if (typeof uri !== 'string' || uri.length === 0) {
    return createContentSlotResult(slot, { boundsKnown: false });
  }

  if (isRemoteOrProtocolUri(uri)) {
    throw new InspectorError(`Remote content is not supported for crop save: ${uri}`);
  }

  const extension = path.extname(stripUriSuffix(uri)).toLowerCase();
  if (extension === '.json') {
    return processNestedTilesetContentSlot(
      context,
      slot,
      uri,
      tileTransform,
      tileProjection,
    );
  }
  if (extension === '.gltf' || extension === '.glb') {
    return processGltfContentSlot(
      context,
      slot,
      uri,
      tileTransform,
      tileProjection,
    );
  }

  return createContentSlotResult(slot, { boundsKnown: false });
}

function applyContentResultsToTile(context, tile, contentResults) {
  const contentBounds = [];
  let boundsKnown = true;

  contentResults.forEach((result) => {
    addContentResultToTraversal(context, result);
    if (result.removeSlot && removeContentSlot(tile, result.slot)) {
      context.tilesetModified = true;
      return;
    }

    boundsKnown = boundsKnown && result.boundsKnown;
    if (result.bounds) {
      contentBounds.push(result.bounds);
    }
  });

  return {
    bounds: unionBounds(contentBounds),
    boundsKnown,
  };
}

async function pruneEmptyChildren(context, tile, tileTransform, tileProjection) {
  if (!Array.isArray(tile.children)) {
    return {
      bounds: null,
      boundsKnown: true,
    };
  }

  const children = tile.children.slice();
  const childResults = await Promise.all(
    children.map(async (child) => ({
      child,
      result: await visitTilesetTile(context, child, tileTransform, false),
    })),
  );
  const childBounds = [];
  let boundsKnown = true;
  const keptChildren = [];
  childResults.forEach(({ child, result }) => {
    if (result.empty) {
      context.tilesetModified = true;
    } else {
      keptChildren.push(child);
      boundsKnown = boundsKnown && result.boundsKnown;
      if (result.boxInParent) {
        const bounds = createBounds();
        if (
          expandProjectedBoundsByBox(
            context.THREE,
            bounds,
            result.boxInParent,
            tileProjection,
          )
        ) {
          childBounds.push(bounds);
        }
      }
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

  return {
    bounds: unionBounds(childBounds),
    boundsKnown,
  };
}

function getTileTransforms(context, tile, inheritedTransform, isRootTile) {
  const localTransform =
    isRootTile && context.rootTransform
      ? new context.THREE.Matrix4().fromArray(context.rootTransform)
      : getTileLocalTransform(context.THREE, tile);
  const worldTransform = localTransform.clone();
  if (inheritedTransform) {
    worldTransform.premultiply(inheritedTransform);
  }
  return { localTransform, worldTransform };
}

async function visitTilesetTile(context, tile, inheritedTransform, isRootTile) {
  const { localTransform, worldTransform } = getTileTransforms(
    context,
    tile,
    inheritedTransform,
    isRootTile,
  );
  const tileProjection = getTileProjection(context.THREE, tile);
  const contentResults = await Promise.all(
    getContentSlots(tile).map((slot) =>
      processContentSlot(context, slot, worldTransform, tileProjection),
    ),
  );

  const contentSummary = applyContentResultsToTile(context, tile, contentResults);
  const childSummary = await pruneEmptyChildren(
    context,
    tile,
    worldTransform,
    tileProjection,
  );
  const projectedBounds = unionBounds([
    contentSummary.bounds,
    childSummary.bounds,
  ]);
  const boundsKnown = contentSummary.boundsKnown && childSummary.boundsKnown;
  if (
    boundsKnown &&
    setTileBoundingVolumeFromProjectedBounds(
      context.THREE,
      tile,
      projectedBounds,
      tileProjection,
    )
  ) {
    context.tilesetModified = true;
  }

  return {
    boxInParent: transformBox(
      context.THREE,
      boundsHasValues(projectedBounds) ? tile.boundingVolume?.box : null,
      localTransform,
    ),
    boundsKnown,
    empty: tileIsEmpty(tile),
    projectedBounds,
  };
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
      boxInParent: null,
      boundsKnown: true,
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
    boxInParent: rootResult.boxInParent,
    boundsKnown: rootResult.boundsKnown,
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
