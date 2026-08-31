import { TilesRenderer } from '3d-tiles-renderer';
import {
  DEFAULT_DOWNLOAD_QUEUE,
  DEFAULT_LRU_CACHE,
  DEFAULT_NODE_QUEUE,
  DEFAULT_PARSE_QUEUE,
  DownloadPriorityQueue,
  LRUCache,
  PriorityQueue,
} from '3d-tiles-renderer/core';
import { ImplicitTilingPlugin } from '3d-tiles-renderer/core/plugins';
import {
  CesiumIonAuthPlugin,
  DebugTilesPlugin,
  GeneratedSurfacePlugin,
  GLTFExtensionsPlugin,
  ImageOverlayPlugin,
  QuantizedMeshPlugin,
  TileCompressionPlugin,
  TilesFadePlugin,
  XYZTilesOverlay,
} from '3d-tiles-renderer/three/plugins';
import { GaussianSplatPlugin } from '3d-tiles-rendererjs-3dgs-plugin';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { forceOpaqueScene } from '../utils.js';

const SATELLITE_IMAGERY = {
  url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  levels: 18,
};
const CESIUM_ION_TERRAIN = {
  assetId: 1,
};

export const DEFAULT_ERROR_TARGET = 16;
const DEFAULT_TERRAIN_ERROR_TARGET = 16;
const DOWNLOAD_QUEUE_MAX_JOBS_PER_ORIGIN = 4;
const PARSE_QUEUE_MAX_JOBS = 4;

function createSatelliteOverlay(preprocessURL, downloadQueue) {
  const overlay = new XYZTilesOverlay({
    url: SATELLITE_IMAGERY.url,
    levels: SATELLITE_IMAGERY.levels,
    tileDimension: 256,
    projection: 'EPSG:3857',
    color: 0xffffff,
    opacity: 1,
    preprocessURL,
  });
  overlay.downloadQueue = downloadQueue;
  return overlay;
}

function configureTileQueues(tiles) {
  const downloadQueue = new DownloadPriorityQueue();
  downloadQueue.priorityCallback = DEFAULT_DOWNLOAD_QUEUE.priorityCallback;
  downloadQueue.maxJobsPerOrigin = DOWNLOAD_QUEUE_MAX_JOBS_PER_ORIGIN;

  const parseQueue = new PriorityQueue();
  parseQueue.priorityCallback = DEFAULT_PARSE_QUEUE.priorityCallback;
  parseQueue.maxJobs = PARSE_QUEUE_MAX_JOBS;

  tiles.downloadQueue = downloadQueue;
  tiles.parseQueue = parseQueue;
}

function configureGlobeTilesResources(tiles) {
  configureTileQueues(tiles);

  const lruCache = new LRUCache();
  lruCache.unloadPriorityCallback = DEFAULT_LRU_CACHE.unloadPriorityCallback;
  lruCache.minSize = 256;
  lruCache.maxSize = 1024;
  lruCache.minBytesSize = 2 ** 30 / 8;
  lruCache.maxBytesSize = 2 ** 30 / 2;

  const processNodeQueue = new PriorityQueue();
  processNodeQueue.priorityCallback = DEFAULT_NODE_QUEUE.priorityCallback;
  processNodeQueue.maxJobs = DEFAULT_NODE_QUEUE.maxJobs;

  tiles.lruCache = lruCache;
  tiles.processNodeQueue = processNodeQueue;
}

function configureGlobeTiles(next, { camera, preprocessURL, renderer }) {
  next.registerPlugin(new TilesFadePlugin());
  next.registerPlugin(new TileCompressionPlugin());
  next.preprocessURL = preprocessURL;
  next.setCamera(camera);
  next.setResolutionFromRenderer(camera, renderer);
  next.addEventListener('load-model', ({ scene: modelScene }) => {
    forceOpaqueScene(modelScene);
  });
  return next;
}

export function createImageryGlobeTiles(options) {
  const next = new TilesRenderer();
  configureGlobeTilesResources(next);
  const satelliteOverlay = createSatelliteOverlay(
    options.preprocessURL,
    next.downloadQueue,
  );
  next.registerPlugin(
    new GeneratedSurfacePlugin({
      overlay: satelliteOverlay,
      shape: 'ellipsoid',
      center: true,
      applyOverlayTexture: true,
    }),
  );
  configureGlobeTiles(next, options);
  next.errorTarget = DEFAULT_ERROR_TARGET;
  return next;
}

export function createTerrainGlobeTiles(options) {
  const apiToken =
    typeof options.cesiumIonToken === 'string'
      ? options.cesiumIonToken.trim()
      : '';
  if (!apiToken) {
    throw new Error('Cesium ion token is required to enable terrain.');
  }

  const next = new TilesRenderer();
  configureGlobeTilesResources(next);
  const satelliteOverlay = createSatelliteOverlay(
    options.preprocessURL,
    next.downloadQueue,
  );
  next.registerPlugin(
    new CesiumIonAuthPlugin({
      apiToken,
      assetId: String(CESIUM_ION_TERRAIN.assetId),
      autoRefreshToken: true,
      assetTypeHandler: (type, tilesRenderer) => {
        if (type === 'TERRAIN') {
          tilesRenderer.registerPlugin(new QuantizedMeshPlugin({}));
        }
      },
    }),
  );
  next.registerPlugin(
    new ImageOverlayPlugin({
      renderer: options.renderer,
      overlays: [satelliteOverlay],
    }),
  );
  configureGlobeTiles(next, options);
  next.errorTarget = DEFAULT_TERRAIN_ERROR_TARGET;
  return next;
}

function createGeometricErrorLayerScalePlugin(preprocessNode) {
  return {
    name: 'GeometricErrorLayerScalePlugin',
    preprocessNode(tile, tilesetDir, parentTile) {
      preprocessNode(tile, null, parentTile);
    },
  };
}

export function createInspectorTilesRenderer({
  camera,
  dracoLoader,
  ktxLoader,
  preprocessURL,
  renderer,
  showBoundingVolume,
  tilePreprocess,
  url,
}) {
  const tiles = new TilesRenderer(url);
  configureTileQueues(tiles);
  tiles.registerPlugin(new TilesFadePlugin());
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new ImplicitTilingPlugin());
  tiles.registerPlugin(createGeometricErrorLayerScalePlugin(tilePreprocess));
  tiles.registerPlugin(new GaussianSplatPlugin());

  const debugTilesPlugin = new DebugTilesPlugin({
    displayBoxBounds: showBoundingVolume,
    displaySphereBounds: showBoundingVolume,
    displayRegionBounds: showBoundingVolume,
  });
  tiles.registerPlugin(debugTilesPlugin);
  tiles.registerPlugin(
    new GLTFExtensionsPlugin({
      metadata: true,
      rtc: true,
      dracoLoader,
      ktxLoader,
      meshoptDecoder: MeshoptDecoder,
      autoDispose: false,
    }),
  );
  tiles.preprocessURL = preprocessURL;
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);

  return {
    debugTilesPlugin,
    tiles,
  };
}
