// Integration tests for all 8 MCP time-tracking tools.
// Strategy: mock getContext() (singleton) to inject an in-memory test DB,
// then call registerTrackingTools directly on a StubServer so we can invoke
// handler functions without a real stdio transport.
// Schema boundary tests use a real McpServer + InMemoryTransport (same pattern
// as tests/mcp/tools/tasks.test.ts).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../../src/storage/database.js';
import { runMigrations } from '../../../src/storage/migrations/runner.js';
import type { AppContext } from '../../../src/commands/context.js';
import { buildTestCtx, buildStubServer } from '../../helpers/mcp.js';
import type { StubServer } from '../../helpers/mcp.js';
import { insertTrackingSession } from '../../helpers/tracking.js';

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
    const { registerTrackingTools } = await import('../../../src/mcp/tools/tracking.js');
    registerTrackingTools(server as never, { allowDelete });
    return server;
}

// Helper: read the single text content string from a result
function getText(result: Record<string, unknown>): string {
    return (result.content as Array<{ text: string }>)[0].text;
}

// Helper: read structuredContent as a typed record
function getStructured(result: Record<string, unknown>): Record<string, unknown> {
    return result.structuredContent as Record<string, unknown>;
}

// Helper: UTC timestamp N seconds in the past
function secondsAgoUtc(n: number): string {
    return new Date(Date.now() - n * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// ─── todo_start_timer ────────────────────────────────────────────────────────

describe('todo_start_timer', () => {
    it('creates a session and returns it in structuredContent', async () => {
        const task = ctx.taskRepo.create({ title: 'Work item', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_start_timer', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const s = getStructured(result);
        expect(s.taskId).toBe(task.id);
        expect(s.taskTitle).toBe('Work item');
        expect(s.session).toBeDefined();
    });

    it('auto-advances status from todo to in_progress — verified via taskRepo', async () => {
        const task = ctx.taskRepo.create({ title: 'Todo task', priority: 'medium', status: 'todo' });
        await loadTools();

        const result = server.call('todo_start_timer', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const s = getStructured(result);
        expect(s.statusAdvancedTo).toBe('in_progress');
        // Confirm the repo was actually mutated
        expect(ctx.taskRepo.getById(task.id)?.status).toBe('in_progress');
    });

    it('does NOT advance status when task is already in_progress', async () => {
        const task = ctx.taskRepo.create({ title: 'Running task', priority: 'medium', status: 'in_progress' });
        await loadTools();

        const result = server.call('todo_start_timer', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const s = getStructured(result);
        expect(s.statusAdvancedTo).toBeNull();
        expect(ctx.taskRepo.getById(task.id)?.status).toBe('in_progress');
    });

    it('returns isError for non-existent task', async () => {
        await loadTools();

        const result = server.call('todo_start_timer', { id: 99999 }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(getText(result)).toMatch(/not found/i);
    });

    it('returns isError when a timer is already running for that task', async () => {
        const task = ctx.taskRepo.create({ title: 'Double start', priority: 'medium' });
        ctx.trackingRepo.start(task.id);
        await loadTools();

        const result = server.call('todo_start_timer', { id: task.id }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
    });

    it('otherActiveTaskIds lists concurrent task IDs when a second timer is running', async () => {
        const t1 = ctx.taskRepo.create({ title: 'Task A', priority: 'low' });
        const t2 = ctx.taskRepo.create({ title: 'Task B', priority: 'low' });
        ctx.trackingRepo.start(t1.id);
        await loadTools();

        const result = server.call('todo_start_timer', { id: t2.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const s = getStructured(result);
        expect(s.otherActiveTaskIds).toEqual(expect.arrayContaining([t1.id]));
    });

    it('archived task is allowed to start a timer (CLI parity)', async () => {
        const task = ctx.taskRepo.create({ title: 'Archived task', priority: 'low' });
        ctx.taskRepo.archive(task.id);
        await loadTools();

        const result = server.call('todo_start_timer', { id: task.id }) as Record<string, unknown>;

        // Archived tasks have status "archived" — applyTimerStart only advances "todo".
        // Timer start itself should succeed.
        expect(result).not.toHaveProperty('isError');
    });

    it('stores the note in the created session', async () => {
        const task = ctx.taskRepo.create({ title: 'Noted task', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_start_timer', { id: task.id, note: 'pair programming' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const session = (getStructured(result).session as Record<string, unknown>);
        expect(session.note).toBe('pair programming');
    });
});

// ─── todo_stop_timer ─────────────────────────────────────────────────────────

describe('todo_stop_timer', () => {
    it('stops the single active timer when no id or all given', async () => {
        const task = ctx.taskRepo.create({ title: 'Stoppable', priority: 'medium' });
        ctx.trackingRepo.start(task.id);
        await loadTools();

        const result = server.call('todo_stop_timer', {}) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const s = getStructured(result);
        expect(s.taskId).toBe(task.id);
        expect(typeof s.durationSeconds).toBe('number');
    });

    it('bumps tasks.time_spent on stop', async () => {
        const task = ctx.taskRepo.create({ title: 'Bookkeeping', priority: 'medium' });
        insertTrackingSession(db, task.id, secondsAgoUtc(120), null, 0);
        await loadTools();

        server.call('todo_stop_timer', {});

        const updated = ctx.taskRepo.getById(task.id);
        expect(updated!.timeSpent).toBeGreaterThan(0);
    });

    it('stops by task id when two timers are active', async () => {
        const t1 = ctx.taskRepo.create({ title: 'Task 1', priority: 'low' });
        const t2 = ctx.taskRepo.create({ title: 'Task 2', priority: 'low' });
        ctx.trackingRepo.start(t1.id);
        ctx.trackingRepo.start(t2.id);
        await loadTools();

        const result = server.call('todo_stop_timer', { id: t1.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(getStructured(result).taskId).toBe(t1.id);
        // t2 still running
        expect(ctx.trackingRepo.getActiveSessions()).toHaveLength(1);
        expect(ctx.trackingRepo.getActiveSessions()[0].taskId).toBe(t2.id);
    });

    it('CLI-hint leak regression: error with two active + no id does NOT contain "todo timer"', async () => {
        const t1 = ctx.taskRepo.create({ title: 'First', priority: 'low' });
        const t2 = ctx.taskRepo.create({ title: 'Second', priority: 'low' });
        ctx.trackingRepo.start(t1.id);
        ctx.trackingRepo.start(t2.id);
        await loadTools();

        const result = server.call('todo_stop_timer', {}) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        const msg = getText(result);
        expect(msg).not.toMatch(/todo timer/i);
        // Should mention the task IDs instead
        expect(msg).toMatch(new RegExp(String(t1.id)));
        expect(msg).toMatch(new RegExp(String(t2.id)));
    });

    it('returns isError when no active timer at all', async () => {
        await loadTools();

        const result = server.call('todo_stop_timer', {}) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(getText(result)).toMatch(/no active timer/i);
    });

    it('returns isError when specified task id has no active timer', async () => {
        const task = ctx.taskRepo.create({ title: 'Idle task', priority: 'low' });
        await loadTools();

        const result = server.call('todo_stop_timer', { id: task.id }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(getText(result)).toMatch(/no active timer/i);
    });

    it('all:true stops all active timers and returns count', async () => {
        const t1 = ctx.taskRepo.create({ title: 'T1', priority: 'low' });
        const t2 = ctx.taskRepo.create({ title: 'T2', priority: 'low' });
        ctx.trackingRepo.start(t1.id);
        ctx.trackingRepo.start(t2.id);
        await loadTools();

        const result = server.call('todo_stop_timer', { all: true }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const s = getStructured(result);
        expect(s.count).toBe(2);
        expect(ctx.trackingRepo.getActiveSessions()).toHaveLength(0);
    });

    it('all:true is idempotent — returns count:0 when none active', async () => {
        await loadTools();

        const result = server.call('todo_stop_timer', { all: true }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(getStructured(result).count).toBe(0);
    });

    it('all:true wins over id — stops all even when id is given', async () => {
        const t1 = ctx.taskRepo.create({ title: 'T1', priority: 'low' });
        const t2 = ctx.taskRepo.create({ title: 'T2', priority: 'low' });
        ctx.trackingRepo.start(t1.id);
        ctx.trackingRepo.start(t2.id);
        await loadTools();

        // Pass both id and all:true; all:true should win
        const result = server.call('todo_stop_timer', { id: t1.id, all: true }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        expect(getStructured(result).count).toBe(2);
        expect(ctx.trackingRepo.getActiveSessions()).toHaveLength(0);
    });
});

// ─── todo_get_active_timers ───────────────────────────────────────────────────

describe('todo_get_active_timers', () => {
    it('returns empty list when no timers are active', async () => {
        await loadTools();

        const result = server.call('todo_get_active_timers', {}) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const items = (result.structuredContent as { items: unknown[] }).items;
        expect(items).toHaveLength(0);
    });

    it('elapsedSeconds > 0 for a backdated running session', async () => {
        const task = ctx.taskRepo.create({ title: 'Long running', priority: 'medium' });
        // Backdated 300s in the past via helper fixture
        insertTrackingSession(db, task.id, secondsAgoUtc(300), null, 0, 'deep focus');
        await loadTools();

        const result = server.call('todo_get_active_timers', {}) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const items = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;
        expect(items).toHaveLength(1);
        expect(items[0].elapsedSeconds).toBeGreaterThanOrEqual(290);
    });

    it('exposes session note and taskTitle', async () => {
        const task = ctx.taskRepo.create({ title: 'Noted timer', priority: 'low' });
        insertTrackingSession(db, task.id, secondsAgoUtc(60), null, 0, 'bug hunt');
        await loadTools();

        const result = server.call('todo_get_active_timers', {}) as Record<string, unknown>;
        const items = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(items[0].note).toBe('bug hunt');
        expect(items[0].taskTitle).toBe('Noted timer');
    });

    it('returns multiple active sessions when multiple timers are running', async () => {
        const t1 = ctx.taskRepo.create({ title: 'Alpha', priority: 'low' });
        const t2 = ctx.taskRepo.create({ title: 'Beta', priority: 'low' });
        ctx.trackingRepo.start(t1.id);
        ctx.trackingRepo.start(t2.id);
        await loadTools();

        const result = server.call('todo_get_active_timers', {}) as Record<string, unknown>;
        const items = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;

        expect(items).toHaveLength(2);
    });
});

// ─── todo_log_time ────────────────────────────────────────────────────────────

describe('todo_log_time', () => {
    it('"2h" logs 7200s and bumps tasks.time_spent', async () => {
        const task = ctx.taskRepo.create({ title: 'Log me', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_log_time', { id: task.id, duration: '2h' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const session = result.structuredContent as Record<string, unknown>;
        expect(session.duration).toBe(7200);
        expect(ctx.taskRepo.getById(task.id)?.timeSpent).toBe(7200);
    });

    it('bare "90" (minutes) logs 5400s', async () => {
        const task = ctx.taskRepo.create({ title: 'Bare minutes', priority: 'low' });
        await loadTools();

        const result = server.call('todo_log_time', { id: task.id, duration: '90' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const session = result.structuredContent as Record<string, unknown>;
        expect(session.duration).toBe(5400);
    });

    it('returns isError for unrecognised duration "abc"', async () => {
        const task = ctx.taskRepo.create({ title: 'Bad duration', priority: 'low' });
        await loadTools();

        const result = server.call('todo_log_time', { id: task.id, duration: 'abc' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(getText(result)).toMatch(/invalid duration/i);
    });

    it('returns isError for zero duration "0m"', async () => {
        const task = ctx.taskRepo.create({ title: 'Zero duration', priority: 'low' });
        await loadTools();

        const result = server.call('todo_log_time', { id: task.id, duration: '0m' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(getText(result)).toMatch(/invalid duration/i);
    });

    it('returns isError for non-existent task', async () => {
        await loadTools();

        const result = server.call('todo_log_time', { id: 99999, duration: '1h' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(getText(result)).toMatch(/not found/i);
    });

    it('stores the optional note on the session', async () => {
        const task = ctx.taskRepo.create({ title: 'Noted log', priority: 'medium' });
        await loadTools();

        const result = server.call('todo_log_time', { id: task.id, duration: '30m', note: 'code review' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const session = result.structuredContent as Record<string, unknown>;
        expect(session.note).toBe('code review');
    });

    it('defaults note to "manual entry" when note is omitted', async () => {
        const task = ctx.taskRepo.create({ title: 'Default note', priority: 'low' });
        await loadTools();

        const result = server.call('todo_log_time', { id: task.id, duration: '15m' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const session = result.structuredContent as Record<string, unknown>;
        expect(session.note).toBe('manual entry');
    });
});

// ─── todo_list_sessions ───────────────────────────────────────────────────────

describe('todo_list_sessions', () => {
    it('returns sessions and totalSeconds for a task', async () => {
        const task = ctx.taskRepo.create({ title: 'Sessioned', priority: 'medium' });
        insertTrackingSession(db, task.id, secondsAgoUtc(3600), new Date(Date.now() - 3600000 + 1800000).toISOString().replace('T', ' ').slice(0, 19), 1800);
        await loadTools();

        const result = server.call('todo_list_sessions', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const s = getStructured(result);
        expect(s.taskId).toBe(task.id);
        expect(s.taskTitle).toBe('Sessioned');
        expect((s.items as unknown[]).length).toBeGreaterThanOrEqual(1);
        expect(s.totalSeconds).toBe(1800);
    });

    it('running session is included in items but excluded from totalSeconds', async () => {
        const task = ctx.taskRepo.create({ title: 'Mixed sessions', priority: 'medium' });
        // Completed session: 600s
        insertTrackingSession(db, task.id, secondsAgoUtc(700), secondsAgoUtc(100), 600);
        // Running session: no ended_at
        insertTrackingSession(db, task.id, secondsAgoUtc(50), null, 0);
        await loadTools();

        const result = server.call('todo_list_sessions', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const s = getStructured(result);
        // Both sessions returned in items
        expect((s.items as unknown[]).length).toBe(2);
        // Only the completed one counted in totalSeconds
        expect(s.totalSeconds).toBe(600);
    });

    it('returns isError for non-existent task', async () => {
        await loadTools();

        const result = server.call('todo_list_sessions', { id: 99999 }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(getText(result)).toMatch(/not found/i);
    });

    it('returns empty items when task has no sessions', async () => {
        const task = ctx.taskRepo.create({ title: 'No sessions', priority: 'low' });
        await loadTools();

        const result = server.call('todo_list_sessions', { id: task.id }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const s = getStructured(result);
        expect(s.items).toHaveLength(0);
        expect(s.totalSeconds).toBe(0);
    });
});

// ─── todo_get_time_report ─────────────────────────────────────────────────────

describe('todo_get_time_report', () => {
    it('returns grouped totals for sessions within the default 7-day window', async () => {
        const task = ctx.taskRepo.create({ title: 'Recent work', priority: 'medium' });
        // Session within the last 7 days
        insertTrackingSession(db, task.id, secondsAgoUtc(3600), secondsAgoUtc(1800), 1800);
        await loadTools();

        const result = server.call('todo_get_time_report', {}) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const items = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;
        expect(items).toHaveLength(1);
        expect(items[0].taskId).toBe(task.id);
        expect(items[0].totalTime).toBe(1800);
    });

    it('older backdated session outside 7-day window is excluded', async () => {
        const task = ctx.taskRepo.create({ title: 'Old work', priority: 'medium' });
        // Session 10 days ago (simulate via direct insert with past timestamp)
        const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
        const startedAt = tenDaysAgo.toISOString().replace('T', ' ').slice(0, 19);
        const endedAt = new Date(tenDaysAgo.getTime() + 1800000).toISOString().replace('T', ' ').slice(0, 19);
        insertTrackingSession(db, task.id, startedAt, endedAt, 1800);
        await loadTools();

        // Default window is 7 days
        const result = server.call('todo_get_time_report', {}) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const items = (result.structuredContent as { items: Array<unknown> }).items;
        expect(items).toHaveLength(0);
    });

    it('custom days parameter expands the window to include older sessions', async () => {
        const task = ctx.taskRepo.create({ title: 'Old work included', priority: 'medium' });
        const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
        const startedAt = tenDaysAgo.toISOString().replace('T', ' ').slice(0, 19);
        const endedAt = new Date(tenDaysAgo.getTime() + 1800000).toISOString().replace('T', ' ').slice(0, 19);
        insertTrackingSession(db, task.id, startedAt, endedAt, 1800);
        await loadTools();

        const result = server.call('todo_get_time_report', { days: 14 }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const items = (result.structuredContent as { items: Array<Record<string, unknown>> }).items;
        expect(items).toHaveLength(1);
        expect(items[0].taskId).toBe(task.id);
    });

    it('returns empty list when no sessions in window', async () => {
        await loadTools();

        const result = server.call('todo_get_time_report', {}) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const items = (result.structuredContent as { items: Array<unknown> }).items;
        expect(items).toHaveLength(0);
    });
});

// ─── todo_reduce_session ──────────────────────────────────────────────────────

describe('todo_reduce_session', () => {
    it('reduces session duration and decrements tasks.time_spent', async () => {
        const task = ctx.taskRepo.create({ title: 'Reduce me', priority: 'medium' });
        // Completed session: 3600s; time_spent must reflect it
        const sessionId = insertTrackingSession(db, task.id, secondsAgoUtc(4000), secondsAgoUtc(400), 3600);
        db.prepare('UPDATE tasks SET time_spent = 3600 WHERE id = ?').run(task.id);
        await loadTools();

        const result = server.call('todo_reduce_session', { sessionId, duration: '30m' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const updated = result.structuredContent as Record<string, unknown>;
        expect(updated.duration).toBe(1800); // 3600 - 1800
        expect(ctx.taskRepo.getById(task.id)?.timeSpent).toBe(1800);
    });

    it('floors duration at 0 when reduction exceeds session length', async () => {
        const task = ctx.taskRepo.create({ title: 'Floor test', priority: 'low' });
        const sessionId = insertTrackingSession(db, task.id, secondsAgoUtc(1000), secondsAgoUtc(400), 600);
        db.prepare('UPDATE tasks SET time_spent = 600 WHERE id = ?').run(task.id);
        await loadTools();

        const result = server.call('todo_reduce_session', { sessionId, duration: '2h' }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const updated = result.structuredContent as Record<string, unknown>;
        expect(updated.duration).toBe(0);
        expect(ctx.taskRepo.getById(task.id)?.timeSpent).toBe(0);
    });

    it('returns isError for an active (running) session', async () => {
        const task = ctx.taskRepo.create({ title: 'Active session reduce', priority: 'medium' });
        const sessionId = insertTrackingSession(db, task.id, secondsAgoUtc(60), null, 0);
        await loadTools();

        const result = server.call('todo_reduce_session', { sessionId, duration: '10m' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
    });

    it('returns isError for unknown session id', async () => {
        await loadTools();

        const result = server.call('todo_reduce_session', { sessionId: 99999, duration: '10m' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(getText(result)).toMatch(/not found/i);
    });

    it('returns isError for invalid duration "abc"', async () => {
        const task = ctx.taskRepo.create({ title: 'Bad reduce duration', priority: 'low' });
        const sessionId = insertTrackingSession(db, task.id, secondsAgoUtc(1000), secondsAgoUtc(400), 600);
        await loadTools();

        const result = server.call('todo_reduce_session', { sessionId, duration: 'abc' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(getText(result)).toMatch(/invalid duration/i);
    });

    it('returns isError for zero duration "0m"', async () => {
        const task = ctx.taskRepo.create({ title: 'Zero reduce', priority: 'low' });
        const sessionId = insertTrackingSession(db, task.id, secondsAgoUtc(1000), secondsAgoUtc(400), 600);
        await loadTools();

        const result = server.call('todo_reduce_session', { sessionId, duration: '0m' }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
    });
});

// ─── todo_delete_session ──────────────────────────────────────────────────────

describe('todo_delete_session', () => {
    it('returns isError when allowDelete is false — session still exists after', async () => {
        const task = ctx.taskRepo.create({ title: 'Protected session', priority: 'medium' });
        const sessionId = insertTrackingSession(db, task.id, secondsAgoUtc(600), secondsAgoUtc(0), 600);
        await loadTools(false); // gate off

        const result = server.call('todo_delete_session', { sessionId }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(getText(result)).toMatch(/disabled/i);
        // Session must still exist
        expect(ctx.trackingRepo.getById(sessionId)).not.toBeNull();
    });

    it('deletes and decrements time_spent when allowDelete is true', async () => {
        const task = ctx.taskRepo.create({ title: 'Deletable session', priority: 'medium' });
        const sessionId = insertTrackingSession(db, task.id, secondsAgoUtc(600), secondsAgoUtc(0), 600);
        db.prepare('UPDATE tasks SET time_spent = 600 WHERE id = ?').run(task.id);
        await loadTools(true); // gate on

        const result = server.call('todo_delete_session', { sessionId }) as Record<string, unknown>;

        expect(result).not.toHaveProperty('isError');
        const s = getStructured(result);
        expect(s.id).toBe(sessionId);
        expect(s.taskId).toBe(task.id);
        expect(s.durationSeconds).toBe(600);
        // Session gone from DB
        expect(ctx.trackingRepo.getById(sessionId)).toBeNull();
        // time_spent decremented
        expect(ctx.taskRepo.getById(task.id)?.timeSpent).toBe(0);
    });

    it('returns isError for unknown session id even when gate is on', async () => {
        await loadTools(true);

        const result = server.call('todo_delete_session', { sessionId: 99999 }) as Record<string, unknown>;

        expect(result).toHaveProperty('isError', true);
        expect(getText(result)).toMatch(/not found/i);
    });
});

// ─── handler catch blocks — non-Error throw via String(e) ────────────────────

describe('handler catch blocks stringify a non-Error throw', () => {
    it('todo_start_timer', async () => {
        const task = ctx.taskRepo.create({ title: 'x', priority: 'low' });
        await loadTools();
        vi.spyOn(ctx.trackingRepo, 'start').mockImplementation(() => { throw 'raw-start'; });
        const r = server.call('todo_start_timer', { id: task.id }) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect(getText(r)).toMatch(/raw-start/);
    });

    it('todo_stop_timer', async () => {
        const task = ctx.taskRepo.create({ title: 'x', priority: 'low' });
        ctx.trackingRepo.start(task.id);
        await loadTools();
        vi.spyOn(ctx.trackingRepo, 'stop').mockImplementation(() => { throw 'raw-stop'; });
        const r = server.call('todo_stop_timer', {}) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect(getText(r)).toMatch(/raw-stop/);
    });

    it('todo_get_active_timers', async () => {
        await loadTools();
        vi.spyOn(ctx.trackingRepo, 'getActiveSessions').mockImplementation(() => { throw 'raw-active'; });
        const r = server.call('todo_get_active_timers', {}) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect(getText(r)).toMatch(/raw-active/);
    });

    it('todo_log_time', async () => {
        const task = ctx.taskRepo.create({ title: 'x', priority: 'low' });
        await loadTools();
        vi.spyOn(ctx.trackingRepo, 'logManual').mockImplementation(() => { throw 'raw-log'; });
        const r = server.call('todo_log_time', { id: task.id, duration: '1h' }) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect(getText(r)).toMatch(/raw-log/);
    });

    it('todo_list_sessions', async () => {
        const task = ctx.taskRepo.create({ title: 'x', priority: 'low' });
        await loadTools();
        vi.spyOn(ctx.trackingRepo, 'getByTaskId').mockImplementation(() => { throw 'raw-list'; });
        const r = server.call('todo_list_sessions', { id: task.id }) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect(getText(r)).toMatch(/raw-list/);
    });

    it('todo_get_time_report', async () => {
        await loadTools();
        vi.spyOn(ctx.trackingRepo, 'getTimeReport').mockImplementation(() => { throw 'raw-report'; });
        const r = server.call('todo_get_time_report', {}) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect(getText(r)).toMatch(/raw-report/);
    });

    it('todo_reduce_session', async () => {
        const task = ctx.taskRepo.create({ title: 'x', priority: 'low' });
        const sessionId = insertTrackingSession(db, task.id, secondsAgoUtc(600), secondsAgoUtc(0), 600);
        await loadTools();
        vi.spyOn(ctx.trackingRepo, 'reduceSession').mockImplementation(() => { throw 'raw-reduce'; });
        const r = server.call('todo_reduce_session', { sessionId, duration: '5m' }) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect(getText(r)).toMatch(/raw-reduce/);
    });

    it('todo_delete_session', async () => {
        const task = ctx.taskRepo.create({ title: 'x', priority: 'low' });
        const sessionId = insertTrackingSession(db, task.id, secondsAgoUtc(600), secondsAgoUtc(0), 600);
        await loadTools(true);
        vi.spyOn(ctx.trackingRepo, 'deleteSession').mockImplementation(() => { throw 'raw-delete'; });
        const r = server.call('todo_delete_session', { sessionId }) as Record<string, unknown>;
        expect(r).toHaveProperty('isError', true);
        expect(getText(r)).toMatch(/raw-delete/);
    });
});

// ─── Zod schema boundary — real McpServer + InMemoryTransport ─────────────────
// Validates that schema constraints (positive int, string min(1), etc.) are
// enforced at the MCP protocol layer before handlers run.

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

    function assertSchemaError(result: Record<string, unknown>) {
        expect(result).toHaveProperty('isError', true);
        const text = (result.content as Array<{ text: string }>)[0].text;
        expect(text).toMatch(/Input validation error/i);
    }

    it('rejects id:0 on todo_start_timer (must be positive integer)', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_start_timer', arguments: { id: 0 } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects id:"1" (string) on todo_start_timer', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_start_timer', arguments: { id: '1' } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects days:-1 on todo_get_time_report (must be positive)', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_get_time_report', arguments: { days: -1 } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects duration:"" on todo_log_time (must be min(1))', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_log_time', arguments: { id: 1, duration: '' } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects duration:"" on todo_reduce_session (must be min(1))', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_reduce_session', arguments: { sessionId: 1, duration: '' } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects sessionId:0 on todo_reduce_session (must be positive integer)', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_reduce_session', arguments: { sessionId: 0, duration: '1h' } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects sessionId:0 on todo_delete_session (must be positive integer)', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_delete_session', arguments: { sessionId: 0 } }) as Record<string, unknown>;
        assertSchemaError(result);
    });

    it('rejects id:0 on todo_list_sessions', async () => {
        const { client } = await buildRealServer();
        const result = await client.callTool({ name: 'todo_list_sessions', arguments: { id: 0 } }) as Record<string, unknown>;
        assertSchemaError(result);
    });
});
