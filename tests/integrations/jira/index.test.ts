// Tests for the Jira IntegrationProvider contract — all network I/O mocked via vi.mock

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock JiraClient before importing the provider so it never hits a real network
vi.mock('../../../src/integrations/jira/jira-client.js', () => ({
    JiraClient: vi.fn(),
}));

// Mock the logger to suppress noise in test output
vi.mock('../../../src/plugins/plugin-logger.js', () => ({
    createPluginLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

import { JiraClient } from '../../../src/integrations/jira/jira-client.js';
import jiraProvider from '../../../src/integrations/jira/index.js';
import type { CredentialStore, ExternalTask } from '../../../src/plugins/types.js';
import type { Task } from '../../../src/core/types.js';

// Build a minimal CredentialStore that serves pre-set values
function makeStore(values: Record<string, string | null>): CredentialStore {
    return {
        get: vi.fn(async (key: string) => values[key] ?? null),
        getOrThrow: vi.fn(async (key: string) => {
            const v = values[key];
            if (!v) throw new Error(`Missing key: ${key}`);
            return v;
        }),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        list: vi.fn(async () => Object.keys(values)),
    };
}

// Full credential set used by most tests
const CREDS = {
    'jira:domain': 'acme.atlassian.net',
    'jira:email': 'dev@acme.com',
    'jira:token': 'secret-token',
};

// Typed mock of the JiraClient constructor
const MockJiraClient = vi.mocked(JiraClient);

let mockClientInstance: {
    getMyself: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    getIssue: ReturnType<typeof vi.fn>;
    getTransitions: ReturnType<typeof vi.fn>;
    doTransition: ReturnType<typeof vi.fn>;
    updateIssue: ReturnType<typeof vi.fn>;
    extractAdfText: ReturnType<typeof vi.fn>;
    computeSyncHash: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
    // Create a fresh mock instance before every test
    mockClientInstance = {
        getMyself: vi.fn().mockResolvedValue({ accountId: 'u1', emailAddress: 'dev@acme.com', displayName: 'Dev' }),
        search: vi.fn().mockResolvedValue({ issues: [], total: 0, maxResults: 50 }),
        getIssue: vi.fn().mockResolvedValue({}),
        getTransitions: vi.fn().mockResolvedValue([]),
        doTransition: vi.fn().mockResolvedValue(undefined),
        updateIssue: vi.fn().mockResolvedValue(undefined),
        extractAdfText: vi.fn().mockReturnValue(''),
        computeSyncHash: vi.fn().mockReturnValue('abc123'),
    };
    MockJiraClient.mockImplementation(() => mockClientInstance as never);
});

afterEach(() => {
    vi.clearAllMocks();
});

// ──────────────────────────────────────────────
// Provider metadata
// ──────────────────────────────────────────────
describe('jiraProvider metadata', () => {
    it('has the expected name and version', () => {
        expect(jiraProvider.name).toBe('jira');
        expect(jiraProvider.version).toBe('0.5.0');
    });

    it('commands() returns an empty array', () => {
        expect(jiraProvider.commands?.()).toEqual([]);
    });
});

// ──────────────────────────────────────────────
// healthCheck
// ──────────────────────────────────────────────
describe('jiraProvider.healthCheck', () => {
    it('returns true when credentials exist and getMyself succeeds', async () => {
        const store = makeStore(CREDS);
        const result = await jiraProvider.healthCheck(store);
        expect(result).toBe(true);
        expect(mockClientInstance.getMyself).toHaveBeenCalledOnce();
    });

    it('returns false when a credential key is missing', async () => {
        const store = makeStore({ 'jira:domain': 'acme.atlassian.net' }); // email + token missing
        const result = await jiraProvider.healthCheck(store);
        expect(result).toBe(false);
        // No client should be constructed when creds are incomplete
        expect(MockJiraClient).not.toHaveBeenCalled();
    });

    it('returns false when getMyself throws', async () => {
        mockClientInstance.getMyself.mockRejectedValue(new Error('401 Unauthorized'));
        const store = makeStore(CREDS);
        const result = await jiraProvider.healthCheck(store);
        expect(result).toBe(false);
    });
});

// ──────────────────────────────────────────────
// pull
// ──────────────────────────────────────────────
describe('jiraProvider.pull', () => {
    it('throws when credentials are missing', async () => {
        const store = makeStore({});
        await expect(jiraProvider.pull(store, {})).rejects.toThrow('Jira credentials not found');
    });

    it('returns an empty array when JiraClient.search returns no issues', async () => {
        const store = makeStore(CREDS);
        const tasks = await jiraProvider.pull(store, {});
        expect(tasks).toEqual([]);
    });

    it('maps a Jira issue to ExternalTask with correct fields', async () => {
        const store = makeStore(CREDS);
        mockClientInstance.search.mockResolvedValue({
            issues: [{
                key: 'PROJ-1',
                id: '10001',
                fields: {
                    summary: 'Fix the login bug',
                    description: 'Plain text description',
                    priority: { name: 'High' },
                    status: { name: 'In Progress' },
                    duedate: '2026-07-01',
                    labels: ['backend'],
                    assignee: { displayName: 'Alice' },
                    project: { key: 'PROJ', name: 'Project Alpha' },
                },
            }],
            total: 1,
            maxResults: 50,
        });

        const tasks = await jiraProvider.pull(store, {});
        expect(tasks).toHaveLength(1);
        const t = tasks[0];
        expect(t.externalRef).toBe('PROJ-1');
        expect(t.title).toBe('Fix the login bug');
        expect(t.priority).toBe('high');
        expect(t.dueDate).toBe('2026-07-01');
        expect(t.labels).toEqual(['backend']);
        expect(t.assignee).toBe('Alice');
        expect(t.project).toBe('Project Alpha');
        expect(t.externalUrl).toBe('https://acme.atlassian.net/browse/PROJ-1');
        expect(t.metadata?.jiraKey).toBe('PROJ-1');
    });

    it('uses project filter in JQL when filters.project is provided', async () => {
        const store = makeStore(CREDS);
        await jiraProvider.pull(store, { project: 'MYPROJ' });
        const [jql] = mockClientInstance.search.mock.calls[0];
        expect(jql).toContain('project = "MYPROJ"');
    });

    it('uses status filter in JQL when filters.status is provided', async () => {
        const store = makeStore(CREDS);
        await jiraProvider.pull(store, { status: 'In Progress' });
        const [jql] = mockClientInstance.search.mock.calls[0];
        expect(jql).toContain('status = "In Progress"');
    });

    it('strips SQL injection characters from filters before building JQL', async () => {
        const store = makeStore(CREDS);
        await jiraProvider.pull(store, { project: "PROJ'; DROP TABLE issues;--" });
        const [jql] = mockClientInstance.search.mock.calls[0];
        // Quotes and backslashes must be stripped
        expect(jql).not.toContain("'");
        expect(jql).not.toContain('"DROP TABLE');
    });

    it('defaults to assignee = currentUser() when no filters are given', async () => {
        const store = makeStore(CREDS);
        await jiraProvider.pull(store, {});
        const [jql] = mockClientInstance.search.mock.calls[0];
        expect(jql).toContain('assignee = currentUser()');
    });

    it('extracts plain text from ADF description objects', async () => {
        const store = makeStore(CREDS);
        mockClientInstance.extractAdfText.mockReturnValue('ADF text content');
        mockClientInstance.search.mockResolvedValue({
            issues: [{
                key: 'PROJ-2',
                id: '10002',
                fields: {
                    summary: 'ADF issue',
                    description: { type: 'doc', content: [] }, // ADF object, not string
                    priority: null,
                    status: { name: 'Open' },
                    duedate: null,
                    labels: [],
                    assignee: null,
                    project: { key: 'PROJ', name: 'Proj' },
                },
            }],
            total: 1,
            maxResults: 50,
        });
        const tasks = await jiraProvider.pull(store, {});
        expect(tasks[0].description).toBe('ADF text content');
        expect(mockClientInstance.extractAdfText).toHaveBeenCalledOnce();
    });
});

// ──────────────────────────────────────────────
// push
// ──────────────────────────────────────────────
describe('jiraProvider.push', () => {
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
        jiraKey: 'PROJ-1',
        jiraId: null,
        githubRef: null,
        syncHash: null,
        lastSyncedAt: null,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-01 00:00:00',
        completedAt: null,
        archivedAt: null,
    };

    it('rejects when credentials are missing (push throws before the catch block)', async () => {
        const store = makeStore({});
        // Missing creds cause an early throw outside the catch block in push()
        await expect(jiraProvider.push(store, baseTask, 'PROJ-1')).rejects.toThrow('Jira credentials not found');
    });

    it('returns success:true and applies transition on happy path', async () => {
        const store = makeStore(CREDS);
        mockClientInstance.getIssue.mockResolvedValue({ key: 'PROJ-1', id: '10001', fields: {} });
        mockClientInstance.getTransitions.mockResolvedValue([
            { id: '31', name: 'Done', to: { name: 'Done' } },
        ]);

        const result = await jiraProvider.push(store, baseTask, 'PROJ-1');
        expect(result.success).toBe(true);
        expect(result.externalRef).toBe('PROJ-1');
        expect(mockClientInstance.doTransition).toHaveBeenCalledWith('PROJ-1', '31');
    });

    it('returns success:false with message when push throws', async () => {
        const store = makeStore(CREDS);
        mockClientInstance.getIssue.mockRejectedValue(new Error('Network error'));

        const result = await jiraProvider.push(store, baseTask, 'PROJ-1');
        expect(result.success).toBe(false);
        expect(result.message).toContain('Network error');
        expect(result.updatedFields).toEqual([]);
    });

    it('updates priority field when task has a priority', async () => {
        const store = makeStore(CREDS);
        mockClientInstance.getIssue.mockResolvedValue({ key: 'PROJ-1', id: '10001', fields: {} });
        mockClientInstance.getTransitions.mockResolvedValue([]);

        await jiraProvider.push(store, { ...baseTask, priority: 'urgent' }, 'PROJ-1');
        expect(mockClientInstance.updateIssue).toHaveBeenCalledWith(
            'PROJ-1',
            expect.objectContaining({ priority: { name: 'Highest' } }),
        );
    });

    it('updates duedate field when task has a dueDate', async () => {
        const store = makeStore(CREDS);
        mockClientInstance.getIssue.mockResolvedValue({ key: 'PROJ-1', id: '10001', fields: {} });
        mockClientInstance.getTransitions.mockResolvedValue([]);

        const result = await jiraProvider.push(store, { ...baseTask, dueDate: '2026-09-01' }, 'PROJ-1');
        expect(result.success).toBe(true);
        expect(mockClientInstance.updateIssue).toHaveBeenCalledWith('PROJ-1', { duedate: '2026-09-01' });
    });
});

// ──────────────────────────────────────────────
// mapToLocal
// ──────────────────────────────────────────────
describe('jiraProvider.mapToLocal', () => {
    it('maps Jira priority names to local TaskPriority values', () => {
        const external: ExternalTask = {
            externalId: '1',
            externalRef: 'PROJ-1',
            externalUrl: '',
            title: 'Issue',
            status: 'In Progress',
            priority: 'Highest',
        };
        const local = jiraProvider.mapToLocal(external);
        expect(local.priority).toBe('urgent');
    });

    it('maps Jira "done" status to local "done"', () => {
        const external: ExternalTask = {
            externalId: '1', externalRef: 'PROJ-1', externalUrl: '', title: 'X', status: 'Done',
        };
        expect(jiraProvider.mapToLocal(external).status).toBe('done');
    });

    it('maps unknown Jira status to "todo"', () => {
        const external: ExternalTask = {
            externalId: '1', externalRef: 'PROJ-1', externalUrl: '', title: 'X', status: 'Weird State',
        };
        expect(jiraProvider.mapToLocal(external).status).toBe('todo');
    });

    it('passes through title, description, and dueDate', () => {
        const external: ExternalTask = {
            externalId: '1', externalRef: 'PROJ-1', externalUrl: '',
            title: 'My issue', description: 'Some desc', dueDate: '2026-08-01', status: 'Open',
        };
        const local = jiraProvider.mapToLocal(external);
        expect(local.title).toBe('My issue');
        expect(local.description).toBe('Some desc');
        expect(local.dueDate).toBe('2026-08-01');
    });
});

// ──────────────────────────────────────────────
// mapToRemote
// ──────────────────────────────────────────────
describe('jiraProvider.mapToRemote', () => {
    it('maps local task fields to Jira field names', () => {
        const task: Task = {
            id: 1, title: 'My Task', description: 'Details', status: 'in_progress',
            priority: 'medium', projectId: null, dueDate: '2026-10-01', recurrence: null,
            timeSpent: 0, jiraKey: null, jiraId: null, githubRef: null,
            syncHash: null, lastSyncedAt: null,
            createdAt: '2026-01-01 00:00:00', updatedAt: '2026-01-01 00:00:00',
            completedAt: null, archivedAt: null,
        };
        const remote = jiraProvider.mapToRemote(task);
        expect(remote.summary).toBe('My Task');
        expect(remote.description).toBe('Details');
        expect(remote.duedate).toBe('2026-10-01');
        expect(remote.priority).toBe('Medium');
    });
});

