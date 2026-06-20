// Tests for runIntegrationCommand factory — verifies exit-code policy and delegation.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock modules before importing the unit under test.
vi.mock('../../src/plugins/index.js', () => ({
    loadAll: vi.fn(),
    getRegistry: vi.fn(),
    EncryptedCredentialStore: vi.fn().mockImplementation(() => ({ get: vi.fn(), set: vi.fn() })),
}));

vi.mock('../../src/commands/context.js', () => ({
    getContext: vi.fn(),
}));

vi.mock('../../src/utils/exit.js', () => ({
    EXIT: { OK: 0, GENERIC: 1, USAGE: 2, NOT_FOUND: 3, INVALID_TRANSITION: 4, CONFIG_ERROR: 5 },
    fail: vi.fn(),
}));

import { loadAll, getRegistry } from '../../src/plugins/index.js';
import { getContext } from '../../src/commands/context.js';
import { fail, EXIT } from '../../src/utils/exit.js';
import { runIntegrationCommand } from '../../src/commands/_integration-runner.js';
import type { RegisteredPlugin } from '../../src/plugins/index.js';

const mockPlugin: RegisteredPlugin = {
    manifest: { name: 'test', displayName: 'Test', description: '', version: '1.0.0' },
    provider: {} as never,
    enabled: true,
};

const mockCtx = {
    taskRepo: {} as never,
    projectRepo: {} as never,
    tagRepo: {} as never,
    timerRepo: {} as never,
    actionLog: {} as never,
    depRepo: {} as never,
    trackingRepo: {} as never,
};

beforeEach(() => {
    vi.mocked(loadAll).mockResolvedValue(undefined);
    vi.mocked(getContext).mockReturnValue(mockCtx);
    vi.mocked(fail).mockImplementation(() => undefined);
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('runIntegrationCommand', () => {
    it('calls fail(NOT_FOUND) when plugin is missing from registry', async () => {
        vi.mocked(loadAll).mockResolvedValue(undefined);
        vi.mocked(getRegistry).mockReturnValue({ get: () => undefined } as never);

        const handler = runIntegrationCommand('missing-plugin', { errorPrefix: 'Op failed' }, vi.fn());
        await handler();

        expect(fail).toHaveBeenCalledWith(EXIT.NOT_FOUND, 'Missing-plugin integration not found');
    });

    it('does not call fn when plugin is missing', async () => {
        vi.mocked(loadAll).mockResolvedValue(undefined);
        vi.mocked(getRegistry).mockReturnValue({ get: () => undefined } as never);

        const fn = vi.fn();
        await runIntegrationCommand('test', { errorPrefix: 'Op failed' }, fn)();

        expect(fn).not.toHaveBeenCalled();
    });

    it('calls fn with plugin, credStore, and ctx on happy path', async () => {
        vi.mocked(loadAll).mockResolvedValue(undefined);
        vi.mocked(getRegistry).mockReturnValue({ get: () => mockPlugin } as never);

        const fn = vi.fn().mockResolvedValue(undefined);
        await runIntegrationCommand('test', { errorPrefix: 'Op failed' }, fn)();

        expect(fn).toHaveBeenCalledOnce();
        const ictx = vi.mocked(fn).mock.calls[0][0];
        expect(ictx.plugin).toBe(mockPlugin);
        expect(ictx.ctx).toBe(mockCtx);
        expect(ictx.credStore).toBeDefined();
        expect(fail).not.toHaveBeenCalled();
    });

    it('calls fail(GENERIC) with prefixed message when fn throws', async () => {
        vi.mocked(loadAll).mockResolvedValue(undefined);
        vi.mocked(getRegistry).mockReturnValue({ get: () => mockPlugin } as never);

        const fn = vi.fn().mockRejectedValue(new Error('network timeout'));
        await runIntegrationCommand('test', { errorPrefix: 'Pull failed' }, fn)();

        expect(fail).toHaveBeenCalledWith(EXIT.GENERIC, 'Pull failed: network timeout');
    });

    it('calls fail(GENERIC) with String(err) for non-Error throws', async () => {
        vi.mocked(loadAll).mockResolvedValue(undefined);
        vi.mocked(getRegistry).mockReturnValue({ get: () => mockPlugin } as never);

        const fn = vi.fn().mockRejectedValue('raw string error');
        await runIntegrationCommand('test', { errorPrefix: 'Auth failed' }, fn)();

        expect(fail).toHaveBeenCalledWith(EXIT.GENERIC, 'Auth failed: raw string error');
    });

    it('capitalizes the provider name in the NOT_FOUND message', async () => {
        vi.mocked(loadAll).mockResolvedValue(undefined);
        vi.mocked(getRegistry).mockReturnValue({ get: () => undefined } as never);

        await runIntegrationCommand('jira', { errorPrefix: 'Op' }, vi.fn())();

        expect(fail).toHaveBeenCalledWith(EXIT.NOT_FOUND, 'Jira integration not found');
    });

    it('does not call fail on success (exit code stays 0)', async () => {
        vi.mocked(loadAll).mockResolvedValue(undefined);
        vi.mocked(getRegistry).mockReturnValue({ get: () => mockPlugin } as never);

        const fn = vi.fn().mockResolvedValue(undefined);
        await runIntegrationCommand('github', { errorPrefix: 'Sync failed' }, fn)();

        expect(fail).not.toHaveBeenCalled();
    });
});
