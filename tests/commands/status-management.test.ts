// Integration tests for `todo status` management subcommands.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { RESERVED_VERBS } from '../../src/commands/reserved-verbs.js';

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
        actionLog: new ActionLogRepository(database),
        depRepo: new DependencyRepository(database),
        trackingRepo: new TrackingRepository(database),
        statusRepo: new StatusRepository(database),
    };
}

vi.mock('../../src/commands/context.js', () => ({
    getContext: () => ctx,
}));

// Silence console output to avoid test noise
let exitCodeBefore: number | undefined;

beforeEach(() => {
    vi.resetModules();
    db = createTestDb();
    runMigrations(db);
    ctx = buildCtx(db);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    exitCodeBefore = process.exitCode as number | undefined;
    process.exitCode = 0;
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    process.exitCode = exitCodeBefore;
});

// ──────────────────────────────────────────────
// status list
// ──────────────────────────────────────────────
describe('status list', () => {
    it('statusRepo.list returns 6 builtin statuses out of the box', () => {
        expect(ctx.statusRepo.list()).toHaveLength(6);
    });

    it('all builtin statuses are marked isBuiltin=true', () => {
        ctx.statusRepo.list().forEach(d => expect(d.isBuiltin).toBe(true));
    });
});

// ──────────────────────────────────────────────
// status add — happy + error paths
// ──────────────────────────────────────────────
describe('status add', () => {
    it('creates a new custom status with all required fields', () => {
        const def = ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        expect(def.key).toBe('on_hold');
        expect(def.label).toBe('On Hold');
        expect(def.verb).toBe('hold');
        expect(def.isBuiltin).toBe(false);
    });

    it('created status appears in list after add', () => {
        ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        const keys = ctx.statusRepo.list().map(d => d.key);
        expect(keys).toContain('on_hold');
    });

    it('duplicate key throws', () => {
        ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        expect(() => ctx.statusRepo.create({ key: 'on_hold', label: 'Dup', verb: 'hold2' })).toThrow();
    });

    it('duplicate verb throws', () => {
        ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        expect(() => ctx.statusRepo.create({ key: 'on_hold2', label: 'Dup', verb: 'hold' })).toThrow();
    });
});

// ──────────────────────────────────────────────
// RESERVED_VERBS — cannot use reserved CLI verbs
// ──────────────────────────────────────────────
describe('RESERVED_VERBS constraint', () => {
    it('RESERVED_VERBS set is non-empty', () => {
        expect(RESERVED_VERBS.size).toBeGreaterThan(0);
    });

    it('contains common CLI subcommands', () => {
        expect(RESERVED_VERBS.has('add')).toBe(true);
        expect(RESERVED_VERBS.has('list')).toBe(true);
        expect(RESERVED_VERBS.has('edit')).toBe(true);
        expect(RESERVED_VERBS.has('delete')).toBe(true);
        expect(RESERVED_VERBS.has('status')).toBe(true);
    });

    it('contains all static command names that would collide', () => {
        // Spot-check known reserved ones
        ['add', 'list', 'ls', 'show', 'edit', 'rm', 'delete', 'bulk', 'project',
            'tag', 'stats', 'undo', 'history', 'config', 'timer', 'track',
            'integrate', 'jira', 'gh', 'mcp', 'status', 'context',
            'help', 'version',
        ].forEach(v => expect(RESERVED_VERBS.has(v)).toBe(true));
    });
});

// ──────────────────────────────────────────────
// status edit — rename + verb change + invalid key
// ──────────────────────────────────────────────
describe('status edit', () => {
    it('can rename a custom status key', () => {
        ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        const updated = ctx.statusRepo.update('on_hold', { newKey: 'paused' });
        expect(updated.key).toBe('paused');
        expect(ctx.statusRepo.getByKeyOrVerb('on_hold')).toBeUndefined();
    });

    it('can change the verb of a custom status', () => {
        ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        const updated = ctx.statusRepo.update('on_hold', { verb: 'pause' });
        expect(updated.verb).toBe('pause');
        expect(ctx.statusRepo.getByKeyOrVerb('hold')).toBeUndefined();
        expect(ctx.statusRepo.getByKeyOrVerb('pause')?.key).toBe('on_hold');
    });

    it('throws on invalid key (non-existent)', () => {
        expect(() => ctx.statusRepo.update('nonexistent', { label: 'X' })).toThrow(/not found/i);
    });

    it('can update label of a builtin status', () => {
        const updated = ctx.statusRepo.update('todo', { label: 'Backlog' });
        expect(updated.label).toBe('Backlog');
    });
});

// ──────────────────────────────────────────────
// status remove — in-use + remap
// ──────────────────────────────────────────────
describe('status remove', () => {
    it('throws when removing a status in use without remap', () => {
        ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        const task = ctx.taskRepo.create({ title: 'x' });
        ctx.taskRepo.update(task.id, { status: 'on_hold' });
        expect(() => ctx.statusRepo.delete('on_hold')).toThrow(/Provide --remap/);
    });

    it('remaps in-use tasks before removing', () => {
        ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        const task = ctx.taskRepo.create({ title: 'x' });
        ctx.taskRepo.update(task.id, { status: 'on_hold' });

        ctx.statusRepo.delete('on_hold', 'todo');

        expect(ctx.taskRepo.getById(task.id)?.status).toBe('todo');
        expect(ctx.statusRepo.getByKeyOrVerb('on_hold')).toBeUndefined();
    });

    it('throws when removing a builtin status', () => {
        expect(() => ctx.statusRepo.delete('todo')).toThrow(/builtin/i);
        expect(() => ctx.statusRepo.delete('done')).toThrow(/builtin/i);
    });

    it('throws when remap target does not exist', () => {
        ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        const task = ctx.taskRepo.create({ title: 'x' });
        ctx.taskRepo.update(task.id, { status: 'on_hold' });
        expect(() => ctx.statusRepo.delete('on_hold', 'ghost_status')).toThrow(/not found/);
    });
});

// ──────────────────────────────────────────────
// status reset
// ──────────────────────────────────────────────
describe('status reset', () => {
    it('removes all custom statuses', () => {
        ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        ctx.statusRepo.create({ key: 'needs_review', label: 'Needs Review', verb: 'needsreview' });
        ctx.statusRepo.reset();
        expect(ctx.statusRepo.list()).toHaveLength(6);
    });

    it('remaps custom-status tasks to todo', () => {
        ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        const task = ctx.taskRepo.create({ title: 'x' });
        ctx.taskRepo.update(task.id, { status: 'on_hold' });

        ctx.statusRepo.reset();

        expect(ctx.taskRepo.getById(task.id)?.status).toBe('todo');
    });

    it('does not affect tasks already on a builtin status', () => {
        const task = ctx.taskRepo.create({ title: 'x' });
        ctx.taskRepo.update(task.id, { status: 'done' });
        ctx.statusRepo.reset();
        expect(ctx.taskRepo.getById(task.id)?.status).toBe('done');
    });

    it('reset is idempotent', () => {
        ctx.statusRepo.reset();
        ctx.statusRepo.reset();
        expect(ctx.statusRepo.list()).toHaveLength(6);
    });
});

// ──────────────────────────────────────────────
// status list --json path (via statusCommand handler)
// ──────────────────────────────────────────────
describe('status list — JSON output', () => {
    it('statusRepo.list returns plain objects (JSON-serializable)', () => {
        const defs = ctx.statusRepo.list();
        const json = JSON.stringify(defs);
        const parsed = JSON.parse(json) as typeof defs;
        expect(parsed).toHaveLength(6);
        expect(parsed[0].key).toBe('todo');
    });
});
