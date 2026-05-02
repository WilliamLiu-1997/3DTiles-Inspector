import { isGaussianSplatScene } from '3d-tiles-rendererjs-3dgs-plugin';
import { formatBytes, formatInteger } from './viewerUtils.js';

const RUNTIME_STATS_UPDATE_INTERVAL_MS = 250;

function getGaussianMeshSplatCount(mesh) {
  if (!mesh || typeof mesh !== 'object') {
    return 0;
  }

  const directCount =
    mesh.extSplats?.getNumSplats?.() ??
    mesh.extSplats?.numSplats ??
    mesh.packedSplats?.getNumSplats?.() ??
    mesh.packedSplats?.numSplats ??
    mesh.splats?.getNumSplats?.();

  return Number.isFinite(directCount) ? directCount : 0;
}

function getLoadedGaussianSplatCount(tiles) {
  if (!tiles || typeof tiles.forEachLoadedModel !== 'function') {
    return 0;
  }

  let total = 0;
  tiles.forEachLoadedModel((loadedScene) => {
    if (!loadedScene?.visible || !isGaussianSplatScene(loadedScene)) {
      return;
    }

    const meshes = loadedScene.userData.gaussianSplatMeshes || [];
    for (const mesh of meshes) {
      total += getGaussianMeshSplatCount(mesh);
    }
  });

  return total;
}

function getActiveSparkSplatsCount(scene) {
  let count = null;

  scene.traverse((node) => {
    if (count !== null || node?.visible === false) {
      return;
    }

    const activeSplats = node?.activeSplats;
    if (
      Number.isFinite(activeSplats) &&
      typeof node?.clearSplats === 'function' &&
      typeof node?.render === 'function'
    ) {
      count = activeSplats;
    }
  });

  return count;
}

export function createRuntimeStats({
  cacheBytesValueEl,
  getScene,
  getTiles,
  hasGaussianSplats,
  splatsCountValueEl,
  tilesDownloadingValueEl,
  tilesLoadedValueEl,
  tilesParsingValueEl,
  tilesVisibleValueEl,
}) {
  let lastUpdateTime = -Infinity;

  return {
    update(force = false) {
      if (
        !cacheBytesValueEl ||
        !splatsCountValueEl ||
        !tilesDownloadingValueEl ||
        !tilesParsingValueEl ||
        !tilesLoadedValueEl ||
        !tilesVisibleValueEl
      ) {
        return;
      }

      const now = performance.now();
      if (!force && now - lastUpdateTime < RUNTIME_STATS_UPDATE_INTERVAL_MS) {
        return;
      }

      lastUpdateTime = now;

      const tiles = getTiles();
      const cacheBytes = tiles?.lruCache?.cachedBytes ?? 0;
      const tilesStats = tiles?.stats;
      const downloadingTiles = tilesStats?.downloading ?? 0;
      const parsingTiles = tilesStats?.parsing ?? 0;
      const loadedTiles = tilesStats?.loaded ?? 0;
      const visibleTiles =
        tiles?.visibleTiles?.size ?? tilesStats?.visible ?? 0;
      const includeSplats = hasGaussianSplats();
      const activeSparkSplats = includeSplats
        ? getActiveSparkSplatsCount(getScene())
        : null;
      const splatCount = includeSplats
        ? (activeSparkSplats ?? getLoadedGaussianSplatCount(tiles))
        : 0;

      cacheBytesValueEl.textContent = formatBytes(cacheBytes);
      splatsCountValueEl.textContent = formatInteger(splatCount);
      tilesDownloadingValueEl.textContent = formatInteger(downloadingTiles);
      tilesParsingValueEl.textContent = formatInteger(parsingTiles);
      tilesLoadedValueEl.textContent = formatInteger(loadedTiles);
      tilesVisibleValueEl.textContent = formatInteger(visibleTiles);
    },
  };
}
