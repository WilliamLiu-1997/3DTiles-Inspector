# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

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
