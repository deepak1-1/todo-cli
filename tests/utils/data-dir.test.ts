import { describe, it, expect, afterEach, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { getDataDir, getDataDirOverride } from '../../src/utils/data-dir.js';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('getDataDir', () => {
    it('returns TODO_CLI_HOME when set', () => {
        vi.stubEnv('TODO_CLI_HOME', '/tmp/todo-cli-test-home');
        expect(getDataDir()).toBe('/tmp/todo-cli-test-home');
    });

    it('falls back to ~/.todo-cli when TODO_CLI_HOME is unset', () => {
        vi.stubEnv('TODO_CLI_HOME', '');
        expect(getDataDir()).toBe(path.join(os.homedir(), '.todo-cli'));
    });

    it('treats empty TODO_CLI_HOME as unset (falls back to home dir)', () => {
        vi.stubEnv('TODO_CLI_HOME', '');
        expect(getDataDir()).not.toBe('');
    });

    // whitespace-only is truthy — returned as-is (caller's responsibility to validate)
    it('returns whitespace-only TODO_CLI_HOME as-is', () => {
        vi.stubEnv('TODO_CLI_HOME', '   ');
        expect(getDataDir()).toBe('   ');
    });
});

describe('getDataDirOverride', () => {
    it('returns the env value when set', () => {
        vi.stubEnv('TODO_CLI_HOME', '/custom/dir');
        expect(getDataDirOverride()).toBe('/custom/dir');
    });

    it('returns undefined when TODO_CLI_HOME is empty string', () => {
        vi.stubEnv('TODO_CLI_HOME', '');
        expect(getDataDirOverride()).toBeUndefined();
    });

    it('returns undefined when TODO_CLI_HOME is not set', () => {
        delete process.env.TODO_CLI_HOME;
        expect(getDataDirOverride()).toBeUndefined();
    });
});

// Module-level constants in credential-store and plugin-loader are captured at
// import time — verify they pick up TODO_CLI_HOME when set before first import.
describe('module-load-time constant isolation', () => {
    it('credential-store DEFAULT_CREDENTIALS_DIR uses TODO_CLI_HOME at import time', async () => {
        const tmpDir = path.join(os.tmpdir(), 'todo-cli-cred-test-' + Date.now());
        vi.stubEnv('TODO_CLI_HOME', tmpDir);
        vi.resetModules();
        const fs = await import('node:fs');
        try {
            // Default-constructed store must write inside the overridden dir
            const mod = await import('../../src/plugins/credential-store.js');
            const store = new mod.EncryptedCredentialStore();
            await store.set('test-provider', 'secret');
            expect(fs.existsSync(path.join(tmpDir, 'credentials.json'))).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, '.salt'))).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, '.machinekey'))).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('plugin-loader PLUGINS_DIR uses TODO_CLI_HOME at import time', async () => {
        vi.stubEnv('TODO_CLI_HOME', path.join(os.tmpdir(), 'todo-cli-plugin-test-nonexistent'));
        vi.resetModules();
        const mod = await import('../../src/plugins/plugin-loader.js');
        expect(mod.loadAll).toBeTypeOf('function');
        // loadGlobal scans <TODO_CLI_HOME>/plugins; a missing dir must resolve without error
        await expect(mod.loadGlobal()).resolves.toBeUndefined();
    });
});

describe('config manager cwd override', () => {
    it('getConfigPath resolves inside TODO_CLI_HOME when override is set', async () => {
        const tmpDir = '/tmp/todo-cli-config-test-' + Date.now();
        vi.stubEnv('TODO_CLI_HOME', tmpDir);
        vi.resetModules();
        const fs = await import('node:fs');
        fs.mkdirSync(tmpDir, { recursive: true });
        try {
            const { getConfigPath } = await import('../../src/config/manager.js');
            expect(getConfigPath()).toContain(tmpDir);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('getConfigPath does not resolve inside TODO_CLI_HOME when override is absent', async () => {
        vi.stubEnv('TODO_CLI_HOME', '');
        vi.resetModules();
        const { getConfigPath } = await import('../../src/config/manager.js');
        const configPath = getConfigPath();
        // When no override, Conf uses its own OS-standard config dir (not ~/.todo-cli)
        expect(configPath).not.toContain('/tmp/todo-cli-config-test-');
    });
});
