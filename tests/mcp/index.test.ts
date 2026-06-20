// Unit tests for runMcpServer and restoreConsole in src/mcp/index.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock StdioServerTransport to prevent real stdio binding.
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}));

// Mock buildMcpServer so no real server + DB is created.
vi.mock('../../src/mcp/server.js', () => ({
    buildMcpServer: vi.fn().mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
    }),
}));

// Mock printMcpConfig to avoid real stdout writes in the config-path test.
vi.mock('../../src/mcp/config.js', () => ({
    printMcpConfig: vi.fn(),
}));

beforeEach(() => {
    vi.resetModules();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('restoreConsole', () => {
    it('sets console.log back to the supplied original', async () => {
        const { restoreConsole } = await import('../../src/mcp/index.js');
        const originalFn = console.log;
        // Corrupt it first, then restore
        console.log = console.error;
        restoreConsole(originalFn);
        expect(console.log).toBe(originalFn);
    });
});

describe('runMcpServer — printConfig path', () => {
    it('calls printMcpConfig and does NOT redirect console.log', async () => {
        const { printMcpConfig } = await import('../../src/mcp/config.js');
        const { runMcpServer } = await import('../../src/mcp/index.js');

        const orig = console.log;
        vi.spyOn(process.stdout, 'write').mockReturnValue(true);

        await runMcpServer({ printConfig: true, allowDelete: false });

        expect(printMcpConfig).toHaveBeenCalledTimes(1);
        // console.log must not have been replaced
        expect(console.log).toBe(orig);
    });
});

describe('runMcpServer — server path', () => {
    it('redirects console.log to console.error before transport connects', async () => {
        const { runMcpServer } = await import('../../src/mcp/index.js');

        const orig = console.log;
        let logDuringConnect: typeof console.log | undefined;

        const { buildMcpServer } = await import('../../src/mcp/server.js');
        const mockServer = {
            connect: vi.fn().mockImplementation(async () => {
                // Capture what console.log is at connect time
                logDuringConnect = console.log;
            }),
        };
        (buildMcpServer as ReturnType<typeof vi.fn>).mockReturnValue(mockServer);

        await runMcpServer({ printConfig: false, allowDelete: false });

        expect(logDuringConnect).toBe(console.error);
        // Restore console.log for subsequent tests
        console.log = orig;
    });
});
