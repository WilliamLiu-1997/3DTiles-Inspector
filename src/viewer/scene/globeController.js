import {
  createImageryGlobeTiles,
  createTerrainGlobeTiles,
} from './tiles.js';
import { normalizeLocalResourceUrl } from '../utils.js';

export function createGlobeController({
  camera,
  globeGroup,
  onTilesChanged,
  renderer,
}) {
  let tiles = null;
  let terrainEnabled = true;

  function setTerrainEnabled(enabled) {
    const globeTileOptions = {
      camera,
      preprocessURL: normalizeLocalResourceUrl,
      renderer,
    };
    const next = enabled
      ? createTerrainGlobeTiles(globeTileOptions)
      : createImageryGlobeTiles(globeTileOptions);

    if (tiles) {
      globeGroup.remove(tiles.group);
      tiles.dispose();
    }

    terrainEnabled = enabled;
    tiles = next;
    globeGroup.add(next.group);
    onTilesChanged?.(next);
    return next;
  }

  return {
    getEllipsoid: () => tiles?.ellipsoid || null,
    getTiles: () => tiles,
    isTerrainEnabled: () => terrainEnabled,
    setTerrainEnabled,
    update() {
      tiles?.update();
    },
  };
}
