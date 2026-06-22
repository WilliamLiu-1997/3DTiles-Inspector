# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

## [0.2.15] - 2026-06-23

### Added

- Added a single crop-sphere selection for Gaussian splats, with radius
  adjustment, transform controls, preview highlighting, confirmed outside
  hiding, center-point local-coordinate sphere/transform axes, and save-time
  removal of splats outside the sphere.

### Changed

- Changed camera picking on Gaussian splats to ignore areas hidden by confirmed
  crop regions and crop sphere.

## [0.2.14] - 2026-06-19

### Changed

- Updated `3d-tiles-rendererjs-3dgs-plugin` from `0.1.11` to `0.1.14`.
- Updated `3d-tiles-renderer` from `0.4.27` to `0.4.28`.

### Added

- Added crop save support for SPZ Gaussian splats with `EXT_splat_opacity` so the opacity accessor data is cropped with the SPZ payload.

## [0.2.13] - 2026-06-02

### Changed

- Changed terrain to default off and require a user-entered Cesium ion token before enabling Cesium World Terrain.
- Removed the unused direct `cesium` development dependency.

## [0.2.12] - 2026-06-01

### Changed

- Moved the Coordinate toolbar section above Transform so coordinate inputs are easier to reach before transform controls.
- Updated `3d-tiles-renderer` from `0.4.25` to `0.4.27` and `3d-tiles-rendererjs-3dgs-plugin` from `0.1.8` to `0.1.11`.

### Fixed

- Fixed globe camera drag and rotation stability by using ellipsoid surface normals for camera-up alignment and refreshing drag anchors when switching into high-altitude drag behavior.

## [0.2.11] - 2026-05-22

### Fixed

- Fixed saved root scale edits not applying the scale delta to persisted tileset geometric errors.

## [0.2.10] - 2026-05-22

### Added

- Added an infinite `Scale` drag track and editable value input for root transform edits.

## [0.2.9] - 2026-05-21

### Changed

- Changed Gaussian Splat crop saves to raw-copy surviving SPZ v3 packet bytes instead of re-encoding splats, preserving source quantization and SH data while using gzip level 6.
- Optimized save-time Gaussian Splat crop filtering by evaluating raw SPZ positions against flattened selection matrices and planes.
- Updated `3d-tiles-renderer` to `0.4.25`, `3d-tiles-rendererjs-3dgs-plugin` to `0.1.8`, and `@sparkjsdev/spark` to `2.1.0`; replaced the deprecated imagery globe `XYZTilesPlugin` path with `GeneratedSurfacePlugin` and `ImageOverlayPlugin`.

### Fixed

- Fixed globe zoom-out near the horizon drifting away from the zoom anchor or moving the camera below the ellipsoid surface.

## [0.2.8] - 2026-05-13

### Fixed

- Fixed save-time crop memory spikes on large tilesets by limiting concurrent Gaussian Splat resource processing based on CPU parallelism, capped at 8 workers.
- Fixed viewer stalls when many tiles are loaded by avoiding repeated tileset-wide leaf geometric-error scans during tile preprocessing.

## [0.2.7] - 2026-05-10

### Changed

- Changed crop saves to remove local orphaned Gaussian Splat `.glb` / `.gltf` resources and private external buffers after fully cropped content is pruned from the tileset.
- Updated `3d-tiles-rendererjs-3dgs-plugin` from `0.1.5` to `0.1.7`.

### Fixed

- Fixed cropped Gaussian Splat resources keeping stale glTF accessor counts after SPZ data is rewritten, which could make Cesium fail while generating splat textures.

## [0.2.6] - 2026-05-05

### Added

- Added realtime `camerapose` URL synchronization so shared viewer URLs can restore the current camera pose.

## [0.2.5] - 2026-05-05

### Fixed

- Fixed coordinate move actions leaving the camera at the previous view by flying back to the relocated tileset after the root transform is moved.
- Fixed near-linear fly-to paths snapping to the start direction instead of interpolating toward the destination.

## [0.2.4] - 2026-05-04

### Added

- Added smooth camera fly-to animations for tileset framing and coordinate navigation, including arced world-space paths, upright heading/pitch interpolation, and orthographic zoom support.

### Changed

- Changed the initial tileset framing and `Move to Tiles`/coordinate actions to animate the camera instead of snapping immediately.
- Moved the crop region list below the crop confirm/cancel controls.
- Reduced the viewer's initial camera distance and far plane.

### Fixed

- Fixed zooming out in center-mode views drifting away from the mouse anchor because globe zoom-out transitions were being applied to local coordinates.

## [0.2.3] - 2026-05-04

### Changed

- Changed Crop Regions to use a `Draw Region` flow with editable convex quadrilateral regions, point/edge handles before camera movement, and a denser drawing grid preview.

## [0.2.2] - 2026-05-03

### Fixed

- Declared the server-side crop dependencies as runtime dependencies so installed packages can load `three` and `@sparkjsdev/spark`.

## [0.2.1] - 2026-05-03

### Changed

- Renamed the crop selection action to `Select Region` and show pending or newest crop regions first in the list.
- Kept the Save/status controls fixed at the bottom of the sidebar, moved `Reset` into the Transform controls, and tightened sidebar behavior on narrow screens.

## [0.2.0] - 2026-05-03

### Added

- Added `Crop Regions` for 3D Gaussian Splat tilesets, with screen-space rectangle selection, pending/confirmed region controls, preview overlays, and adjustable far-plane depth handles.
- Added save-time Gaussian Splat cropping for supported local `.gltf` and `.glb` resources using `KHR_gaussian_splatting_compression_spz_2`, including multi-resource writes, multi-bufferView rewrites, empty tile pruning, and progress updates.
- Added README documentation, a crop-region screenshot, and smoke-test fixtures for the 3DGS crop workflow.

### Changed

- Moved inspector session, HTTP server, save handling, viewer asset generation, and splat-crop logic into focused `src/server/` modules.
- Refactored the browser viewer into focused DOM, IO, scene, navigation, screen-selection, and transform modules.
- Updated the public `./session` export to `src/server/session.js` and routed the CLI through the package entrypoint.
- Updated `3d-tiles-rendererjs-3dgs-plugin` from `0.1.4` to `0.1.5`.

### Fixed

- Fixed repeated saves on Windows failing with `EPERM` when replacing recently streamed `.glb`, `.gltf`, `.bin`, or `.json` files, including races with active tile requests.

## [0.1.8] - 2026-05-03

### Added

- Added a camera pivot indicator for rotate, pan, and zoom interactions.
- Added bottom-right tile runtime stats for downloading, parsing, loaded, and visible tile counts.

### Changed

- Moved the `Canvas` toolbar section above `Transform`.

## [0.1.7] - 2026-04-27

### Changed

- Changed `Layer Multiplier` to use the tileset-wide minimum leaf geometric error as the baseline, so non-minimum leaf tiles are scaled too.

## [0.1.6] - 2026-04-27

### Changed

- Changed `Layer Multiplier` to scale each tile's geometric-error difference from its leaf baseline instead of applying a depth-based multiplier.
- Expanded the `Layer Multiplier` range to `1/8x` through `8x`.

## [0.1.5] - 2026-04-27

### Added

- Added an LOD `Layer Multiplier` slider to scale geometric errors progressively by distance from leaf tiles.

### Changed

- Tightened inspector toolbar spacing and LOD slider value labels.

## [0.1.4] - 2026-04-25

### Changed

- Raised the default tileset and terrain geometric-error targets to `16` for more consistent LOD behavior.

## [0.1.3] - 2026-04-25

### Fixed

- Reset the `Geometric Error` slider to the center after `Save` while keeping the newly applied LOD scale active.

## [0.1.2] - 2026-04-24

### Added

- `Bounding Volume` toolbar toggle backed by `DebugTilesPlugin` to show tileset box, sphere, and region bounds.

### Changed

- Moved `Latitude`, `Longitude`, and `Height` labels to the left side of the coordinate inputs and expanded the shortened labels.

## [0.1.1] - 2026-04-23

### Changed

- Follow-up patch release after `0.1.0` had already been published to npm.
- No functional changes beyond the package version metadata.

## [0.1.0] - 2026-04-23

### Added

- Initial release of `3dtiles-inspector`.
- CLI support for opening a local 3D Tiles tileset in the browser inspector.
- Public Node API with `runInspector`, `startInspectorSession`, `resolveAndValidateTilesetPath`, and `InspectorError`.
- Interactive tools for transform editing, coordinate placement, terrain toggle, geometric-error scaling, reset, and save.
- Save-time synchronization for `build_summary.json` when present next to the root tileset.
- Top-of-viewer runtime stats for cache bytes and Gaussian splat counts.
- Bundled browser assets for npm distribution.
- CI and npm publish workflows.
- README badges and inspector screenshot.

### Changed

- Tightened the top runtime-stats typography so the overlay is less visually heavy.
