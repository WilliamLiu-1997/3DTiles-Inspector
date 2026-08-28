import { SplatMesh } from 'gaussian-splat-lite';
import { formatBytes, formatInteger } from '../utils.js';

const RUNTIME_STATS_UPDATE_INTERVAL_MS = 250;
const FPS_UPDATE_INTERVAL_MS = 500;

function getGaussianMeshSplatCount(mesh) {
  if (!mesh || typeof mesh !== 'object') {
    return 0;
  }

  const directCount =
    mesh.numSplats ?? mesh.splats?.getNumSplats?.();

  return Number.isFinite(directCount) ? directCount : 0;
}

function getLoadedGaussianSplatCount(tiles) {
  if (!tiles || typeof tiles.forEachLoadedModel !== 'function') {
    return 0;
  }

  let total = 0;
  tiles.forEachLoadedModel((loadedScene) => {
    if (!loadedScene?.visible) {
      return;
    }

    loadedScene.traverse((object) => {
      if (object instanceof SplatMesh && object.visible) {
        total += getGaussianMeshSplatCount(object);
      }
    });
  });

  return total;
}

function getActiveGaussianSplatsCount(gaussianSplatRenderer) {
  const count = gaussianSplatRenderer?.activeSplats;
  return Number.isFinite(count) ? count : null;
}

export function createRuntimeStats({
  cacheBytesValueEl,
  fpsValueEl,
  getGaussianSplatRenderer,
  getTiles,
  hasGaussianSplats,
  splatsCountValueEl,
  tilesDownloadingValueEl,
  tilesLoadedValueEl,
  tilesParsingValueEl,
  tilesVisibleValueEl,
}) {
  let lastUpdateTime = -Infinity;
  let fpsSampleStart = null;
  let renderedFrames = 0;

  return {
    markRenderIdle() {
      fpsSampleStart = null;
      renderedFrames = 0;
      if (fpsValueEl) {
        fpsValueEl.textContent = '0';
      }
    },
    recordRenderedFrame(time = performance.now()) {
      if (!fpsValueEl) {
        return;
      }

      if (fpsSampleStart === null) {
        fpsSampleStart = time;
      }
      renderedFrames += 1;

      const elapsed = time - fpsSampleStart;
      if (elapsed < FPS_UPDATE_INTERVAL_MS) {
        return;
      }

      const fps = (renderedFrames * 1000) / elapsed;
      fpsValueEl.textContent = fps >= 10 ? Math.round(fps) : fps.toFixed(1);
      fpsSampleStart = time;
      renderedFrames = 0;
    },
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
      const activeGaussianSplats = includeSplats
        ? getActiveGaussianSplatsCount(getGaussianSplatRenderer())
        : null;
      const splatCount = includeSplats
        ? (activeGaussianSplats ?? getLoadedGaussianSplatCount(tiles))
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
