import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from '../../src/storage/database.js';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';

let db: Database.Database;
let repo: TaskRepository;

beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    repo = new TaskRepository(db);
});

afterEach(() => {
    db.close();
});

describe('migration 008 — parent_id', () => {
    it('adds the parent_id column and index', () => {
        const cols = (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name);
        expect(cols).toContain('parent_id');
        const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_parent'").get();
        expect(idx).toBeTruthy();
    });

    it('hard-deleting a parent SET NULLs the child (FK ON DELETE SET NULL)', () => {
        const parent = repo.create({ title: 'P' });
        const child = repo.create({ title: 'C', parentId: parent.id });
        repo.delete(parent.id);
        expect(repo.getById(child.id)?.parentId).toBeNull();
    });

    it('hard-deleting a child leaves the parent intact', () => {
        const parent = repo.create({ title: 'P' });
        const child = repo.create({ title: 'C', parentId: parent.id });
        repo.delete(child.id);
        expect(repo.getById(parent.id)).not.toBeNull();
    });
});

describe('TaskRepository — subtasks', () => {
    it('create + getById round-trips parentId', () => {
        const parent = repo.create({ title: 'P' });
        const child = repo.create({ title: 'C', parentId: parent.id });
        expect(child.parentId).toBe(parent.id);
        expect(repo.getById(child.id)?.parentId).toBe(parent.id);
    });

    it('update writes parent_id and detaches with null', () => {
        const parent = repo.create({ title: 'P' });
        const child = repo.create({ title: 'C' });
        repo.update(child.id, { parentId: parent.id });
        expect(repo.getById(child.id)?.parentId).toBe(parent.id);
        repo.update(child.id, { parentId: null });
        expect(repo.getById(child.id)?.parentId).toBeNull();
    });

    it('getChildren returns direct children', () => {
        const parent = repo.create({ title: 'P' });
        repo.create({ title: 'C1', parentId: parent.id });
        repo.create({ title: 'C2', parentId: parent.id });
        expect(repo.getChildren(parent.id).map((c) => c.title).sort()).toEqual(['C1', 'C2']);
    });

    it('list filters by parentId (children) and null (roots)', () => {
        const parent = repo.create({ title: 'P' });
        const child = repo.create({ title: 'C', parentId: parent.id });
        expect(repo.list({ parentId: parent.id }).map((t) => t.id)).toEqual([child.id]);
        expect(repo.list({ parentId: null }).map((t) => t.id)).toEqual([parent.id]);
    });

    it('getChildProgress counts done; archived children excluded from both', () => {
        const parent = repo.create({ title: 'P' });
        const a = repo.create({ title: 'A', parentId: parent.id });
        repo.create({ title: 'B', parentId: parent.id });
        const c = repo.create({ title: 'C', parentId: parent.id });
        repo.update(a.id, { status: 'done' });
        repo.archive(c.id);
        // total = A(done) + B(todo) = 2 (archived C excluded); done = A = 1
        expect(repo.getChildProgress(parent.id)).toEqual({ done: 1, total: 2 });
    });

    it('getChildProgress — in_progress child counts in total but not done', () => {
        const parent = repo.create({ title: 'P' });
        const a = repo.create({ title: 'A', parentId: parent.id }); // todo
        const b = repo.create({ title: 'B', parentId: parent.id });
        repo.update(a.id, { status: 'done' });
        repo.update(b.id, { status: 'in_progress' });
        // Both A and B are non-archived → total=2; only A completes → done=1
        expect(repo.getChildProgress(parent.id)).toEqual({ done: 1, total: 2 });
    });

    it('getChildProgress — all children archived returns zero/zero', () => {
        const parent = repo.create({ title: 'P' });
        const a = repo.create({ title: 'A', parentId: parent.id });
        const b = repo.create({ title: 'B', parentId: parent.id });
        repo.archive(a.id);
        repo.archive(b.id);
        expect(repo.getChildProgress(parent.id)).toEqual({ done: 0, total: 0 });
    });

    it('getChildProgress — no children returns zero/zero', () => {
        const parent = repo.create({ title: 'P' });
        expect(repo.getChildProgress(parent.id)).toEqual({ done: 0, total: 0 });
    });

    it('promoteChildren detaches all children and returns their ids', () => {
        const parent = repo.create({ title: 'P' });
        const c1 = repo.create({ title: 'C1', parentId: parent.id });
        const c2 = repo.create({ title: 'C2', parentId: parent.id });
        const promoted = repo.promoteChildren(parent.id).sort((x, y) => x - y);
        expect(promoted).toEqual([c1.id, c2.id]);
        expect(repo.getById(c1.id)?.parentId).toBeNull();
        expect(repo.getById(c2.id)?.parentId).toBeNull();
    });

    it('getByIdWithRelations populates children and progress', () => {
        const parent = repo.create({ title: 'P' });
        repo.create({ title: 'C', parentId: parent.id });
        const full = repo.getByIdWithRelations(parent.id);
        expect(full?.children?.length).toBe(1);
        expect(full?.progress).toEqual({ done: 0, total: 1 });
    });

    it('archiveAllDone promotes children of archived parents and reports prevStatus', () => {
        const parent = repo.create({ title: 'P' });
        const child = repo.create({ title: 'C', parentId: parent.id });
        repo.update(parent.id, { status: 'done' });
        const archived = repo.archiveAllDone();
        expect(archived).toHaveLength(1);
        expect(archived[0]).toMatchObject({ id: parent.id, prevStatus: 'done' });
        expect(archived[0].promotedChildIds).toEqual([child.id]);
        expect(repo.getById(child.id)?.parentId).toBeNull();
    });

    it('moving a subtree keeps grandchildren attached to the moved node', () => {
        const a = repo.create({ title: 'A' });
        const b = repo.create({ title: 'B', parentId: a.id });
        const c = repo.create({ title: 'C', parentId: b.id });
        const d = repo.create({ title: 'D' });
        repo.update(b.id, { parentId: d.id }); // move B (and its child C) under D
        expect(repo.getById(b.id)?.parentId).toBe(d.id);
        expect(repo.getById(c.id)?.parentId).toBe(b.id);
    });
});
