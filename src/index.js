const { InspectorError } = require('./errors');
const { resolveAndValidateTilesetPath } = require('./tileset-path');
const { startInspectorSession } = require('./server/session');

async function runInspector(rawPath, options = {}) {
  const tilesetPath = resolveAndValidateTilesetPath(rawPath);
  const session = await startInspectorSession(tilesetPath, options);
  console.log(`[ok] inspector ready: ${session.url}`);
  console.log('[info] press Ctrl+C to stop the local inspector server.');
  await session.waitUntilClosed();
  return session;
}

module.exports = {
  InspectorError,
  resolveAndValidateTilesetPath,
  runInspector,
  startInspectorSession,
};
