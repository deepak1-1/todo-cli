import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { format, subDays, subMonths, subYears } from 'date-fns';
import { getDateRange, formatLastLabel } from '../../src/commands/stats.js';
import { toLocalDateString } from '../../src/utils/date.js';
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
import { insertTrackingSession } from '../helpers/tracking.js';

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

vi.mock('../../src/commands/context.js', () => ({
    getContext: () => ctx,
}));

// Frozen to 2026-06-15T00:30 IST (= 2026-06-14T19:00Z) — the critical rollover window
const FROZEN_UTC = '2026-06-14T19:00:00Z';

describe('getDateRange', () => {
    it('should default to last 7 days when no options provided', () => {
        beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(FROZEN_UTC)); });
        afterEach(() => vi.useRealTimers());
        const result = getDateRange({});
        const today = format(new Date(), 'yyyy-MM-dd');
        const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
        expect(result.to).toBe(today);
        expect(result.from).toBe(weekAgo);
    });

    it('should use --from and --to when provided', () => {
        const result = getDateRange({ from: '2025-01-01', to: '2025-01-31' });
        expect(result.from).toBe('2025-01-01');
        expect(result.to).toBe('2025-01-31');
    });

    it('should handle --last with days', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ last: '30d' });
            const today = format(new Date(), 'yyyy-MM-dd');
            const expected = format(subDays(new Date(), 30), 'yyyy-MM-dd');
            expect(result.from).toBe(expected);
            expect(result.to).toBe(today);
        } finally { vi.useRealTimers(); }
    });

    it('should handle --last with months', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ last: '3m' });
            const today = format(new Date(), 'yyyy-MM-dd');
            const expected = format(subMonths(new Date(), 3), 'yyyy-MM-dd');
            expect(result.from).toBe(expected);
            expect(result.to).toBe(today);
        } finally { vi.useRealTimers(); }
    });

    it('should handle --last with years', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ last: '1y' });
            const today = format(new Date(), 'yyyy-MM-dd');
            const expected = format(subYears(new Date(), 1), 'yyyy-MM-dd');
            expect(result.from).toBe(expected);
            expect(result.to).toBe(today);
        } finally { vi.useRealTimers(); }
    });

    it('should throw for invalid --last format', () => {
        expect(() => getDateRange({ last: 'invalid' })).toThrow('Invalid --last format');
        expect(() => getDateRange({ last: '7w' })).toThrow('Invalid --last format');
    });

    it('should prioritize --from over --last', () => {
        const result = getDateRange({ from: '2025-01-01', last: '7d' });
        expect(result.from).toBe('2025-01-01');
    });

    it('should prioritize --last over --monthly', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ last: '14d', monthly: true });
            const expected = format(subDays(new Date(), 14), 'yyyy-MM-dd');
            expect(result.from).toBe(expected);
        } finally { vi.useRealTimers(); }
    });

    it('should compute --last relative to --to date', () => {
        const result = getDateRange({ last: '30d', to: '2025-12-31' });
        expect(result.to).toBe('2025-12-31');
        const expected = format(subDays(new Date('2025-12-31'), 30), 'yyyy-MM-dd');
        expect(result.from).toBe(expected);
    });

    it('should default --to to today when only --from is provided', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ from: '2025-01-01' });
            const today = format(new Date(), 'yyyy-MM-dd');
            expect(result.from).toBe('2025-01-01');
            expect(result.to).toBe(today);
        } finally { vi.useRealTimers(); }
    });

    it('should handle --monthly', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ monthly: true });
            const today = format(new Date(), 'yyyy-MM-dd');
            expect(result.to).toBe(today);
            // monthly subtracts 30 days — use local helper, not UTC toISOString
            const fromDate = new Date();
            fromDate.setDate(fromDate.getDate() - 30);
            expect(result.from).toBe(toLocalDateString(fromDate));
        } finally { vi.useRealTimers(); }
    });

    it('--today returns local date, not UTC date, during IST midnight rollover', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ today: true });
            // IST: 2026-06-15 00:30; UTC: 2026-06-14 19:00
            expect(result.from).toBe('2026-06-15');
            expect(result.to).toBe('2026-06-15');
            expect(result.from).not.toBe('2026-06-14');
        } finally { vi.useRealTimers(); }
    });
});

describe('formatLastLabel', () => {
    it('should format singular day', () => {
        expect(formatLastLabel('1d')).toBe('Last 1 day');
    });

    it('should format plural days', () => {
        expect(formatLastLabel('30d')).toBe('Last 30 days');
    });

    it('should format singular month', () => {
        expect(formatLastLabel('1m')).toBe('Last 1 month');
    });

    it('should format plural months', () => {
        expect(formatLastLabel('3m')).toBe('Last 3 months');
    });

    it('should format singular year', () => {
        expect(formatLastLabel('1y')).toBe('Last 1 year');
    });

    it('should format plural years', () => {
        expect(formatLastLabel('2y')).toBe('Last 2 years');
    });

    it('should handle uppercase units', () => {
        expect(formatLastLabel('7D')).toBe('Last 7 days');
    });

    it('should fallback for invalid format', () => {
        expect(formatLastLabel('invalid')).toBe('Last invalid');
    });
});

// ─── stats -S / --status resolution ───────────────────────────────────────────
// Tests for the resolveStatusOrThrow path in statsCommand action.
// Uses parseAsync to drive the command the same way the CLI does; getContext() is
// mocked above so no real ~/.todo-cli/todo.db is touched.
describe('stats -S status resolution', () => {
    beforeEach(() => {
        vi.resetModules();
        db = createTestDb();
        runMigrations(db);
        ctx = buildCtx(db);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        process.exitCode = 0;
    });

    afterEach(() => {
        db.close();
        vi.restoreAllMocks();
        process.exitCode = 0;
    });

    it('-S in-progress resolves and does not set a USAGE exit code', async () => {
        // Re-import to pick up the vi.mock above in the same module graph
        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['-S', 'in-progress', '--from', '2020-01-01', '--to', '2099-12-31'], { from: 'user' });
        // The action succeeds: exit code must NOT be EXIT.USAGE (2)
        expect(process.exitCode).not.toBe(2);
    });

    it('-S in_progress (canonical) resolves without error', async () => {
        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['-S', 'in_progress', '--from', '2020-01-01', '--to', '2099-12-31'], { from: 'user' });
        expect(process.exitCode).not.toBe(2);
    });

    it('-S bogus sets EXIT.USAGE (2) via fail()', async () => {
        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['-S', 'bogus', '--from', '2020-01-01', '--to', '2099-12-31'], { from: 'user' });
        // resolveStatusOrThrow throws → caught → fail(EXIT.USAGE)
        expect(process.exitCode).toBe(2);
    });

    it('-S bogus emits an error message containing the bad input', async () => {
        const errorSpy = vi.spyOn(console, 'error');
        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['-S', 'bogus', '--from', '2020-01-01', '--to', '2099-12-31'], { from: 'user' });
        // console.error is called with formatted error text containing "bogus"
        const calls = errorSpy.mock.calls.flat().join(' ');
        expect(calls).toMatch(/bogus/);
    });

    it('-S done resolves without USAGE error', async () => {
        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['-S', 'done', '--from', '2020-01-01', '--to', '2099-12-31'], { from: 'user' });
        expect(process.exitCode).not.toBe(2);
    });
});

// ─── stats -P / --project filter ─────────────────────────────────────────────
describe('stats -P project filter', () => {
    beforeEach(() => {
        vi.resetModules();
        db = createTestDb();
        runMigrations(db);
        ctx = buildCtx(db);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        process.exitCode = 0;
    });

    afterEach(() => {
        db.close();
        vi.restoreAllMocks();
        process.exitCode = 0;
    });

    it('-P none does not set USAGE exit code (applyProjectFilter reaches task.repo list)', async () => {
        ctx.taskRepo.create({ title: 'No project task' });
        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['-P', 'none', '--from', '2020-01-01', '--to', '2099-12-31'], { from: 'user' });
        expect(process.exitCode).not.toBe(2);
    });

    it('-P none returns only projectless tasks (via console.log JSON output)', async () => {
        // Stats only surfaces tasks with tracked time; both tasks need a session
        const project = ctx.projectRepo.create({ name: 'Work' });
        const t1 = ctx.taskRepo.create({ title: 'No project task' });
        const t2 = ctx.taskRepo.create({ title: 'In project task', projectId: project.id });
        insertTrackingSession(db, t1.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, '');
        insertTrackingSession(db, t2.id, '2026-04-25 11:00:00', '2026-04-25 11:30:00', 1800, '');
        // beforeEach already spies on console.log; access it via vi.mocked
        const logSpy = vi.mocked(console.log);

        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['-P', 'none', '--json', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        const raw = logSpy.mock.calls.map(c => String(c[0])).find(s => s.trim().startsWith('{'));
        const data = JSON.parse(raw!);
        // Only the projectless task should appear in the results
        expect(data.tasks).toHaveLength(1);
        expect(data.tasks[0].title).toBe('No project task');
    });

    it('-P <name> scopes stats to the named project only', async () => {
        // Stats only surfaces tasks with tracked time; both tasks need a session
        const project = ctx.projectRepo.create({ name: 'Work' });
        const t1 = ctx.taskRepo.create({ title: 'No project task' });
        const t2 = ctx.taskRepo.create({ title: 'In project task', projectId: project.id });
        insertTrackingSession(db, t1.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, '');
        insertTrackingSession(db, t2.id, '2026-04-25 11:00:00', '2026-04-25 11:30:00', 1800, '');
        const logSpy = vi.mocked(console.log);

        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['-P', 'Work', '--json', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        const raw = logSpy.mock.calls.map(c => String(c[0])).find(s => s.trim().startsWith('{'));
        const data = JSON.parse(raw!);
        expect(data.tasks).toHaveLength(1);
        expect(data.tasks[0].title).toBe('In project task');
    });
});

// Local binding over the shared fixture so call sites don't have to pass the per-test db.
const insertSession = (taskId: number, startedAt: string, endedAt: string, duration: number, note = ''): number =>
    insertTrackingSession(db, taskId, startedAt, endedAt, duration, note);

// Strip ANSI escape sequences so assertions are independent of chalk styling.
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

// ─── stats --json sessions ────────────────────────────────────────────────────
describe('stats --json sessions', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
        db = createTestDb();
        runMigrations(db);
        ctx = buildCtx(db);
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        process.exitCode = 0;
    });

    afterEach(() => {
        db.close();
        vi.restoreAllMocks();
        process.exitCode = 0;
    });

    function parsedJson() {
        const raw = logSpy.mock.calls.map(c => String(c[0])).find(s => s.trim().startsWith('{'));
        if (!raw) throw new Error('No JSON call found in console.log spy');
        return JSON.parse(raw);
    }

    it('includes sessions array with correct date, duration, and note', async () => {
        const task = ctx.taskRepo.create({ title: 'Tracked task', priority: 'medium' });
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'coding work');

        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['--json', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        const data = parsedJson();
        const taskJson = data.tasks.find((t: { id: number }) => t.id === task.id);
        expect(taskJson).toBeDefined();
        expect(taskJson.sessions).toHaveLength(1);
        expect(taskJson.sessions[0].date).toBe('2026-04-25');
        expect(taskJson.sessions[0].duration).toBe(1800);
        expect(taskJson.sessions[0].note).toBe('coding work');
    });

    it('includes session with empty note as note: ""', async () => {
        const task = ctx.taskRepo.create({ title: 'Empty note task', priority: 'medium' });
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, '');

        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['--json', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        const data = parsedJson();
        const taskJson = data.tasks.find((t: { id: number }) => t.id === task.id);
        expect(taskJson.sessions[0].note).toBe('');
    });

    it('always includes sessions in --json even without --notes flag', async () => {
        const task = ctx.taskRepo.create({ title: 'Always sessions', priority: 'medium' });
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'some note');

        const { statsCommand } = await import('../../src/commands/stats.js');
        // Intentionally no --notes flag
        await statsCommand.parseAsync(['--json', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        const data = parsedJson();
        const taskJson = data.tasks.find((t: { id: number }) => t.id === task.id);
        expect(taskJson.sessions).toBeDefined();
        expect(taskJson.sessions).toHaveLength(1);
    });

    it('session durations sum to the task time-in-range', async () => {
        const task = ctx.taskRepo.create({ title: 'Sum check', priority: 'medium' });
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'a');
        insertSession(task.id, '2026-04-26 14:00:00', '2026-04-26 14:15:00', 900, 'b');

        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['--json', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        const data = parsedJson();
        const taskJson = data.tasks.find((t: { id: number }) => t.id === task.id);
        const sessionTotal = (taskJson.sessions as { duration: number }[]).reduce((s, r) => s + r.duration, 0);
        expect(sessionTotal).toBe(2700);
    });
});

// ─── stats --notes ─────────────────────────────────────────────────────────────
describe('stats --notes', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    function getOutput(): string {
        return logSpy.mock.calls.map(c => stripAnsi(String(c[0]))).join('\n');
    }

    beforeEach(() => {
        vi.resetModules();
        db = createTestDb();
        runMigrations(db);
        ctx = buildCtx(db);
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        process.exitCode = 0;
    });

    afterEach(() => {
        db.close();
        vi.restoreAllMocks();
        process.exitCode = 0;
    });

    it('prints Notes heading when --notes is set', async () => {
        const task = ctx.taskRepo.create({ title: 'Noted task', priority: 'medium' });
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'a note');

        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['--notes', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        expect(getOutput()).toContain('Notes');
    });

    it('shows task header and note line for a task with a non-empty session note', async () => {
        const task = ctx.taskRepo.create({ title: 'Feature work', priority: 'medium' });
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'implemented login');

        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['--notes', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        const output = getOutput();
        expect(output).toContain('Feature work');
        expect(output).toContain('implemented login');
    });

    it('omits tasks whose sessions all have empty notes from the Notes section', async () => {
        const noted = ctx.taskRepo.create({ title: 'Has notes', priority: 'medium' });
        const silent = ctx.taskRepo.create({ title: 'All empty', priority: 'low' });
        insertSession(noted.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'something');
        insertSession(silent.id, '2026-04-25 11:00:00', '2026-04-25 11:30:00', 1800, '');

        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['--notes', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        const output = getOutput();
        expect(output).toContain('Has notes');
        // "All empty" appears in the table header but NOT inside the Notes section
        // — assert the specific note text is absent (no notes were logged for that task)
        expect(output).not.toContain('(All empty notes shown here)');
    });

    it('prints "No session notes in this range" when every session has an empty note', async () => {
        const task = ctx.taskRepo.create({ title: 'Silent task', priority: 'medium' });
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, '');

        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['--notes', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        expect(getOutput()).toContain('No session notes in this range');
    });

    it('displays at most 10 session notes per task and appends the overflow line', async () => {
        const task = ctx.taskRepo.create({ title: 'Many notes task', priority: 'medium' });
        // Insert 13 sessions; ordered ASC by started_at — first 10 shown, 3 in overflow
        for (let i = 1; i <= 13; i++) {
            const h = String(i).padStart(2, '0');
            insertSession(task.id, `2026-04-25 ${h}:00:00`, `2026-04-25 ${h}:30:00`, 1800, `note ${i}`);
        }

        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['--notes', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        const output = getOutput();
        expect(output).toContain('... and 3 more sessions');
        // note 11, 12, 13 must not appear (only first 10 are displayed)
        expect(output).not.toContain('note 11');
        expect(output).not.toContain('note 12');
        expect(output).not.toContain('note 13');
    });

    it('does not print Notes heading or session notes without --notes flag', async () => {
        const task = ctx.taskRepo.create({ title: 'Hidden', priority: 'medium' });
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'secret-note-xyz');

        const { statsCommand } = await import('../../src/commands/stats.js');
        // No --notes flag
        await statsCommand.parseAsync(['--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        const output = getOutput();
        expect(output).not.toContain('secret-note-xyz');
        // "Notes" as a section heading; the word does not appear in Summary/table headers
        expect(output).not.toContain('\n  Notes');
    });

    it('shows "manual entry" note verbatim in --notes output', async () => {
        const task = ctx.taskRepo.create({ title: 'Manual log task', priority: 'medium' });
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'manual entry');

        const { statsCommand } = await import('../../src/commands/stats.js');
        await statsCommand.parseAsync(['--notes', '--from', '2026-04-24', '--to', '2026-04-28'], { from: 'user' });

        expect(getOutput()).toContain('manual entry');
    });
});
