const assert = require('assert');
const fs = require('fs');
const zlib = require('zlib');

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_BIN_CHUNK_TYPE = 0x004e4942;
const SQRT_HALF = Math.SQRT1_2;
const SPZ_MAGIC = 0x5053474e;
const SPZ_VERSION = 3;
const SPZ_FRACTIONAL_BITS = 12;
const SPZ_FLAGS = 0;
const SPZ_POSITION_STRIDE = 9;
const SPZ_BYTES_PER_SPLAT = 20;
const SPZ_COMPRESSION_LEVEL = 6;

function writeInt24LE(buffer, offset, value) {
  if (value < -0x800000 || value > 0x7fffff) {
    throw new RangeError('SPZ fixture position exceeds signed 24-bit range.');
  }
  buffer.writeIntLE(value, offset, 3);
}

function createSpzBytes(points) {
  const raw = Buffer.alloc(16 + points.length * SPZ_BYTES_PER_SPLAT);
  raw.writeUInt32LE(SPZ_MAGIC, 0);
  raw.writeUInt32LE(SPZ_VERSION, 4);
  raw.writeUInt32LE(points.length, 8);
  raw.writeUInt8(0, 12);
  raw.writeUInt8(SPZ_FRACTIONAL_BITS, 13);
  raw.writeUInt8(SPZ_FLAGS, 14);

  const opacityOffset = 16 + points.length * SPZ_POSITION_STRIDE;
  const colorOffset = opacityOffset + points.length;
  const scaleOffset = colorOffset + points.length * 3;
  const quaternionOffset = scaleOffset + points.length * 3;
  const fixedScale = 2 ** SPZ_FRACTIONAL_BITS;

  points.forEach((point, index) => {
    if (
      !Array.isArray(point) ||
      point.length !== 3 ||
      point.some((value) => !Number.isFinite(value))
    ) {
      throw new TypeError('SPZ fixture positions must be finite xyz arrays.');
    }
    const positionOffset = 16 + index * SPZ_POSITION_STRIDE;
    point.forEach((value, component) => {
      writeInt24LE(
        raw,
        positionOffset + component * 3,
        Math.round(value * fixedScale),
      );
    });
    raw[opacityOffset + index] = 0xff;
    raw.fill(0xc3, colorOffset + index * 3, colorOffset + (index + 1) * 3);
    raw[quaternionOffset + index * 4 + 3] = 0xc0;
  });

  return zlib.gzipSync(raw, {
    level: SPZ_COMPRESSION_LEVEL,
    memLevel: 9,
  });
}

function readSpzCenters(bytes) {
  const raw = zlib.gunzipSync(bytes);
  assert.strictEqual(raw.readUInt32LE(0), SPZ_MAGIC);
  assert.strictEqual(raw.readUInt32LE(4), SPZ_VERSION);
  const count = raw.readUInt32LE(8);
  const fixedScale = 2 ** raw.readUInt8(13);
  const centers = new Array(count);
  for (let index = 0; index < count; index++) {
    const offset = 16 + index * SPZ_POSITION_STRIDE;
    centers[index] = {
      x: raw.readIntLE(offset, 3) / fixedScale,
      y: raw.readIntLE(offset + 3, 3) / fixedScale,
      z: raw.readIntLE(offset + 6, 3) / fixedScale,
    };
  }
  return centers;
}

function makeGaussianPrimitive(bufferView) {
  return {
    extensions: {
      KHR_gaussian_splatting: {
        extensions: {
          KHR_gaussian_splatting_compression_spz_2: {
            bufferView,
          },
        },
      },
    },
  };
}

function makeGaussianGltf(bufferUri, byteLength, bufferViews = null) {
  const views = bufferViews || [{ buffer: 0, byteOffset: 0, byteLength }];
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: views.map((_, index) => makeGaussianPrimitive(index)),
      },
    ],
    buffers: [
      bufferUri == null
        ? { byteLength }
        : {
            byteLength,
            uri: bufferUri,
          },
    ],
    bufferViews: views,
    extensionsUsed: [
      'KHR_gaussian_splatting',
      'KHR_gaussian_splatting_compression_spz_2',
    ],
  };
}

function padBuffer(buffer, fill) {
  const remainder = buffer.length % 4;
  if (remainder === 0) {
    return buffer;
  }
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
}

function buildGlb(json, bin) {
  const jsonBytes = padBuffer(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binBytes = padBuffer(Buffer.from(bin), 0);
  const totalLength = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(GLB_VERSION, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(GLB_JSON_CHUNK_TYPE, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBytes.length, 0);
  binHeader.writeUInt32LE(GLB_BIN_CHUNK_TYPE, 4);

  return Buffer.concat([
    header,
    jsonHeader,
    jsonBytes,
    binHeader,
    binBytes,
  ]);
}

function parseGlb(filePath) {
  const bytes = fs.readFileSync(filePath);
  assert.strictEqual(bytes.readUInt32LE(0), GLB_MAGIC);
  assert.strictEqual(bytes.readUInt32LE(4), GLB_VERSION);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLength;
    if (chunkType === GLB_JSON_CHUNK_TYPE) {
      json = JSON.parse(bytes.subarray(start, end).toString('utf8').trimEnd());
    } else if (chunkType === GLB_BIN_CHUNK_TYPE) {
      bin = bytes.subarray(start, end);
    }
    offset = end;
  }
  return { json, bin };
}

function readBufferViewBytes(bytes, view) {
  const start = Number(view.byteOffset || 0);
  return bytes.subarray(start, start + Number(view.byteLength));
}

function readGltfBufferViewBytes(gltfPath, bufferPath, bufferViewIndex = 0) {
  const gltf = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
  const buffer = fs.readFileSync(bufferPath);
  return readBufferViewBytes(buffer, gltf.bufferViews[bufferViewIndex]);
}

function readGlbBufferViewBytes(glbPath, bufferViewIndex = 0) {
  const { json, bin } = parseGlb(glbPath);
  return readBufferViewBytes(bin, json.bufferViews[bufferViewIndex]);
}

function writeSplatTileset(tilesetPath, contentUri) {
  fs.writeFileSync(
    tilesetPath,
    JSON.stringify({
      asset: { version: '1.1' },
      geometricError: 10,
      root: {
        boundingVolume: {
          box: [
            0,
            0,
            0,
            100 * SQRT_HALF,
            100 * SQRT_HALF,
            0,
            -100 * SQRT_HALF,
            100 * SQRT_HALF,
            0,
            0,
            0,
            100,
          ],
        },
        geometricError: 10,
        content: { uri: contentUri },
      },
    }),
    'utf8',
  );
}

module.exports = {
  buildGlb,
  createSpzBytes,
  makeGaussianGltf,
  readGlbBufferViewBytes,
  readGltfBufferViewBytes,
  readSpzCenters,
  writeSplatTileset,
};
