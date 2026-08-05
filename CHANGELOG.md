# Changelog

All notable changes to this project are documented in this file.

## [1.0.1]

### Added

- Setup guidance in `todo mcp --help` (Claude Code / Claude Desktop / Cursor steps), `todo jira auth --help` (API-token walkthrough), and `todo gh auth --help` (gh CLI install + login steps)

### Changed

- Upgraded `better-sqlite3` 11 → 13: N-API prebuilds are bundled in the package, removing the deprecated `prebuild-install` dependency (and its npm install warning), 33 transitive packages, and the `postinstall` rebuild step

## [1.0.0]

Initial public release.

### Core

- Task CRUD, projects, tags, dynamic statuses, dependencies, timers and time tracking, stats, undo/history, Jira and GitHub integrations, plugin system, MCP stdio server (`todo mcp`)

### Distribution

- Standalone single-binary distribution via Node SEA (`npm run build:sea` + `scripts/build-sea.sh`) for darwin-arm64, darwin-x64, linux-x64, linux-arm64
- curl installer (`install.sh`) with sha256 verification and `--uninstall`
- Release workflow: tag check, tests, binary matrix, GitHub Release with checksums, idempotent npm publish
- `repository`/`bugs`/`homepage`/`publishConfig` package metadata
- CI node matrix 22.x/24.x with `npm ci` and working lcov coverage upload
