// Tests for migration 008: subtask hierarchy — tasks.parent_id.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { up as up008 } from '../../src/storage/migrations/008-task-parent.js';
import * as migration001 from '../../src/storage/migrations/001-initial.js';
import * as migration002 from '../../src/storage/migrations/002-time-tracking.js';
import * as migration003 from '../../src/storage/migrations/003-project-name-nocase.js';
import * as migration004 from '../../src/storage/migrations/004-fix-tasks-fk.js';
import * as migration005 from '../../src/storage/migrations/005-add-in-qa-status.js';
import * as migration006 from '../../src/storage/migrations/006-dynamic-statuses.js';
import * as migration007 from '../../src/storage/migrations/007-drop-unused.js';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.some((r) => r.name === column);
}

function hasIndex(db: Database.Database, name: string): boolean {
    const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(name);
    return !!row;
}

// Build a DB with migrations 001-007 applied (pre-008 state).
function buildPre008Db(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    const steps: [string, (db: Database.Database) => void][] = [
        ['001-initial', migration001.up],
        ['002-time-tracking', migration002.up],
        ['003-project-name-nocase', migration003.up],
        ['004-fix-tasks-fk', migration004.up],
        ['005-add-in-qa-status', migration005.up],
        ['006-dynamic-statuses', migration006.up],
        ['007-drop-unused', migration007.up],
    ];
    for (const [name, up] of steps) {
        up(db);
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
    }
    return db;
}

let db: Database.Database;

afterEach(() => {
    db.close();
});

describe('migration 008 — pre-008 state lacks parent_id', () => {
    beforeEach(() => {
        db = buildPre008Db();
    });

    it('does not have parent_id column or idx_tasks_parent index before 008', () => {
        expect(hasColumn(db, 'tasks', 'parent_id')).toBe(false);
        expect(hasIndex(db, 'idx_tasks_parent')).toBe(false);
    });

    it('adds parent_id column and idx_tasks_parent index when applied', () => {
        up008(db);
        expect(hasColumn(db, 'tasks', 'parent_id')).toBe(true);
        expect(hasIndex(db, 'idx_tasks_parent')).toBe(true);
    });

    it('records itself via markApplied inside its own transaction', () => {
        let recorded = false;
        up008(db, () => {
            db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('008-task-parent');
            recorded = true;
        });
        expect(recorded).toBe(true);
        const row = db.prepare('SELECT name FROM _migrations WHERE name = ?').get('008-task-parent');
        expect(row).toBeDefined();
    });

    it('rolls back the ALTER + INDEX if markApplied throws after inserting the row', () => {
        expect(() => {
            up008(db, () => {
                db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('008-task-parent');
                throw new Error('simulated crash after record insert');
            });
        }).toThrow(/simulated crash/);

        // The whole transaction — ALTER, INDEX, and the _migrations row — rolled back together.
        expect(hasColumn(db, 'tasks', 'parent_id')).toBe(false);
        expect(hasIndex(db, 'idx_tasks_parent')).toBe(false);
        const row = db.prepare('SELECT name FROM _migrations WHERE name = ?').get('008-task-parent');
        expect(row).toBeUndefined();
    });
});

describe('migration 008 — via full runMigrations', () => {
    beforeEach(() => {
        db = new Database(':memory:');
        db.pragma('foreign_keys = ON');
    });

    it('applies 008 exactly once and adds the parent_id column', () => {
        runMigrations(db);
        expect(hasColumn(db, 'tasks', 'parent_id')).toBe(true);
        expect(hasIndex(db, 'idx_tasks_parent')).toBe(true);

        const count = (
            db.prepare('SELECT COUNT(*) as c FROM _migrations WHERE name = ?').get('008-task-parent') as { c: number }
        ).c;
        expect(count).toBe(1);
    });

    it('is idempotent across repeated runMigrations calls', () => {
        runMigrations(db);
        const second = runMigrations(db);
        expect(second).toEqual([]);
    });

    it('regression: BUG — crash between schema commit and runner record no longer bricks startup', () => {
        // Simulate a process kill immediately after 008's own transaction commits
        // (schema + _migrations row already durable) but before control returns to
        // the caller — i.e. the exact window the original bug lived in. Re-running
        // runMigrations() on "restart" must see 008 as already applied and must NOT
        // attempt to re-run it (which would throw "duplicate column name: parent_id").
        const first = runMigrations(db);
        expect(first).toContain('008-task-parent');

        expect(() => runMigrations(db)).not.toThrow();
        const rerun = runMigrations(db);
        expect(rerun).toEqual([]);

        const count = (
            db.prepare('SELECT COUNT(*) as c FROM _migrations WHERE name = ?').get('008-task-parent') as { c: number }
        ).c;
        expect(count).toBe(1);
        expect(hasColumn(db, 'tasks', 'parent_id')).toBe(true);
    });
});
