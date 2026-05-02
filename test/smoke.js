const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const api = require('../src');

const IDENTITY_MATRIX4 = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];
const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_BIN_CHUNK_TYPE = 0x004e4942;

async function postSave(sessionUrl, body) {
  const origin = new URL(sessionUrl).origin;
  const response = await fetch(
    new URL('/__inspector/save-transform', sessionUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    },
  );
  const payload = await response.json();
  assert.strictEqual(response.status, 200, payload.error);
  assert.strictEqual(payload.ok, true);
  return payload;
}

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

function makeGaussianGltf(bufferUri, byteLength) {
  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            extensions: {
              KHR_gaussian_splatting: {
                extensions: {
                  KHR_gaussian_splatting_compression_spz_2: {
                    bufferView: 0,
                  },
                },
              },
            },
          },
        ],
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
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength }],
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

function writeSplatTileset(tilesetPath, contentUri) {
  fs.writeFileSync(
    tilesetPath,
    JSON.stringify({
      asset: { version: '1.1' },
      geometricError: 10,
      root: {
        geometricError: 10,
        content: { uri: contentUri },
      },
    }),
    'utf8',
  );
}

async function assertCropSaveDeletesTwoSplats({ tilesetPath, readSpzBytes }) {
  const session = await api.startInspectorSession(tilesetPath, {
    handleSignals: false,
    openBrowser: false,
  });
  try {
    const payload = await postSave(session.url, {
      geometricErrorLayerScale: 1,
      geometricErrorScale: 2,
      splatCropBoxes: [{ matrix: IDENTITY_MATRIX4 }],
      transform: IDENTITY_MATRIX4,
    });
    assert.strictEqual(payload.deletedSplats, 2);
    assert.strictEqual(payload.processedSplatResources, 1);
  } finally {
    await session.close();
  }

  const rewrittenTileset = JSON.parse(fs.readFileSync(tilesetPath, 'utf8'));
  assert.strictEqual(rewrittenTileset.geometricError, 20);
  assert.strictEqual(rewrittenTileset.root.geometricError, 20);

  const centers = await readSpzCenters(readSpzBytes());
  assert.strictEqual(centers.length, 1);
  assert.ok(Math.abs(centers[0].x - 3) < 0.01);
}

async function assertCropSavePrunesFullyDeletedSplatTile(baseDir) {
  const pruneDir = path.join(baseDir, 'crop-prune');
  fs.mkdirSync(pruneDir);

  const removedSpzBytes = await createSpzBytes([
    [0, 0, 0],
    [0.5, 0, 0],
  ]);
  const keptSpzBytes = await createSpzBytes([[3, 0, 0]]);
  const tilesetPath = path.join(pruneDir, 'tileset.json');
  const removedGltfPath = path.join(pruneDir, 'removed.gltf');
  const removedBinPath = path.join(pruneDir, 'removed.bin');
  const keptGltfPath = path.join(pruneDir, 'kept.gltf');
  const keptBinPath = path.join(pruneDir, 'kept.bin');

  fs.writeFileSync(removedBinPath, removedSpzBytes);
  fs.writeFileSync(keptBinPath, keptSpzBytes);
  fs.writeFileSync(
    removedGltfPath,
    JSON.stringify(makeGaussianGltf('removed.bin', removedSpzBytes.length)),
    'utf8',
  );
  fs.writeFileSync(
    keptGltfPath,
    JSON.stringify(makeGaussianGltf('kept.bin', keptSpzBytes.length)),
    'utf8',
  );
  fs.writeFileSync(
    tilesetPath,
    JSON.stringify({
      asset: { version: '1.1' },
      geometricError: 10,
      root: {
        geometricError: 10,
        children: [
          {
            content: { uri: 'removed.gltf' },
            geometricError: 5,
          },
          {
            content: { uri: 'kept.gltf' },
            geometricError: 5,
          },
        ],
      },
    }),
    'utf8',
  );

  const session = await api.startInspectorSession(tilesetPath, {
    handleSignals: false,
    openBrowser: false,
  });
  try {
    const payload = await postSave(session.url, {
      geometricErrorLayerScale: 1,
      geometricErrorScale: 1,
      splatCropBoxes: [{ matrix: IDENTITY_MATRIX4 }],
      transform: IDENTITY_MATRIX4,
    });
    assert.strictEqual(payload.deletedSplats, 2);
    assert.strictEqual(payload.processedSplatResources, 2);
  } finally {
    await session.close();
  }

  const rewrittenTileset = JSON.parse(fs.readFileSync(tilesetPath, 'utf8'));
  assert.strictEqual(rewrittenTileset.root.children.length, 1);
  assert.strictEqual(
    rewrittenTileset.root.children[0].content.uri,
    'kept.gltf',
  );

  const removedGltf = JSON.parse(fs.readFileSync(removedGltfPath, 'utf8'));
  assert.strictEqual(removedGltf.meshes[0].primitives.length, 0);

  const keptGltf = JSON.parse(fs.readFileSync(keptGltfPath, 'utf8'));
  const keptView = keptGltf.bufferViews[0];
  const keptBytes = fs.readFileSync(keptBinPath).subarray(
    Number(keptView.byteOffset || 0),
    Number(keptView.byteOffset || 0) + Number(keptView.byteLength),
  );
  const centers = await readSpzCenters(keptBytes);
  assert.strictEqual(centers.length, 1);
  assert.ok(Math.abs(centers[0].x - 3) < 0.01);
}

async function main() {
  assert.strictEqual(typeof api.InspectorError, 'function');
  assert.strictEqual(typeof api.startInspectorSession, 'function');
  assert.strictEqual(typeof api.runInspector, 'function');
  assert.strictEqual(typeof api.resolveAndValidateTilesetPath, 'function');

  assert.ok(!('ViewerError' in api));
  assert.ok(!('startViewerSession' in api));
  assert.ok(!('runViewer' in api));
  assert.ok(!('parseArgs' in api));
  assert.ok(!('run' in api));
  assert.ok(!('usage' in api));

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), '3dtiles-inspector-test-'),
  );

  try {
    const tilesetPath = path.join(tempDir, 'tileset.json');
    const nestedDir = path.join(tempDir, 'nested');
    const nestedTilesetPath = path.join(nestedDir, 'tileset.json');
    const summaryPath = path.join(tempDir, 'build_summary.json');

    fs.mkdirSync(nestedDir);
    fs.writeFileSync(
      tilesetPath,
      JSON.stringify({
        asset: { version: '1.0' },
        geometricError: 100,
        root: {
          geometricError: 100,
          children: [
            {
              geometricError: 50,
              children: [{ geometricError: 25 }],
            },
            {
              content: { uri: 'nested/tileset.json' },
              geometricError: 40,
            },
          ],
        },
      }),
      'utf8',
    );
    fs.writeFileSync(
      nestedTilesetPath,
      JSON.stringify({
        asset: { version: '1.0' },
        geometricError: 20,
        root: {
          geometricError: 20,
          children: [{ geometricError: 10 }],
        },
      }),
      'utf8',
    );
    fs.writeFileSync(
      summaryPath,
      JSON.stringify({ viewer_geometric_error_scale: 2 }),
      'utf8',
    );

    assert.strictEqual(
      api.resolveAndValidateTilesetPath(tilesetPath),
      tilesetPath,
    );
    assert.strictEqual(api.resolveAndValidateTilesetPath(tempDir), tilesetPath);

    const help = spawnSync(
      process.execPath,
      [path.join(__dirname, '..', 'bin', '3dtiles-inspector.js'), '--help'],
      { encoding: 'utf8' },
    );

    assert.strictEqual(help.status, 0, help.stderr);
    assert.match(
      help.stdout,
      /Usage: 3dtiles-inspector \[options\] <tileset_json>/,
    );

    const session = await api.startInspectorSession(tilesetPath, {
      handleSignals: false,
      openBrowser: false,
    });
    try {
      await postSave(session.url, {
        geometricErrorLayerScale: 8,
        geometricErrorScale: 2,
        transform: IDENTITY_MATRIX4,
      });
    } finally {
      await session.close();
    }

    const tileset = JSON.parse(fs.readFileSync(tilesetPath, 'utf8'));
    assert.strictEqual(tileset.geometricError, 1460);
    assert.strictEqual(tileset.root.geometricError, 1460);
    assert.strictEqual(tileset.root.children[0].geometricError, 660);
    assert.strictEqual(
      tileset.root.children[0].children[0].geometricError,
      260,
    );
    assert.strictEqual(tileset.root.children[1].geometricError, 500);

    const nestedTileset = JSON.parse(
      fs.readFileSync(nestedTilesetPath, 'utf8'),
    );
    assert.strictEqual(nestedTileset.geometricError, 180);
    assert.strictEqual(nestedTileset.root.geometricError, 180);
    assert.strictEqual(nestedTileset.root.children[0].geometricError, 20);

    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    assert.strictEqual(summary.viewer_geometric_error_scale, 4);
    assert.strictEqual(summary.viewer_geometric_error_layer_scale, 8);

    const cropPoints = [
      [0, 0, 0],
      [0.5, 0, 0],
      [3, 0, 0],
    ];

    const gltfCropDir = path.join(tempDir, 'crop-gltf');
    fs.mkdirSync(gltfCropDir);
    const gltfSpzBytes = await createSpzBytes(cropPoints);
    const gltfTilesetPath = path.join(gltfCropDir, 'tileset.json');
    const gltfPath = path.join(gltfCropDir, 'splats.gltf');
    const gltfBinPath = path.join(gltfCropDir, 'splats.bin');
    fs.writeFileSync(gltfBinPath, gltfSpzBytes);
    fs.writeFileSync(
      gltfPath,
      JSON.stringify(makeGaussianGltf('splats.bin', gltfSpzBytes.length)),
      'utf8',
    );
    writeSplatTileset(gltfTilesetPath, 'splats.gltf');
    await assertCropSaveDeletesTwoSplats({
      tilesetPath: gltfTilesetPath,
      readSpzBytes: () => {
        const gltf = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
        const view = gltf.bufferViews[0];
        const buffer = fs.readFileSync(gltfBinPath);
        return buffer.subarray(
          Number(view.byteOffset || 0),
          Number(view.byteOffset || 0) + Number(view.byteLength),
        );
      },
    });

    const glbCropDir = path.join(tempDir, 'crop-glb');
    fs.mkdirSync(glbCropDir);
    const glbSpzBytes = await createSpzBytes(cropPoints);
    const glbTilesetPath = path.join(glbCropDir, 'tileset.json');
    const glbPath = path.join(glbCropDir, 'splats.glb');
    fs.writeFileSync(
      glbPath,
      buildGlb(makeGaussianGltf(null, glbSpzBytes.length), glbSpzBytes),
    );
    writeSplatTileset(glbTilesetPath, 'splats.glb');
    await assertCropSaveDeletesTwoSplats({
      tilesetPath: glbTilesetPath,
      readSpzBytes: () => {
        const { json, bin } = parseGlb(glbPath);
        const view = json.bufferViews[0];
        return bin.subarray(
          Number(view.byteOffset || 0),
          Number(view.byteOffset || 0) + Number(view.byteLength),
        );
      },
    });

    await assertCropSavePrunesFullyDeletedSplatTile(tempDir);

    console.log('ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
