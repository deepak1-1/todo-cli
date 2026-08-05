---
name: npm-publishing
description: Release flow for @deepak.tewatia/todo-cli. Use when cutting a version, bumping deps, or changing the bin/files surface.
---

# npm publishing for @deepak.tewatia/todo-cli

## Pre-release gate (do not skip any step)
1. `npm run typecheck` — zero errors.
2. `npm run lint` — zero errors.
3. `npm test` — zero failures.
4. `npm run build` — produces `dist/index.js` with the `#!/usr/bin/env node` banner.
5. `node dist/index.js --version` — prints the version in `package.json`.
6. `node dist/index.js list` and one TUI smoke — confirm runtime externals resolve.

## Versioning
- Semver. `npm version patch|minor|major` (no `--no-git-tag-version` — we want the tag).
- Bumping a CLI flag's semantics or removing a command is **major**, even pre-1.0.
- Adding a command or option is **minor**.
- Internal refactors and fixes are **patch**.

## Package contents
`package.json` `files: ["dist/", "README.md", "LICENSE"]` is the source of truth. Verify with:
```
npm pack --dry-run
```
Confirm `node_modules`, `tests/`, `src/`, `docs/` are not in the tarball.

## Publish
- Local dry run: `npm publish --dry-run --access public`.
- Real: `npm publish --access public` (scoped package needs `--access public` to be public by default).
- Prefer OIDC Trusted Publishing via GitHub Actions over long-lived npm tokens. If a token is unavoidable, scope it to publish-only on this package.

## Post-release
- Push the tag: `git push --tags`.
- Update `CHANGELOG.md` with the version section before publishing (publish-then-CHANGELOG is a recurring bug source).
- Open issues / PRs referenced in the changelog get a comment with the release link.

## Native bindings
`better-sqlite3` v13+ bundles N-API prebuilds inside the package (`prebuilds/<platform>-<arch>.node`) — there is no postinstall rebuild step. `scripts/build-sea.sh` copies the platform prebuild as the SEA sidecar; keep its path in sync if better-sqlite3 changes layout again.
