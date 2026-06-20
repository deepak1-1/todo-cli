import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        setupFiles: ['./tests/setup-tz.ts'],
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            // src/tui/** is a reserved forward-guard for the planned kanban TUI (see ROADMAP.md); no-op until it exists
            exclude: ['src/index.ts', 'src/tui/**'],
        },
    },
});
