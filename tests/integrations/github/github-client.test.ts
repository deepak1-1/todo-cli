// Unit tests for GitHubClient.createIssue — execFile mocked at module level

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted() runs before vi.mock hoisting, so we can reference these in the factory.
const { execFileMock, execFileAsyncMock } = vi.hoisted(() => {
    const execFileAsyncMock = vi.fn();
    // execFile itself is never called directly by the client — only promisify(execFile) is.
    // promisify uses [util.promisify.custom] if present; we set it to execFileAsyncMock.
    const execFileMock = vi.fn();
    return { execFileMock, execFileAsyncMock };
});

vi.mock('node:child_process', () => ({
    execFile: execFileMock,
}));

// Override util.promisify so that promisify(execFile) === execFileAsyncMock.
vi.mock('node:util', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:util')>();
    return {
        ...actual,
        promisify: (fn: unknown) => {
            if (fn === execFileMock) return execFileAsyncMock;
            return actual.promisify(fn as Parameters<typeof actual.promisify>[0]);
        },
    };
});

import { GitHubClient } from '../../../src/integrations/github/github-client.js';

// Minimal PluginLogger stub
const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('GitHubClient.createIssue', () => {
    it('returns number and html_url when gh returns a valid issue URL', async () => {
        execFileAsyncMock.mockResolvedValue({ stdout: 'https://github.com/acme/frontend/issues/42\n', stderr: '' });
        const client = new GitHubClient(logger);
        const result = await client.createIssue('acme', 'frontend', { title: 'Fix bug', body: 'Details' });
        expect(result.number).toBe(42);
        expect(result.html_url).toBe('https://github.com/acme/frontend/issues/42');
    });

    it('throws when stdout is not a parseable issue URL', async () => {
        execFileAsyncMock.mockResolvedValue({ stdout: 'some unexpected output\n', stderr: '' });
        const client = new GitHubClient(logger);
        await expect(
            client.createIssue('acme', 'frontend', { title: 'X', body: '' }),
        ).rejects.toThrow('gh issue create returned an unparseable URL');
    });

    it('passes title and body verbatim including quotes and newlines', async () => {
        execFileAsyncMock.mockResolvedValue({ stdout: 'https://github.com/acme/frontend/issues/1\n', stderr: '' });
        const client = new GitHubClient(logger);
        const title = 'Fix "the $thing" with `backticks`';
        const body = 'Line one\nLine two';
        await client.createIssue('acme', 'frontend', { title, body });
        // execFileAsyncMock is called with (cmd, args, opts) — check args includes title and body
        const calledArgs = execFileAsyncMock.mock.calls[0][1] as string[];
        expect(calledArgs).toContain(title);
        expect(calledArgs).toContain(body);
    });

    it('throws when gh CLI exits with an error', async () => {
        execFileAsyncMock.mockRejectedValue(new Error('gh: command not found'));
        const client = new GitHubClient(logger);
        await expect(
            client.createIssue('acme', 'frontend', { title: 'X' }),
        ).rejects.toThrow();
    });

    it('throws when stdout is an empty string', async () => {
        execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' });
        const client = new GitHubClient(logger);
        await expect(
            client.createIssue('acme', 'frontend', { title: 'X' }),
        ).rejects.toThrow('gh issue create returned an unparseable URL');
    });
});

describe('GitHubClient.updateIssue', () => {
    it('emits --add-label for each label in data.labels', async () => {
        execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' });
        const client = new GitHubClient(logger);
        await client.updateIssue('acme', 'frontend', 42, { labels: ['priority: critical'] });
        const calledArgs = execFileAsyncMock.mock.calls[0][1] as string[];
        expect(calledArgs).toEqual(expect.arrayContaining(['--add-label', 'priority: critical']));
    });

    it('propagates a rejection when gh issue edit fails', async () => {
        execFileAsyncMock.mockRejectedValue(new Error('label not found'));
        const client = new GitHubClient(logger);
        await expect(
            client.updateIssue('acme', 'frontend', 42, { labels: ['priority: high'] }),
        ).rejects.toThrow('label not found');
    });
});

// Helper to build an execFile-style rejection matching the real promisify(execFile) error shape:
// err.message embeds the full command line + stderr; err.stderr carries stderr only.
function ghError(commandLine: string, stderr: string, code = 1): Error {
    return Object.assign(new Error(`Command failed: ${commandLine}\n${stderr}`), { stderr, code });
}

describe('GitHubClient retry behavior', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Drive a promise through fake-timer backoff waits until it settles.
    async function flush<T>(p: Promise<T>): Promise<T> {
        let settled = false;
        p.then(() => (settled = true), () => (settled = true));
        for (let i = 0; i < 10 && !settled; i++) {
            await vi.advanceTimersByTimeAsync(5000);
        }
        return p;
    }

    describe('non-idempotent creates never retry', () => {
        it('createPullRequest attempts exactly once on a genuine 5xx and rejects', async () => {
            execFileAsyncMock.mockRejectedValueOnce(
                ghError('gh pr create --repo acme/x --title T --base main --head feat', 'gh: Server Error (HTTP 502)\n'),
            );
            const client = new GitHubClient(logger);
            const promise = client.createPullRequest('acme', 'x', {
                title: 'T',
                head: 'feat',
                base: 'main',
            });
            await expect(flush(promise)).rejects.toThrow();
            expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
        });

        it('createIssue attempts exactly once on a genuine 5xx and rejects', async () => {
            execFileAsyncMock.mockRejectedValueOnce(
                ghError('gh issue create --repo acme/x --title T --body B', 'gh: Server Error (HTTP 502)\n'),
            );
            const client = new GitHubClient(logger);
            const promise = client.createIssue('acme', 'x', { title: 'T', body: 'B' });
            await expect(flush(promise)).rejects.toThrow();
            expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
        });
    });

    describe('anchored stderr-based 5xx/429 predicate for reads', () => {
        it('retries a genuine REST 5xx: stderr "gh: Server Error (HTTP 503)"', async () => {
            execFileAsyncMock
                .mockRejectedValueOnce(ghError('gh api repos/acme/x/commits/abc/status', 'gh: Server Error (HTTP 503)\n'))
                .mockResolvedValueOnce({ stdout: JSON.stringify({ state: 'success' }), stderr: '' });
            const client = new GitHubClient(logger);
            const result = await flush(client.getCommitStatus('acme', 'x', 'abc'));
            expect(result.state).toBe('success');
            expect(execFileAsyncMock).toHaveBeenCalledTimes(2);
        });

        it('retries the HTTP/2 slash-version form: stderr "gh: upstream error (HTTP/2 503)"', async () => {
            execFileAsyncMock
                .mockRejectedValueOnce(ghError('gh api repos/acme/x/commits/abc/status', 'gh: upstream error (HTTP/2 503)\n'))
                .mockResolvedValueOnce({ stdout: JSON.stringify({ state: 'success' }), stderr: '' });
            const client = new GitHubClient(logger);
            const result = await flush(client.getCommitStatus('acme', 'x', 'abc'));
            expect(result.state).toBe('success');
            expect(execFileAsyncMock).toHaveBeenCalledTimes(2);
        });

        it('does not retry when a 503-looking number is only in the command line (issue #503, 404 in stderr)', async () => {
            execFileAsyncMock.mockRejectedValueOnce(
                ghError('gh issue view 503 --repo acme/x --json ...', 'gh: Not Found (HTTP 404)\n'),
            );
            const client = new GitHubClient(logger);
            await expect(flush(client.getIssue('acme', 'x', 503))).rejects.toThrow();
            expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
        });

        it('does not retry a permanent GraphQL error with no HTTP status token', async () => {
            execFileAsyncMock.mockRejectedValueOnce(
                ghError('gh search issues --assignee @me', 'GraphQL: Could not resolve to a Repository with the name \'x\'.\n'),
            );
            const client = new GitHubClient(logger);
            await expect(flush(client.getAssignedIssues())).rejects.toThrow();
            expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
        });

        it('still retries on a genuine network reset (ECONNRESET)', async () => {
            execFileAsyncMock
                .mockRejectedValueOnce(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))
                .mockResolvedValueOnce({ stdout: JSON.stringify({ login: 'me', id: 1, name: null, email: null }), stderr: '' });
            const client = new GitHubClient(logger);
            const result = await flush(client.getUser());
            expect(result.login).toBe('me');
            expect(execFileAsyncMock).toHaveBeenCalledTimes(2);
        });

        it('retries on a 429 rate-limit status', async () => {
            execFileAsyncMock
                .mockRejectedValueOnce(ghError('gh api user', 'gh: API rate limit exceeded (HTTP 429)\n'))
                .mockResolvedValueOnce({ stdout: JSON.stringify({ login: 'me', id: 1, name: null, email: null }), stderr: '' });
            const client = new GitHubClient(logger);
            const result = await flush(client.getUser());
            expect(result.login).toBe('me');
            expect(execFileAsyncMock).toHaveBeenCalledTimes(2);
        });

        it('does not retry an auth failure (exit code 4)', async () => {
            execFileAsyncMock.mockRejectedValueOnce(
                Object.assign(new Error('Command failed: gh api user\ngh: not logged into any accounts\n'), {
                    stderr: 'gh: not logged into any accounts\n',
                    code: 4,
                }),
            );
            const client = new GitHubClient(logger);
            await expect(flush(client.getUser())).rejects.toThrow();
            expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
        });
    });
});
