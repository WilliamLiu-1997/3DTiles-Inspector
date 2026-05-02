# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

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
