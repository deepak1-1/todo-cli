import { defineConfig } from 'tsup';

// CJS bundle for the Node SEA binary — better-sqlite3 JS is bundled, its .node addon ships as a sidecar
export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs'],
    target: 'node22',
    outDir: 'dist-sea',
    clean: true,
    splitting: false,
    dts: false,
    sourcemap: false,
    shims: true,
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
        'better-sqlite3',
    ],
});
