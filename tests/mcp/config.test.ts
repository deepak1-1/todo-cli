// Tests for MCP --print-config output shape.
// printMcpConfig() writes to process.stdout — we capture with a spy.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

beforeEach(() => {
    vi.resetModules();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('printMcpConfig', () => {
    it('emits valid JSON with mcpServers.todo shape', async () => {
        const chunks: string[] = [];
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            chunks.push(String(chunk));
            return true;
        });

        const { printMcpConfig } = await import('../../src/mcp/config.js');
        printMcpConfig();

        const raw = chunks.join('');
        const parsed = JSON.parse(raw);

        expect(parsed).toHaveProperty('mcpServers');
        expect(parsed.mcpServers).toHaveProperty('todo');
        expect(parsed.mcpServers.todo).toHaveProperty('command');
        expect(typeof parsed.mcpServers.todo.command).toBe('string');
        expect(parsed.mcpServers.todo.command.length).toBeGreaterThan(0);
        expect(parsed.mcpServers.todo.args).toEqual(['mcp']);
    });

    it('emits output ending with a newline', async () => {
        const chunks: string[] = [];
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            chunks.push(String(chunk));
            return true;
        });

        const { printMcpConfig } = await import('../../src/mcp/config.js');
        printMcpConfig();

        const raw = chunks.join('');
        expect(raw.endsWith('\n')).toBe(true);
    });

    it('command is the resolved absolute path of process.argv[1]', async () => {
        const chunks: string[] = [];
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            chunks.push(String(chunk));
            return true;
        });

        const { printMcpConfig } = await import('../../src/mcp/config.js');
        printMcpConfig();

        const parsed = JSON.parse(chunks.join(''));
        // argv[1] is resolved to an absolute path; must be non-empty and absolute
        expect(parsed.mcpServers.todo.command.length).toBeGreaterThan(0);
        expect(parsed.mcpServers.todo.command.startsWith('/')).toBe(true);
    });

    it('falls back to "todo" when process.argv[1] is empty string', async () => {
        const original = process.argv[1];
        try {
            process.argv[1] = '';
            const chunks: string[] = [];
            vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
                chunks.push(String(chunk));
                return true;
            });

            const { printMcpConfig } = await import('../../src/mcp/config.js');
            printMcpConfig();

            const parsed = JSON.parse(chunks.join(''));
            expect(parsed.mcpServers.todo.command).toBe('todo');
        } finally {
            process.argv[1] = original;
        }
    });
});
