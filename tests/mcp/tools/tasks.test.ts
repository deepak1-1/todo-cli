// Integration tests for all 6 MCP task tools.
// Strategy: mock getContext() (singleton) to inject an in-memory test DB,
// then call registerTaskTools directly on a minimal McpServer stub so we
// can invoke handler functions without a real stdio transport.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../../src/storage/database.js';
import { runMigrations } from '../../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../../src/storage/repositories/project.repo.js';
import { TagRepository } from '../../../src/storage/repositories/tag.repo.js';
import { ActionLogRepository } from '../../../src/storage/repositories/action-log.repo.js';
import { DependencyRepository } from '../../../src/storage/repositories/dependency.repo.js';
import { TrackingRepository } from '../../../src/storage/repositories/tracking.repo.js';
import { StatusRepository } from '../../../src/storage/repositories/status.repo.js';
import type { AppContext } from '../../../src/commands/context.js';

// Mock hook manager to prevent async side-effects during tests
vi.mock('../../../src/plugins/hook-manager.js', () => ({
    getHookManager: () => ({
        onTaskCreate: vi.fn().mockResolvedValue(undefined),
        onTaskUpdate: vi.fn().mockResolvedValue(undefined),
        onTaskComplete: vi.fn().mockResolvedValue(undefined),
        onTaskDelete: vi.fn().mockResolvedValue(undefined),
    }),
}));

let db: Database.Database;
let ctx: AppContext;

function buildCtx(database: Database.Database): AppContext {
    return {
        taskRepo: new TaskRepository(database),
        projectRepo: new ProjectRepository(database),
        tagRepo: new TagRepository(database),
        actionLog: new ActionLogRepository(database),
        depRepo: new DependencyRepository(database),
        trackingRepo: new TrackingRepository(database),
        statusRepo: new StatusRepository(database),
    };
}

// Wire ctx into getContext so MCP tool handlers use the test DB
vi.mock('../../../src/commands/context.js', () => ({
    getContext: () => ctx,
}));

// Minimal McpServer stub: captures registered handlers by tool name
// so tests can invoke them directly without a real MCP transport.
type HandlerFn = (args: Record<string, unknown>) => unknown;

function buildStubServer() {
    const handlers: Record<string, HandlerFn> = {};
    return {
        registerTool(name: string, _meta: unknown, handler: HandlerFn) {
            handlers[name] = handler;
        },
        call(name: string, args: Record<string, unknown>) {
            const fn = handlers[name];
            if (!fn) throw new Error(`Tool "${name}" not registered`);
            return fn(args);
        },
    };
}

type StubServer = ReturnType<typeof buildStubServer>;

let server: StubServer;

beforeEach(() => {
    vi.resetModules();
    db = createTestDb();
    runMigrations(db);
    ctx = buildCtx(db);
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
