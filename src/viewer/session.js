const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { InspectorError } = require('../errors');
const { resolveAndValidateTilesetPath } = require('../tileset-path');

const VIEWER_HTML_NAME = 'viewer.html';
const VIEWER_DIR_NAME = 'viewer';
const BUILT_VIEWER_ASSETS_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'dist',
  'inspector-assets',
);
const SAVE_ENDPOINT_PATH = '/__inspector/save-transform';
const SHUTDOWN_ENDPOINT_PATH = '/__inspector/shutdown';
const MAX_SAVE_BODY_BYTES = 64 * 1024;
const SHUTDOWN_DELAY_MS = 1000;
const IDENTITY_MATRIX4 = Object.freeze([
  1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0,
  1.0,
]);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.subtree': 'application/octet-stream',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

function encodePathSegment(segment) {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function getBrowserRelativePath(fromDir, targetPath) {
  const relativePath = path.relative(fromDir, targetPath);
  if (
    relativePath.length === 0 ||
    relativePath === '.' ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new InspectorError(
      `Tileset path must stay within the viewer root: ${targetPath}`,
    );
  }

  return relativePath.split(path.sep).map(encodePathSegment).join('/');
}

function stringifyInlineScriptValue(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026');
}

function cloneIdentityMatrix4() {
  return IDENTITY_MATRIX4.slice();
}

function normalizeMatrix4Array(value, name = 'transform') {
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

function multiplyMatrix4(left, right) {
  const a = normalizeMatrix4Array(left, 'left');
  const b = normalizeMatrix4Array(right, 'right');
  const out = new Array(16);

  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0.0;
      for (let i = 0; i < 4; i++) {
        sum += a[i * 4 + row] * b[column * 4 + i];
      }
      out[column * 4 + row] = sum;
    }
  }

  return out;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function copyDirectoryRecursive(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function resolveBuiltViewerSubdir() {
  const builtViewerSubdir = path.join(BUILT_VIEWER_ASSETS_DIR, VIEWER_DIR_NAME);
  if (!fs.existsSync(builtViewerSubdir)) {
    throw new InspectorError(
      'Missing built inspector assets. Run `npm run build:viewer` first.',
    );
  }
  if (!fs.statSync(builtViewerSubdir).isDirectory()) {
    throw new InspectorError(
      `Built viewer assets path must be a directory: ${builtViewerSubdir}`,
    );
  }
  return builtViewerSubdir;
}

function createViewerAssetsDir(viewerConfig) {
  const assetsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), '3dtiles-inspector-'),
  );
  const viewerSubdir = path.join(assetsDir, VIEWER_DIR_NAME);
  fs.mkdirSync(viewerSubdir, { recursive: true });
  fs.writeFileSync(
    path.join(assetsDir, VIEWER_HTML_NAME),
    buildViewerHtml(viewerConfig),
    'utf8',
  );
  copyDirectoryRecursive(resolveBuiltViewerSubdir(), viewerSubdir);
  return assetsDir;
}

function removeViewerAssetsDir(assetsDir) {
  if (!assetsDir) {
    return;
  }
  fs.rmSync(assetsDir, { recursive: true, force: true });
}

function normalizePositiveFinite(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new InspectorError(`${name} must be a finite number greater than 0.`);
  }
  return number;
}

function scaleGeometricErrorValue(
  target,
  key,
  geometricErrorScale,
  geometricErrorLayerScale,
  leafGeometricError,
  label,
) {
  if (target[key] == null) {
    return;
  }

  const number = Number(target[key]);
  if (!Number.isFinite(number)) {
    throw new InspectorError(`${label} must be a finite number.`);
  }

  if (!Number.isFinite(leafGeometricError)) {
    throw new InspectorError(`${label} leaf geometricError must be finite.`);
  }

  const adjusted =
    leafGeometricError +
    (number - leafGeometricError) * geometricErrorLayerScale;
  const next = adjusted * geometricErrorScale;
  if (!Number.isFinite(next)) {
    throw new InspectorError(`${label} scaled value must be finite.`);
  }

  target[key] = next;
}

function assertTilesetPathInsideRoot(resolvedPath, rootDir) {
  if (
    resolvedPath !== rootDir &&
    !resolvedPath.startsWith(`${rootDir}${path.sep}`)
  ) {
    throw new InspectorError(
      `Nested tileset path escapes the viewer root: ${resolvedPath}`,
    );
  }
}

function getLocalExternalTilesetPaths(tile, baseDir) {
  const paths = [];
  if (!tile || typeof tile !== 'object') {
    return paths;
  }

  if (tile.content && typeof tile.content === 'object') {
    const filePath = getLocalJsonReferencePath(
      baseDir,
      tile.content.uri || tile.content.url,
    );
    if (filePath) {
      paths.push(filePath);
    }
  }

  if (Array.isArray(tile.contents)) {
    tile.contents.forEach((entry) => {
      if (entry && typeof entry === 'object') {
        const filePath = getLocalJsonReferencePath(
          baseDir,
          entry.uri || entry.url,
        );
        if (filePath) {
          paths.push(filePath);
        }
      }
    });
  }

  return paths;
}

function getTilesetRootLeafGeometricError(
  tilesetPath,
  rootDir,
  leafGeometricErrorCache,
  stack,
) {
  const resolvedPath = path.resolve(tilesetPath);
  if (leafGeometricErrorCache.has(resolvedPath)) {
    return leafGeometricErrorCache.get(resolvedPath);
  }

  if (stack.has(resolvedPath)) {
    return 0;
  }

  assertTilesetPathInsideRoot(resolvedPath, rootDir);

  if (!fs.existsSync(resolvedPath)) {
    throw new InspectorError(
      `Referenced nested tileset does not exist: ${resolvedPath}`,
    );
  }

  const tileset = readJsonFile(resolvedPath);
  if (!tileset || typeof tileset !== 'object' || !tileset.root) {
    throw new InspectorError(`${resolvedPath} must contain a root object.`);
  }

  stack.add(resolvedPath);
  const leafGeometricError = getTileLeafGeometricError(
    tileset.root,
    path.dirname(resolvedPath),
    rootDir,
    leafGeometricErrorCache,
    stack,
  );
  stack.delete(resolvedPath);
  leafGeometricErrorCache.set(resolvedPath, leafGeometricError);
  return leafGeometricError;
}

function getTileLeafGeometricError(
  tile,
  baseDir,
  rootDir,
  leafGeometricErrorCache,
  stack,
) {
  if (!tile || typeof tile !== 'object') {
    return 0;
  }

  const ownGeometricError = Number(tile.geometricError);
  if (!Number.isFinite(ownGeometricError)) {
    return 0;
  }

  let leafGeometricError = null;
  if (Array.isArray(tile.children)) {
    tile.children.forEach((child) => {
      const childLeafGeometricError = getTileLeafGeometricError(
        child,
        baseDir,
        rootDir,
        leafGeometricErrorCache,
        stack,
      );
      leafGeometricError =
        leafGeometricError === null
          ? childLeafGeometricError
          : Math.min(leafGeometricError, childLeafGeometricError);
    });
  }

  getLocalExternalTilesetPaths(tile, baseDir).forEach((childTilesetPath) => {
    const childLeafGeometricError = getTilesetRootLeafGeometricError(
      childTilesetPath,
      rootDir,
      leafGeometricErrorCache,
      stack,
    );
    leafGeometricError =
      leafGeometricError === null
        ? childLeafGeometricError
        : Math.min(leafGeometricError, childLeafGeometricError);
  });

  return leafGeometricError === null ? ownGeometricError : leafGeometricError;
}

function scaleTilesetGeometricErrors(
  tile,
  geometricErrorScale,
  geometricErrorLayerScale,
  baseDir,
  rootDir,
  leafGeometricErrorCache,
  pathLabel = 'tileset.root',
) {
  if (!tile || typeof tile !== 'object') {
    return;
  }

  scaleGeometricErrorValue(
    tile,
    'geometricError',
    geometricErrorScale,
    geometricErrorLayerScale,
    getTileLeafGeometricError(
      tile,
      baseDir,
      rootDir,
      leafGeometricErrorCache,
      new Set(),
    ),
    `${pathLabel}.geometricError`,
  );

  if (!Array.isArray(tile.children)) {
    return;
  }

  tile.children.forEach((child, index) => {
    scaleTilesetGeometricErrors(
      child,
      geometricErrorScale,
      geometricErrorLayerScale,
      baseDir,
      rootDir,
      leafGeometricErrorCache,
      `${pathLabel}.children[${index}]`,
    );
  });
}

function getLocalJsonReferencePath(baseDir, uri) {
  if (typeof uri !== 'string' || uri.length === 0) {
    return null;
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(uri) || uri.startsWith('//')) {
    return null;
  }

  const normalized = uri.split('#', 1)[0].split('?', 1)[0];
  if (!/\.json$/i.test(normalized)) {
    return null;
  }

  return path.resolve(baseDir, normalized.replace(/\//g, path.sep));
}

function collectExternalTilesetPaths(tile, baseDir, results) {
  if (!tile || typeof tile !== 'object') {
    return;
  }

  getLocalExternalTilesetPaths(tile, baseDir).forEach((filePath) => {
    results.add(filePath);
  });

  if (!Array.isArray(tile.children)) {
    return;
  }

  tile.children.forEach((child) => {
    collectExternalTilesetPaths(child, baseDir, results);
  });
}

function updateTilesetJsonFile(
  tilesetPath,
  {
    geometricErrorLayerScale,
    geometricErrorScale,
    rootDir,
    rootTransform = null,
    leafGeometricErrorCache = new Map(),
  },
  visited = new Set(),
) {
  const resolvedPath = path.resolve(tilesetPath);
  if (visited.has(resolvedPath)) {
    return null;
  }
  visited.add(resolvedPath);

  assertTilesetPathInsideRoot(resolvedPath, rootDir);

  if (!fs.existsSync(resolvedPath)) {
    throw new InspectorError(
      `Referenced nested tileset does not exist: ${resolvedPath}`,
    );
  }

  const tileset = readJsonFile(resolvedPath);
  if (!tileset || typeof tileset !== 'object' || !tileset.root) {
    throw new InspectorError(`${resolvedPath} must contain a root object.`);
  }

  if (rootTransform) {
    tileset.root.transform = rootTransform.slice();
  }

  const tilesetDir = path.dirname(resolvedPath);
  scaleGeometricErrorValue(
    tileset,
    'geometricError',
    geometricErrorScale,
    geometricErrorLayerScale,
    getTileLeafGeometricError(
      tileset.root,
      tilesetDir,
      rootDir,
      leafGeometricErrorCache,
      new Set(),
    ),
    `${resolvedPath}.geometricError`,
  );
  scaleTilesetGeometricErrors(
    tileset.root,
    geometricErrorScale,
    geometricErrorLayerScale,
    tilesetDir,
    rootDir,
    leafGeometricErrorCache,
    `${resolvedPath}.root`,
  );
  writeJsonAtomic(resolvedPath, tileset);

  const nestedTilesets = new Set();
  collectExternalTilesetPaths(tileset.root, tilesetDir, nestedTilesets);
  nestedTilesets.forEach((childTilesetPath) => {
    updateTilesetJsonFile(
      childTilesetPath,
      {
        geometricErrorLayerScale,
        geometricErrorScale,
        leafGeometricErrorCache,
        rootDir,
      },
      visited,
    );
  });

  return tileset;
}

function saveViewerTransform(
  rootTilesetPath,
  editMatrix,
  { geometricErrorLayerScale = 1, geometricErrorScale = 1 } = {},
) {
  const normalizedEdit = normalizeMatrix4Array(editMatrix, 'transform');
  const normalizedGeometricErrorScale = normalizePositiveFinite(
    geometricErrorScale,
    'geometricErrorScale',
  );
  const normalizedGeometricErrorLayerScale = normalizePositiveFinite(
    geometricErrorLayerScale,
    'geometricErrorLayerScale',
  );
  const tilesetPath = path.resolve(rootTilesetPath);
  const rootDir = path.dirname(tilesetPath);

  if (!fs.existsSync(tilesetPath)) {
    throw new InspectorError(
      `Cannot save viewer transform because ${tilesetPath} does not exist.`,
    );
  }

  const tileset = readJsonFile(tilesetPath);
  if (!tileset || typeof tileset !== 'object' || !tileset.root) {
    throw new InspectorError(
      `Root tileset JSON must contain a root object: ${tilesetPath}`,
    );
  }

  const currentRoot = Array.isArray(tileset.root.transform)
    ? normalizeMatrix4Array(tileset.root.transform, 'tileset.root.transform')
    : cloneIdentityMatrix4();
  const nextRoot = multiplyMatrix4(normalizedEdit, currentRoot);

  updateTilesetJsonFile(tilesetPath, {
    geometricErrorLayerScale: normalizedGeometricErrorLayerScale,
    geometricErrorScale: normalizedGeometricErrorScale,
    rootDir,
    rootTransform: nextRoot,
  });

  const summaryPath = path.join(rootDir, 'build_summary.json');
  if (fs.existsSync(summaryPath)) {
    const summary = readJsonFile(summaryPath);
    const previousGeometricErrorScale =
      summary.viewer_geometric_error_scale == null
        ? 1
        : normalizePositiveFinite(
            summary.viewer_geometric_error_scale,
            'build_summary.viewer_geometric_error_scale',
          );
    summary.root_transform = nextRoot.slice();
    summary.root_transform_source = 'transform';
    summary.root_coordinate = null;
    summary.viewer_geometric_error_scale =
      previousGeometricErrorScale * normalizedGeometricErrorScale;
    const previousGeometricErrorLayerScale =
      summary.viewer_geometric_error_layer_scale == null
        ? 1
        : normalizePositiveFinite(
            summary.viewer_geometric_error_layer_scale,
            'build_summary.viewer_geometric_error_layer_scale',
          );
    summary.viewer_geometric_error_layer_scale =
      previousGeometricErrorLayerScale * normalizedGeometricErrorLayerScale;
    writeJsonAtomic(summaryPath, summary);
  }

  return nextRoot;
}

function resolveStaticFilePath(tilesDir, viewerAssetsDir, pathname) {
  let decodedPathname;
  try {
    decodedPathname = decodeURIComponent(pathname || '/');
  } catch (err) {
    throw new InspectorError('Request path is not valid URL encoding.');
  }

  if (decodedPathname.includes('\0')) {
    throw new InspectorError('Request path contains invalid characters.');
  }

  const requested =
    decodedPathname === '/' || decodedPathname === ''
      ? VIEWER_HTML_NAME
      : decodedPathname.replace(/^[/\\]+/, '');

  const normalized = requested.replace(/\\/g, '/');
  const isViewerAsset =
    normalized === VIEWER_HTML_NAME ||
    normalized === VIEWER_DIR_NAME ||
    normalized.startsWith(`${VIEWER_DIR_NAME}/`);

  const resolvedRoot = path.resolve(isViewerAsset ? viewerAssetsDir : tilesDir);
  const resolvedPath = path.resolve(resolvedRoot, requested);

  if (
    resolvedPath !== resolvedRoot &&
    !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new InspectorError('Request path escapes the viewer root.');
  }

  return resolvedPath;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, statusCode, message, headers = {}) {
  const body = `${message}\n`;
  res.writeHead(statusCode, {
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_SAVE_BODY_BYTES) {
        reject(new InspectorError('Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function normalizeRequestTarget(rawTarget) {
  if (typeof rawTarget !== 'string' || rawTarget.length === 0) {
    return '/';
  }

  if (rawTarget.startsWith('//')) {
    return `/${rawTarget.replace(/^\/+/, '')}`;
  }

  return rawTarget;
}

async function handleSaveTransformRequest(rootTilesetPath, req, res) {
  let payload;
  try {
    const body = await readRequestBody(req);
    payload = body.length > 0 ? JSON.parse(body.toString('utf8')) : {};
  } catch (err) {
    sendJson(res, 400, {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'Invalid JSON payload.',
    });
    return;
  }

  if (!payload || typeof payload !== 'object') {
    sendJson(res, 400, { error: 'Request payload must be a JSON object.' });
    return;
  }

  let normalizedEdit;
  try {
    normalizedEdit = normalizeMatrix4Array(payload.transform, 'transform');
  } catch (err) {
    sendJson(res, 400, {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'transform must be a 16-number matrix.',
    });
    return;
  }

  let normalizedGeometricErrorScale;
  try {
    normalizedGeometricErrorScale = normalizePositiveFinite(
      payload.geometricErrorScale == null ? 1 : payload.geometricErrorScale,
      'geometricErrorScale',
    );
  } catch (err) {
    sendJson(res, 400, {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'geometricErrorScale must be a finite number greater than 0.',
    });
    return;
  }

  let normalizedGeometricErrorLayerScale;
  try {
    normalizedGeometricErrorLayerScale = normalizePositiveFinite(
      payload.geometricErrorLayerScale == null
        ? 1
        : payload.geometricErrorLayerScale,
      'geometricErrorLayerScale',
    );
  } catch (err) {
    sendJson(res, 400, {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'geometricErrorLayerScale must be a finite number greater than 0.',
    });
    return;
  }

  let nextRoot;
  try {
    nextRoot = saveViewerTransform(rootTilesetPath, normalizedEdit, {
      geometricErrorLayerScale: normalizedGeometricErrorLayerScale,
      geometricErrorScale: normalizedGeometricErrorScale,
    });
  } catch (err) {
    sendJson(res, 500, {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'Failed to save transform.',
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    transform: nextRoot,
    geometricErrorLayerScale: normalizedGeometricErrorLayerScale,
    geometricErrorScale: normalizedGeometricErrorScale,
  });
}

async function handleViewerRequest(
  tilesDir,
  rootTilesetPath,
  viewerAssetsDir,
  req,
  res,
  requestUrl = null,
) {
  const normalizedRequestUrl =
    requestUrl || new URL(normalizeRequestTarget(req.url), 'http://127.0.0.1');

  if (normalizedRequestUrl.pathname === SAVE_ENDPOINT_PATH) {
    if (req.method !== 'POST') {
      sendText(res, 405, 'Method Not Allowed', { Allow: 'POST' });
      return;
    }
    await handleSaveTransformRequest(rootTilesetPath, req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    return;
  }

  let filePath;
  try {
    filePath = resolveStaticFilePath(
      tilesDir,
      viewerAssetsDir,
      normalizedRequestUrl.pathname,
    );
  } catch (err) {
    sendText(res, 403, err.message || 'Forbidden');
    return;
  }

  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch (err) {
    sendText(res, 404, 'Not Found');
    return;
  }

  if (!stats.isFile()) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Length': stats.size,
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

function escapeForSingleQuotedPowerShell(value) {
  return String(value).replace(/'/g, "''");
}

function openBrowser(url) {
  return new Promise((resolve, reject) => {
    let child;

    if (process.platform === 'win32') {
      child = spawn(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Start-Process '${escapeForSingleQuotedPowerShell(url)}'`,
        ],
        {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        },
      );
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], {
        detached: true,
        stdio: 'ignore',
      });
    } else {
      child = spawn('xdg-open', [url], {
        detached: true,
        stdio: 'ignore',
      });
    }

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function buildViewerHtml(viewerConfig) {
  const serializedViewerConfig = stringifyInlineScriptValue(viewerConfig);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, viewport-fit=cover"
    />
    <title>3D Tiles Inspector</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(255, 255, 255, 0.95), rgba(236, 240, 245, 0.9)),
          linear-gradient(180deg, #eef3f8 0%, #dfe7ef 100%);
        color: #16324f;
      }

      #app {
        position: fixed;
        inset: 0;
      }

      .runtime-stats {
        position: fixed;
        top: 16px;
        right: 16px;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
        max-width: min(420px, calc(100vw - 32px));
        z-index: 12;
        pointer-events: none;
      }

      .runtime-stat {
        display: grid;
        gap: 4px;
        min-width: 132px;
        padding: 8px 12px;
        border: 1px solid rgba(22, 50, 79, 0.1);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 14px 32px rgba(33, 52, 73, 0.12);
        backdrop-filter: blur(14px);
      }

      .runtime-stat-label {
        margin: 0;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #5d738b;
      }

      .runtime-stat-value {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
        line-height: 1.1;
        color: #16324f;
      }

      canvas {
        display: block;
      }

      .toolbar-dock {
        position: fixed;
        top: 14px;
        bottom: 14px;
        left: 14px;
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        align-items: stretch;
        gap: 0;
        width: min(280px, calc(100vw - 28px));
        z-index: 10;
      }

      .toolbar {
        display: grid;
        align-content: start;
        gap: 8px;
        padding: 10px 14px;
        border: 1px solid rgba(22, 50, 79, 0.12);
        border-top: 0;
        border-radius: 0 0 20px 20px;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 18px 44px rgba(33, 52, 73, 0.16);
        backdrop-filter: blur(14px);
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        transition:
          opacity 160ms ease,
          transform 160ms ease;
      }

      .toolbar.hidden {
        display: none;
      }

      .toolbar-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-height: 32px;
        padding: 8px 12px;
        border: 1px solid rgba(22, 50, 79, 0.08);
        border-radius: 20px 20px 0 0;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #16324f;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: 0 18px 44px rgba(33, 52, 73, 0.16);
        cursor: pointer;
        backdrop-filter: blur(14px);
        transition:
          background-color 120ms ease,
          color 120ms ease,
          box-shadow 120ms ease;
      }

      .toolbar-dock.collapsed .toolbar-toggle {
        justify-self: start;
        width: auto;
        min-height: 36px;
        padding: 6px 12px 7px;
        border-radius: 999px;
        color: #506377;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 12px 28px rgba(33, 52, 73, 0.12);
      }

      .toolbar-toggle:hover {
        color: #16324f;
        background: rgba(225, 226, 229, 0.98);
        box-shadow: 0 18px 40px rgba(33, 52, 73, 0.18);
      }

      .toolbar-dock.collapsed .toolbar-toggle:hover {
        background: rgba(239, 241, 243, 0.98);
        box-shadow: 0 10px 22px rgba(33, 52, 73, 0.1);
      }

      .toolbar-toggle:focus-visible {
        outline: 2px solid rgba(13, 111, 131, 0.35);
        outline-offset: 2px;
      }

      .toolbar-section {
        display: grid;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid rgba(22, 50, 79, 0.08);
        border-radius: 14px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(243, 247, 251, 0.9));
      }

      .toolbar-section-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }

      .toolbar-section-title {
        margin: 0;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #5d738b;
      }

      .toolbar-value {
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        color: #5d738b;
      }

      .button-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .transform-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .transform-actions button {
        width: 100%;
      }

      .transform-actions .full-span {
        grid-column: 1 / -1;
      }

      .toolbar button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 999px;
        padding: 7px 14px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #16324f;
        background: #dde7f2;
        cursor: pointer;
        transition:
          transform 120ms ease,
          background-color 120ms ease,
          color 120ms ease;
      }

      .toolbar button:hover {
        transform: translateY(-1px);
        background: #d0deeb;
      }

      .toolbar button.active {
        color: #fff;
        background: #0d6f83;
      }

      .toolbar button.save {
        color: #fff;
        background: #19765b;
      }

      .toolbar button:disabled {
        transform: none;
        opacity: 0.7;
        cursor: wait;
      }

      .range-field {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .range-field-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }

      .range-field span {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #5d738b;
      }

      .range-field input[type='range'] {
        width: 100%;
        margin: 0;
      }

      .coordinate-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
      }

      .coordinate-grid label {
        display: grid;
        grid-template-columns: 78px minmax(0, 1fr);
        align-items: center;
        min-width: 0;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #5d738b;
      }

      .coordinate-grid label span {
        min-width: 0;
      }

      .coordinate-grid input {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid rgba(22, 50, 79, 0.16);
        border-radius: 10px;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: #16324f;
        background: rgba(255, 255, 255, 0.92);
      }

      .coordinate-actions {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
      }

      .toolbar button.wide {
        width: 100%;
        justify-content: center;
      }

      .status {
        min-width: 0;
        font-size: 13px;
        line-height: 1.4;
        color: #38516c;
      }

      .status.error {
        color: #a33f2f;
      }

      .status-panel {
        display: grid;
        gap: 10px;
      }

      .status-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .status-actions button {
        width: 100%;
      }

      @media (max-width: 720px) {
        .runtime-stats {
          top: 16px;
          right: 16px;
          left: 16px;
          justify-content: stretch;
          max-width: none;
        }

        .runtime-stat {
          flex: 1 1 140px;
          min-width: 0;
        }

        .toolbar-dock {
          top: auto;
          bottom: 16px;
          right: 16px;
          left: 16px;
          width: auto;
          max-height: min(78vh, 640px);
        }

        .toolbar {
          max-height: min(calc(78vh - 44px), 596px);
        }

        .coordinate-actions button,
        .status-actions button {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div class="runtime-stats" aria-live="polite">
      <div class="runtime-stat">
        <p class="runtime-stat-label">CacheBytes</p>
        <p id="cache-bytes-value" class="runtime-stat-value">0 B</p>
      </div>
      <div class="runtime-stat">
        <p class="runtime-stat-label">splatsNumber</p>
        <p id="splats-count-value" class="runtime-stat-value">0</p>
      </div>
    </div>
    <div class="toolbar-dock expanded">
      <button
        id="toolbar-toggle"
        class="toolbar-toggle"
        type="button"
        aria-controls="toolbar"
        aria-label="Hide Sidebar"
        aria-expanded="true"
      >
        Hide Sidebar
      </button>
      <div id="toolbar" class="toolbar">
        <div class="toolbar-section">
          <div class="toolbar-section-header">
            <p class="toolbar-section-title">Transform</p>
          </div>
          <div class="transform-actions">
            <button id="translate" type="button">Translate</button>
            <button id="rotate" type="button">Rotate</button>
            <button id="set-position" class="full-span" type="button">Set Position</button>
          </div>
        </div>
        <div class="toolbar-section">
          <div class="toolbar-section-header">
            <p class="toolbar-section-title">Canvas</p>
          </div>
          <div class="coordinate-actions">
            <button id="terrain" class="wide" type="button">Terrain</button>
            <button id="bounding-volume" class="wide" type="button">Bounding Volume</button>
            <button id="move-to-tiles" type="button">Move To Tiles</button>
          </div>
        </div>
        <div class="toolbar-section">
          <div class="toolbar-section-header">
            <p class="toolbar-section-title">Coordinate</p>
          </div>
          <div class="coordinate-grid">
            <label><span>Latitude</span><input id="latitude" type="number" step="any" value="0" /></label>
            <label><span>Longitude</span><input id="longitude" type="number" step="any" value="0" /></label>
            <label><span>Height</span><input id="height" type="number" step="any" value="0" /></label>
          </div>
          <div class="coordinate-actions">
            <button id="move-tiles-to-coordinate" class="wide" type="button">Move Tiles</button>
            <button id="move-camera-to-coordinate" class="wide" type="button">Move Camera</button>
          </div>
        </div>
        <div class="toolbar-section">
          <div class="toolbar-section-header">
            <p class="toolbar-section-title">LOD</p>
          </div>
          <label class="range-field">
            <div class="range-field-header">
              <span>Geometric Error</span>
              <p id="geometric-error-value" class="toolbar-value">x1.00</p>
            </div>
            <input
              id="geometric-error-scale"
              type="range"
              min="-4"
              max="4"
              step="0.1"
              value="0"
            />
          </label>
          <label class="range-field">
            <div class="range-field-header">
              <span>Layer Multiplier</span>
              <p id="geometric-error-layer-value" class="toolbar-value">x1.00</p>
            </div>
            <input
              id="geometric-error-layer-scale"
              type="range"
              min="-3"
              max="3"
              step="0.1"
              value="0"
            />
          </label>
        </div>
        <div class="toolbar-section status-panel">
          <div class="status-actions">
            <button id="reset" type="button">Reset</button>
            <button id="save" class="save" type="button">Save</button>
          </div>
          <div id="status" class="status">Loading tileset...</div>
        </div>
      </div>
    </div>
    <script>
      globalThis.__TILES_INSPECTOR_CONFIG__ = ${serializedViewerConfig};
    </script>
    <script type="module" src="./viewer/app.js"></script>
  </body>
</html>
`;
}

async function startInspectorSession(
  rawTilesetPath,
  { openBrowser: shouldOpenBrowser = true, handleSignals = true } = {},
) {
  const tilesetPath = resolveAndValidateTilesetPath(rawTilesetPath);
  const rootDir = path.dirname(tilesetPath);
  const viewerAssetsDir = createViewerAssetsDir({
    tilesetLabel: path.basename(tilesetPath),
    tilesetUrl: `./${getBrowserRelativePath(rootDir, tilesetPath)}`,
  });
  let sessionOrigin = null;
  let closingPromise = null;
  let shutdownTimer = null;
  let cleanedUp = false;
  const signalHandlers = [];

  const removeSignalHandlers = () => {
    while (signalHandlers.length > 0) {
      const { event, handler } = signalHandlers.pop();
      process.off(event, handler);
    }
  };

  const cancelScheduledShutdown = () => {
    if (shutdownTimer) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
  };

  let closeResolve;
  const closed = new Promise((resolve) => {
    closeResolve = resolve;
  });

  const close = () => {
    if (closingPromise) {
      return closingPromise;
    }

    closingPromise = new Promise((resolve, reject) => {
      cancelScheduledShutdown();
      removeSignalHandlers();
      server.close((err) => {
        try {
          if (err) {
            reject(err);
            return;
          }
          if (!cleanedUp) {
            removeViewerAssetsDir(viewerAssetsDir);
            cleanedUp = true;
          }
          resolve();
        } catch (cleanupErr) {
          reject(cleanupErr);
        } finally {
          closeResolve();
        }
      });
    });

    return closingPromise;
  };

  const scheduleShutdown = () => {
    cancelScheduledShutdown();
    shutdownTimer = setTimeout(() => {
      shutdownTimer = null;
      close().catch((err) => {
        console.error(
          `[warn] failed to close inspector server cleanly: ${err.message || err}`,
        );
      });
    }, SHUTDOWN_DELAY_MS);
    if (typeof shutdownTimer.unref === 'function') {
      shutdownTimer.unref();
    }
  };

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(
      normalizeRequestTarget(req.url),
      'http://127.0.0.1',
    );

    if (
      req.method === 'POST' &&
      requestUrl.pathname.startsWith('/__inspector/') &&
      req.headers.origin !== sessionOrigin
    ) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    if (requestUrl.pathname === SHUTDOWN_ENDPOINT_PATH) {
      if (req.method !== 'POST') {
        sendText(res, 405, 'Method Not Allowed', { Allow: 'POST' });
        return;
      }
      sendJson(res, 200, { ok: true });
      scheduleShutdown();
      return;
    }

    cancelScheduledShutdown();
    handleViewerRequest(
      rootDir,
      tilesetPath,
      viewerAssetsDir,
      req,
      res,
      requestUrl,
    ).catch((err) => {
      sendJson(res, 500, {
        error:
          err instanceof Error && err.message
            ? err.message
            : 'Unexpected inspector server error.',
      });
    });
  });

  if (handleSignals) {
    for (const event of ['SIGINT', 'SIGTERM']) {
      const handler = () => {
        close().catch((err) => {
          console.error(
            `[warn] failed to close inspector server cleanly: ${err.message || err}`,
          );
        });
      };
      signalHandlers.push({ event, handler });
      process.on(event, handler);
    }
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await close();
    throw new InspectorError('Inspector server failed to bind to a TCP port.');
  }

  sessionOrigin = `http://127.0.0.1:${address.port}`;
  const url = `${sessionOrigin}/${VIEWER_HTML_NAME}`;
  if (shouldOpenBrowser) {
    try {
      await openBrowser(url);
    } catch (err) {
      console.warn(
        `[warn] failed to open the browser automatically: ${err.message || err}`,
      );
    }
  }

  return {
    close,
    port: address.port,
    url,
    waitUntilClosed() {
      return closed;
    },
  };
}

module.exports = {
  startInspectorSession,
};
