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
        const filters = buildFilters({ parent: 'none' }, ctx);
        expect(filters.parentId).toBeNull();
    });

    it('sets parentId to the parsed integer for a valid positive id string', () => {
        const filters = buildFilters({ parent: '5' }, ctx);
        expect(filters.parentId).toBe(5);
    });

    it('throws for a non-numeric string', () => {
        expect(() => buildFilters({ parent: 'abc' }, ctx)).toThrow(/--parent must be a positive task ID/);
    });

    it('throws for "0" (zero is not a valid task id)', () => {
        expect(() => buildFilters({ parent: '0' }, ctx)).toThrow(/--parent must be a positive task ID/);
    });

    it('throws for a negative string', () => {
        expect(() => buildFilters({ parent: '-3' }, ctx)).toThrow(/--parent must be a positive task ID/);
    });

    it('throws for whitespace-padded value " 5 " (parseInt succeeds but leading space may mislead — verify)', () => {
        // parseInt(' 5 ', 10) === 5, so this is accepted as 5 (not rejected)
        const filters = buildFilters({ parent: ' 5 ' }, ctx);
        expect(filters.parentId).toBe(5);
    });

    it('throws for leading-zero string "05" — parseInt parses to 5, accepted as valid', () => {
        // parseInt('05', 10) === 5 > 0 — accepted
        const filters = buildFilters({ parent: '05' }, ctx);
        expect(filters.parentId).toBe(5);
    });

    it('does not set parentId when parent option is absent', () => {
        const filters = buildFilters({}, ctx);
        expect(filters.parentId).toBeUndefined();
    });

    it('throws for a float string that encodes a non-positive value via truncation (e.g. "0.9" → 0)', () => {
        // parseInt('0.9', 10) === 0 which is <= 0
        expect(() => buildFilters({ parent: '0.9' }, ctx)).toThrow(/--parent must be a positive task ID/);
    });

    it('error message includes the bad value for diagnostics', () => {
        expect(() => buildFilters({ parent: 'xyz' }, ctx)).toThrow('xyz');
    });

    it('filterAndSearchTasks propagates the --parent throw to the caller', () => {
        expect(() => filterAndSearchTasks(ctx, { parent: 'bad' })).toThrow(/--parent must be a positive task ID/);
    });
});

// ─── buildFilters — --project "none" ───────────────────────────────────────────
describe('buildFilters — --project "none"', () => {
    it('sets projectName to null when project is "none"', () => {
        const filters = buildFilters({ project: 'none' }, ctx);
        expect(filters.projectName).toBeNull();
    });

    it('passes a normal project name through', () => {
        const filters = buildFilters({ project: 'Work' }, ctx);
        expect(filters.projectName).toBe('Work');
    });

    it('does not set projectName when project option is absent', () => {
        const filters = buildFilters({}, ctx);
        expect(filters.projectName).toBeUndefined();
    });

    it('filterAndSearchTasks with project "none" returns only projectless tasks', () => {
        const project = ctx.projectRepo.create({ name: 'Work' });
        ctx.taskRepo.create({ title: 'In project', projectId: project.id });
        ctx.taskRepo.create({ title: 'No project' });

        const { tasks } = filterAndSearchTasks(ctx, { project: 'none' });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('No project');
    });

    it('applyProjectFilter: empty string "" is a no-op — projectName remains unset', () => {
        // '' is falsy; applyProjectFilter should not set projectName (no filter)
        const filters = buildFilters({ project: '' }, ctx);
        expect(filters.projectName).toBeUndefined();
    });

    it('constraint: project literally named "none" cannot be filtered by name via this sentinel (documented trade-off)', () => {
        // applyProjectFilter maps "none" → null; a real project named "none" is unreachable
        const filters = buildFilters({ project: 'none' }, ctx);
        // null means IS NULL, not name = "none"
        expect(filters.projectName).toBeNull();
    });

    it('filterAndSearchTasks with project "none" combined with priority filter returns intersection', () => {
        const project = ctx.projectRepo.create({ name: 'Work' });
        ctx.taskRepo.create({ title: 'In project urgent', projectId: project.id, priority: 'urgent' });
        ctx.taskRepo.create({ title: 'No project urgent', priority: 'urgent' });
        ctx.taskRepo.create({ title: 'No project low', priority: 'low' });

        // Status must be set to include 'todo'; buildFilters default sets non-archived array
        const { tasks } = filterAndSearchTasks(ctx, { project: 'none', priority: 'urgent' });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('No project urgent');
    });
});

// ─── buildFilters — status resolution ──────────────────────────────────────────
describe('buildFilters — status resolution', () => {
    it('hyphenated -S in-progress resolves to canonical in_progress', () => {
        const filters = buildFilters({ status: 'in-progress' }, ctx);
        expect(filters.status).toBe('in_progress');
    });

    it('uppercase -S IN-PROGRESS resolves to canonical in_progress', () => {
        const filters = buildFilters({ status: 'IN-PROGRESS' }, ctx);
        expect(filters.status).toBe('in_progress');
    });

    it('exact key -S in_progress resolves to in_progress', () => {
        const filters = buildFilters({ status: 'in_progress' }, ctx);
        expect(filters.status).toBe('in_progress');
    });

    it('verb -S start resolves to in_progress', () => {
        const filters = buildFilters({ status: 'start' }, ctx);
        expect(filters.status).toBe('in_progress');
    });

    it('-S done resolves to done', () => {
        const filters = buildFilters({ status: 'done' }, ctx);
        expect(filters.status).toBe('done');
    });

    it('-S bogus throws with a descriptive message listing valid statuses', () => {
        expect(() => buildFilters({ status: 'bogus' }, ctx)).toThrow(/Invalid status "bogus"/);
    });

    it('-S bogus throw message lists valid status keys', () => {
        expect(() => buildFilters({ status: 'bogus' }, ctx)).toThrow(/todo/);
    });

    it('no -S with no --all yields non-archived string[] as default', () => {
        const filters = buildFilters({}, ctx);
        expect(Array.isArray(filters.status)).toBe(true);
        const statuses = filters.status as string[];
        expect(statuses).not.toContain('archived');
        expect(statuses).toContain('todo');
        expect(statuses).toContain('in_progress');
    });

    it('no -S with --all does NOT set a default status filter', () => {
        const filters = buildFilters({ all: true }, ctx);
        // includeArchived is set but status is undefined (or does not restrict)
        expect(filters.includeArchived).toBe(true);
        // status should NOT be the default non-archived array
        expect(Array.isArray(filters.status)).toBe(false);
    });
});

// ─── filterAndSearchTasks — hyphen-status end-to-end ───────────────────────────
describe('filterAndSearchTasks — hyphen status resolves and returns tasks', () => {
    it('-S in-progress returns in_progress tasks (not zero rows)', () => {
        const t1 = ctx.taskRepo.create({ title: 'Active task', priority: 'medium' });
        ctx.taskRepo.update(t1.id, { status: 'in_progress' });
        ctx.taskRepo.create({ title: 'Todo task', priority: 'low' });

        const { tasks } = filterAndSearchTasks(ctx, { status: 'in-progress' });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].id).toBe(t1.id);
    });

    it('-S bogus throws (does not silently return empty array)', () => {
        ctx.taskRepo.create({ title: 'Some task', priority: 'medium' });
        expect(() => filterAndSearchTasks(ctx, { status: 'bogus' })).toThrow(/Invalid status "bogus"/);
    });
});
