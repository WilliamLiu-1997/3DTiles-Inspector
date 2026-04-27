const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const api = require('../src');

const IDENTITY_MATRIX4 = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

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
    assert.strictEqual(tileset.root.children[0].geometricError, 450);
    assert.strictEqual(
      tileset.root.children[0].children[0].geometricError,
      50,
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

    console.log('ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
