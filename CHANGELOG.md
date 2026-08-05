# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Standalone single-binary distribution via Node SEA (`npm run build:sea` + `scripts/build-sea.sh`) for darwin-arm64, darwin-x64, linux-x64, linux-arm64
- curl installer (`install.sh`) with sha256 verification and `--uninstall`
- Release workflow: tag check, tests, binary matrix, GitHub Release with checksums, idempotent npm publish
- `repository`/`bugs`/`homepage`/`publishConfig` package metadata

### Changed

- CI node matrix is now 22.x/24.x with `npm ci` and working lcov coverage upload

## [1.0.0]

Initial release: task CRUD, projects, tags, dynamic statuses, dependencies, timers and time tracking, stats, undo/history, Jira and GitHub integrations, plugin system, MCP stdio server (`todo mcp`).
