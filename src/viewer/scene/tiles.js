import { TilesRenderer } from '3d-tiles-renderer';
import { ImplicitTilingPlugin } from '3d-tiles-renderer/src/core/plugins/ImplicitTilingPlugin.js';
import { CesiumIonAuthPlugin } from '3d-tiles-renderer/src/three/plugins/CesiumIonAuthPlugin.js';
import { DebugTilesPlugin } from '3d-tiles-renderer/src/three/plugins/DebugTilesPlugin.js';
import { GLTFExtensionsPlugin } from '3d-tiles-renderer/src/three/plugins/GLTFExtensionsPlugin.js';
import { QuantizedMeshPlugin } from '3d-tiles-renderer/src/three/plugins/QuantizedMeshPlugin.js';
import { TileCompressionPlugin } from '3d-tiles-renderer/src/three/plugins/TileCompressionPlugin.js';
import { UnloadTilesPlugin } from '3d-tiles-renderer/src/three/plugins/UnloadTilesPlugin.js';
import { TilesFadePlugin } from '3d-tiles-renderer/src/three/plugins/fade/TilesFadePlugin.js';
import { GeneratedSurfacePlugin } from '3d-tiles-renderer/src/three/plugins/images/GeneratedSurfacePlugin.js';
import {
  ImageOverlayPlugin,
  XYZTilesOverlay,
} from '3d-tiles-renderer/src/three/plugins/images/ImageOverlayPlugin.js';
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

function createSatelliteOverlay(preprocessURL) {
  return new XYZTilesOverlay({
    url: SATELLITE_IMAGERY.url,
    levels: SATELLITE_IMAGERY.levels,
    tileDimension: 256,
    projection: 'EPSG:3857',
    color: 0xffffff,
    opacity: 1,
    preprocessURL,
  });
}

function configureGlobeTiles(next, { camera, preprocessURL, renderer }) {
  next.registerPlugin(new TilesFadePlugin());
  next.registerPlugin(new TileCompressionPlugin());
  next.registerPlugin(new UnloadTilesPlugin());
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
  const satelliteOverlay = createSatelliteOverlay(options.preprocessURL);
  next.downloadQueue.maxJobs = 8;
  next.parseQueue.maxJobs = 2;
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
  const satelliteOverlay = createSatelliteOverlay(options.preprocessURL);
  next.downloadQueue.maxJobs = 8;
  next.parseQueue.maxJobs = 2;
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
  scene,
  showBoundingVolume,
  tilePreprocess,
  url,
}) {
  const tiles = new TilesRenderer(url);
  tiles.downloadQueue.maxJobs = 8;
  tiles.parseQueue.maxJobs = 4;
  tiles.registerPlugin(new TilesFadePlugin());
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new UnloadTilesPlugin());
  tiles.registerPlugin(new ImplicitTilingPlugin());
  tiles.registerPlugin(createGeometricErrorLayerScalePlugin(tilePreprocess));
  tiles.registerPlugin(
    new GaussianSplatPlugin({
      renderer,
      scene,
      sparkRendererOptions: {
        accumExtSplats: true,
      },
    }),
  );

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
