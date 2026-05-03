<div align="center">

# 3DTiles-Inspector

[![npm version](https://img.shields.io/npm/v/3dtiles-inspector)](https://www.npmjs.com/package/3dtiles-inspector)
[![CI](https://github.com/WilliamLiu-1997/3DTiles-Inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/WilliamLiu-1997/3DTiles-Inspector/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<img src="https://raw.githubusercontent.com/WilliamLiu-1997/3DTiles-Inspector/main/3DTiles-Inspector.png" alt="3DTiles-Inspector" width="960" />

</div>

`3dtiles-inspector` is a Node.js package and CLI for opening a local 3D Tiles tileset in a browser inspector, adjusting the root transform, tuning the effective geometric error scale, and saving the result back to disk.

Requires Node.js 18 or newer.

## Built On

This project is based on and integrates work from:

- [WilliamLiu-1997/3D-Tiles-RendererJS-3DGS-Plugin](https://github.com/WilliamLiu-1997/3D-Tiles-RendererJS-3DGS-Plugin)
- [NASA-AMMOS/3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS)

## Install

```bash
npm install 3dtiles-inspector
```

## CLI

```bash
3dtiles-inspector <tileset_json>
```

```bash
npx 3dtiles-inspector <tileset_json>
```

From a cloned repository:

```bash
npm run cli -- <tileset_json>
```

The CLI starts a localhost HTTP server, copies the built inspector assets into a temporary directory, opens the default browser, and keeps running until you stop it with `Ctrl+C`.

`<tileset_json>` can be either:

- the root tileset JSON file, for example `out_tiles/tileset.json`
- a directory that contains `tileset.json`

## Node API

```js
const { runInspector } = require('3dtiles-inspector');

(async () => {
  await runInspector('./out_tiles/tileset.json');
})();
```

If you need to control the browser launch or manage the session lifecycle yourself:

```js
const {
  resolveAndValidateTilesetPath,
  startInspectorSession,
} = require('3dtiles-inspector');

(async () => {
  const tilesetPath = resolveAndValidateTilesetPath('./out_tiles/tileset.json');
  const session = await startInspectorSession(tilesetPath, {
    openBrowser: false,
    handleSignals: false,
  });

  console.log(session.url);

  await session.close();
})();
```

## Inspector Features

<img src="https://raw.githubusercontent.com/WilliamLiu-1997/3DTiles-Inspector/main/screenshot.png" alt="screenshot" width="960" />

- `Translate`, `Rotate`, and `Reset` for root transform edits
- `Move Camera` to a WGS84 latitude / longitude / height
- `Move Tiles` to relocate the tileset root with an ENU-aligned transform
- `Set Position` to click the globe, terrain, or loaded tiles and place the tileset there
- `Terrain` to toggle Cesium World Terrain while keeping satellite imagery
- `Geometric Error` scaling from `1/16x` to `16x`
- `Layer Multiplier` scaling from `1/8x` to `8x` for each tile's geometric-error difference from the tileset's global leaf baseline
- `Crop Regions` for drawing screen-space exclude regions on 3D Gaussian Splat tilesets
- `Save` to persist the updated root transform and geometric-error scale back to disk

### Crop Regions

`Crop Regions` appears when the loaded tileset contains 3D Gaussian Splat content. It lets you draw one or more screen-space exclude rectangles, preview them in the viewer, then apply the crop when you click `Save`.

The basic workflow is:

1. Click `Screen Select` and drag a rectangle over the splats to remove.
2. Click `Confirm` to add the region to the save list, or `Cancel` to discard the pending rectangle.
3. Select a confirmed region row if you need to adjust its 3D far plane with the transform handle.
4. Click `Save` to persist the root transform and delete splats inside the confirmed crop regions.

Crop saving rewrites supported local `.gltf` / `.glb` Gaussian Splat resources that use `KHR_gaussian_splatting_compression_spz_2`. Fully deleted splat primitives are removed from their glTF, and empty tile content can be pruned from the tileset JSON. Remote content and unsupported Gaussian Splat encodings are rejected instead of being modified.

If `build_summary.json` exists next to the root tileset, `Save` also updates:

- `root_transform`
- `root_transform_source`
- `root_coordinate`
- `viewer_geometric_error_scale`
- `viewer_geometric_error_layer_scale`

## Package Surface

- `src/index.js` exports the public Node API
- `src/cli.js` implements the standalone CLI
- `src/server/session.js` manages the local server, temporary assets, browser launch, and shutdown lifecycle
- `src/server/saveTransform.js` and `src/server/splatCrop/` handle transform saves, geometric-error updates, and Gaussian Splat crop writes
- `src/server/viewerAssets.js` and `src/server/viewerHtml.js` create the temporary viewer HTML and static asset directory
- `src/viewer/app.js` contains the browser runtime source
- `src/viewer/screenSelection/` contains the browser-side crop region selection and preview UI
- `dist/inspector-assets/viewer/` contains the generated browser bundle and local decoder assets built by `npm run build:viewer`
- `src/viewer/scene/cameraController.js` contains the vendored camera controller used by the runtime

## Development

```bash
npm install
npm test
npm run pack:check
```

## Error Handling

Runtime and validation failures throw `InspectorError` from the Node API and print a concise error message in the CLI.
