// Tests for the GitHub IntegrationProvider contract — all gh CLI calls mocked

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock GitHubClient so no real gh CLI is invoked
vi.mock('../../../src/integrations/github/github-client.js', () => ({
    GitHubClient: vi.fn(),
}));

// Mock the logger to suppress noise
vi.mock('../../../src/plugins/plugin-logger.js', () => ({
    createPluginLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

import { GitHubClient } from '../../../src/integrations/github/github-client.js';
import githubProvider from '../../../src/integrations/github/index.js';
import type { CredentialStore, ExternalTask } from '../../../src/plugins/types.js';
import type { Task } from '../../../src/core/types.js';

// Minimal CredentialStore (GitHub provider reads nothing from it — uses gh CLI)
function makeStore(): CredentialStore {
    return {
        get: vi.fn(async () => null),
        getOrThrow: vi.fn(async () => { throw new Error('not found'); }),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        list: vi.fn(async () => []),
    };
}

const MockGitHubClient = vi.mocked(GitHubClient);

let mockClientInstance: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
    getAssignedIssues: ReturnType<typeof vi.fn>;
    updateIssue: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
    mockClientInstance = {
        isAuthenticated: vi.fn().mockResolvedValue(true),
        getUser: vi.fn().mockResolvedValue({ login: 'alice', id: 1, name: 'Alice', email: 'a@x.com' }),
        getAssignedIssues: vi.fn().mockResolvedValue([]),
        updateIssue: vi.fn().mockResolvedValue(undefined),
    };
    MockGitHubClient.mockImplementation(() => mockClientInstance as never);
});

afterEach(() => {
    vi.clearAllMocks();
});

// ──────────────────────────────────────────────
// Provider metadata
// ──────────────────────────────────────────────
describe('githubProvider metadata', () => {
    it('has the expected name and version', () => {
        expect(githubProvider.name).toBe('github');
        expect(githubProvider.version).toBe('0.6.0');
    });

    it('commands() returns an empty array', () => {
        expect(githubProvider.commands?.()).toEqual([]);
    });
});

// ──────────────────────────────────────────────
// healthCheck
// ──────────────────────────────────────────────
describe('githubProvider.healthCheck', () => {
    it('returns true when gh CLI reports authenticated', async () => {
        const store = makeStore();
        mockClientInstance.isAuthenticated.mockResolvedValue(true);
        const result = await githubProvider.healthCheck(store);
        expect(result).toBe(true);
    });

    it('returns false when gh CLI is not authenticated', async () => {
        const store = makeStore();
        mockClientInstance.isAuthenticated.mockResolvedValue(false);
        const result = await githubProvider.healthCheck(store);
        expect(result).toBe(false);
    });

    it('returns false when isAuthenticated throws', async () => {
        const store = makeStore();
        mockClientInstance.isAuthenticated.mockRejectedValue(new Error('gh not installed'));
        const result = await githubProvider.healthCheck(store);
        expect(result).toBe(false);
    });
});

// ──────────────────────────────────────────────
// pull
// ──────────────────────────────────────────────
describe('githubProvider.pull', () => {
    it('returns an empty array when no issues are assigned', async () => {
        const store = makeStore();
        const tasks = await githubProvider.pull(store, {});
        expect(tasks).toEqual([]);
    });

    it('maps a GitHub issue to an ExternalTask with correct fields', async () => {
        const store = makeStore();
        mockClientInstance.getAssignedIssues.mockResolvedValue([{
            id: 42,
            number: 7,
            title: 'Fix navbar crash',
            body: 'Steps to reproduce...',
            state: 'open',
            labels: [{ name: 'priority: high' }, { name: 'bug' }],
            milestone: null,
            assignee: { login: 'alice' },
            due_on: null,
            html_url: 'https://github.com/acme/frontend/issues/7',
        }]);

        const tasks = await githubProvider.pull(store, {});
        expect(tasks).toHaveLength(1);
        const t = tasks[0];
        expect(t.externalRef).toBe('acme/frontend#7');
        expect(t.title).toBe('Fix navbar crash');
        expect(t.priority).toBe('high');
        expect(t.project).toBe('frontend');
        expect(t.assignee).toBe('alice');
        expect(t.externalUrl).toBe('https://github.com/acme/frontend/issues/7');
    });

    it('passes the repo filter to getAssignedIssues when filters.project is set', async () => {
        const store = makeStore();
        await githubProvider.pull(store, { project: 'acme/frontend' });
        expect(mockClientInstance.getAssignedIssues).toHaveBeenCalledWith(
            expect.objectContaining({ repo: 'acme/frontend' }),
        );
    });

    it('passes the label filter to getAssignedIssues when filters.label is set', async () => {
        const store = makeStore();
        await githubProvider.pull(store, { label: 'bug' });
        expect(mockClientInstance.getAssignedIssues).toHaveBeenCalledWith(
            expect.objectContaining({ labels: ['bug'] }),
        );
    });

    it('returns priority undefined when no priority label is present', async () => {
        const store = makeStore();
        mockClientInstance.getAssignedIssues.mockResolvedValue([{
            id: 1,
            number: 1,
            title: 'No priority label',
            body: null,
            state: 'open',
            labels: [{ name: 'good first issue' }],
            milestone: null,
            assignee: null,
            due_on: null,
            html_url: 'https://github.com/acme/repo/issues/1',
        }]);
        const tasks = await githubProvider.pull(store, {});
        expect(tasks[0].priority).toBeUndefined();
    });

    it('handles issues with no body (null body)', async () => {
        const store = makeStore();
        mockClientInstance.getAssignedIssues.mockResolvedValue([{
            id: 2,
            number: 2,
            title: 'Empty body issue',
            body: null,
            state: 'open',
            labels: [],
            milestone: null,
            assignee: null,
            due_on: null,
            html_url: 'https://github.com/acme/repo/issues/2',
        }]);
        const tasks = await githubProvider.pull(store, {});
        expect(tasks[0].description).toBeUndefined();
    });
});

// ──────────────────────────────────────────────
// push
// ──────────────────────────────────────────────
describe('githubProvider.push', () => {
    const baseTask: Task = {
        id: 1,
        title: 'Fix bug',
        description: '',
        status: 'done',
        priority: 'high',
        projectId: null,
        dueDate: null,
        recurrence: null,
        timeSpent: 0,
        jiraKey: null,
        jiraId: null,
        githubRef: 'acme/repo#5',
        syncHash: null,
        lastSyncedAt: null,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
        completedAt: null,
        archivedAt: null,
    };

    it('closes issue when task status is done', async () => {
        const store = makeStore();
        const result = await githubProvider.push(store, baseTask, 'acme/repo#5');
        expect(result.success).toBe(true);
        expect(mockClientInstance.updateIssue).toHaveBeenCalledWith('acme', 'repo', 5, { state: 'closed' });
    });

    it('reopens issue when task status is pending', async () => {
        const store = makeStore();
        const result = await githubProvider.push(store, { ...baseTask, status: 'pending' }, 'acme/repo#5');
        expect(result.success).toBe(true);
        expect(mockClientInstance.updateIssue).toHaveBeenCalledWith('acme', 'repo', 5, { state: 'open' });
    });

    it('closes issue when task status is archived', async () => {
        const store = makeStore();
        await githubProvider.push(store, { ...baseTask, status: 'archived' }, 'acme/repo#5');
        expect(mockClientInstance.updateIssue).toHaveBeenCalledWith('acme', 'repo', 5, { state: 'closed' });
    });

    it('updates labels with the mapped priority label when priority is set', async () => {
        const store = makeStore();
        await githubProvider.push(store, { ...baseTask, priority: 'urgent' }, 'acme/repo#5');
        const calls = mockClientInstance.updateIssue.mock.calls;
        const labelCall = calls.find(([, , , d]) => Array.isArray((d as Record<string, unknown>).labels));
        expect(labelCall).toBeDefined();
        expect((labelCall![3] as Record<string, unknown>).labels).toContain('priority: critical');
    });

    it('returns success:false with message when updateIssue throws', async () => {
        const store = makeStore();
        mockClientInstance.updateIssue.mockRejectedValue(new Error('gh command failed'));
        const result = await githubProvider.push(store, baseTask, 'acme/repo#5');
        expect(result.success).toBe(false);
        expect(result.message).toContain('gh command failed');
        expect(result.updatedFields).toEqual([]);
    });

    it('returns success:false for an invalid externalRef format', async () => {
        const store = makeStore();
        const result = await githubProvider.push(store, baseTask, 'not-a-ref');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Invalid GitHub reference format');
    });
});

// ──────────────────────────────────────────────
// mapToLocal
// ──────────────────────────────────────────────
describe('githubProvider.mapToLocal', () => {
    it('maps priority label to local TaskPriority', () => {
        const external: ExternalTask = {
            externalId: '1', externalRef: 'owner/repo#1', externalUrl: '',
            title: 'Issue', status: 'open', priority: 'high',
        };
        const local = githubProvider.mapToLocal(external);
        expect(local.priority).toBe('high');
    });

    it('maps labels array to tags', () => {
        const external: ExternalTask = {
            externalId: '1', externalRef: 'o/r#1', externalUrl: '',
            title: 'X', status: 'open', labels: ['bug', 'needs-triage'],
        };
        const local = githubProvider.mapToLocal(external);
        expect(local.tags).toEqual(['bug', 'needs-triage']);
    });

    it('sets priority to undefined for an unknown priority string', () => {
        const external: ExternalTask = {
            externalId: '1', externalRef: 'o/r#1', externalUrl: '',
            title: 'X', status: 'open', priority: 'critical-xXx',
        };
        const local = githubProvider.mapToLocal(external);
        expect(local.priority).toBeUndefined();
    });
});

// ──────────────────────────────────────────────
// mapToRemote
// ──────────────────────────────────────────────
describe('githubProvider.mapToRemote', () => {
    it('maps local task to GitHub issue shape', () => {
        const task: Task = {
            id: 1, title: 'A task', description: 'Body text', status: 'pending',
            priority: 'low', projectId: null, dueDate: null, recurrence: null,
            timeSpent: 0, jiraKey: null, jiraId: null, githubRef: null,
            syncHash: null, lastSyncedAt: null,
            createdAt: '2026-01-01 00:00:00', updatedAt: '2026-01-01 00:00:00',
            completedAt: null, archivedAt: null,
        };
        const remote = githubProvider.mapToRemote(task);
        expect(remote.title).toBe('A task');
        expect(remote.body).toBe('Body text');
        expect((remote.labels as string[])).toContain('priority: low');
    });
});

