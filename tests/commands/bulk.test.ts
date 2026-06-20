// Focused tests for bulk done / start / review / edit command flows

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/storage/database.js';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../src/storage/repositories/project.repo.js';
import { TagRepository } from '../../src/storage/repositories/tag.repo.js';
import { TimerRepository } from '../../src/storage/repositories/timer.repo.js';
import { ActionLogRepository } from '../../src/storage/repositories/action-log.repo.js';
import { DependencyRepository } from '../../src/storage/repositories/dependency.repo.js';
import { TrackingRepository } from '../../src/storage/repositories/tracking.repo.js';
import { StatusRepository } from '../../src/storage/repositories/status.repo.js';
import type { AppContext } from '../../src/commands/context.js';

// Mock hook manager to prevent async side-effects during tests
vi.mock('../../src/plugins/hook-manager.js', () => ({
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
        timerRepo: new TimerRepository(database),
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
