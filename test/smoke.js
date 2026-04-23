const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const api = require('../src');

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
  fs.writeFileSync(tilesetPath, JSON.stringify({ root: {} }), 'utf8');

  assert.strictEqual(api.resolveAndValidateTilesetPath(tilesetPath), tilesetPath);
  assert.strictEqual(api.resolveAndValidateTilesetPath(tempDir), tilesetPath);

  const help = spawnSync(
    process.execPath,
    [path.join(__dirname, '..', 'bin', '3dtiles-inspector.js'), '--help'],
    { encoding: 'utf8' },
  );

  assert.strictEqual(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: 3dtiles-inspector \[options\] <tileset_json>/);

  console.log('ok');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
