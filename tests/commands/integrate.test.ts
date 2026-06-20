// Tests for `todo integrate info` — ported from the removed `plugin info` command.

import { describe, it, expect, vi, afterEach } from 'vitest';

function captureLog(): { restore: () => void; lines: () => string[]; text: () => string } {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    return {
        restore: () => { log.mockRestore(); err.mockRestore(); },
        lines: () => log.mock.calls.map(c => String(c[0])),
        text: () => log.mock.calls.map(c => String(c[0]).replace(/\x1B\[[0-9;]*m/g, '')).join('\n'),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('integrate info', () => {
    it('shows manifest details for a built-in integration (text)', async () => {
        const cap = captureLog();
        const { integrateCommand } = await import('../../src/commands/integrate.js');
        await integrateCommand.parseAsync(['info', 'jira'], { from: 'user' });
        const out = cap.text();
        cap.restore();

        expect(out).toContain('Jira');
        expect(out).toMatch(/Version:/);
        expect(out).toMatch(/Status:/);
    });

    it('emits a flat JSON object with --json', async () => {
        const cap = captureLog();
        const { integrateCommand } = await import('../../src/commands/integrate.js');
        await integrateCommand.parseAsync(['info', 'github', '--json'], { from: 'user' });
        const lines = cap.lines();
        cap.restore();

        // Find the JSON blob among the logged lines and parse it.
        const blob = lines.find(l => l.trim().startsWith('{'));
        expect(blob).toBeDefined();
        const obj = JSON.parse(blob as string);
        expect(obj.name).toBe('github');
        expect(typeof obj.enabled).toBe('boolean');
    });
});
