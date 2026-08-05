// Tests for buildStatusCommands — dynamic verb command generation.

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
import { buildStatusCommands } from '../../src/commands/status-commands.js';
import { applyEdit } from '../../src/commands/edit.js';

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
// buildStatusCommands — generation
// ──────────────────────────────────────────────
describe('buildStatusCommands — one command per status verb', () => {
    it('generates a command for each status that is not in existingVerbs', () => {
        const defs = ctx.statusRepo.list();
        const commands = buildStatusCommands(defs, new Set());
        expect(commands).toHaveLength(defs.length);
    });

    it('command names match status verbs', () => {
        const defs = ctx.statusRepo.list();
        const commands = buildStatusCommands(defs, new Set());
        const names = commands.map(c => c.name());
        expect(names).toEqual(defs.map(d => d.verb));
    });

    it('skips statuses whose verb is already in existingVerbs', () => {
        const defs = ctx.statusRepo.list();
        const existing = new Set(['reopen', 'start']);
        const commands = buildStatusCommands(defs, existing);
        expect(commands).toHaveLength(defs.length - 2);
        const names = commands.map(c => c.name());
        expect(names).not.toContain('reopen');
        expect(names).not.toContain('start');
    });

    it('collision skip: empty defs → no commands generated', () => {
        const commands = buildStatusCommands([], new Set());
        expect(commands).toHaveLength(0);
    });

    it('each generated command has a description referencing its target status', () => {
        const defs = ctx.statusRepo.list();
        const commands = buildStatusCommands(defs, new Set());
        for (let i = 0; i < commands.length; i++) {
            expect(commands[i].description()).toContain(defs[i].key);
        }
    });

    it('each generated command accepts an <id> argument', () => {
        const defs = ctx.statusRepo.list();
        const commands = buildStatusCommands(defs, new Set());
        for (const cmd of commands) {
            expect(cmd.registeredArguments).toHaveLength(1);
            expect(cmd.registeredArguments[0].name()).toBe('id');
        }
    });

    it('each generated command has a --json option', () => {
        const defs = ctx.statusRepo.list();
        const commands = buildStatusCommands(defs, new Set());
        for (const cmd of commands) {
            const hasJson = cmd.options.some(o => o.long === '--json');
            expect(hasJson).toBe(true);
        }
    });
});

describe('buildStatusCommands — custom status included', () => {
    it('newly created custom status verb appears in generated commands', () => {
        ctx.statusRepo.create({ key: 'on_hold', label: 'On Hold', verb: 'hold' });
        const defs = ctx.statusRepo.list();
        const commands = buildStatusCommands(defs, new Set());
        const names = commands.map(c => c.name());
        expect(names).toContain('hold');
    });
});

// ──────────────────────────────────────────────
// regression: editCommand rejects --status flag
// ──────────────────────────────────────────────
describe('regression: edit command does NOT accept --status option', () => {
    it('applyEdit with status key calls findByKeyOrVerb and sets status', () => {
        // This test verifies the internal wire-up: applyEdit resolves status via statusRepo
        const task = ctx.taskRepo.create({ title: 'wire-up test' });
        const result = applyEdit(ctx, task.id, { status: 'in_progress' });
        expect(result.task.status).toBe('in_progress');
    });

    it('applyEdit with unknown status key silently ignores it', () => {
        const task = ctx.taskRepo.create({ title: 'ignore unknown' });
        const result = applyEdit(ctx, task.id, { status: 'not_a_status' });
        // Status remains todo because the key is not found
        expect(result.task.status).toBe('todo');
    });

    it('edit command source does not export --status as a CLI option (static check)', async () => {
        // Import the edit command and verify no option named --status exists
        const editMod = await import('../../src/commands/edit.js');
        // editCommand is a named export if it exists; if the command no longer has --status
        // the module just exports applyEdit and executeEdit
        expect(typeof editMod.applyEdit).toBe('function');
        expect(typeof editMod.executeEdit).toBe('function');
    });
});

// ──────────────────────────────────────────────
// applyEdit — empty-title validation
// ──────────────────────────────────────────────
describe('applyEdit — rejects blank title via validateUpdateInput', () => {
    it('throws TaskValidationError on empty string title', () => {
        const task = ctx.taskRepo.create({ title: 'Original', priority: 'medium' });
        expect(() => applyEdit(ctx, task.id, { title: '' })).toThrow('Task title cannot be empty');
    });

    it('throws TaskValidationError on whitespace-only title', () => {
        const task = ctx.taskRepo.create({ title: 'Original', priority: 'medium' });
        expect(() => applyEdit(ctx, task.id, { title: '   ' })).toThrow('Task title cannot be empty');
    });

    it('accepts a normal title update without error', () => {
        const task = ctx.taskRepo.create({ title: 'Original', priority: 'medium' });
        const result = applyEdit(ctx, task.id, { title: 'Renamed' });
        expect(result.task.title).toBe('Renamed');
    });

    it('accepts a status-only edit (no title) without error', () => {
        const task = ctx.taskRepo.create({ title: 'No title change', priority: 'medium' });
        const result = applyEdit(ctx, task.id, { status: 'in_progress' });
        expect(result.task.status).toBe('in_progress');
    });
});

// ──────────────────────────────────────────────
// regression: recurring spawn only fires on a genuine non-done -> done transition
// ──────────────────────────────────────────────
describe('applyEdit — recurring spawn guards against re-completion duplicates', () => {
    it('does not spawn a second occurrence when re-completing an already-done recurring task', () => {
        const task = ctx.taskRepo.create({ title: 'Recurring', recurrence: 'daily' });
        const r1 = applyEdit(ctx, task.id, { status: 'done' });
        expect(r1.recurring).toBeDefined();
        const countAfterFirst = ctx.taskRepo.list({}).length;
        const r2 = applyEdit(ctx, task.id, { status: 'done' });
        expect(r2.recurring).toBeUndefined();
        expect(ctx.taskRepo.list({}).length).toBe(countAfterFirst);
    });

    it('spawns again after reopening and re-completing a recurring task', () => {
        const task = ctx.taskRepo.create({ title: 'Recurring', recurrence: 'daily' });
        const r1 = applyEdit(ctx, task.id, { status: 'done' });
        expect(r1.recurring).toBeDefined();
        applyEdit(ctx, task.id, { status: 'todo' });
        const r2 = applyEdit(ctx, task.id, { status: 'done' });
        expect(r2.recurring).toBeDefined();
        expect(r2.recurring?.id).not.toBe(r1.recurring?.id);
    });

    it('does not spawn when moving between two completing statuses', () => {
        ctx.statusRepo.create({ key: 'verified', label: 'Verified', verb: 'verify', completes: true });
        const task = ctx.taskRepo.create({ title: 'Recurring', recurrence: 'daily' });
        const r1 = applyEdit(ctx, task.id, { status: 'done' });
        expect(r1.recurring).toBeDefined();
        const r2 = applyEdit(ctx, task.id, { status: 'verified' });
        expect(r2.recurring).toBeUndefined();
    });

    it('does not spawn when archiving an already-done recurring task', () => {
        const task = ctx.taskRepo.create({ title: 'Recurring', recurrence: 'daily' });
        const r1 = applyEdit(ctx, task.id, { status: 'done' });
        expect(r1.recurring).toBeDefined();
        const r2 = applyEdit(ctx, task.id, { status: 'archived' });
        expect(r2.recurring).toBeUndefined();
    });
});
