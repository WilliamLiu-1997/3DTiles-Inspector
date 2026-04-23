# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

## [0.1.0] - 2026-04-23

### Added

- Initial release of `3dtiles-inspector`.
- CLI support for opening a local 3D Tiles tileset in the browser inspector.
- Public Node API with `runInspector`, `startInspectorSession`, `resolveAndValidateTilesetPath`, and `InspectorError`.
- Interactive tools for transform editing, coordinate placement, terrain toggle, geometric-error scaling, reset, and save.
- Save-time synchronization for `build_summary.json` when present next to the root tileset.
- Bundled browser assets for npm distribution.
- CI and npm publish workflows.
