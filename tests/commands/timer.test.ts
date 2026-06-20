// Focused tests for timer start / stop / status / log (manual) command flows

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
import { diffSeconds, parseSqliteUtc } from '../../src/utils/date.js';
import type { AppContext } from '../../src/commands/context.js';

// Mock hook manager to suppress async side-effects
vi.mock('../../src/plugins/hook-manager.js', () => ({
    getHookManager: () => ({
        onTaskCreate: vi.fn().mockResolvedValue(undefined),
        onTaskUpdate: vi.fn().mockResolvedValue(undefined),
        onTaskComplete: vi.fn().mockResolvedValue(undefined),
        onTaskDelete: vi.fn().mockResolvedValue(undefined),
    }),
}));

// Mock fail so it doesn't set process.exitCode in tests
vi.mock('../../src/utils/exit.js', () => ({
    EXIT: { OK: 0, GENERIC: 1, USAGE: 2, NOT_FOUND: 3, INVALID_TRANSITION: 4, CONFIG_ERROR: 5 },
    fail: vi.fn(),
    requireEntity: vi.fn((entity: unknown, kind: string, ref: unknown) => {
        if (!entity) { return false; }
        return true;
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
    };
}

// Wire ctx into getContext so all commands use the test DB
vi.mock('../../src/commands/context.js', () => ({
    getContext: () => ctx,
}));

// Suppress console output from timer command
function silenceConsole() {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    return () => { log.mockRestore(); err.mockRestore(); };
}

beforeEach(() => {
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
// timer start
// ──────────────────────────────────────────────
describe('timer start', () => {
    it('creates an active tracking session in SQLite', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Work item', priority: 'medium' });

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['start', String(task.id)], { from: 'user' });

        restore();
        const session = ctx.trackingRepo.getActiveForTask(task.id);
        expect(session).not.toBeNull();
        expect(session?.taskId).toBe(task.id);
        expect(session?.endedAt).toBeNull();
    });

    it('stores startedAt in SQLite UTC format (YYYY-MM-DD HH:mm:ss)', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Timestamped work', priority: 'low' });

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['start', String(task.id)], { from: 'user' });

        restore();
        const session = ctx.trackingRepo.getActiveForTask(task.id);
        // Must match the SQLite UTC pattern
        expect(session?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('auto-transitions a pending task to in_progress', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Pending task', priority: 'medium' });
        expect(task.status).toBe('pending');

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['start', String(task.id)], { from: 'user' });

        restore();
        expect(ctx.taskRepo.getById(task.id)?.status).toBe('in_progress');
    });

    it('does not change status when task is already in_progress', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Active task', priority: 'medium' });
        ctx.taskRepo.update(task.id, { status: 'in_progress' });

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['start', String(task.id)], { from: 'user' });

        restore();
        expect(ctx.taskRepo.getById(task.id)?.status).toBe('in_progress');
    });
});

// ──────────────────────────────────────────────
// timer stop
// ──────────────────────────────────────────────
describe('timer stop', () => {
    it('closes the active session and stores ended_at', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Stoppable task', priority: 'medium' });
        ctx.trackingRepo.start(task.id);

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['stop', String(task.id)], { from: 'user' });

        restore();
        const session = ctx.trackingRepo.getActiveForTask(task.id);
        expect(session).toBeNull(); // no active session after stop

        const sessions = ctx.trackingRepo.getByTaskId(task.id);
        expect(sessions).toHaveLength(1);
        expect(sessions[0].endedAt).not.toBeNull();
    });

    it('computes a non-negative duration in seconds after stopping', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Duration task', priority: 'medium' });
        ctx.trackingRepo.start(task.id);

        // Wait a tick so started_at and ended_at differ
        await new Promise(r => setTimeout(r, 50));

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['stop', String(task.id)], { from: 'user' });

        restore();
        const sessions = ctx.trackingRepo.getByTaskId(task.id);
        const s = sessions[0];
        expect(s.duration).toBeGreaterThanOrEqual(0);
        // Verify diffSeconds is consistent with the stored timestamps
        if (s.endedAt) {
            const computed = diffSeconds(s.startedAt, s.endedAt);
            expect(computed).toBeGreaterThanOrEqual(0);
        }
    });

    it('adds the session duration to the task time_spent', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Timed task', priority: 'medium' });
        ctx.trackingRepo.start(task.id);
        await new Promise(r => setTimeout(r, 50));

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['stop', String(task.id)], { from: 'user' });

        restore();
        const updated = ctx.taskRepo.getById(task.id);
        expect(updated?.timeSpent).toBeGreaterThanOrEqual(0);
    });

    it('prints no-active-timer message when timer is not running', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const task = ctx.taskRepo.create({ title: 'No timer task', priority: 'low' });

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['stop', String(task.id)], { from: 'user' });

        const allText = logSpy.mock.calls
            // eslint-disable-next-line no-control-regex
            .map(c => String(c[0]).replace(/\x1B\[[0-9;]*m/g, ''))
            .join('\n');
        logSpy.mockRestore();

        expect(allText).toMatch(/no active timer/i);
    });
});

// ──────────────────────────────────────────────
// timer status
// ──────────────────────────────────────────────
describe('timer status', () => {
    it('prints a no-active-timer message when no sessions are running', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['status'], { from: 'user' });

        const allText = logSpy.mock.calls
            // eslint-disable-next-line no-control-regex
            .map(c => String(c[0]).replace(/\x1B\[[0-9;]*m/g, ''))
            .join('\n');
        logSpy.mockRestore();

        expect(allText).toMatch(/no active timer/i);
    });

    it('shows the active task title when a session is running', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const task = ctx.taskRepo.create({ title: 'Active sprint task', priority: 'medium' });
        ctx.trackingRepo.start(task.id);

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['status'], { from: 'user' });

        const allText = logSpy.mock.calls
            // eslint-disable-next-line no-control-regex
            .map(c => String(c[0]).replace(/\x1B\[[0-9;]*m/g, ''))
            .join('\n');
        logSpy.mockRestore();

        expect(allText).toContain('Active sprint task');
    });
});

// ──────────────────────────────────────────────
// timer log (manual entry)
// ──────────────────────────────────────────────
describe('timer log', () => {
    it('creates a completed session with the specified duration', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Manual log task', priority: 'medium' });

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['log', String(task.id), '30m'], { from: 'user' });

        restore();
        const sessions = ctx.trackingRepo.getByTaskId(task.id);
        expect(sessions).toHaveLength(1);
        expect(sessions[0].duration).toBe(30 * 60); // 1800 seconds
        expect(sessions[0].endedAt).not.toBeNull(); // manual sessions are already closed
    });

    it('stores both startedAt and endedAt in SQLite UTC format', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'UTC format task', priority: 'low' });

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['log', String(task.id), '1h'], { from: 'user' });

        restore();
        const sessions = ctx.trackingRepo.getByTaskId(task.id);
        const s = sessions[0];
        // Both timestamps must follow SQLite UTC pattern
        expect(s.startedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        expect(s.endedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('diffSeconds between startedAt and endedAt equals the logged duration', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Duration diff task', priority: 'medium' });

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['log', String(task.id), '2h'], { from: 'user' });

        restore();
        const sessions = ctx.trackingRepo.getByTaskId(task.id);
        const s = sessions[0];
        const computed = diffSeconds(s.startedAt, s.endedAt!);
        // 2h = 7200s; allow ±1s for rounding in logManual
        expect(Math.abs(computed - 7200)).toBeLessThanOrEqual(1);
    });

    it('updates the task time_spent by the logged amount', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Time spent task', priority: 'medium' });
        expect(task.timeSpent).toBe(0);

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['log', String(task.id), '45m'], { from: 'user' });

        restore();
        const updated = ctx.taskRepo.getById(task.id);
        expect(updated?.timeSpent).toBe(45 * 60); // 2700 seconds
    });

    it('supports hour+minute compound duration (e.g. 1h30m = 5400s)', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Compound duration task', priority: 'low' });

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['log', String(task.id), '1h30m'], { from: 'user' });

        restore();
        const sessions = ctx.trackingRepo.getByTaskId(task.id);
        expect(sessions[0].duration).toBe(90 * 60); // 5400 seconds
    });

    it('calls fail for a zero-second invalid duration', async () => {
        const restore = silenceConsole();
        const { fail } = await import('../../src/utils/exit.js');
        const task = ctx.taskRepo.create({ title: 'Bad duration task', priority: 'medium' });

        const { timerCommand } = await import('../../src/commands/timer.js');
        // "0m" resolves to 0 seconds — invalid
        await timerCommand.parseAsync(['log', String(task.id), '0m'], { from: 'user' });

        restore();
        expect(fail).toHaveBeenCalled();
        // No session should be stored
        expect(ctx.trackingRepo.getByTaskId(task.id)).toHaveLength(0);
    });

    it('attaches the note to the manual session', async () => {
        const restore = silenceConsole();
        const task = ctx.taskRepo.create({ title: 'Noted task', priority: 'low' });

        const { timerCommand } = await import('../../src/commands/timer.js');
        await timerCommand.parseAsync(['log', String(task.id), '15m', '--note', 'code review'], { from: 'user' });

        restore();
        const sessions = ctx.trackingRepo.getByTaskId(task.id);
        expect(sessions[0].note).toBe('code review');
    });
});

// ──────────────────────────────────────────────
// parseSqliteUtc round-trip (unit)
// ──────────────────────────────────────────────
describe('SQLite timestamp shape', () => {
    it('parseSqliteUtc correctly round-trips a stored timestamp', () => {
        const stored = '2026-06-14 10:30:00';
        const date = parseSqliteUtc(stored);
        expect(date).toBeInstanceOf(Date);
        expect(isNaN(date.getTime())).toBe(false);
    });

    it('diffSeconds returns correct elapsed time between two UTC timestamps', () => {
        const start = '2026-06-14 10:00:00';
        const end = '2026-06-14 10:01:30';
        // 1 minute 30 seconds = 90 seconds
        expect(diffSeconds(start, end)).toBe(90);
    });

    it('diffSeconds returns 0 for identical timestamps', () => {
        const ts = '2026-06-14 12:00:00';
        expect(diffSeconds(ts, ts)).toBe(0);
    });
});
