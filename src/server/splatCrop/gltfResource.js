const fs = require('fs');
const path = require('path');

const { InspectorError } = require('../../errors');
const { normalizeMatrix4Array } = require('./normalize');

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_BIN_CHUNK_TYPE = 0x004e4942;

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

function addReplacement(replacements, replacement) {
  replacements.push(replacement);
  replacements.sort((a, b) => a.start - b.start);
  for (let index = 1; index < replacements.length; index++) {
    if (replacements[index - 1].end > replacements[index].start) {
      throw new InspectorError('Overlapping SPZ bufferViews are not supported.');
    }
  }
}

function getReplacementDelta(replacement) {
  return replacement.bytes.length - (replacement.end - replacement.start);
}

function getOffsetDeltaBefore(replacements, originalOffset) {
  let delta = 0;
  replacements.forEach((replacement) => {
    if (originalOffset > replacement.start) {
      delta += getReplacementDelta(replacement);
    }
  });
  return delta;
}

function collectBufferViewOffsets(resource, bufferIndex) {
  const offsets = new Map();
  resource.json.bufferViews?.forEach((view, viewIndex) => {
    if (!view || typeof view !== 'object') {
      return;
    }
    const viewBufferIndex = view.buffer == null ? 0 : view.buffer;
    if (viewBufferIndex === bufferIndex) {
      offsets.set(viewIndex, Number(view.byteOffset || 0));
    }
  });
  return offsets;
}

function setBufferViewByteOffset(view, byteOffset) {
  if (byteOffset === 0 && view.byteOffset == null) {
    return;
  }
  view.byteOffset = byteOffset;
}

function applyBufferReplacements(resource, bufferIndex, replacements) {
  if (replacements.length === 0) {
    return false;
  }

  const record = loadResourceBuffer(resource, bufferIndex);
  const originalOffsets = collectBufferViewOffsets(resource, bufferIndex);
  const replacementByView = new Map(
    replacements.map((replacement) => [
      replacement.bufferViewIndex,
      replacement,
    ]),
  );
  const parts = [];
  let cursor = 0;

  replacements.forEach((replacement) => {
    parts.push(record.bytes.subarray(cursor, replacement.start));
    parts.push(Buffer.from(replacement.bytes));
    cursor = replacement.end;
  });

  parts.push(record.bytes.subarray(cursor));
  record.bytes = Buffer.concat(parts);
  const bufferDef = resource.json.buffers[bufferIndex];
  bufferDef.byteLength = record.bytes.length;

  originalOffsets.forEach((originalOffset, viewIndex) => {
    const view = resource.json.bufferViews[viewIndex];
    const replacement = replacementByView.get(viewIndex);
    if (replacement) {
      setBufferViewByteOffset(
        view,
        replacement.start + getOffsetDeltaBefore(replacements, originalOffset),
      );
      view.byteLength = replacement.bytes.length;
      return;
    }

    setBufferViewByteOffset(
      view,
      originalOffset + getOffsetDeltaBefore(replacements, originalOffset),
    );
  });

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

module.exports = {
  applyBufferReplacements,
  addReplacement,
  assertPathInsideRoot,
  getBufferViewSlice,
  getNodeLocalMatrix,
  isRemoteOrProtocolUri,
  loadGltfResource,
  resolveLocalUri,
  saveGltfResource,
  stripUriSuffix,
  writeJsonAtomic,
};
