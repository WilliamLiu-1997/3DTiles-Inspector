const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const { InspectorError } = require('../errors');

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_BIN_CHUNK_TYPE = 0x004e4942;
const MAX_CROP_BOXES = 256;
const SPLAT_CROP_WORKER_COUNT = 4;
const SPLAT_CROP_WORKER_PATH = path.join(__dirname, 'splatCropWorker.js');
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

function normalizeMatrix4Array(value, name = 'matrix') {
  if (!Array.isArray(value) || value.length !== 16) {
    throw new InspectorError(`${name} must be a 16-number matrix.`);
  }

  return value.map((entry, index) => {
    const number = Number(entry);
    if (!Number.isFinite(number)) {
      throw new InspectorError(`${name}[${index}] must be a finite number.`);
    }
    return number;
  });
}

function normalizeSplatCropBoxes(value) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new InspectorError('splatCropBoxes must be an array.');
  }

  if (value.length > MAX_CROP_BOXES) {
    throw new InspectorError(
      `splatCropBoxes cannot contain more than ${MAX_CROP_BOXES} boxes.`,
    );
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new InspectorError(`splatCropBoxes[${index}] must be an object.`);
    }

    return {
      matrix: normalizeMatrix4Array(
        entry.matrix,
        `splatCropBoxes[${index}].matrix`,
      ),
    };
  });
}

function deserializeWorkerError(error) {
  const message =
    error && typeof error.message === 'string'
      ? error.message
      : 'SPZ crop worker failed.';
  const next =
    error && error.name === 'InspectorError'
      ? new InspectorError(message)
      : new Error(message);
  if (error && typeof error.stack === 'string') {
    next.stack = error.stack;
  }
  return next;
}

class SplatCropWorkerPool {
  constructor(size = SPLAT_CROP_WORKER_COUNT) {
    this.callbacks = new Map();
    this.closed = false;
    this.idleWorkers = [];
    this.nextJobId = 1;
    this.queue = [];
    this.workers = [];

    const workerCount = Math.max(1, Math.floor(size));
    for (let index = 0; index < workerCount; index++) {
      const worker = this.createWorker();
      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  createWorker() {
    const worker = new Worker(SPLAT_CROP_WORKER_PATH);
    worker.currentJobId = null;
    worker.failed = false;
    worker.on('message', (message) => {
      this.handleMessage(worker, message);
    });
    worker.on('error', (err) => {
      this.handleWorkerFailure(worker, err);
    });
    worker.on('exit', (code) => {
      if (!this.closed && code !== 0) {
        this.handleWorkerFailure(
          worker,
          new Error(`SPZ crop worker exited with code ${code}.`),
        );
      }
    });
    return worker;
  }

  handleMessage(worker, message) {
    const job = this.callbacks.get(message?.id);
    if (!job) {
      return;
    }

    this.callbacks.delete(job.id);
    worker.currentJobId = null;

    if (message.error) {
      job.reject(deserializeWorkerError(message.error));
    } else {
      const result = message.result || {};
      job.resolve({
        bytes: result.bytes ? Buffer.from(result.bytes) : null,
        deleted: Number(result.deleted || 0),
        empty: !!result.empty,
      });
    }

    if (!this.closed && !worker.failed) {
      this.idleWorkers.push(worker);
      this.dispatch();
    }
  }

  handleWorkerFailure(worker, err) {
    if (worker.failed) {
      return;
    }
    worker.failed = true;

    this.workers = this.workers.filter((entry) => entry !== worker);
    this.idleWorkers = this.idleWorkers.filter((entry) => entry !== worker);

    if (worker.currentJobId !== null) {
      const job = this.callbacks.get(worker.currentJobId);
      if (job) {
        this.callbacks.delete(job.id);
        job.reject(err);
      }
      worker.currentJobId = null;
    }

    if (!this.closed) {
      const replacement = this.createWorker();
      this.workers.push(replacement);
      this.idleWorkers.push(replacement);
      this.dispatch();
    }
  }

  dispatch() {
    while (!this.closed && this.queue.length > 0 && this.idleWorkers.length > 0) {
      const worker = this.idleWorkers.pop();
      const job = this.queue.shift();
      this.callbacks.set(job.id, job);
      worker.currentJobId = job.id;
      try {
        worker.postMessage(
          {
            id: job.id,
            payload: job.payload,
            type: 'rewriteSpzBytes',
          },
          job.transferList,
        );
      } catch (err) {
        this.callbacks.delete(job.id);
        worker.currentJobId = null;
        job.reject(err);
        if (!worker.failed) {
          this.idleWorkers.push(worker);
        }
      }
    }
  }

  run(payload, transferList = []) {
    if (this.closed) {
      return Promise.reject(new Error('SPZ crop worker pool is closed.'));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        id: this.nextJobId++,
        payload,
        reject,
        resolve,
        transferList,
      });
      this.dispatch();
    });
  }

  async close() {
    this.closed = true;
    this.queue.forEach((job) => {
      job.reject(new Error('SPZ crop worker pool was closed.'));
    });
    this.queue = [];
    this.callbacks.forEach((job) => {
      job.reject(new Error('SPZ crop worker pool was closed.'));
    });
    this.callbacks.clear();

    await Promise.all(
      this.workers.map((worker) =>
        worker.terminate().catch(() => undefined),
      ),
    );
    this.idleWorkers = [];
    this.workers = [];
  }
}

function assertPathInsideRoot(resolvedPath, rootDir, label) {
  const root = path.resolve(rootDir);
  const target = path.resolve(resolvedPath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new InspectorError(`${label} escapes the tileset root: ${target}`);
  }
  return target;
}

function stripUriSuffix(uri) {
  return uri.split('#', 1)[0].split('?', 1)[0];
}

function isRemoteOrProtocolUri(uri) {
  return /^[a-z][a-z\d+.-]*:/i.test(uri) || uri.startsWith('//');
}

function resolveLocalUri(baseDir, rootDir, uri, label) {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new InspectorError(`${label} must have a local URI.`);
  }

  if (isRemoteOrProtocolUri(uri)) {
    throw new InspectorError(`${label} must be a local file URI: ${uri}`);
  }

  const normalized = stripUriSuffix(uri);
  const resolvedPath = path.resolve(baseDir, normalized.replace(/\//g, path.sep));
  return assertPathInsideRoot(resolvedPath, rootDir, label);
}

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

function writeBytesAtomic(filePath, bytes) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, Buffer.from(bytes));
  fs.renameSync(tempPath, filePath);
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function getTileLocalTransform(THREE, tile) {
  const matrix = new THREE.Matrix4();
  if (Array.isArray(tile?.transform)) {
    matrix.fromArray(normalizeMatrix4Array(tile.transform, 'tile.transform'));
  }
  return matrix;
}

function getTileWorldTransform(THREE, tile, parentTransform) {
  const matrix = getTileLocalTransform(THREE, tile);
  if (parentTransform) {
    matrix.premultiply(parentTransform);
  }
  return matrix;
}

function getRootUpRotationMatrix(THREE, tileset) {
  const axis =
    typeof tileset?.asset?.gltfUpAxis === 'string'
      ? tileset.asset.gltfUpAxis.toLowerCase()
      : 'y';
  const matrix = new THREE.Matrix4();

  if (axis === 'x') {
    matrix.makeRotationY(-Math.PI / 2);
  } else if (axis === 'y') {
    matrix.makeRotationX(Math.PI / 2);
  } else if (axis !== 'z') {
    throw new InspectorError(`Unsupported asset.gltfUpAxis value: ${axis}`);
  }

  return matrix;
}

function parseGlb(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 20) {
    throw new InspectorError(`Invalid GLB file: ${filePath}`);
  }

  const magic = bytes.readUInt32LE(0);
  const version = bytes.readUInt32LE(4);
  const length = bytes.readUInt32LE(8);
  if (magic !== GLB_MAGIC || version !== GLB_VERSION || length > bytes.length) {
    throw new InspectorError(`Invalid GLB header: ${filePath}`);
  }

  let json = null;
  let bin = null;
  let offset = 12;
  while (offset + 8 <= length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > length) {
      throw new InspectorError(`Invalid GLB chunk length: ${filePath}`);
    }

    const chunk = bytes.subarray(chunkStart, chunkEnd);
    if (chunkType === GLB_JSON_CHUNK_TYPE) {
      json = JSON.parse(chunk.toString('utf8').replace(/\0+$/g, '').trimEnd());
    } else if (chunkType === GLB_BIN_CHUNK_TYPE && !bin) {
      bin = Buffer.from(chunk);
    }

    offset = chunkEnd;
  }

  if (!json || typeof json !== 'object') {
    throw new InspectorError(`GLB file is missing a JSON chunk: ${filePath}`);
  }

  return { json, bin };
}

function padBuffer(buffer, multiple, fill) {
  const remainder = buffer.length % multiple;
  if (remainder === 0) {
    return buffer;
  }

  return Buffer.concat([buffer, Buffer.alloc(multiple - remainder, fill)]);
}

function buildGlb(json, bin) {
  const jsonBytes = padBuffer(Buffer.from(JSON.stringify(json), 'utf8'), 4, 0x20);
  const chunks = [];
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(GLB_JSON_CHUNK_TYPE, 4);
  chunks.push(jsonHeader, jsonBytes);

  if (bin) {
    const binBytes = padBuffer(Buffer.from(bin), 4, 0);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binBytes.length, 0);
    binHeader.writeUInt32LE(GLB_BIN_CHUNK_TYPE, 4);
    chunks.push(binHeader, binBytes);
  }

  const length = 12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(GLB_VERSION, 4);
  header.writeUInt32LE(length, 8);
  return Buffer.concat([header, ...chunks], length);
}

function decodeDataUri(uri, label) {
  const match = /^data:([^,]*?),(.*)$/i.exec(uri);
  if (!match) {
    throw new InspectorError(`${label} has an invalid data URI.`);
  }

  const metadata = match[1];
  const data = match[2];
  if (!/;base64(?:;|$)/i.test(metadata)) {
    throw new InspectorError(`${label} data URI must be base64 encoded.`);
  }

  return {
    metadata,
    bytes: Buffer.from(data, 'base64'),
  };
}

function encodeDataUri(metadata, bytes) {
  return `data:${metadata},${Buffer.from(bytes).toString('base64')}`;
}

function loadGltfResource(filePath, rootDir) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.glb') {
    const parsed = parseGlb(filePath);
    return {
      type: 'glb',
      filePath,
      json: parsed.json,
      embeddedBin: parsed.bin || Buffer.alloc(0),
      buffers: [],
      modifiedExternalBuffers: new Set(),
      dataUriMetadata: new Map(),
      rootDir,
    };
  }

  if (extension === '.gltf') {
    return {
      type: 'gltf',
      filePath,
      json: JSON.parse(fs.readFileSync(filePath, 'utf8')),
      embeddedBin: null,
      buffers: [],
      modifiedExternalBuffers: new Set(),
      dataUriMetadata: new Map(),
      rootDir,
    };
  }

  throw new InspectorError(`Unsupported splat resource type: ${filePath}`);
}

function loadResourceBuffer(resource, bufferIndex) {
  if (resource.buffers[bufferIndex]) {
    return resource.buffers[bufferIndex];
  }

  const bufferDef = resource.json.buffers?.[bufferIndex];
  if (!bufferDef || typeof bufferDef !== 'object') {
    throw new InspectorError(
      `${resource.filePath} references missing buffer ${bufferIndex}.`,
    );
  }

  let record;
  if (typeof bufferDef.uri === 'string' && bufferDef.uri.length > 0) {
    if (/^data:/i.test(bufferDef.uri)) {
      const { metadata, bytes } = decodeDataUri(
        bufferDef.uri,
        `${resource.filePath}.buffers[${bufferIndex}].uri`,
      );
      resource.dataUriMetadata.set(bufferIndex, metadata);
      record = { bytes: Buffer.from(bytes), dataUri: true };
    } else {
      const bufferPath = resolveLocalUri(
        path.dirname(resource.filePath),
        resource.rootDir,
        bufferDef.uri,
        `${resource.filePath}.buffers[${bufferIndex}].uri`,
      );
      record = {
        bytes: fs.readFileSync(bufferPath),
        path: bufferPath,
      };
    }
  } else if (resource.type === 'glb' && bufferIndex === 0) {
    record = {
      bytes: Buffer.from(resource.embeddedBin || Buffer.alloc(0)),
      embedded: true,
    };
  } else {
    throw new InspectorError(
      `${resource.filePath}.buffers[${bufferIndex}] must reference a local buffer.`,
    );
  }

  resource.buffers[bufferIndex] = record;
  return record;
}

function getNodeLocalMatrix(THREE, node) {
  const matrix = new THREE.Matrix4();
  if (Array.isArray(node?.matrix)) {
    matrix.fromArray(normalizeMatrix4Array(node.matrix, 'node.matrix'));
    return matrix;
  }

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  if (Array.isArray(node?.translation)) {
    position.fromArray(node.translation.map(Number));
  }
  if (Array.isArray(node?.rotation)) {
    quaternion.fromArray(node.rotation.map(Number));
  }
  if (Array.isArray(node?.scale)) {
    scale.fromArray(node.scale.map(Number));
  }

  matrix.compose(position, quaternion, scale);
  return matrix;
}

function collectGaussianPrimitiveDescriptors(THREE, json, tileSceneMatrix) {
  const descriptors = [];
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const scenes = Array.isArray(json.scenes) ? json.scenes : [];
  const sceneIndex = Number.isInteger(json.scene) ? json.scene : 0;
  const rootNodeIndices = Array.isArray(scenes[sceneIndex]?.nodes)
    ? scenes[sceneIndex].nodes
    : nodes.map((_, index) => index);

  function visitNode(nodeIndex, parentMatrix, stack) {
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) {
      return;
    }
    if (stack.has(nodeIndex)) {
      throw new InspectorError('glTF node hierarchy contains a cycle.');
    }

    const node = nodes[nodeIndex];
    if (!node || typeof node !== 'object') {
      return;
    }

    stack.add(nodeIndex);
    const nodeWorldMatrix = getNodeLocalMatrix(THREE, node);
    nodeWorldMatrix.premultiply(parentMatrix);

    if (Number.isInteger(node.mesh)) {
      const mesh = meshes[node.mesh];
      if (mesh && Array.isArray(mesh.primitives)) {
        mesh.primitives.forEach((primitive, primitiveIndex) => {
          const gaussianExtension =
            primitive?.extensions?.KHR_gaussian_splatting?.extensions
              ?.KHR_gaussian_splatting_compression_spz_2;
          const bufferView = gaussianExtension?.bufferView;
          if (bufferView == null) {
            if (primitive?.extensions?.KHR_gaussian_splatting) {
              throw new InspectorError(
                'Only KHR_gaussian_splatting_compression_spz_2 Gaussian primitives are supported for crop deletion.',
              );
            }
            return;
          }
          if (!Number.isInteger(bufferView)) {
            throw new InspectorError('Gaussian SPZ bufferView must be an integer.');
          }
          descriptors.push({
            bufferView,
            meshIndex: node.mesh,
            primitiveIndex,
            sourceToWorldMatrix: nodeWorldMatrix.clone(),
          });
        });
      }
    }

    if (Array.isArray(node.children)) {
      node.children.forEach((childIndex) => {
        visitNode(childIndex, nodeWorldMatrix, stack);
      });
    }
    stack.delete(nodeIndex);
  }

  rootNodeIndices.forEach((nodeIndex) => {
    visitNode(nodeIndex, tileSceneMatrix, new Set());
  });

  return descriptors;
}

function hasScenePrimitives(json) {
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const scenes = Array.isArray(json.scenes) ? json.scenes : [];
  const sceneIndex = Number.isInteger(json.scene) ? json.scene : 0;
  const rootNodeIndices = Array.isArray(scenes[sceneIndex]?.nodes)
    ? scenes[sceneIndex].nodes
    : nodes.map((_, index) => index);
  const visited = new Set();

  function visitNode(nodeIndex) {
    if (!Number.isInteger(nodeIndex) || nodeIndex < 0 || nodeIndex >= nodes.length) {
      return false;
    }
    if (visited.has(nodeIndex)) {
      return false;
    }

    visited.add(nodeIndex);
    const node = nodes[nodeIndex];
    const mesh = Number.isInteger(node?.mesh) ? meshes[node.mesh] : null;
    if (Array.isArray(mesh?.primitives) && mesh.primitives.length > 0) {
      return true;
    }

    if (!Array.isArray(node?.children)) {
      return false;
    }

    return node.children.some(visitNode);
  }

  return rootNodeIndices.some(visitNode);
}

function removeMeshPrimitives(resource, descriptors) {
  const removals = new Map();
  descriptors.forEach((descriptor) => {
    if (
      !Number.isInteger(descriptor.meshIndex) ||
      !Number.isInteger(descriptor.primitiveIndex)
    ) {
      return;
    }
    removals.set(
      `${descriptor.meshIndex}:${descriptor.primitiveIndex}`,
      descriptor,
    );
  });

  const ordered = Array.from(removals.values()).sort((left, right) => {
    if (left.meshIndex !== right.meshIndex) {
      return right.meshIndex - left.meshIndex;
    }
    return right.primitiveIndex - left.primitiveIndex;
  });

  let removed = 0;
  ordered.forEach((descriptor) => {
    const primitives = resource.json.meshes?.[descriptor.meshIndex]?.primitives;
    if (
      Array.isArray(primitives) &&
      descriptor.primitiveIndex >= 0 &&
      descriptor.primitiveIndex < primitives.length
    ) {
      primitives.splice(descriptor.primitiveIndex, 1);
      removed += 1;
    }
  });

  return removed;
}

function addReplacement(replacements, replacement) {
  replacements.push(replacement);
  replacements.sort((a, b) => a.start - b.start);
  for (let index = 1; index < replacements.length; index++) {
    if (replacements[index - 1].end > replacements[index].start) {
      throw new InspectorError('Overlapping SPZ bufferViews are not supported.');
    }
  }
}

function applyBufferReplacements(resource, bufferIndex, replacements) {
  if (replacements.length === 0) {
    return false;
  }

  const record = loadResourceBuffer(resource, bufferIndex);
  const parts = [];
  let cursor = 0;
  let delta = 0;

  replacements.forEach((replacement) => {
    parts.push(record.bytes.subarray(cursor, replacement.start));
    parts.push(Buffer.from(replacement.bytes));
    cursor = replacement.end;

    const view = resource.json.bufferViews[replacement.bufferViewIndex];
    view.byteOffset = replacement.start + delta;
    view.byteLength = replacement.bytes.length;
    const localDelta = replacement.bytes.length - (replacement.end - replacement.start);

    resource.json.bufferViews.forEach((otherView, otherIndex) => {
      if (
        otherIndex !== replacement.bufferViewIndex &&
        otherView &&
        (otherView.buffer == null ? 0 : otherView.buffer) === bufferIndex &&
        Number(otherView.byteOffset || 0) > replacement.start
      ) {
        otherView.byteOffset = Number(otherView.byteOffset || 0) + localDelta;
      }
    });
    delta += localDelta;
  });

  parts.push(record.bytes.subarray(cursor));
  record.bytes = Buffer.concat(parts);
  const bufferDef = resource.json.buffers[bufferIndex];
  bufferDef.byteLength = record.bytes.length;

  if (record.embedded) {
    resource.embeddedBin = record.bytes;
  } else if (record.dataUri) {
    const metadata = resource.dataUriMetadata.get(bufferIndex);
    bufferDef.uri = encodeDataUri(metadata, record.bytes);
  } else {
    resource.modifiedExternalBuffers.add(bufferIndex);
  }

  return true;
}

function saveGltfResource(resource) {
  resource.modifiedExternalBuffers.forEach((bufferIndex) => {
    const record = resource.buffers[bufferIndex];
    writeBytesAtomic(record.path, record.bytes);
  });

  if (resource.type === 'glb') {
    writeBytesAtomic(resource.filePath, buildGlb(resource.json, resource.embeddedBin));
  } else {
    writeJsonAtomic(resource.filePath, resource.json);
  }
}

function getBufferViewSlice(resource, bufferViewIndex) {
  const view = resource.json.bufferViews?.[bufferViewIndex];
  if (!view || typeof view !== 'object') {
    throw new InspectorError(
      `${resource.filePath} references missing bufferView ${bufferViewIndex}.`,
    );
  }
  const bufferIndex = view.buffer == null ? 0 : view.buffer;
  if (!Number.isInteger(bufferIndex)) {
    throw new InspectorError(
      `${resource.filePath}.bufferViews[${bufferViewIndex}].buffer must be an integer.`,
    );
  }

  const record = loadResourceBuffer(resource, bufferIndex);
  const start = Number(view.byteOffset || 0);
  const length = Number(view.byteLength);
  if (!Number.isInteger(start) || start < 0) {
    throw new InspectorError(
      `${resource.filePath}.bufferViews[${bufferViewIndex}].byteOffset must be a non-negative integer.`,
    );
  }
  if (!Number.isInteger(length) || length < 0) {
    throw new InspectorError(
      `${resource.filePath}.bufferViews[${bufferViewIndex}].byteLength must be a non-negative integer.`,
    );
  }
  if (start + length > record.bytes.length) {
    throw new InspectorError(
      `${resource.filePath}.bufferViews[${bufferViewIndex}] exceeds its buffer.`,
    );
  }

  return {
    bufferIndex,
    start,
    end: start + length,
    bytes: record.bytes.subarray(start, start + length),
  };
}

function serializeCropBoxMatrices(cropBoxMatrices) {
  return cropBoxMatrices.map((matrix) => matrix.toArray());
}

function serializeRewriteDescriptors(descriptors) {
  return descriptors.map((descriptor) => ({
    sourceToWorldMatrix: descriptor.sourceToWorldMatrix.toArray(),
  }));
}

function rewriteSpzBytesInWorker({
  bytes,
  cropBoxMatrices,
  descriptors,
  workerPool,
}) {
  const workerBytes = Uint8Array.from(bytes);
  return workerPool.run(
    {
      bytes: workerBytes,
      cropBoxMatrices,
      descriptors: serializeRewriteDescriptors(descriptors),
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

async function processGltfResource({
  THREE,
  filePath,
  rootDir,
  tileSceneMatrix,
  cropBoxMatrices,
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
        cropBoxMatrices,
        descriptors: viewDescriptors,
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

async function traverseTileset({
  THREE,
  tilesetPath,
  rootDir,
  upRotationMatrix,
  rootTransform,
  cropBoxMatrices,
  parentTransform,
  visitedTilesets,
  processedResources,
  emptySplatResources,
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

  const tileset = JSON.parse(fs.readFileSync(resolvedTilesetPath, 'utf8'));
  if (!tileset || typeof tileset !== 'object' || !tileset.root) {
    throw new InspectorError(`${resolvedTilesetPath} must contain a root object.`);
  }

  const tilesetDir = path.dirname(resolvedTilesetPath);
  let deletedSplats = 0;
  let processedSplatResources = 0;
  let tilesetModified = false;

  async function visitTile(tile, inheritedTransform, isRootTile) {
    const tileTransform = isRootTile && rootTransform
      ? new THREE.Matrix4().fromArray(rootTransform)
      : getTileWorldTransform(THREE, tile, inheritedTransform);

    const contentResults = await Promise.all(getContentSlots(tile).map(async (slot) => {
      const { content } = slot;
      const uri = getContentUri(content);
      if (typeof uri !== 'string' || uri.length === 0) {
        return {
          deletedSplats: 0,
          processedSplatResources: 0,
          removeSlot: false,
          slot,
        };
      }

      if (isRemoteOrProtocolUri(uri)) {
        throw new InspectorError(`Remote content is not supported for crop save: ${uri}`);
      }

      const normalizedUri = stripUriSuffix(uri);
      const extension = path.extname(normalizedUri).toLowerCase();
      if (extension === '.json') {
        const childTilesetPath = resolveLocalUri(
          tilesetDir,
          rootDir,
          uri,
          'Nested tileset content URI',
        );
        const childResult = await traverseTileset({
          THREE,
          tilesetPath: childTilesetPath,
          rootDir,
          upRotationMatrix,
          rootTransform: null,
          cropBoxMatrices,
          parentTransform: tileTransform,
          visitedTilesets,
          processedResources,
          emptySplatResources,
          resourceLocks,
          workerPool,
        });
        return {
          deletedSplats: childResult.deletedSplats,
          processedSplatResources: childResult.processedSplatResources,
          removeSlot: childResult.rootEmpty,
          slot,
        };
      } else if (extension === '.gltf' || extension === '.glb') {
        const resourcePath = resolveLocalUri(
          tilesetDir,
          rootDir,
          uri,
          'Splat content URI',
        );
        const tileSceneMatrix = tileTransform.clone().multiply(upRotationMatrix);
        const resourceResult = await runWithResourceLock(
          resourceLocks,
          resourcePath,
          async () => {
            const withProcessedResourceCount = (result) => {
              const processedSplatResource =
                result.processed && !processedResources.has(resourcePath)
                  ? 1
                  : 0;
              if (processedSplatResource) {
                processedResources.add(resourcePath);
              }
              return {
                ...result,
                processedSplatResource,
              };
            };
            const cachedEmptyResource = emptySplatResources.get(resourcePath);
            if (cachedEmptyResource) {
              return withProcessedResourceCount({
                deletedSplats: 0,
                empty: true,
                processed: cachedEmptyResource.processed,
              });
            }

            const next = await processGltfResource({
              THREE,
              filePath: resourcePath,
              rootDir,
              tileSceneMatrix,
              cropBoxMatrices,
              workerPool,
            });
            if (next.empty) {
              emptySplatResources.set(resourcePath, {
                processed: next.processed,
              });
            }
            return withProcessedResourceCount(next);
          },
        );
        return {
          deletedSplats: resourceResult.deletedSplats,
          processedSplatResources: resourceResult.processedSplatResource,
          removeSlot: resourceResult.empty,
          slot,
        };
      }

      return {
        deletedSplats: 0,
        processedSplatResources: 0,
        removeSlot: false,
        slot,
      };
    }));

    contentResults.forEach((result) => {
      deletedSplats += result.deletedSplats;
      processedSplatResources += result.processedSplatResources;
      if (result.removeSlot && removeContentSlot(tile, result.slot)) {
        tilesetModified = true;
      }
    });

    if (Array.isArray(tile.children)) {
      const children = tile.children.slice();
      const childResults = await Promise.all(
        children.map(async (child) => ({
          child,
          result: await visitTile(child, tileTransform, false),
        })),
      );
      const keptChildren = [];
      childResults.forEach(({ child, result: childResult }) => {
        if (childResult.empty) {
          tilesetModified = true;
        } else {
          keptChildren.push(child);
        }
      });
      if (keptChildren.length === 0) {
        if (tile.children.length > 0) {
          tilesetModified = true;
        }
        delete tile.children;
      } else if (keptChildren.length !== tile.children.length) {
        tile.children = keptChildren;
      }
    }

    return { empty: tileIsEmpty(tile) };
  }

  const rootResult = await visitTile(tileset.root, parentTransform, true);
  if (tilesetModified) {
    writeJsonAtomic(resolvedTilesetPath, tileset);
  }
  return {
    deletedSplats,
    processedSplatResources,
    rootEmpty: rootResult.empty,
  };
}

async function deleteSplatsInBoxes(rootTilesetPath, rootTransform, splatCropBoxes) {
  const normalizedBoxes = normalizeSplatCropBoxes(splatCropBoxes);
  if (normalizedBoxes.length === 0) {
    return {
      deletedSplats: 0,
      processedSplatResources: 0,
    };
  }

  const tilesetPath = path.resolve(rootTilesetPath);
  const rootDir = path.dirname(tilesetPath);
  assertPathInsideRoot(tilesetPath, rootDir, 'Root tileset path');

  const { THREE } = await getSplatCropModules();
  const rootTileset = JSON.parse(fs.readFileSync(tilesetPath, 'utf8'));
  if (!rootTileset || typeof rootTileset !== 'object' || !rootTileset.root) {
    throw new InspectorError(`${tilesetPath} must contain a root object.`);
  }

  const upRotationMatrix = getRootUpRotationMatrix(THREE, rootTileset);
  const cropBoxMatrices = normalizedBoxes.map((box, index) => {
    const matrix = new THREE.Matrix4().fromArray(box.matrix);
    if (Math.abs(matrix.determinant()) <= 1e-12) {
      throw new InspectorError(
        `splatCropBoxes[${index}].matrix must be invertible.`,
      );
    }
    return matrix;
  });
  const cropBoxMatrixArrays = serializeCropBoxMatrices(cropBoxMatrices);
  const workerPool = new SplatCropWorkerPool(SPLAT_CROP_WORKER_COUNT);

  try {
    return await traverseTileset({
      THREE,
      tilesetPath,
      rootDir,
      upRotationMatrix,
      rootTransform:
        rootTransform == null
          ? IDENTITY_MATRIX4
          : normalizeMatrix4Array(rootTransform, 'rootTransform'),
      cropBoxMatrices: cropBoxMatrixArrays,
      parentTransform: null,
      visitedTilesets: new Set(),
      processedResources: new Set(),
      emptySplatResources: new Map(),
      resourceLocks: new Map(),
      workerPool,
    });
  } finally {
    await workerPool.close();
  }
}

module.exports = {
  deleteSplatsInBoxes,
  normalizeSplatCropBoxes,
};
