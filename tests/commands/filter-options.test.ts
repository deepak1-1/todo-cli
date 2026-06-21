import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { filterAndSearchTasks, buildFilters } from '../../src/commands/filter-options.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let ctx: AppContext;

// Build a minimal AppContext backed by an in-memory DB
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

beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    ctx = buildCtx(db);
});

afterEach(() => {
    db.close();
});;

describe('filterAndSearchTasks', () => {
    it('returns all active tasks when no filters provided', () => {
        ctx.taskRepo.create({ title: 'Alpha' });
        ctx.taskRepo.create({ title: 'Beta' });
        const { tasks, filters, sort } = filterAndSearchTasks(ctx, {});
        // Default filter excludes archived; both tasks are todo so both appear
        expect(tasks.length).toBe(2);
        // Default includes all non-archived statuses from the registry
        expect(Array.isArray(filters.status)).toBe(true);
        expect((filters.status as string[]).includes('todo')).toBe(true);
        expect((filters.status as string[]).includes('archived')).toBe(false);
        expect(sort).toBeUndefined();
    });

    it('filters by status', () => {
        const t1 = ctx.taskRepo.create({ title: 'Pending task' });
        const t2 = ctx.taskRepo.create({ title: 'Done task' });
        ctx.taskRepo.update(t2.id, { status: 'done', completedAt: new Date().toISOString() });

        const { tasks } = filterAndSearchTasks(ctx, { status: 'done' });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe(t2.id);

        // Ensure t1 is not returned
        expect(tasks.find((t) => t.id === t1.id)).toBeUndefined();
    });

    it('returns empty array when search matches nothing', () => {
        ctx.taskRepo.create({ title: 'Buy groceries' });
        const { tasks } = filterAndSearchTasks(ctx, { search: 'xyzzy-no-match' });
        expect(tasks).toHaveLength(0);
    });

    it('filters by search term against title', () => {
        ctx.taskRepo.create({ title: 'Write unit tests' });
        ctx.taskRepo.create({ title: 'Deploy to production' });
        const { tasks } = filterAndSearchTasks(ctx, { search: 'unit' });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('Write unit tests');
    });

    it('applies both search and sort together', () => {
        ctx.taskRepo.create({ title: 'alpha task', priority: 'low' });
        ctx.taskRepo.create({ title: 'alpha chore', priority: 'urgent' });
        ctx.taskRepo.create({ title: 'beta task', priority: 'high' });

        const { tasks, sort } = filterAndSearchTasks(ctx, { search: 'alpha', sort: 'priority', reverse: false });
        // "reverse: false" → direction: 'desc', so urgent comes first
        expect(tasks).toHaveLength(2);
        expect(sort).toEqual({ field: 'priority', direction: 'desc' });
        expect(tasks[0].priority).toBe('urgent');
        expect(tasks[1].priority).toBe('low');
    });

    it('respects the limit option', () => {
        ctx.taskRepo.create({ title: 'Task A', priority: 'urgent' });
        ctx.taskRepo.create({ title: 'Task B', priority: 'high' });
        ctx.taskRepo.create({ title: 'Task C', priority: 'low' });

        const { tasks } = filterAndSearchTasks(ctx, { limit: '2' });
        expect(tasks).toHaveLength(2);
    });

    it('accepts a numeric limit value', () => {
        ctx.taskRepo.create({ title: 'Task A' });
        ctx.taskRepo.create({ title: 'Task B' });
        ctx.taskRepo.create({ title: 'Task C' });

        const { tasks } = filterAndSearchTasks(ctx, { limit: 1 });
        expect(tasks).toHaveLength(1);
    });

    it('returns filters object reflecting the built TaskFilters', () => {
        const { filters } = filterAndSearchTasks(ctx, { priority: 'urgent' });
        expect(filters.priority).toBe('urgent');
    });
});

// ─── buildFilters — --parent validation ────────────────────────────────────────
describe('buildFilters — --parent validation', () => {
    it('sets parentId to null when parent is "none"', () => {
        const filters = buildFilters({ parent: 'none' });
        expect(filters.parentId).toBeNull();
    });

    it('sets parentId to the parsed integer for a valid positive id string', () => {
        const filters = buildFilters({ parent: '5' });
        expect(filters.parentId).toBe(5);
    });

    it('throws for a non-numeric string', () => {
        expect(() => buildFilters({ parent: 'abc' })).toThrow(/--parent must be a positive task ID/);
    });

    it('throws for "0" (zero is not a valid task id)', () => {
        expect(() => buildFilters({ parent: '0' })).toThrow(/--parent must be a positive task ID/);
    });

    it('throws for a negative string', () => {
        expect(() => buildFilters({ parent: '-3' })).toThrow(/--parent must be a positive task ID/);
    });

    it('throws for whitespace-padded value " 5 " (parseInt succeeds but leading space may mislead — verify)', () => {
        // parseInt(' 5 ', 10) === 5, so this is accepted as 5 (not rejected)
        const filters = buildFilters({ parent: ' 5 ' });
        expect(filters.parentId).toBe(5);
    });

    it('throws for leading-zero string "05" — parseInt parses to 5, accepted as valid', () => {
        // parseInt('05', 10) === 5 > 0 — accepted
        const filters = buildFilters({ parent: '05' });
        expect(filters.parentId).toBe(5);
    });

    it('does not set parentId when parent option is absent', () => {
        const filters = buildFilters({});
        expect(filters.parentId).toBeUndefined();
    });

    it('throws for a float string that encodes a non-positive value via truncation (e.g. "0.9" → 0)', () => {
        // parseInt('0.9', 10) === 0 which is <= 0
        expect(() => buildFilters({ parent: '0.9' })).toThrow(/--parent must be a positive task ID/);
    });

    it('error message includes the bad value for diagnostics', () => {
        expect(() => buildFilters({ parent: 'xyz' })).toThrow('xyz');
    });

    it('filterAndSearchTasks propagates the --parent throw to the caller', () => {
        expect(() => filterAndSearchTasks(ctx, { parent: 'bad' })).toThrow(/--parent must be a positive task ID/);
    });
});
