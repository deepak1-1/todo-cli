// Tests for the local plugin loader — hermetic, uses temp dirs + module reset
//
// NOTE: `loadLocal()`'s success path routes through `dynamicImport` (plugin-loader.ts), the
// `new Function('specifier', 'return import(specifier)')` indirection added for the SEA build.
// Under Vitest that indirection throws ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING (Node's vm module
// requires an explicit importModuleDynamically callback for import() calls compiled at runtime
// via `new Function`; a literal `import()` written in source is fine because vite-node's
// transform rewrites it). This is a Vitest/vm-sandbox limitation, not a production bug — a plain
// `node -e` script exercising the same dynamicImport against a real plugin file loads correctly.
// See regression-sweep report: this means the actual plugin-load-succeeds path has no automated
// coverage and can only be verified via a real `node dist/index.js` smoke test.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, afterEach, vi } from 'vitest';

describe('plugin-loader loadLocal', () => {
    let tmpDir: string;

    afterEach(() => {
        if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('resolves without error when the plugins directory does not exist', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-plugin-loader-test-'));
        vi.stubEnv('TODO_CLI_HOME', tmpDir);
        vi.resetModules();
        const loaderMod = await import('../../src/plugins/plugin-loader.js');

        await expect(loaderMod.loadLocal()).resolves.toBeUndefined();
    });

    it('skips a non-directory entry inside the plugins directory', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-plugin-loader-test-'));
        const pluginsDir = path.join(tmpDir, 'plugins');
        fs.mkdirSync(pluginsDir, { recursive: true });
        fs.writeFileSync(path.join(pluginsDir, 'stray-file.txt'), 'not a plugin dir');
        vi.stubEnv('TODO_CLI_HOME', tmpDir);
        vi.resetModules();
        const loaderMod = await import('../../src/plugins/plugin-loader.js');
        const registryMod = await import('../../src/plugins/plugin-registry.js');

        await expect(loaderMod.loadLocal()).resolves.toBeUndefined();

        expect(registryMod.getRegistry().getAll()).toHaveLength(0);
    });

    it('skips a plugin directory that has no index.js', async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-plugin-loader-test-'));
        const pluginsDir = path.join(tmpDir, 'plugins');
        fs.mkdirSync(path.join(pluginsDir, 'incomplete-plugin'), { recursive: true });
        vi.stubEnv('TODO_CLI_HOME', tmpDir);
        vi.resetModules();
        const loaderMod = await import('../../src/plugins/plugin-loader.js');
        const registryMod = await import('../../src/plugins/plugin-registry.js');

        await expect(loaderMod.loadLocal()).resolves.toBeUndefined();

        expect(registryMod.getRegistry().isRegistered('incomplete-plugin')).toBe(false);
    });
});
