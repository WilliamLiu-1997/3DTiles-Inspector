import { Ion } from 'cesium';
import { TilesRenderer } from '3d-tiles-renderer';
import {
  GLTFExtensionsPlugin,
  ImplicitTilingPlugin,
  TileCompressionPlugin,
  TilesFadePlugin,
  UnloadTilesPlugin,
  XYZTilesPlugin,
} from '3d-tiles-renderer/plugins';
import {
  CesiumIonAuthPlugin,
  DebugTilesPlugin,
  ImageOverlayPlugin,
  QuantizedMeshPlugin,
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
  apiToken: Ion.defaultAccessToken,
  assetId: 1,
};

export const DEFAULT_ERROR_TARGET = 16;
const DEFAULT_TERRAIN_ERROR_TARGET = 16;

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
  next.downloadQueue.maxJobs = 8;
  next.parseQueue.maxJobs = 2;
  next.registerPlugin(
    new XYZTilesPlugin({
      shape: 'ellipsoid',
      center: true,
      levels: SATELLITE_IMAGERY.levels,
      url: SATELLITE_IMAGERY.url,
    }),
  );
  configureGlobeTiles(next, options);
  next.errorTarget = DEFAULT_ERROR_TARGET;
  return next;
}

export function createTerrainGlobeTiles(options) {
  const next = new TilesRenderer();
  next.downloadQueue.maxJobs = 8;
  next.parseQueue.maxJobs = 2;
  next.registerPlugin(
    new CesiumIonAuthPlugin({
      apiToken: CESIUM_ION_TERRAIN.apiToken,
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
      overlays: [
        new XYZTilesOverlay({
          url: SATELLITE_IMAGERY.url,
          levels: SATELLITE_IMAGERY.levels,
          tileDimension: 256,
          projection: 'EPSG:3857',
          color: 0xffffff,
          opacity: 1,
        }),
      ],
    }),
  );
  configureGlobeTiles(next, options);
  next.errorTarget = DEFAULT_TERRAIN_ERROR_TARGET;
  return next;
}

function createGeometricErrorLayerScalePlugin(preprocessNode) {
  return {
    name: 'GeometricErrorLayerScalePlugin',
    preprocessNode(tile) {
      preprocessNode(tile);
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
