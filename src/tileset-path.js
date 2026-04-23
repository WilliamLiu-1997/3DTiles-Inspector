const fs = require('fs');
const path = require('path');

const { InspectorError } = require('./errors');

function resolveAndValidateTilesetPath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new InspectorError('Missing <tileset_json>.');
  }

  const resolvedPath = path.resolve(rawPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new InspectorError(`Tileset path does not exist: ${resolvedPath}`);
  }

  const stats = fs.statSync(resolvedPath);
  if (stats.isDirectory()) {
    const defaultTilesetPath = path.join(resolvedPath, 'tileset.json');
    if (!fs.existsSync(defaultTilesetPath)) {
      throw new InspectorError(
        `Tileset directory must contain tileset.json, or pass the root tileset JSON path directly: ${resolvedPath}`,
      );
    }
    return defaultTilesetPath;
  }

  if (!stats.isFile()) {
    throw new InspectorError(
      `Tileset path must be a JSON file or a directory: ${resolvedPath}`,
    );
  }

  if (path.extname(resolvedPath).toLowerCase() !== '.json') {
    throw new InspectorError(
      `Tileset path must point to a JSON file: ${resolvedPath}`,
    );
  }

  return resolvedPath;
}

module.exports = {
  resolveAndValidateTilesetPath,
};
