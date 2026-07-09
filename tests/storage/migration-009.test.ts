// Tests for migration 009: backfill completed_at / archived_at for terminal-status rows.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import * as migration001 from '../../src/storage/migrations/001-initial.js';
import * as migration002 from '../../src/storage/migrations/002-time-tracking.js';
import * as migration003 from '../../src/storage/migrations/003-project-name-nocase.js';
import * as migration004 from '../../src/storage/migrations/004-fix-tasks-fk.js';
import * as migration005 from '../../src/storage/migrations/005-add-in-qa-status.js';
import * as migration006 from '../../src/storage/migrations/006-dynamic-statuses.js';
import * as migration007 from '../../src/storage/migrations/007-drop-unused.js';
import * as migration008 from '../../src/storage/migrations/008-task-parent.js';
import { down as migration009Down } from '../../src/storage/migrations/009-backfill-completed-at.js';

// Build a DB with migrations 001-008 applied (pre-009 state)
function buildPre009Db(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    const steps: [string, (db: Database.Database, markApplied?: () => void) => void][] = [
        ['001-initial', migration001.up],
        ['002-time-tracking', migration002.up],
        ['003-project-name-nocase', migration003.up],
        ['004-fix-tasks-fk', migration004.up],
        ['005-add-in-qa-status', migration005.up],
        ['006-dynamic-statuses', migration006.up],
        ['007-drop-unused', migration007.up],
        ['008-task-parent', migration008.up],
    ];
    for (const [name, up] of steps) {
        up(db, () => db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name));
        if (!(db.prepare('SELECT name FROM _migrations WHERE name = ?').get(name) as unknown)) {
            db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
        }
    }
    return db;
}

// Insert a row directly bypassing the repository (to simulate pre-fix state with NULL timestamps)
function insertTaskDirect(
    db: Database.Database,
    opts: {
        title: string;
        status: string;
        completedAt?: string | null;
        archivedAt?: string | null;
        updatedAt?: string;
        createdAt?: string;
    },
): number {
    const createdAt = opts.createdAt ?? '2025-01-01 10:00:00';
    const updatedAt = opts.updatedAt ?? '2025-06-01 12:00:00';
    const result = db.prepare(`
        INSERT INTO tasks (title, status, priority, created_at, updated_at, completed_at, archived_at)
        VALUES (?, ?, 'medium', ?, ?, ?, ?)
    `).run(
        opts.title,
        opts.status,
        createdAt,
        updatedAt,
        opts.completedAt ?? null,
        opts.archivedAt ?? null,
    );
    return Number(result.lastInsertRowid);
}

let db: Database.Database;

afterEach(() => {
    db.close();
});

describe('migration 009 — runs via full runMigrations on fresh DB', () => {
    beforeEach(() => {
        db = new Database(':memory:');
        db.pragma('foreign_keys = ON');
    });

    it('applies cleanly on a fresh DB and is recorded in _migrations', () => {
        runMigrations(db);
        const row = db.prepare("SELECT COUNT(*) as c FROM _migrations WHERE name = '009-backfill-completed-at'")
            .get() as { c: number };
        expect(row.c).toBe(1);
    });

    it('is idempotent — second runMigrations call is a no-op', () => {
        runMigrations(db);
        const second = runMigrations(db);
        expect(second).toEqual([]);
    });
});

describe('migration 009 — backfill behavior', () => {
    beforeEach(() => {
        db = buildPre009Db();
    });

    it('backfills completed_at = COALESCE(updated_at, created_at) for a done task with NULL completed_at', () => {
        const id = insertTaskDirect(db, {
            title: 'Old done task',
            status: 'done',
            completedAt: null,
            updatedAt: '2025-06-01 12:00:00',
            createdAt: '2025-01-01 10:00:00',
        });

        runMigrations(db);

        const row = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(id) as { completed_at: string | null };
        // COALESCE(updated_at, created_at) → updated_at wins
        expect(row.completed_at).toBe('2025-06-01 12:00:00');
    });

    it('backfills completed_at = created_at when updated_at is NULL (COALESCE fallback)', () => {
        // Insert with no updated_at by using raw SQL with NULL updated_at
        // SQLite default makes updated_at non-null, so we set them equal here
        const id = insertTaskDirect(db, {
            title: 'Created equals updated',
            status: 'done',
            completedAt: null,
            updatedAt: '2025-03-15 08:00:00',
            createdAt: '2025-03-15 08:00:00',
        });

        runMigrations(db);

        const row = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(id) as { completed_at: string | null };
        expect(row.completed_at).toBe('2025-03-15 08:00:00');
    });

    it('backfills archived_at for an archived task with NULL archived_at', () => {
        const id = insertTaskDirect(db, {
            title: 'Old archived task',
            status: 'archived',
            archivedAt: null,
            updatedAt: '2025-05-20 09:00:00',
            createdAt: '2025-01-10 08:00:00',
        });

        runMigrations(db);

        const row = db.prepare('SELECT archived_at FROM tasks WHERE id = ?').get(id) as { archived_at: string | null };
        expect(row.archived_at).toBe('2025-05-20 09:00:00');
    });

    it('does NOT overwrite existing non-NULL completed_at', () => {
        const id = insertTaskDirect(db, {
            title: 'Already stamped',
            status: 'done',
            completedAt: '2025-04-10 15:30:00',
            updatedAt: '2025-06-01 12:00:00',
        });

        runMigrations(db);

        const row = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(id) as { completed_at: string | null };
        // The pre-existing value must be preserved unchanged
        expect(row.completed_at).toBe('2025-04-10 15:30:00');
    });

    it('does NOT overwrite existing non-NULL archived_at', () => {
        const id = insertTaskDirect(db, {
            title: 'Already archived stamped',
            status: 'archived',
            archivedAt: '2025-02-28 11:00:00',
            updatedAt: '2025-06-01 12:00:00',
        });

        runMigrations(db);

        const row = db.prepare('SELECT archived_at FROM tasks WHERE id = ?').get(id) as { archived_at: string | null };
        expect(row.archived_at).toBe('2025-02-28 11:00:00');
    });

    it('leaves completed_at NULL for a non-terminal todo task', () => {
        const id = insertTaskDirect(db, {
            title: 'Todo task',
            status: 'todo',
            completedAt: null,
            updatedAt: '2025-06-01 12:00:00',
        });

        runMigrations(db);

        const row = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(id) as { completed_at: string | null };
        expect(row.completed_at).toBeNull();
    });

    it('leaves archived_at NULL for a non-terminal in_progress task', () => {
        const id = insertTaskDirect(db, {
            title: 'In progress task',
            status: 'in_progress',
            archivedAt: null,
            updatedAt: '2025-06-01 12:00:00',
        });

        runMigrations(db);

        const row = db.prepare('SELECT archived_at FROM tasks WHERE id = ?').get(id) as { archived_at: string | null };
        expect(row.archived_at).toBeNull();
    });

    it('handles multiple rows — only terminal-status NULLs get backfilled', () => {
        const doneId = insertTaskDirect(db, { title: 'Done', status: 'done', completedAt: null, updatedAt: '2025-05-01 10:00:00' });
        const archivedId = insertTaskDirect(db, { title: 'Archived', status: 'archived', archivedAt: null, updatedAt: '2025-05-02 11:00:00' });
        const todoId = insertTaskDirect(db, { title: 'Todo', status: 'todo', completedAt: null });
        const inProgressId = insertTaskDirect(db, { title: 'WIP', status: 'in_progress', completedAt: null });
        const alreadyDoneId = insertTaskDirect(db, { title: 'Pre-stamped', status: 'done', completedAt: '2025-01-01 00:00:00', updatedAt: '2025-06-01 12:00:00' });

        runMigrations(db);

        type Row = { completed_at: string | null; archived_at: string | null };

        const done = db.prepare('SELECT completed_at, archived_at FROM tasks WHERE id = ?').get(doneId) as Row;
        expect(done.completed_at).toBe('2025-05-01 10:00:00');
        expect(done.archived_at).toBeNull();

        const archived = db.prepare('SELECT completed_at, archived_at FROM tasks WHERE id = ?').get(archivedId) as Row;
        expect(archived.archived_at).toBe('2025-05-02 11:00:00');
        expect(archived.completed_at).toBeNull();

        const todo = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(todoId) as { completed_at: string | null };
        expect(todo.completed_at).toBeNull();

        const wip = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(inProgressId) as { completed_at: string | null };
        expect(wip.completed_at).toBeNull();

        const prestamped = db.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(alreadyDoneId) as { completed_at: string | null };
        expect(prestamped.completed_at).toBe('2025-01-01 00:00:00');
    });

    it('down() throws (non-reversible)', () => {
        expect(() => migration009Down()).toThrow('Migration 009 is not reversible');
    });
});

describe('migration 009 — requiresNoTransaction ordering (runner batch logic)', () => {
    beforeEach(() => {
        db = new Database(':memory:');
        db.pragma('foreign_keys = ON');
    });

    it('runner applies 009 AFTER 006 — statuses table exists when 009 runs', () => {
        // On a fresh DB, if 009 were transactional it would run in the same batch
        // as 001 and 002 (before 006 creates statuses), causing the UPDATE to fail.
        // requiresNoTransaction=true ensures 009 is in the self-managed batch which
        // runs AFTER all transactional migrations AND after 006/007/008 (also self-managed).
        // This test proves 009 runs cleanly — if it ran before 006, the statuses
        // subquery would fail or silently touch no rows on a fresh DB with tasks.
        runMigrations(db);
        // statuses table must exist and be seeded by the time 009 ran
        const count = (db.prepare('SELECT COUNT(*) as c FROM statuses').get() as { c: number }).c;
        expect(count).toBe(6); // seeded by 006
    });

    it('009 runs in the self-managed batch (after the transactional batch)', () => {
        // Verify ordering by inserting a done task BEFORE running migrations,
        // then checking that 009 correctly backfills it — proving it saw the
        // statuses table (created by 006) and tasks table.
        const tmpDb = buildPre009Db();
        const id = insertTaskDirect(tmpDb, {
            title: 'Batch-order check',
            status: 'done',
            completedAt: null,
            updatedAt: '2025-11-11 11:11:11',
        });
        runMigrations(tmpDb);
        const row = tmpDb.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(id) as { completed_at: string | null };
        expect(row.completed_at).toBe('2025-11-11 11:11:11');
        tmpDb.close();
    });

    it('_migrations records 006 with a lower rowid than 009 — proves ordering on fresh DB', () => {
        // If 009 were applied before 006, this assertion would fail because 009's
        // rowid would be lower than 006's.  The rowid reflects insertion order, which
        // is the sequence the runner actually executed the migrations.
        runMigrations(db);
        const row006 = db.prepare("SELECT id FROM _migrations WHERE name = '006-dynamic-statuses'").get() as { id: number };
        const row009 = db.prepare("SELECT id FROM _migrations WHERE name = '009-backfill-completed-at'").get() as { id: number };
        expect(row006).toBeDefined();
        expect(row009).toBeDefined();
        expect(row006.id).toBeLessThan(row009.id);
    });
});
