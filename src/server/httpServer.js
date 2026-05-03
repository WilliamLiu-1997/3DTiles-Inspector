const fs = require('fs');
const path = require('path');

const { InspectorError } = require('../errors');
const { MIME_TYPES, sendText, normalizeRequestTarget } = require('./httpHelpers');
const {
  SAVE_ENDPOINT_PATH,
  handleSaveTransformRequest,
} = require('./saveTransformHandler');
const { VIEWER_DIR_NAME, VIEWER_HTML_NAME } = require('./viewerAssets');

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

module.exports = {
  handleViewerRequest,
};
