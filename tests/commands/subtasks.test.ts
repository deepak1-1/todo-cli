import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
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
import { applyEdit } from '../../src/commands/edit.js';
import { applyDelete } from '../../src/commands/delete.js';

let db: Database.Database;
let ctx: AppContext;

beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    ctx = {
        taskRepo: new TaskRepository(db),
        projectRepo: new ProjectRepository(db),
        tagRepo: new TagRepository(db),
        actionLog: new ActionLogRepository(db),
        depRepo: new DependencyRepository(db),
        trackingRepo: new TrackingRepository(db),
        statusRepo: new StatusRepository(db),
    };
});

afterEach(() => {
    db.close();
});

describe('applyEdit — parent', () => {
    it('sets a valid parent', () => {
        const p = ctx.taskRepo.create({ title: 'P' });
        const c = ctx.taskRepo.create({ title: 'C' });
        applyEdit(ctx, c.id, { parent: String(p.id) });
        expect(ctx.taskRepo.getById(c.id)?.parentId).toBe(p.id);
    });

    it('detaches with --no-parent (parent=false)', () => {
        const p = ctx.taskRepo.create({ title: 'P' });
        const c = ctx.taskRepo.create({ title: 'C', parentId: p.id });
        applyEdit(ctx, c.id, { parent: false });
        expect(ctx.taskRepo.getById(c.id)?.parentId).toBeNull();
    });

    it('rejects a non-existent parent', () => {
        const c = ctx.taskRepo.create({ title: 'C' });
        expect(() => applyEdit(ctx, c.id, { parent: '999' })).toThrow(/not found/);
    });

    it('rejects a cycle (descendant as parent)', () => {
        const a = ctx.taskRepo.create({ title: 'A' });
        const b = ctx.taskRepo.create({ title: 'B', parentId: a.id });
        expect(() => applyEdit(ctx, a.id, { parent: String(b.id) })).toThrow(/cycle/);
    });

    it('rejects self as parent', () => {
        const a = ctx.taskRepo.create({ title: 'A' });
        expect(() => applyEdit(ctx, a.id, { parent: String(a.id) })).toThrow(/cycle/);
    });
});

describe('applyDelete — soft delete promotes children, undo re-parents', () => {
    it('promotes children to root on archive and records promotedChildIds', () => {
        const p = ctx.taskRepo.create({ title: 'P' });
        const c = ctx.taskRepo.create({ title: 'C', parentId: p.id });
        applyDelete(ctx, p.id);
        expect(ctx.taskRepo.getById(c.id)?.parentId).toBeNull();

        const last = ctx.actionLog.getLast();
        expect(last?.action).toBe('archive');
        const prev = JSON.parse(last!.prevState!);
        expect(prev.promotedChildIds).toEqual([c.id]);
    });

    it('undo of archive re-attaches promoted children to the parent', () => {
        // Set up: archive parent (which promotes child), then manually execute undo logic
        const p = ctx.taskRepo.create({ title: 'P' });
        const c = ctx.taskRepo.create({ title: 'C', parentId: p.id });
        applyDelete(ctx, p.id);

        // Child is now a root
        expect(ctx.taskRepo.getById(c.id)?.parentId).toBeNull();

        // Simulate undo: parse prevState, restore parent status, re-parent children
        const last = ctx.actionLog.getLast()!;
        const prev = JSON.parse(last.prevState!);
        ctx.taskRepo.update(last.taskId!, { status: prev.status || 'todo', archivedAt: null });
        for (const childId of prev.promotedChildIds as number[]) {
            ctx.taskRepo.update(childId, { parentId: last.taskId });
        }

        // After undo: parent unarchived, child re-attached
        expect(ctx.taskRepo.getById(p.id)?.status).toBe('todo');
        expect(ctx.taskRepo.getById(c.id)?.parentId).toBe(p.id);
    });

    it('hard-delete via applyDelete force:true triggers FK SET NULL on child parentId', () => {
        const p = ctx.taskRepo.create({ title: 'P' });
        const c = ctx.taskRepo.create({ title: 'C', parentId: p.id });
        applyDelete(ctx, p.id, { force: true });
        // Parent is gone; child still exists with NULL parent_id (FK ON DELETE SET NULL)
        expect(ctx.taskRepo.getById(p.id)).toBeNull();
        expect(ctx.taskRepo.getById(c.id)?.parentId).toBeNull();
    });
});

describe('applyEdit — undo restores previous parentId', () => {
    it('update action stores full task including parentId in prevState, and undo reverses the re-parent', () => {
        const parent1 = ctx.taskRepo.create({ title: 'Parent1' });
        const parent2 = ctx.taskRepo.create({ title: 'Parent2' });
        const child = ctx.taskRepo.create({ title: 'Child', parentId: parent1.id });

        // Move child under parent2 — this logs an 'update' action with prevState = task before edit
        applyEdit(ctx, child.id, { parent: String(parent2.id) });
        expect(ctx.taskRepo.getById(child.id)?.parentId).toBe(parent2.id);

        // Find the update action log entry
        const last = ctx.actionLog.getLast()!;
        expect(last.action).toBe('update');
        const prev = JSON.parse(last.prevState!);
        // prevState captured the task before the edit; parentId was parent1.id
        expect(prev.parentId).toBe(parent1.id);

        // Simulate undo: pass the full prevState back to update()
        ctx.taskRepo.update(last.taskId!, prev);
        expect(ctx.taskRepo.getById(child.id)?.parentId).toBe(parent1.id);
    });

    it('detaching (parent=false) is also reversed by undo', () => {
        const p = ctx.taskRepo.create({ title: 'P' });
        const c = ctx.taskRepo.create({ title: 'C', parentId: p.id });

        applyEdit(ctx, c.id, { parent: false });
        expect(ctx.taskRepo.getById(c.id)?.parentId).toBeNull();

        const last = ctx.actionLog.getLast()!;
        const prev = JSON.parse(last.prevState!);
        expect(prev.parentId).toBe(p.id);

        ctx.taskRepo.update(last.taskId!, prev);
        expect(ctx.taskRepo.getById(c.id)?.parentId).toBe(p.id);
    });
});
