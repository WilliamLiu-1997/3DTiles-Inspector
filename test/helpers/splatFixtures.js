const assert = require('assert');
const fs = require('fs');

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_BIN_CHUNK_TYPE = 0x004e4942;
const SQRT_HALF = Math.SQRT1_2;

async function createSpzBytes(points) {
  const { SpzWriter } = await import('@sparkjsdev/spark');
  const writer = new SpzWriter({
    numSplats: points.length,
    shDegree: 0,
  });

  points.forEach(([x, y, z], index) => {
    writer.setCenter(index, x, y, z);
    writer.setAlpha(index, 1);
    writer.setRgb(index, 1, 1, 1);
    writer.setScale(index, 0, 0, 0);
    writer.setQuat(index, 0, 0, 0, 1);
  });

  return Buffer.from(await writer.finalize());
}

async function readSpzCenters(bytes) {
  const { SpzReader } = await import('@sparkjsdev/spark');
  const reader = new SpzReader({ fileBytes: bytes });
  await reader.parseHeader();
  const centers = [];
  await reader.parseSplats((index, x, y, z) => {
    centers[index] = { x, y, z };
  });
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
