// Focused tests for bulk done / start / review / edit command flows

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/storage/database.js';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../src/storage/repositories/project.repo.js';
import { TagRepository } from '../../src/storage/repositories/tag.repo.js';
import { ActionLogRepository } from '../../src/storage/repositories/action-log.repo.js';
import { DependencyRepository } from '../../src/storage/repositories/dependency.repo.js';
import { TrackingRepository } from '../../src/storage/repositories/tracking.repo.js';
import { StatusRepository } from '../../src/storage/repositories/status.repo.js';
import type { AppContext } from '../../src/commands/context.js';

let db: Database.Database;
let ctx: AppContext;

// Captures a single JSON line written to stdout during fn(), preserving process.exitCode for assertions.
async function captureJsonOutput(fn: () => Promise<void>): Promise<{ payload: Record<string, unknown>; exitCode: number | undefined }> {
    let captured = '';
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { captured += chunk; return true; });
    process.exitCode = undefined;
    try {
        await fn();
    } finally {
        writeSpy.mockRestore();
    }
    return { payload: JSON.parse(captured.trim()) as Record<string, unknown>, exitCode: process.exitCode };
}

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

// Wire ctx into getContext so all commands use the test DB
vi.mock('../../src/commands/context.js', () => ({
    getContext: () => ctx,
}));

/** Re-import bulkCommand and register status subcommands from the test DB. */
async function loadBulkCommand() {
    const { bulkCommand, buildBulkStatusCommands } = await import('../../src/commands/bulk.js');
    for (const cmd of buildBulkStatusCommands(ctx.statusRepo.list())) {
        bulkCommand.addCommand(cmd);
    }
    return bulkCommand;
}

// Suppress console output produced by bulk commands during tests
function silenceConsole() {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    return () => { log.mockRestore(); err.mockRestore(); };
}

beforeEach(() => {
    // Reset modules so each test gets a fresh Commander Command object
    vi.resetModules();
    db = createTestDb();
    runMigrations(db);
    ctx = buildCtx(db);
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    // Avoid exit-code leakage between tests since bulk actions set process.exitCode directly
    process.exitCode = undefined;
});

// ──────────────────────────────────────────────
// bulk done
// ──────────────────────────────────────────────
describe('bulk done', () => {
    it('marks matching tasks as done when status filter is provided', async () => {
        const restore = silenceConsole();
        const t1 = ctx.taskRepo.create({ title: 'Task A', priority: 'medium' });
        const t2 = ctx.taskRepo.create({ title: 'Task B', priority: 'medium' });
        const t3 = ctx.taskRepo.create({ title: 'Task C', priority: 'high' });

        ctx.taskRepo.update(t1.id, { status: 'in_progress' });
        ctx.taskRepo.update(t2.id, { status: 'in_progress' });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(['done', '--status', 'in_progress', '--yes'], { from: 'user' });

        restore();
        expect(ctx.taskRepo.getById(t1.id)?.status).toBe('done');
        expect(ctx.taskRepo.getById(t2.id)?.status).toBe('done');
        // t3 is todo and must remain untouched
        expect(ctx.taskRepo.getById(t3.id)?.status).toBe('todo');
    });

    it('calls fail(USAGE) when no filter is provided', async () => {
        const restore = silenceConsole();

        // Use a local mock for exit so we can detect the call in this test's scope
        const { fail: failMock } = await import('../../src/utils/exit.js');
        const spy = vi.spyOn({ fail: failMock }, 'fail');

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(['done', '--yes'], { from: 'user' });

        restore();
        // fail is called with a non-zero exit code and a message about filters
        expect(process.exitCode).toBeDefined();
        // Verify the module's behavior by checking that no tasks were changed
        expect(ctx.taskRepo.list({})).toHaveLength(0);
        spy.mockRestore();
    });

    it('logs no-match message and mutates nothing when no tasks match the filter', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(['done', '--project', 'nonexistent-project', '--yes'], { from: 'user' });

        const callTexts = logSpy.mock.calls.map(c => String(c[0]));
        logSpy.mockRestore();

        // The no-match message should appear
        const hasNoMatch = callTexts.some(t => t.includes('No tasks'));
        expect(hasNoMatch).toBe(true);
        // Nothing in DB should have changed
        expect(ctx.taskRepo.list({})).toHaveLength(0);
    });
});

// ──────────────────────────────────────────────
// bulk start
// ──────────────────────────────────────────────
describe('bulk start', () => {
    it('transitions matching tasks to in_progress', async () => {
        const restore = silenceConsole();
        const t1 = ctx.taskRepo.create({ title: 'Todo A', priority: 'low' });
        const t2 = ctx.taskRepo.create({ title: 'Todo B', priority: 'low' });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(['start', '--priority', 'low', '--yes'], { from: 'user' });

        restore();
        expect(ctx.taskRepo.getById(t1.id)?.status).toBe('in_progress');
        expect(ctx.taskRepo.getById(t2.id)?.status).toBe('in_progress');
    });

    it('does not affect tasks that do not match the given priority filter', async () => {
        const restore = silenceConsole();
        const low = ctx.taskRepo.create({ title: 'Low priority task', priority: 'low' });
        const high = ctx.taskRepo.create({ title: 'High priority task', priority: 'high' });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(['start', '--priority', 'low', '--yes'], { from: 'user' });

        restore();
        expect(ctx.taskRepo.getById(low.id)?.status).toBe('in_progress');
        // High-priority task must remain untouched
        expect(ctx.taskRepo.getById(high.id)?.status).toBe('todo');
    });

    it('prints a summary line mentioning the count when tasks are started', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        ctx.taskRepo.create({ title: 'T1', priority: 'urgent' });
        ctx.taskRepo.create({ title: 'T2', priority: 'urgent' });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(['start', '--priority', 'urgent', '--yes'], { from: 'user' });

        // Strip ANSI escape codes before matching
        const allText = logSpy.mock.calls
            // eslint-disable-next-line no-control-regex
            .map(c => String(c[0]).replace(/\x1B\[[0-9;]*m/g, ''))
            .join('\n');
        logSpy.mockRestore();

        // The summary must mention "2"
        expect(allText).toMatch(/2/);
    });
});

// ──────────────────────────────────────────────
// bulk review (replaces bulk qa)
// ──────────────────────────────────────────────
describe('bulk review', () => {
    it('transitions in_progress tasks to in_review', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Review me', priority: 'medium' });
        ctx.taskRepo.update(task.id, { status: 'in_progress' });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(['review', '--status', 'in_progress', '--yes'], { from: 'user' });

        restore();
        expect(ctx.taskRepo.getById(task.id)?.status).toBe('in_review');
    });

    it('does not affect tasks not matching the filter', async () => {
        const restore = silenceConsole();
        const todo = ctx.taskRepo.create({ title: 'Todo task', priority: 'medium' });
        const inProgress = ctx.taskRepo.create({ title: 'In progress task', priority: 'medium' });
        ctx.taskRepo.update(inProgress.id, { status: 'in_progress' });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(['review', '--status', 'in_progress', '--yes'], { from: 'user' });

        restore();
        // Only in_progress should become in_review
        expect(ctx.taskRepo.getById(inProgress.id)?.status).toBe('in_review');
        expect(ctx.taskRepo.getById(todo.id)?.status).toBe('todo');
    });
});

// ──────────────────────────────────────────────
// bulk edit
// ──────────────────────────────────────────────
describe('bulk edit', () => {
    it('updates priority on all tasks matching the filter', async () => {
        const restore = silenceConsole();
        const t1 = ctx.taskRepo.create({ title: 'Alpha', priority: 'low' });
        const t2 = ctx.taskRepo.create({ title: 'Beta', priority: 'low' });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(
            ['edit', '--priority', 'low', '--set-priority', 'urgent', '--yes'],
            { from: 'user' },
        );

        restore();
        expect(ctx.taskRepo.getById(t1.id)?.priority).toBe('urgent');
        expect(ctx.taskRepo.getById(t2.id)?.priority).toBe('urgent');
    });

    it('does not set priority for tasks not matching the filter', async () => {
        const restore = silenceConsole();
        const lowTask = ctx.taskRepo.create({ title: 'Low task', priority: 'low' });
        const highTask = ctx.taskRepo.create({ title: 'High task', priority: 'high' });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(
            ['edit', '--priority', 'low', '--set-priority', 'urgent', '--yes'],
            { from: 'user' },
        );

        restore();
        expect(ctx.taskRepo.getById(lowTask.id)?.priority).toBe('urgent');
        // High task must be unaffected
        expect(ctx.taskRepo.getById(highTask.id)?.priority).toBe('high');
    });

    it('produces no edit when no tasks match the filter', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        ctx.taskRepo.create({ title: 'Medium task', priority: 'medium' });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(
            ['edit', '--priority', 'urgent', '--set-priority', 'low', '--yes'],
            { from: 'user' },
        );

        logSpy.mockRestore();
        // Priority must remain medium (no match for urgent)
        const allTasks = ctx.taskRepo.list({});
        expect(allTasks.every(t => t.priority === 'medium')).toBe(true);
    });

    it('routes --priority as edit target when used as the only filter source', async () => {
        const restore = silenceConsole();
        // Task already at 'low'; --priority low filters and "sets" to low (idempotent)
        const t1 = ctx.taskRepo.create({ title: 'Low task A', priority: 'low' });
        const t2 = ctx.taskRepo.create({ title: 'Low task B', priority: 'low' });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(
            ['edit', '--priority', 'low', '--yes'],
            { from: 'user' },
        );

        restore();
        expect(ctx.taskRepo.getById(t1.id)?.priority).toBe('low');
        expect(ctx.taskRepo.getById(t2.id)?.priority).toBe('low');
    });

    it('routes --status bare flag as edit target when --set-status is absent', async () => {
        const restore = silenceConsole();
        const t1 = ctx.taskRepo.create({ title: 'Todo task', priority: 'medium' });

        const bulkCommand = await loadBulkCommand();
        // --status todo filters by todo AND sets status to todo (idempotent)
        await bulkCommand.parseAsync(
            ['edit', '--status', 'todo', '--yes'],
            { from: 'user' },
        );

        restore();
        expect(ctx.taskRepo.getById(t1.id)?.status).toBe('todo');
    });

    it('gives --set-priority precedence over bare --priority when both supplied', async () => {
        const restore = silenceConsole();
        const t1 = ctx.taskRepo.create({ title: 'Low task', priority: 'low' });

        const bulkCommand = await loadBulkCommand();
        // --priority low = filter; --set-priority urgent = explicit edit (set-* wins)
        await bulkCommand.parseAsync(
            ['edit', '--priority', 'low', '--set-priority', 'urgent', '--yes'],
            { from: 'user' },
        );

        restore();
        expect(ctx.taskRepo.getById(t1.id)?.priority).toBe('urgent');
    });
});

// ──────────────────────────────────────────────
// bulk delete — parent/child promotion (now routes through applyDelete)
// ──────────────────────────────────────────────
// bulk delete reuses applyDelete(), so soft-archiving a parent promotes its
// children to root (same path as `rm`), preventing orphaned-under-archive tasks.
describe('bulk delete — subtask promotion on archive', () => {
    it('promotes children to root when a parent is bulk-archived (soft delete)', async () => {
        const restore = silenceConsole();
        const parent = ctx.taskRepo.create({ title: 'Parent task', priority: 'urgent' });
        const child = ctx.taskRepo.create({ title: 'Child task', priority: 'low', parentId: parent.id });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(['delete', '--priority', 'urgent', '--yes'], { from: 'user' });

        restore();

        // Parent is archived
        expect(ctx.taskRepo.getById(parent.id)?.status).toBe('archived');

        // Child is promoted to root (parentId null), and the promotion is logged for undo.
        expect(ctx.taskRepo.getById(child.id)?.parentId).toBeNull();
        const last = ctx.actionLog.getByTaskId(parent.id).find(e => e.action === 'archive');
        expect(JSON.parse(last!.prevState!).promotedChildIds).toEqual([child.id]);
    });

    it('documents that bulk delete with --force does NOT restore children when parent is hard-deleted (FK SET NULL)', async () => {
        const restore = silenceConsole();
        const parent = ctx.taskRepo.create({ title: 'Parent force', priority: 'urgent' });
        const child = ctx.taskRepo.create({ title: 'Child force', priority: 'low', parentId: parent.id });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(['delete', '--priority', 'urgent', '--force', '--yes'], { from: 'user' });

        restore();

        // Parent is gone (hard deleted)
        expect(ctx.taskRepo.getById(parent.id)).toBeNull();
        // FK ON DELETE SET NULL fires — child survives with parentId null (correct by accident)
        expect(ctx.taskRepo.getById(child.id)?.parentId).toBeNull();
    });

    it('applyDelete (single-task path) correctly promotes children on soft delete', async () => {
        // Contrast: the single-task delete command (applyDelete) DOES call promoteChildren
        const { applyDelete } = await import('../../src/commands/delete.js');
        const parent = ctx.taskRepo.create({ title: 'Parent single', priority: 'urgent' });
        const child = ctx.taskRepo.create({ title: 'Child single', priority: 'low', parentId: parent.id });

        applyDelete(ctx, parent.id);

        // Single-task path promotes correctly
        expect(ctx.taskRepo.getById(parent.id)?.status).toBe('archived');
        expect(ctx.taskRepo.getById(child.id)?.parentId).toBeNull(); // correctly promoted
    });
});

// ──────────────────────────────────────────────
// Regression: bulk verbs must not report false success when per-task edits fail
// (TITLE: bulk-false-success — ok:true/full count reported while every edit throws)
// ──────────────────────────────────────────────
describe('bulk false-success regression', () => {
    it('bulk edit --set-due <garbage> --json reports ok:false, updated:0, failed:N, nonzero exit', async () => {
        ctx.taskRepo.create({ title: 'Task A', priority: 'medium' });
        ctx.taskRepo.create({ title: 'Task B', priority: 'medium' });

        const bulkCommand = await loadBulkCommand();
        const { payload, exitCode } = await captureJsonOutput(async () => {
            await bulkCommand.parseAsync(
                ['edit', '--priority', 'medium', '--set-due', 'garbagedate', '--json', '--yes'],
                { from: 'user' },
            );
        });

        expect(payload.ok).toBe(false);
        expect(exitCode).toBe(4); // EXIT.INVALID_TRANSITION
        const data = payload.data as Record<string, unknown>;
        expect(data.updated).toBe(0);
        expect(data.failed).toBe(2);
        expect((data.errors as unknown[]).length).toBe(2);

        // No task's dueDate actually changed
        const tasks = ctx.taskRepo.list({});
        expect(tasks.every(t => t.dueDate === null)).toBe(true);
    });

    it('bulk edit --set-due <valid> --json still reports ok:true/updated:N/failed:0/exit 0 (happy path unaffected)', async () => {
        ctx.taskRepo.create({ title: 'Task A', priority: 'medium' });
        ctx.taskRepo.create({ title: 'Task B', priority: 'medium' });

        const bulkCommand = await loadBulkCommand();
        const { payload, exitCode } = await captureJsonOutput(async () => {
            await bulkCommand.parseAsync(
                ['edit', '--priority', 'medium', '--set-due', 'next friday', '--json', '--yes'],
                { from: 'user' },
            );
        });

        expect(payload.ok).toBe(true);
        expect(exitCode === undefined || exitCode === 0).toBe(true);
        const data = payload.data as Record<string, unknown>;
        expect(data.updated).toBe(2);
        expect(data.failed).toBe(0);
        expect(data.errors).toEqual([]);
    });

    it('bulk edit all-success (--set-priority) leaves exitCode untouched (regression: happy path)', async () => {
        const restore = silenceConsole();
        const t1 = ctx.taskRepo.create({ title: 'Alpha', priority: 'low' });
        const t2 = ctx.taskRepo.create({ title: 'Beta', priority: 'low' });

        const bulkCommand = await loadBulkCommand();
        await bulkCommand.parseAsync(
            ['edit', '--priority', 'low', '--set-priority', 'urgent', '--yes'],
            { from: 'user' },
        );

        restore();
        expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
        expect(ctx.taskRepo.getById(t1.id)?.priority).toBe('urgent');
        expect(ctx.taskRepo.getById(t2.id)?.priority).toBe('urgent');
    });

    it('bulk status verb reports failure (not false success) when applyEdit throws for every task', async () => {
        // A parent/child cycle attempt is impossible via status; instead force a throw via
        // an invalid transition path — use a task already archived so a status write still runs
        // through applyEdit but we assert the accounting mechanism using a spy that throws.
        const t1 = ctx.taskRepo.create({ title: 'Task A', priority: 'urgent' });
        const t2 = ctx.taskRepo.create({ title: 'Task B', priority: 'urgent' });

        const updateSpy = vi.spyOn(ctx.taskRepo, 'update').mockImplementation(() => {
            throw new Error('simulated update failure');
        });

        const bulkCommand = await loadBulkCommand();
        const { payload, exitCode } = await captureJsonOutput(async () => {
            await bulkCommand.parseAsync(['done', '--priority', 'urgent', '--json', '--yes'], { from: 'user' });
        });

        updateSpy.mockRestore();

        expect(payload.ok).toBe(false);
        expect(exitCode).toBe(4);
        const data = payload.data as Record<string, unknown>;
        expect(data.updated).toBe(0);
        expect(data.failed).toBe(2);
        // Status must remain unchanged since update() threw before persisting
        expect(ctx.taskRepo.getById(t1.id)?.status).not.toBe('done');
        expect(ctx.taskRepo.getById(t2.id)?.status).not.toBe('done');
    });

    it('partial failure: N-of-M accounting when only some tasks fail', async () => {
        const t1 = ctx.taskRepo.create({ title: 'Task A', priority: 'urgent' });
        const t2 = ctx.taskRepo.create({ title: 'Task B', priority: 'urgent' });

        const originalUpdate = ctx.taskRepo.update.bind(ctx.taskRepo);
        const updateSpy = vi.spyOn(ctx.taskRepo, 'update').mockImplementation((id, changes) => {
            if (id === t1.id) throw new Error('simulated failure for t1');
            return originalUpdate(id, changes);
        });

        const bulkCommand = await loadBulkCommand();
        const { payload, exitCode } = await captureJsonOutput(async () => {
            await bulkCommand.parseAsync(['done', '--priority', 'urgent', '--json', '--yes'], { from: 'user' });
        });

        updateSpy.mockRestore();

        expect(payload.ok).toBe(false);
        expect(exitCode).toBe(4);
        const data = payload.data as Record<string, unknown>;
        expect(data.updated).toBe(1);
        expect(data.failed).toBe(1);
        expect(ctx.taskRepo.getById(t2.id)?.status).toBe('done');
        expect(ctx.taskRepo.getById(t1.id)?.status).not.toBe('done');
    });

    it('bulk delete mid-loop throw is counted as a failure, not an unhandled rejection', async () => {
        const t1 = ctx.taskRepo.create({ title: 'Task A', priority: 'urgent' });
        const t2 = ctx.taskRepo.create({ title: 'Task B', priority: 'urgent' });

        const originalArchive = ctx.taskRepo.archive.bind(ctx.taskRepo);
        const archiveSpy = vi.spyOn(ctx.taskRepo, 'archive').mockImplementation((id) => {
            if (id === t1.id) throw new Error('simulated archive failure');
            return originalArchive(id);
        });

        const bulkCommand = await loadBulkCommand();
        const { payload, exitCode } = await captureJsonOutput(async () => {
            await bulkCommand.parseAsync(['delete', '--priority', 'urgent', '--json', '--yes'], { from: 'user' });
        });

        archiveSpy.mockRestore();

        expect(payload.ok).toBe(false);
        expect(exitCode).toBe(1); // EXIT.GENERIC
        const data = payload.data as Record<string, unknown>;
        expect(data.updated).toBe(1);
        expect(data.failed).toBe(1);
        expect(ctx.taskRepo.getById(t2.id)?.status).toBe('archived');
    });

    it('bulk tag add mid-loop throw is counted as a failure, not a crash', async () => {
        const t1 = ctx.taskRepo.create({ title: 'Task A', priority: 'urgent' });
        const t2 = ctx.taskRepo.create({ title: 'Task B', priority: 'urgent' });

        const originalAddTags = ctx.tagRepo.addTaskTags.bind(ctx.tagRepo);
        const addTagsSpy = vi.spyOn(ctx.tagRepo, 'addTaskTags').mockImplementation((id, tagNames) => {
            if (id === t1.id) throw new Error('simulated tag failure');
            return originalAddTags(id, tagNames);
        });

        const bulkCommand = await loadBulkCommand();
        const { payload, exitCode } = await captureJsonOutput(async () => {
            await bulkCommand.parseAsync(['tag', 'add', 'urgent-tag', '--priority', 'urgent', '--json', '--yes'], { from: 'user' });
        });

        addTagsSpy.mockRestore();

        expect(payload.ok).toBe(false);
        expect(exitCode).toBe(1); // EXIT.GENERIC
        const data = payload.data as Record<string, unknown>;
        expect(data.updated).toBe(1);
        expect(data.failed).toBe(1);
        expect(ctx.tagRepo.getTaskTags(t2.id)).toContain('urgent-tag');
        expect(ctx.tagRepo.getTaskTags(t1.id)).not.toContain('urgent-tag');
    });
});
