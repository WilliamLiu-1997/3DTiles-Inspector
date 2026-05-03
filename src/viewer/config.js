import { MathUtils } from 'three';
import { normalizeLocalResourceUrl } from './utils.js';

export const SAVE_URL = new URL('../__inspector/save-transform', import.meta.url)
  .href;
export const SHUTDOWN_URL = new URL(
  '../__inspector/shutdown',
  import.meta.url,
).href;

const VIEWER_CONFIG =
  globalThis.__TILES_INSPECTOR_CONFIG__ &&
  typeof globalThis.__TILES_INSPECTOR_CONFIG__ === 'object'
    ? globalThis.__TILES_INSPECTOR_CONFIG__
    : {};

export const ROOT_TILESET_LABEL =
  typeof VIEWER_CONFIG.tilesetLabel === 'string' &&
  VIEWER_CONFIG.tilesetLabel.length > 0
    ? VIEWER_CONFIG.tilesetLabel
    : 'tileset.json';

export const TILESET_URL = normalizeLocalResourceUrl(
  VIEWER_CONFIG.tilesetUrl || new URL('../tileset.json', import.meta.url).href,
);

const THREE_EXAMPLES_BASE_URL = new URL(
  './vendor/three/examples/jsm/',
  import.meta.url,
).href;

export const DRACO_DECODER_PATH = `${THREE_EXAMPLES_BASE_URL}libs/draco/gltf/`;
export const BASIS_TRANSCODER_PATH = `${THREE_EXAMPLES_BASE_URL}libs/basis/`;
export const CAMERA_CENTER_MODE_DISTANCE = 3000000;
export const CAMERA_CENTER_MODE_DISTANCE_SQ =
  CAMERA_CENTER_MODE_DISTANCE ** 2;
export const MOVE_TO_TILES_HEADING = 0;
export const MOVE_TO_TILES_PITCH = MathUtils.degToRad(-30);
export const MOVE_TO_TILES_ROLL = 0;
export const MOVE_TO_COORDINATE_RADIUS = 10;
export const SET_POSITION_CLICK_MAX_DISTANCE_PX = 2;
export const SET_POSITION_CLICK_MAX_DISTANCE_SQ =
  SET_POSITION_CLICK_MAX_DISTANCE_PX ** 2;
export const GEOMETRIC_ERROR_SCALE_MIN_EXPONENT = -4;
export const GEOMETRIC_ERROR_SCALE_MAX_EXPONENT = 4;
export const GEOMETRIC_ERROR_SCALE_STEP = 0.1;
export const GEOMETRIC_ERROR_LAYER_SCALE_MIN_EXPONENT = -3;
export const GEOMETRIC_ERROR_LAYER_SCALE_MAX_EXPONENT = 3;
export const GEOMETRIC_ERROR_LAYER_SCALE_STEP = 0.1;
