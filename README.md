<div align="center">

# 3DTiles-Inspector

[![npm version](https://img.shields.io/npm/v/3dtiles-inspector)](https://www.npmjs.com/package/3dtiles-inspector)
[![CI](https://github.com/WilliamLiu-1997/3DTiles-Inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/WilliamLiu-1997/3DTiles-Inspector/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<img src="https://raw.githubusercontent.com/WilliamLiu-1997/3DTiles-Inspector/main/3DTiles-Inspector.png" alt="3DTiles-Inspector" width="960" />

</div>

`3dtiles-inspector` is a Node.js package and CLI for opening a local 3D Tiles tileset in a browser inspector, adjusting the root transform, tuning the effective geometric error scale, and saving the result back to disk.

Requires Node.js 18 or newer.

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

- `Translate`, `Rotate`, and `Reset` for root transform edits
- `Move Camera` to a WGS84 latitude / longitude / height
- `Move Tiles` to relocate the tileset root with an ENU-aligned transform
- `Set Position` to click the globe, terrain, or loaded tiles and place the tileset there
- `Terrain` to toggle Cesium World Terrain while keeping satellite imagery
- `Geometric Error` scaling from `1/16x` to `16x`
- `Layer Multiplier` scaling from `1/1.5x` to `1.5x` for leaf-based geometric error changes between tile depths
- `Save` to persist the updated root transform and geometric-error scale back to disk

If `build_summary.json` exists next to the root tileset, `Save` also updates:

- `root_transform`
- `root_transform_source`
- `root_coordinate`
- `viewer_geometric_error_scale`
- `viewer_geometric_error_layer_scale`

## Package Surface

- `src/index.js` exports the public Node API
- `src/cli.js` implements the standalone CLI
- `src/viewer/session.js` manages the local server, temporary assets, browser launch, and save handling
- `src/viewer/app.js` contains the browser runtime source
- `dist/inspector-assets/viewer/` contains the generated browser bundle and local decoder assets built by `npm run build:viewer`
- `src/viewer/cameraController.js` contains the vendored camera controller used by the runtime

## Development

```bash
npm install
npm test
npm run pack:check
```

## Error Handling

Runtime and validation failures throw `InspectorError` from the Node API and print a concise error message in the CLI.
