// Integration tests for all 6 MCP task tools.
// Strategy: mock getContext() (singleton) to inject an in-memory test DB,
// then call registerTaskTools directly on a minimal McpServer stub so we
// can invoke handler functions without a real stdio transport.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../../src/storage/database.js';
import { runMigrations } from '../../../src/storage/migrations/runner.js';
import type { AppContext } from '../../../src/commands/context.js';
import { buildTestCtx, buildStubServer } from '../../helpers/mcp.js';
import type { StubServer } from '../../helpers/mcp.js';

let db: Database.Database;
let ctx: AppContext;

// Wire ctx into getContext so MCP tool handlers use the test DB
vi.mock('../../../src/commands/context.js', () => ({
    getContext: () => ctx,
}));

let server: StubServer;

beforeEach(() => {
    vi.resetModules();
    db = createTestDb();
    runMigrations(db);
    ctx = buildTestCtx(db);
    server = buildStubServer();
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
});

async function loadTools(allowDelete = false) {
    const { registerTaskTools } = await import('../../../src/mcp/tools/tasks.js');
    // Cast stub to McpServer — shape is compatible for tool registration
    registerTaskTools(server as never, { allowDelete });
    return server;
}

// ─── todo_add_task ────────────────────────────────────────────────────────────
describe('todo_add_task', () => {
    it('creates a task and returns it in structuredContent', async () => {
        await loadTools();
        const result = server.call('todo_add_task', { title: 'Buy milk', priority: 'low' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.title).toBe('Buy milk');
        expect(structured.priority).toBe('low');
        expect(typeof structured.id).toBe('number');
    });

    it('is reflected in taskRepo.list after creation', async () => {
        await loadTools();
        server.call('todo_add_task', { title: 'Reflected task', priority: 'medium' });

        const tasks = ctx.taskRepo.list({});
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('Reflected task');
    });

    it('creates a task with tags and reflects tags in the repo', async () => {
        await loadTools();
        const result = server.call('todo_add_task', { title: 'Tagged task', tags: ['work', 'urgent-flag'] }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        const id = structured.id as number;
        // getTaskTags returns string[] directly
        const tags = ctx.tagRepo.getTaskTags(id);
        expect(tags).toEqual(expect.arrayContaining(['work', 'urgent-flag']));
    });

    it('auto-creates a project when projectName is provided', async () => {
        await loadTools();
        const result = server.call('todo_add_task', { title: 'Project task', projectName: 'My Project' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const project = ctx.projectRepo.getOrCreate('My Project');
        expect(project).toBeDefined();
    });

    it('returns isError when title is empty string', async () => {
        await loadTools();
        // validateCreateInput throws; the handler catch block converts it to isError
        const result = server.call('todo_add_task', { title: '' }) as Record<string, unknown>;
        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/title/i);
    });

    it('returns isError when dueDate is unparseable', async () => {
        await loadTools();
        const result = server.call('todo_add_task', {
            title: 'Bad date task',
            dueDate: 'not-a-date-xyzzy',
        }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/parse/i);
    });

    it('text summary mentions the created task id and title', async () => {
        await loadTools();
        const result = server.call('todo_add_task', { title: 'Summary check' }) as Record<string, unknown>;

        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/Summary check/);
        expect(content.text).toMatch(/#\d+/);
    });

    it('safely stores SQL metacharacters in title', async () => {
        await loadTools();
        const malicious = "'; DROP TABLE tasks; --";
        const result = server.call('todo_add_task', { title: malicious }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.title).toBe(malicious);
        // Table still exists and holds the row
        expect(ctx.taskRepo.list({})).toHaveLength(1);
    });
});

// ─── todo_update_task ─────────────────────────────────────────────────────────
describe('todo_update_task', () => {
    it('updates title and priority and is reflected in taskRepo', async () => {
        const task = ctx.taskRepo.create({ title: 'Original', priority: 'low' });
        await loadTools();

        const result = server.call('todo_update_task', {
            id: task.id,
            title: 'Updated',
            priority: 'urgent',
        }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const updated = ctx.taskRepo.getById(task.id);
        expect(updated?.title).toBe('Updated');
        expect(updated?.priority).toBe('urgent');
    });

    it('returns updated task in structuredContent', async () => {
        const task = ctx.taskRepo.create({ title: 'Check content', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', {
            id: task.id,
            title: 'Content updated',
        }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.title).toBe('Content updated');
        expect(structured.id).toBe(task.id);
    });

    it('returns isError for non-existent task id', async () => {
        await loadTools();
        const result = server.call('todo_update_task', { id: 99999, title: 'Ghost' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/not found/i);
    });

    it('removes due date when dueDate is empty string', async () => {
        const task = ctx.taskRepo.create({ title: 'Has due', priority: 'medium', dueDate: '2026-12-31' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, dueDate: '' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const updated = ctx.taskRepo.getById(task.id);
        expect(updated?.dueDate).toBeNull();
    });

    it('removes project when projectName is empty string', async () => {
        const proj = ctx.projectRepo.getOrCreate('TestProject');
        const task = ctx.taskRepo.create({ title: 'Has project', priority: 'medium', projectId: proj.id });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, projectName: '' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const updated = ctx.taskRepo.getById(task.id);
        expect(updated?.projectId).toBeNull();
    });

    it('returns isError when dueDate is unparseable', async () => {
        const task = ctx.taskRepo.create({ title: 'Bad date', priority: 'low' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, dueDate: 'xyzzy-bad' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
    });
});

// ─── todo_set_status ─────────────────────────────────────────────────────────
describe('todo_set_status', () => {
    it('transitions a task to done status', async () => {
        const task = ctx.taskRepo.create({ title: 'Finish me', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_set_status', { id: task.id, status: 'done' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const updated = ctx.taskRepo.getById(task.id);
        expect(updated?.status).toBe('done');
    });

    it('transitions to in_progress', async () => {
        const task = ctx.taskRepo.create({ title: 'Start me', priority: 'high' });
        await loadTools();

        const result = server.call('todo_set_status', { id: task.id, status: 'in_progress' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(ctx.taskRepo.getById(task.id)?.status).toBe('in_progress');
    });

    it('mutation is reflected in taskRepo', async () => {
        const task = ctx.taskRepo.create({ title: 'Status reflect', priority: 'low' });
        await loadTools();

        server.call('todo_set_status', { id: task.id, status: 'in_review' });

        expect(ctx.taskRepo.getById(task.id)?.status).toBe('in_review');
    });

    it('returns isError for unrecognised status', async () => {
        const task = ctx.taskRepo.create({ title: 'Status task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_set_status', { id: task.id, status: 'flying' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/invalid status/i);
    });

    it('returns isError for non-existent task id', async () => {
        await loadTools();
        const result = server.call('todo_set_status', { id: 9999, status: 'done' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
    });

    it('text summary mentions the new status label', async () => {
        const task = ctx.taskRepo.create({ title: 'Label check', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_set_status', { id: task.id, status: 'done' }) as Record<string, unknown>;

        const content = (result.content as Array<{ text: string }>)[0];
        // The summary says: Task #N is now "Done" (label from StatusDef)
        expect(content.text).toMatch(/#\d+/);
        expect(content.text).toMatch(/done/i);
    });
});

// ─── todo_delete_task ─────────────────────────────────────────────────────────
describe('todo_delete_task', () => {
    it('archives a task by default (soft delete)', async () => {
        const task = ctx.taskRepo.create({ title: 'Archive me', priority: 'medium' });
        await loadTools(false);

        const result = server.call('todo_delete_task', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.archived).toBe(true);
        // Task still exists in DB but has archived status
        const found = ctx.taskRepo.getById(task.id);
        expect(found?.status).toBe('archived');
    });

    it('archive is undoable — task remains in DB', async () => {
        const task = ctx.taskRepo.create({ title: 'Undoable', priority: 'low' });
        await loadTools(false);

        server.call('todo_delete_task', { id: task.id });

        // getById still finds it (it's archived, not hard deleted)
        const found = ctx.taskRepo.getById(task.id);
        expect(found).not.toBeNull();
    });

    it('refuses hard delete when allowDelete is false', async () => {
        const task = ctx.taskRepo.create({ title: 'Protected', priority: 'medium' });
        await loadTools(false);

        const result = server.call('todo_delete_task', { id: task.id, hard: true }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/hard delete is disabled/i);
        // Task still exists and is NOT archived
        const found = ctx.taskRepo.getById(task.id);
        expect(found?.status).toBe('todo');
    });

    it('hard-deletes when allowDelete is true and hard:true', async () => {
        const task = ctx.taskRepo.create({ title: 'Really gone', priority: 'urgent' });
        await loadTools(true);

        const result = server.call('todo_delete_task', { id: task.id, hard: true }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.archived).toBe(false);
        // Hard delete: task no longer retrievable
        const found = ctx.taskRepo.getById(task.id);
        expect(found).toBeNull();
    });

    it('archives (not hard-deletes) when allowDelete is true but hard is omitted', async () => {
        const task = ctx.taskRepo.create({ title: 'Soft even with allow', priority: 'low' });
        await loadTools(true);

        const result = server.call('todo_delete_task', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.archived).toBe(true);
        const found = ctx.taskRepo.getById(task.id);
        expect(found?.status).toBe('archived');
    });

    it('returns isError for non-existent task id', async () => {
        await loadTools(false);
        const result = server.call('todo_delete_task', { id: 99999 }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/not found/i);
    });

    it('structuredContent includes id and title on success', async () => {
        const task = ctx.taskRepo.create({ title: 'Payload check', priority: 'medium' });
        await loadTools(false);

        const result = server.call('todo_delete_task', { id: task.id }) as Record<string, unknown>;

        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.id).toBe(task.id);
        expect(structured.title).toBe('Payload check');
    });

    it('text summary says Archived when soft-deleting', async () => {
        const task = ctx.taskRepo.create({ title: 'Summary soft', priority: 'low' });
        await loadTools(false);

        const result = server.call('todo_delete_task', { id: task.id }) as Record<string, unknown>;

        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/archived/i);
    });

    it('text summary says Permanently deleted when hard-deleting', async () => {
        const task = ctx.taskRepo.create({ title: 'Summary hard', priority: 'low' });
        await loadTools(true);

        const result = server.call('todo_delete_task', { id: task.id, hard: true }) as Record<string, unknown>;

        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/permanently deleted/i);
    });
});

// ─── todo_list_tasks ──────────────────────────────────────────────────────────
describe('todo_list_tasks', () => {
    it('returns all active tasks when no filters are given', async () => {
        ctx.taskRepo.create({ title: 'Alpha', priority: 'high' });
        ctx.taskRepo.create({ title: 'Beta', priority: 'low' });
        await loadTools();

        const result = server.call('todo_list_tasks', {}) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const tasks = (result.structuredContent as { items: Array<unknown> }).items;
        expect(tasks).toHaveLength(2);
    });

    it('structuredContent is an array of task objects', async () => {
        ctx.taskRepo.create({ title: 'Task One', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_list_tasks', {}) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(Array.isArray(tasks)).toBe(true);
        expect(tasks[0]).toHaveProperty('title', 'Task One');
        expect(tasks[0]).toHaveProperty('id');
    });

    it('filters by status', async () => {
        const t1 = ctx.taskRepo.create({ title: 'Todo task', priority: 'medium' });
        const t2 = ctx.taskRepo.create({ title: 'Done task', priority: 'medium' });
        ctx.taskRepo.update(t2.id, { status: 'done', completedAt: new Date().toISOString() });
        await loadTools();

        const result = server.call('todo_list_tasks', { status: 'todo' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe(t1.id);
    });

    it('filters by priority', async () => {
        ctx.taskRepo.create({ title: 'Urgent one', priority: 'urgent' });
        ctx.taskRepo.create({ title: 'Low one', priority: 'low' });
        await loadTools();

        const result = server.call('todo_list_tasks', { priority: 'urgent' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(1);
        expect(tasks[0].priority).toBe('urgent');
    });

    it('returns empty array when no tasks match the filter', async () => {
        ctx.taskRepo.create({ title: 'Only task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_list_tasks', { priority: 'urgent' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<unknown> }).items;

        expect(tasks).toHaveLength(0);
    });

    it('text summary reports the correct task count', async () => {
        ctx.taskRepo.create({ title: 'A', priority: 'low' });
        ctx.taskRepo.create({ title: 'B', priority: 'low' });
        ctx.taskRepo.create({ title: 'C', priority: 'low' });
        await loadTools();

        const result = server.call('todo_list_tasks', {}) as Record<string, unknown>;
        const content = (result.content as Array<{ text: string }>)[0];

        expect(content.text).toMatch(/3/);
    });

    it('respects limit parameter', async () => {
        for (let i = 0; i < 10; i++) {
            ctx.taskRepo.create({ title: `Task ${i}`, priority: 'low' });
        }
        await loadTools();

        const result = server.call('todo_list_tasks', { limit: 3 }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<unknown> }).items;

        expect(tasks).toHaveLength(3);
    });

    it('does not include archived tasks by default', async () => {
        const t1 = ctx.taskRepo.create({ title: 'Active', priority: 'medium' });
        const t2 = ctx.taskRepo.create({ title: 'Archived', priority: 'medium' });
        ctx.taskRepo.archive(t2.id);
        await loadTools();

        const result = server.call('todo_list_tasks', {}) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        const ids = tasks.map((t) => t.id);
        expect(ids).toContain(t1.id);
        expect(ids).not.toContain(t2.id);
    });

    it('includes archived tasks when includeArchived is true', async () => {
        const t1 = ctx.taskRepo.create({ title: 'Active', priority: 'medium' });
        const t2 = ctx.taskRepo.create({ title: 'Archived', priority: 'medium' });
        ctx.taskRepo.archive(t2.id);
        await loadTools();

        const result = server.call('todo_list_tasks', { includeArchived: true }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        const ids = tasks.map((t) => t.id);
        expect(ids).toContain(t1.id);
        expect(ids).toContain(t2.id);
    });
});

// ─── todo_get_task ────────────────────────────────────────────────────────────
describe('todo_get_task', () => {
    it('returns a single task by id in structuredContent', async () => {
        const task = ctx.taskRepo.create({ title: 'Fetch me', priority: 'high' });
        await loadTools();

        const result = server.call('todo_get_task', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.id).toBe(task.id);
        expect(structured.title).toBe('Fetch me');
    });

    it('text summary includes id, title, and status', async () => {
        const task = ctx.taskRepo.create({ title: 'Summary task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_get_task', { id: task.id }) as Record<string, unknown>;
        const content = (result.content as Array<{ text: string }>)[0];

        expect(content.text).toMatch(/#\d+/);
        expect(content.text).toMatch(/Summary task/);
        expect(content.text).toMatch(/todo/i);
    });

    it('returns isError when task does not exist', async () => {
        await loadTools();

        const result = server.call('todo_get_task', { id: 88888 }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/not found/i);
    });

    it('returns task with project relation when task has a project', async () => {
        const proj = ctx.projectRepo.getOrCreate('Work');
        const task = ctx.taskRepo.create({ title: 'Project task', priority: 'medium', projectId: proj.id });
        await loadTools();

        const result = server.call('todo_get_task', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.id).toBe(task.id);
        // getByIdWithRelations should include projectName
        expect(structured).toHaveProperty('projectName', 'Work');
    });
});

// ─── regression: code-review follow-ups ─────────────────────────────────────────
describe('todo_set_status — case-insensitive matching', () => {
    it('accepts an upper-case status key (parity with CLI findByKeyOrVerb)', async () => {
        const task = ctx.taskRepo.create({ title: 'Case task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_set_status', { id: task.id, status: 'DONE' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(ctx.taskRepo.getById(task.id)?.status).toBe('done');
    });
});

describe('todo_update_task — tags', () => {
    it('adds tags that are reflected on the task', async () => {
        const task = ctx.taskRepo.create({ title: 'Tag task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, tags: ['urgent', 'backend'] }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const fetched = ctx.taskRepo.getByIdWithRelations(task.id);
        expect(fetched?.tagNames).toEqual(expect.arrayContaining(['urgent', 'backend']));
    });

    it('treats an empty tags array as a no-op (documented behavior)', async () => {
        const task = ctx.taskRepo.create({ title: 'Keep tags', priority: 'medium' });
        await loadTools();
        server.call('todo_update_task', { id: task.id, tags: ['keep'] });

        const result = server.call('todo_update_task', { id: task.id, tags: [] }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const fetched = ctx.taskRepo.getByIdWithRelations(task.id);
        expect(fetched?.tagNames).toContain('keep');
    });

    it('keeps existing tags when adding a bare-name tag (Bug A regression)', async () => {
        const task = ctx.taskRepo.create({ title: 'Existing tags task', priority: 'medium' });
        ctx.tagRepo.addTaskTags(task.id, ['frontend', 'api']);
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, tags: ['backend'] }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const fetched = ctx.taskRepo.getByIdWithRelations(task.id);
        // Exact count guards against duplicates
        expect(fetched?.tagNames).toHaveLength(3);
        // Existing tags must still be present
        expect(fetched?.tagNames).toEqual(expect.arrayContaining(['frontend', 'api', 'backend']));
    });

    it('removes a tag via "-name" prefix while keeping others', async () => {
        const task = ctx.taskRepo.create({ title: 'Remove tag task', priority: 'medium' });
        ctx.tagRepo.addTaskTags(task.id, ['frontend', 'legacy', 'api']);
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, tags: ['-legacy'] }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const fetched = ctx.taskRepo.getByIdWithRelations(task.id);
        expect(fetched?.tagNames).not.toContain('legacy');
        expect(fetched?.tagNames).toEqual(expect.arrayContaining(['frontend', 'api']));
    });

    it('rejects empty string title with isError', async () => {
        const task = ctx.taskRepo.create({ title: 'Original title', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, title: '' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
    });

    it('rejects whitespace-only title with isError', async () => {
        const task = ctx.taskRepo.create({ title: 'Original title', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, title: '   ' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
    });

    it('sets a valid dueDate on an existing task', async () => {
        const task = ctx.taskRepo.create({ title: 'Due date task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, dueDate: '2027-06-01' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const updated = ctx.taskRepo.getById(task.id);
        expect(updated?.dueDate).toMatch(/2027-06-01/);
    });
});

// ─── todo_add_task — additional coverage paths ────────────────────────────────
describe('todo_add_task — extended coverage', () => {
    it('stores a valid ISO dueDate on the created task', async () => {
        await loadTools();
        const result = server.call('todo_add_task', { title: 'Task with due', dueDate: '2027-12-31' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        const id = structured.id as number;
        const stored = ctx.taskRepo.getById(id);
        expect(stored?.dueDate).toMatch(/2027-12-31/);
    });

    it('stores a valid recurrence on the created task', async () => {
        await loadTools();
        const result = server.call('todo_add_task', { title: 'Recurring task', recurrence: 'weekly' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        const id = structured.id as number;
        const stored = ctx.taskRepo.getById(id);
        expect(stored?.recurrence).toBe('weekly');
    });

    it('returns isError for whitespace-only title', async () => {
        await loadTools();
        const result = server.call('todo_add_task', { title: '   ' }) as Record<string, unknown>;
        // validateCreateInput in applyAdd throws on blank titles
        expect(result).toHaveProperty('isError', true);
    });
});

// ─── todo_list_tasks — extended coverage paths ────────────────────────────────
describe('todo_list_tasks — extended coverage', () => {
    it('filters by tags', async () => {
        const t1 = ctx.taskRepo.create({ title: 'Tagged', priority: 'medium' });
        ctx.taskRepo.create({ title: 'Untagged', priority: 'medium' });
        ctx.tagRepo.addTaskTags(t1.id, ['backend']);
        await loadTools();

        const result = server.call('todo_list_tasks', { tags: ['backend'] }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe(t1.id);
    });

    it('filters by search term', async () => {
        ctx.taskRepo.create({ title: 'Refactor database', priority: 'high' });
        ctx.taskRepo.create({ title: 'Write docs', priority: 'low' });
        await loadTools();

        const result = server.call('todo_list_tasks', { search: 'database' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('Refactor database');
    });

    it('returns empty list when search term matches nothing', async () => {
        ctx.taskRepo.create({ title: 'Refactor database', priority: 'high' });
        ctx.taskRepo.create({ title: 'Write docs', priority: 'low' });
        await loadTools();

        const result = server.call('todo_list_tasks', { search: 'zzzznomatch' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(0);
    });

    it('finds a search match beyond the default 100-row cap', async () => {
        for (let i = 0; i < 120; i++) {
            ctx.taskRepo.create({ title: `Filler ${i}`, priority: 'low' });
        }
        ctx.taskRepo.create({ title: 'Pay invoice ACME', priority: 'low' });
        await loadTools();

        const result = server.call('todo_list_tasks', { search: 'invoice' }) as Record<string, unknown>;
        const content = (result.content as Array<{ text: string }>)[0];
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(content.text).toMatch(/Found 1 task/);
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('Pay invoice ACME');
    });

    it('caps search matches at an explicit limit while still searching all rows', async () => {
        for (let i = 0; i < 120; i++) {
            ctx.taskRepo.create({ title: `Filler ${i}`, priority: 'low' });
        }
        for (let i = 0; i < 5; i++) {
            ctx.taskRepo.create({ title: `Invoice batch ${i}`, priority: 'low' });
        }
        await loadTools();

        const result = server.call('todo_list_tasks', { search: 'invoice', limit: 2 }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(2);
    });

    it('non-search list still caps at the default 100 rows', async () => {
        for (let i = 0; i < 150; i++) {
            ctx.taskRepo.create({ title: `Task ${i}`, priority: 'low' });
        }
        await loadTools();

        const result = server.call('todo_list_tasks', {}) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(100);
    });

    it('filters by project name', async () => {
        const project = ctx.projectRepo.create({ name: 'Work' });
        ctx.taskRepo.create({ title: 'In project', projectId: project.id });
        ctx.taskRepo.create({ title: 'No project' });
        await loadTools();

        const result = server.call('todo_list_tasks', { projectName: 'Work' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('In project');
    });

    it('empty projectName filters to tasks without a project', async () => {
        const project = ctx.projectRepo.create({ name: 'Work' });
        ctx.taskRepo.create({ title: 'In project', projectId: project.id });
        ctx.taskRepo.create({ title: 'No project' });
        await loadTools();

        const result = server.call('todo_list_tasks', { projectName: '' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('No project');
    });

    it('respects sortField and sortDirection', async () => {
        ctx.taskRepo.create({ title: 'Alpha task', priority: 'low' });
        ctx.taskRepo.create({ title: 'Zeta task', priority: 'urgent' });
        await loadTools();

        const result = server.call('todo_list_tasks', { sortField: 'title', sortDirection: 'asc' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks.length).toBeGreaterThanOrEqual(2);
        const titles = tasks.map((t) => t.title as string);
        expect(titles[0]).toBe('Alpha task');
    });

    it('empty projectName combined with status filter returns only matching projectless tasks', async () => {
        const project = ctx.projectRepo.create({ name: 'Work' });
        const t1 = ctx.taskRepo.create({ title: 'No project todo' });
        const t2 = ctx.taskRepo.create({ title: 'No project done' });
        ctx.taskRepo.create({ title: 'In project todo', projectId: project.id });
        ctx.taskRepo.update(t2.id, { status: 'done', completedAt: new Date().toISOString() });
        await loadTools();

        const result = server.call('todo_list_tasks', { projectName: '', status: 'todo' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe(t1.id);
    });
});

// ─── todo_get_task — tagNames populated ───────────────────────────────────────
describe('todo_get_task — extended coverage', () => {
    it('includes populated tagNames on a task that has tags', async () => {
        const task = ctx.taskRepo.create({ title: 'Tagged get task', priority: 'medium' });
        ctx.tagRepo.addTaskTags(task.id, ['devops', 'infra']);
        await loadTools();

        const result = server.call('todo_get_task', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        const tagNames = structured.tagNames as string[];
        expect(tagNames).toEqual(expect.arrayContaining(['devops', 'infra']));
    });
});

// ─── todo_set_status — verb matching ─────────────────────────────────────────
describe('todo_set_status — verb matching', () => {
    it('accepts a verb that differs from the key (e.g. "start" → in_progress)', async () => {
        const task = ctx.taskRepo.create({ title: 'Verb test task', priority: 'medium' });
        await loadTools();

        // "start" is the verb for in_progress in the default status definitions
        const result = server.call('todo_set_status', { id: task.id, status: 'start' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(ctx.taskRepo.getById(task.id)?.status).toBe('in_progress');
    });
});

// ─── todo_set_status — hyphenated status normalization ───────────────────────
describe('todo_set_status — hyphenated status normalization', () => {
    it('accepts "in-progress" (hyphen) and transitions to in_progress', async () => {
        const task = ctx.taskRepo.create({ title: 'Hyphen status task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_set_status', { id: task.id, status: 'in-progress' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(ctx.taskRepo.getById(task.id)?.status).toBe('in_progress');
    });

    it('accepts "IN-PROGRESS" (all caps hyphen) and transitions to in_progress', async () => {
        const task = ctx.taskRepo.create({ title: 'Caps hyphen task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_set_status', { id: task.id, status: 'IN-PROGRESS' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(ctx.taskRepo.getById(task.id)?.status).toBe('in_progress');
    });

    it('returns isError for a completely unknown status (not just hyphen-variant)', async () => {
        const task = ctx.taskRepo.create({ title: 'Unknown status task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_set_status', { id: task.id, status: 'bogus-status' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/invalid status/i);
    });
});

// ─── todo_list_tasks — hyphenated status normalization ───────────────────────
describe('todo_list_tasks — hyphenated status normalization', () => {
    it('status:"in-progress" resolves and returns in_progress tasks', async () => {
        const t1 = ctx.taskRepo.create({ title: 'In progress task', priority: 'medium' });
        ctx.taskRepo.update(t1.id, { status: 'in_progress' });
        ctx.taskRepo.create({ title: 'Todo task', priority: 'low' });
        await loadTools();

        const result = server.call('todo_list_tasks', { status: 'in-progress' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;
        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe(t1.id);
    });

    it('status:"IN-PROGRESS" (all caps hyphen) resolves and returns exactly the in_progress task (no leakage)', async () => {
        const t1 = ctx.taskRepo.create({ title: 'Caps check task', priority: 'high' });
        ctx.taskRepo.update(t1.id, { status: 'in_progress' });
        // Create a todo task that must NOT appear in the result
        ctx.taskRepo.create({ title: 'Todo task', priority: 'low' });
        await loadTools();

        const result = server.call('todo_list_tasks', { status: 'IN-PROGRESS' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;
        // Exactly one result and it is the in_progress task — not the todo task
        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe(t1.id);
    });

    it('unknown status returns the err shape (not an empty list)', async () => {
        ctx.taskRepo.create({ title: 'Some task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_list_tasks', { status: 'completely-bogus' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/invalid status/i);
    });

    it('array of statuses including hyphen variant resolves correctly', async () => {
        const t1 = ctx.taskRepo.create({ title: 'In progress task', priority: 'medium' });
        ctx.taskRepo.update(t1.id, { status: 'in_progress' });
        const t2 = ctx.taskRepo.create({ title: 'Done task', priority: 'medium' });
        ctx.taskRepo.update(t2.id, { status: 'done', completedAt: new Date().toISOString() });
        await loadTools();

        // Pass an array with a hyphen-variant
        const result = server.call('todo_list_tasks', { status: ['in-progress', 'done'] }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;
        const ids = tasks.map((t) => t.id);
        expect(ids).toContain(t1.id);
        expect(ids).toContain(t2.id);
    });
});

// ─── FIX F: empty/degenerate tag name validation (MCP layer) ─────────────────
describe('todo_update_task — empty/degenerate tag rejection', () => {
    it('returns isError and creates no blank tag for tags:[""]', async () => {
        const task = ctx.taskRepo.create({ title: 'Tag reject empty', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, tags: [''] }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(ctx.tagRepo.list()).toHaveLength(0);
    });

    it('returns isError and creates no blank tag for tags:["+"]', async () => {
        const task = ctx.taskRepo.create({ title: 'Tag reject plus', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, tags: ['+'] }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(ctx.tagRepo.list()).toHaveLength(0);
    });

    it('succeeds as a no-op for tags:["-"] (remove of empty name is harmless)', async () => {
        // "-" strips to "" in removeTags path; removeTaskTags uses a lookup-DELETE, so it
        // never calls getOrCreate and never inserts anything — the result is success + no tags.
        const task = ctx.taskRepo.create({ title: 'Tag minus noop', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, tags: ['-'] }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(ctx.tagRepo.list()).toHaveLength(0);
    });

    it('returns isError and creates no blank tag for tags:["  "] (whitespace)', async () => {
        const task = ctx.taskRepo.create({ title: 'Tag reject space', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, tags: ['  '] }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(ctx.tagRepo.list()).toHaveLength(0);
    });

    it('rejects the whole batch when any tag is empty — no partial junk', async () => {
        const task = ctx.taskRepo.create({ title: 'Tag partial reject', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, tags: ['backend', ''] }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        // Transaction rolled back — backend must not have been stored
        expect(ctx.tagRepo.getTaskTags(task.id)).toHaveLength(0);
    });
});

describe('todo_add_task — empty tag rejection', () => {
    it('returns isError and creates no blank tag for tags:[""]', async () => {
        await loadTools();

        const result = server.call('todo_add_task', { title: 'New task', tags: [''] }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(ctx.tagRepo.list()).toHaveLength(0);
    });
});

// ─── create with terminal status — completedAt in structuredContent ───────────
// The MCP tool doesn't expose status as input to todo_add_task, but when a task is
// created via the repo with a terminal status (e.g. from Jira import or the CLI
// add --status done path), todo_get_task must surface the completedAt field.
describe('todo_get_task — completedAt present when task was created with done status', () => {
    it('structuredContent.completedAt is non-null for a task created with status:done', async () => {
        // Simulate Jira import or CLI add --status done via repo (the fix point)
        const task = ctx.taskRepo.create({ title: 'Pre-done task', status: 'done' });
        await loadTools();

        const result = server.call('todo_get_task', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        // completedAt must be set — would fail if task.repo.create() did not stamp it
        expect(structured.completedAt).not.toBeNull();
        expect(structured.completedAt).toBeDefined();
    });

    it('structuredContent.completedAt is null for a task created with status:todo', async () => {
        const task = ctx.taskRepo.create({ title: 'Not done yet', status: 'todo' });
        await loadTools();

        const result = server.call('todo_get_task', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        expect(structured.completedAt).toBeNull();
    });
});

// ─── FIX G: zod schema boundary tests (real McpServer + Client) ──────────────
// Drive the actual validateToolInput → safeParseAsync path so schema regressions
// (e.g. dropping .int().positive() on id) are caught immediately.
// The SDK converts McpError validation failures into isError:true responses
// (it does NOT reject the callTool promise), so we assert on the resolved value.
describe('zod schema boundary — real McpServer validation', () => {
    async function buildRealServer() {
        const { buildMcpServer } = await import('../../../src/mcp/server.js');
        const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
        const mcpServer = buildMcpServer({ allowDelete: false });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await mcpServer.connect(serverTransport);
        const client = new Client({ name: 'test-client', version: '0.0.1' });
        await client.connect(clientTransport);
        return { client };
    }

    // Helper: assert the resolved result signals a validation error
    function assertSchemaError(result: Record<string, unknown>, pattern?: RegExp) {
        expect(result).toHaveProperty('isError', true);
        const text = (result.content as Array<{ text: string }>)[0].text;
        expect(text).toMatch(/Input validation error/i);
        if (pattern) expect(text).toMatch(pattern);
    }

    it('rejects id:-1 on todo_get_task (must be positive integer)', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_get_task', arguments: { id: -1 } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects id:0 on todo_get_task (must be positive integer)', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_get_task', arguments: { id: 0 } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects id:1.5 on todo_get_task (must be integer)', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_get_task', arguments: { id: 1.5 } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects id:"1" (string) on todo_get_task (must be number)', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_get_task', arguments: { id: '1' } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects id:-1 on todo_update_task', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_update_task', arguments: { id: -1, title: 'x' } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects id:0 on todo_set_status', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_set_status', arguments: { id: 0, status: 'done' } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects title:"" on todo_update_task at schema level (.min(1))', async () => {
        const task = ctx.taskRepo.create({ title: 'Schema test', priority: 'medium' });
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_update_task', arguments: { id: task.id, title: '' } }) as Record<string, unknown>;
        assertSchemaError(result, /title/i);
    });

    it('rejects title:"   " on todo_update_task at schema level (.trim().min(1))', async () => {
        const task = ctx.taskRepo.create({ title: 'Schema trim test', priority: 'medium' });
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_update_task', arguments: { id: task.id, title: '   ' } }) as Record<string, unknown>;
        assertSchemaError(result, /title/i);
    });

    it('rejects priority:"critical" on todo_add_task (not in enum)', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_add_task', arguments: { title: 'Enum test', priority: 'critical' } }) as Record<string, unknown>;
        assertSchemaError(result, /priority/i);
    });

    it('rejects priority:"critical" on todo_update_task (not in enum)', async () => {
        const task = ctx.taskRepo.create({ title: 'Enum update test', priority: 'medium' });
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_update_task', arguments: { id: task.id, priority: 'critical' } }) as Record<string, unknown>;
        assertSchemaError(result, /priority/i);
    });
});

// ─── coverage completion: handler catch blocks + remaining filter/arg branches ──
// The only intentionally-uncovered branch in tasks.ts is the `?? undefined` on the
// add-task priority (line 54): zod's prioritySchema enum rejects non-priority values
// before the handler, so normalizePriority can never return null there.
describe('todo_list_tasks — error path and remaining filter branches', () => {
    it('returns isError when the repo throws (catch block)', async () => {
        ctx.taskRepo.create({ title: 'Pre', priority: 'low' });
        await loadTools();
        vi.spyOn(ctx.taskRepo, 'list').mockImplementation(() => { throw new Error('db boom'); });

        const result = server.call('todo_list_tasks', {}) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect((result.content as Array<{ text: string }>)[0].text).toMatch(/db boom/);
    });

    it('filters by projectName', async () => {
        const proj = ctx.projectRepo.getOrCreate('Backend');
        const t1 = ctx.taskRepo.create({ title: 'In project', priority: 'medium', projectId: proj.id });
        ctx.taskRepo.create({ title: 'No project', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_list_tasks', { projectName: 'Backend' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe(t1.id);
    });

    it('filters by dueDate keyword "overdue"', async () => {
        ctx.taskRepo.create({ title: 'Overdue task', priority: 'medium', dueDate: '2000-01-01' });
        ctx.taskRepo.create({ title: 'No due', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_list_tasks', { dueDate: 'overdue' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('Overdue task');
    });

    it('filters by dueBefore', async () => {
        ctx.taskRepo.create({ title: 'Early', priority: 'medium', dueDate: '2026-01-01' });
        ctx.taskRepo.create({ title: 'Late', priority: 'medium', dueDate: '2027-12-31' });
        await loadTools();

        const result = server.call('todo_list_tasks', { dueBefore: '2026-06-01' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks.map((t) => t.title)).toEqual(['Early']);
    });

    it('filters by dueAfter', async () => {
        ctx.taskRepo.create({ title: 'Early', priority: 'medium', dueDate: '2026-01-01' });
        ctx.taskRepo.create({ title: 'Late', priority: 'medium', dueDate: '2027-12-31' });
        await loadTools();

        const result = server.call('todo_list_tasks', { dueAfter: '2027-01-01' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks.map((t) => t.title)).toEqual(['Late']);
    });

    it('defaults sortDirection to asc when only sortField is given', async () => {
        ctx.taskRepo.create({ title: 'Bravo', priority: 'low' });
        ctx.taskRepo.create({ title: 'Alpha', priority: 'low' });
        await loadTools();

        const result = server.call('todo_list_tasks', { sortField: 'title' }) as Record<string, unknown>;
        const tasks = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(tasks[0].title).toBe('Alpha');
    });
});

describe('todo_get_task — error path', () => {
    it('returns isError when the repo throws (catch block)', async () => {
        const task = ctx.taskRepo.create({ title: 'Boom', priority: 'low' });
        await loadTools();
        vi.spyOn(ctx.taskRepo, 'getByIdWithRelations').mockImplementation(() => { throw new Error('get boom'); });

        const result = server.call('todo_get_task', { id: task.id }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect((result.content as Array<{ text: string }>)[0].text).toMatch(/get boom/);
    });
});

describe('todo_update_task — remaining arg branches', () => {
    it('updates description', async () => {
        const task = ctx.taskRepo.create({ title: 'Desc task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, description: 'New description' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(ctx.taskRepo.getById(task.id)?.description).toBe('New description');
    });

    it('updates recurrence', async () => {
        const task = ctx.taskRepo.create({ title: 'Recur update', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, recurrence: 'monthly' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(ctx.taskRepo.getById(task.id)?.recurrence).toBe('monthly');
    });

    it('moves the task to a project when projectName has a value', async () => {
        const task = ctx.taskRepo.create({ title: 'Move me', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_update_task', { id: task.id, projectName: 'NewProj' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const proj = ctx.projectRepo.getByName('NewProj');
        expect(proj).not.toBeNull();
        expect(ctx.taskRepo.getById(task.id)?.projectId).toBe(proj!.id);
    });
});

// ─── subtask / parentId coverage ─────────────────────────────────────────────
describe('todo_add_task — parentId', () => {
    it('creates a subtask when a valid parentId is supplied', async () => {
        const parent = ctx.taskRepo.create({ title: 'Parent', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_add_task', { title: 'Child', parentId: parent.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        const childId = structured.id as number;
        expect(ctx.taskRepo.getById(childId)?.parentId).toBe(parent.id);
    });

    it('returns isError when parentId refers to a non-existent task', async () => {
        await loadTools();
        const result = server.call('todo_add_task', { title: 'Orphan', parentId: 99999 }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/not found/i);
    });
});

describe('todo_update_task — parentId', () => {
    it('detaches a child (parentId:0 → parent=false)', async () => {
        const parent = ctx.taskRepo.create({ title: 'Parent', priority: 'medium' });
        const child = ctx.taskRepo.create({ title: 'Child', priority: 'low', parentId: parent.id });
        await loadTools();

        const result = server.call('todo_update_task', { id: child.id, parentId: 0 }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(ctx.taskRepo.getById(child.id)?.parentId).toBeNull();
    });

    it('re-parents with a valid positive parentId', async () => {
        const p1 = ctx.taskRepo.create({ title: 'Parent1', priority: 'medium' });
        const p2 = ctx.taskRepo.create({ title: 'Parent2', priority: 'medium' });
        const child = ctx.taskRepo.create({ title: 'Child', priority: 'low', parentId: p1.id });
        await loadTools();

        const result = server.call('todo_update_task', { id: child.id, parentId: p2.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(ctx.taskRepo.getById(child.id)?.parentId).toBe(p2.id);
    });

    it('returns isError when parentId would create a cycle', async () => {
        const a = ctx.taskRepo.create({ title: 'A', priority: 'medium' });
        const b = ctx.taskRepo.create({ title: 'B', priority: 'medium', parentId: a.id });
        await loadTools();

        // Making A a child of B creates cycle A → B → A
        const result = server.call('todo_update_task', { id: a.id, parentId: b.id }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/cycle/i);
    });

    it('rejects a 3-level cycle via MCP: making the root a grandchild of its own grandchild', async () => {
        // Chain: A → B → C  (A is grandparent, C is grandchild)
        const a = ctx.taskRepo.create({ title: 'A', priority: 'medium' });
        const b = ctx.taskRepo.create({ title: 'B', priority: 'medium', parentId: a.id });
        const c = ctx.taskRepo.create({ title: 'C', priority: 'medium', parentId: b.id });
        await loadTools();

        // Making A a child of C creates cycle A → B → C → A
        const result = server.call('todo_update_task', { id: a.id, parentId: c.id }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const content = (result.content as Array<{ text: string }>)[0];
        expect(content.text).toMatch(/cycle/i);
    });

    it('allows a valid re-parent that does not form a 3-level cycle', async () => {
        // Chain: A → B → C; moving C under a new unrelated root D is safe
        const a = ctx.taskRepo.create({ title: 'A', priority: 'medium' });
        const b = ctx.taskRepo.create({ title: 'B', priority: 'medium', parentId: a.id });
        const c = ctx.taskRepo.create({ title: 'C', priority: 'medium', parentId: b.id });
        const d = ctx.taskRepo.create({ title: 'D', priority: 'low' });
        await loadTools();

        const result = server.call('todo_update_task', { id: c.id, parentId: d.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(ctx.taskRepo.getById(c.id)?.parentId).toBe(d.id);
    });
});

describe('todo_get_task — children and progress fields', () => {
    it('returns children array and progress when parent has subtasks', async () => {
        const parent = ctx.taskRepo.create({ title: 'Parent', priority: 'medium' });
        ctx.taskRepo.create({ title: 'Child1', priority: 'low', parentId: parent.id });
        ctx.taskRepo.create({ title: 'Child2', priority: 'low', parentId: parent.id });
        await loadTools();

        const result = server.call('todo_get_task', { id: parent.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const structured = result.structuredContent as Record<string, unknown>;
        expect(Array.isArray(structured.children)).toBe(true);
        expect((structured.children as unknown[]).length).toBe(2);
        const progress = structured.progress as { done: number; total: number };
        expect(progress.total).toBe(2);
        expect(progress.done).toBe(0);
    });

    it('progress.done increments when a child is marked done', async () => {
        const parent = ctx.taskRepo.create({ title: 'Parent', priority: 'medium' });
        const c1 = ctx.taskRepo.create({ title: 'C1', priority: 'low', parentId: parent.id });
        ctx.taskRepo.create({ title: 'C2', priority: 'low', parentId: parent.id });
        ctx.taskRepo.update(c1.id, { status: 'done' });
        await loadTools();

        const result = server.call('todo_get_task', { id: parent.id }) as Record<string, unknown>;

        const progress = (result.structuredContent as Record<string, unknown>).progress as { done: number; total: number };
        expect(progress).toEqual({ done: 1, total: 2 });
    });
});

// ─── MCP recurring-completion wiring (todo_set_status on a recurring task) ─────
describe('todo_set_status — recurring completion', () => {
    it('creates the next occurrence when a recurring task is completed', async () => {
        await loadTools();
        const add = server.call('todo_add_task', { title: 'Weekly standup', recurrence: 'weekly', tags: ['team'] }) as Record<string, unknown>;
        const id = (add.structuredContent as Record<string, unknown>).id as number;

        const result = server.call('todo_set_status', { id, status: 'done' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const sameTitle = ctx.taskRepo.list({ includeArchived: true }).filter((t) => t.title === 'Weekly standup');
        expect(sameTitle).toHaveLength(2);
        expect(sameTitle.some((t) => t.status === 'done')).toBe(true);
        expect(sameTitle.some((t) => t.status === 'todo' && t.recurrence === 'weekly')).toBe(true);
    });

    it('regenerated occurrence of a recurring child stays under the same parent', async () => {
        const parent = ctx.taskRepo.create({ title: 'Epic', priority: 'medium' });
        await loadTools();
        const add = server.call('todo_add_task', { title: 'Weekly report', recurrence: 'weekly', parentId: parent.id }) as Record<string, unknown>;
        const id = (add.structuredContent as Record<string, unknown>).id as number;

        server.call('todo_set_status', { id, status: 'done' });

        const all = ctx.taskRepo.list({ includeArchived: true }).filter((t) => t.title === 'Weekly report');
        expect(all).toHaveLength(2);
        // Both the completed and the new occurrence must have the same parentId
        expect(all.every((t) => t.parentId === parent.id)).toBe(true);
    });

    // regression: re-issuing todo_set_status on an already-done recurring task (retry, duplicate call)
    // must not spawn another next-occurrence copy.
    it('does not spawn a duplicate occurrence when todo_set_status is re-issued on an already-done task', async () => {
        await loadTools();
        const add = server.call('todo_add_task', { title: 'Daily sync', recurrence: 'daily' }) as Record<string, unknown>;
        const id = (add.structuredContent as Record<string, unknown>).id as number;

        const first = server.call('todo_set_status', { id, status: 'done' }) as Record<string, unknown>;
        expect(first).not.toHaveProperty('isError');
        const afterFirst = ctx.taskRepo.list({ includeArchived: true }).filter((t) => t.title === 'Daily sync');
        expect(afterFirst).toHaveLength(2);

        const second = server.call('todo_set_status', { id, status: 'done' }) as Record<string, unknown>;
        expect(second).not.toHaveProperty('isError');
        const afterSecond = ctx.taskRepo.list({ includeArchived: true }).filter((t) => t.title === 'Daily sync');
        expect(afterSecond).toHaveLength(2);
    });
});

// ─── handler catches surface a non-Error throw via String(e) (defensive arm) ───
describe('handler catches stringify a non-Error throw', () => {
    it('todo_list_tasks', async () => {
        await loadTools();
        vi.spyOn(ctx.taskRepo, 'list').mockImplementation(() => { throw 'raw-list'; });
        const r = server.call('todo_list_tasks', {}) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect((r.content as Array<{ text: string }>)[0].text).toMatch(/raw-list/);
    });

    it('todo_get_task', async () => {
        const t = ctx.taskRepo.create({ title: 'g', priority: 'low' });
        await loadTools();
        vi.spyOn(ctx.taskRepo, 'getByIdWithRelations').mockImplementation(() => { throw 'raw-get'; });
        const r = server.call('todo_get_task', { id: t.id }) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect((r.content as Array<{ text: string }>)[0].text).toMatch(/raw-get/);
    });

    it('todo_add_task', async () => {
        await loadTools();
        vi.spyOn(ctx.taskRepo, 'create').mockImplementation(() => { throw 'raw-add'; });
        const r = server.call('todo_add_task', { title: 'x' }) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect((r.content as Array<{ text: string }>)[0].text).toMatch(/raw-add/);
    });

    it('todo_update_task', async () => {
        const t = ctx.taskRepo.create({ title: 'u', priority: 'low' });
        await loadTools();
        vi.spyOn(ctx.taskRepo, 'update').mockImplementation(() => { throw 'raw-update'; });
        const r = server.call('todo_update_task', { id: t.id, title: 'New' }) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect((r.content as Array<{ text: string }>)[0].text).toMatch(/raw-update/);
    });

    it('todo_set_status', async () => {
        const t = ctx.taskRepo.create({ title: 's', priority: 'low' });
        await loadTools();
        vi.spyOn(ctx.taskRepo, 'update').mockImplementation(() => { throw 'raw-status'; });
        const r = server.call('todo_set_status', { id: t.id, status: 'done' }) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect((r.content as Array<{ text: string }>)[0].text).toMatch(/raw-status/);
    });

    it('todo_delete_task', async () => {
        const t = ctx.taskRepo.create({ title: 'd', priority: 'low' });
        await loadTools(false);
        vi.spyOn(ctx.taskRepo, 'archive').mockImplementation(() => { throw 'raw-delete'; });
        const r = server.call('todo_delete_task', { id: t.id }) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect((r.content as Array<{ text: string }>)[0].text).toMatch(/raw-delete/);
    });
});
