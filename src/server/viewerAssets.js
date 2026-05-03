const fs = require('fs');
const os = require('os');
const path = require('path');

const { InspectorError } = require('../errors');
const { copyDirectoryRecursive } = require('./fileUtils');
const { buildViewerHtml } = require('./viewerHtml');

const VIEWER_HTML_NAME = 'viewer.html';
const VIEWER_DIR_NAME = 'viewer';
const BUILT_VIEWER_ASSETS_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'dist',
  'inspector-assets',
);

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

module.exports = {
  VIEWER_DIR_NAME,
  VIEWER_HTML_NAME,
  createViewerAssetsDir,
  getBrowserRelativePath,
  removeViewerAssetsDir,
};
