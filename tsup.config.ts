import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node22',
    outDir: 'dist',
    clean: true,
    splitting: false,
    dts: false,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node\nimport{createRequire}from"module";const require=createRequire(import.meta.url);' },
    external: [
        'better-sqlite3',
    ],
    noExternal: [
        '@modelcontextprotocol/sdk',
        'chalk',
        'commander',
        'chrono-node',
        'cli-table3',
        'date-fns',
        'figures',
        'fuse.js',
        'conf',
        'zod',
    ],
});
