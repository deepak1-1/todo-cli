---
name: tsup-bundling
description: tsup config for this CLI - external vs noExternal, ESM-only, native binding rules. Use any time a dependency is added, removed, or upgraded.
---

# tsup bundling rules

## Output shape
- `format: ['esm']`, `target: 'node22'`, single `dist/index.js`.
- Banner re-introduces `createRequire` so bundled CJS-style requires still work in ESM (`#!/usr/bin/env node` + `import{createRequire}from"module"`). Don't strip it.
- `splitting: false`, `dts: false`. Don't enable splitting — it breaks the single-file bin contract.

## Externals (must remain external)
- `better-sqlite3` — native binding, can't bundle.
- `node-llama-cpp` — native + dynamic GGUF loading.
- `ink`, `ink-text-input`, `ink-spinner`, `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, `react-devtools-core`, `react-reconciler` — Ink's render pipeline resolves these at runtime.
- `yoga-wasm-web`, `yoga-layout` — WASM, loaded dynamically by Ink.

If you add anything in those families, add it to `external`.

## noExternal (bundle into dist)
`chalk`, `commander`, `chrono-node`, `cli-table3`, `date-fns`, `figures`, `fuse.js`, `ora`, `conf`, `terminal-link`. Reason: they're pure JS, small, and bundling avoids `node_modules` shipping with the bin.

If you add a pure-JS dep that's safe to bundle, add it here. Otherwise it ships unbundled and the bin breaks for users without it installed.

## Decision tree for a new dependency
1. Does it ship a `.node` / native binding? → `external`.
2. Does it dynamically `import()` or `require()` based on file paths? → `external`.
3. Is it a peer of Ink/React? → `external`.
4. Otherwise → `noExternal`.

## Verification
After editing `tsup.config.ts` or adding a dep:
```
npm run build
node dist/index.js --version
node dist/index.js list
```
Smoke-test at least one path that touches the new dep. A bundle that builds but crashes at runtime is the common failure mode for misconfigured externals.

## Sourcemaps
`sourcemap: true`. Don't disable — stack traces in user bug reports rely on it.
