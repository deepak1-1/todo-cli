// Tests for migration 007: drop unused columns and tables.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { up as up007 } from '../../src/storage/migrations/007-drop-unused.js';
import * as migration001 from '../../src/storage/migrations/001-initial.js';
import * as migration002 from '../../src/storage/migrations/002-time-tracking.js';
import * as migration003 from '../../src/storage/migrations/003-project-name-nocase.js';
import * as migration004 from '../../src/storage/migrations/004-fix-tasks-fk.js';
import * as migration005 from '../../src/storage/migrations/005-add-in-qa-status.js';
import * as migration006 from '../../src/storage/migrations/006-dynamic-statuses.js';

function hasColumn(db: Database.Database, table: string, column: string): boolean {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.some((r) => r.name === column);
}

function hasTable(db: Database.Database, name: string): boolean {
    const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name);
    return !!row;
}

// Build a DB with migrations 001-006 applied (pre-007 state).
function buildPre007Db(): Database.Database {
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

describe('migration 007 — pre-007 state has the columns/tables it drops', () => {
    beforeEach(() => {
        db = buildPre007Db();
    });

    it('has gitlab_ref / linear_ref columns and the unused tables before 007', () => {
        expect(hasColumn(db, 'tasks', 'gitlab_ref')).toBe(true);
        expect(hasColumn(db, 'tasks', 'linear_ref')).toBe(true);
        expect(hasTable(db, 'integration_config')).toBe(true);
        expect(hasTable(db, 'pomodoro_sessions')).toBe(true);
    });

    it('drops the columns and tables when applied', () => {
        up007(db);
        expect(hasColumn(db, 'tasks', 'gitlab_ref')).toBe(false);
        expect(hasColumn(db, 'tasks', 'linear_ref')).toBe(false);
        expect(hasTable(db, 'integration_config')).toBe(false);
        expect(hasTable(db, 'pomodoro_sessions')).toBe(false);
    });

    it('records itself via markApplied inside its own transaction', () => {
        let recorded = false;
        up007(db, () => {
            db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('007-drop-unused');
            recorded = true;
        });
        expect(recorded).toBe(true);
        const row = db.prepare('SELECT name FROM _migrations WHERE name = ?').get('007-drop-unused');
        expect(row).toBeDefined();
    });
});

describe('migration 007 — via full runMigrations', () => {
    beforeEach(() => {
        db = new Database(':memory:');
        db.pragma('foreign_keys = ON');
    });

    it('applies 007 exactly once and removes the dropped columns/tables', () => {
        runMigrations(db);
        expect(hasColumn(db, 'tasks', 'gitlab_ref')).toBe(false);
        expect(hasColumn(db, 'tasks', 'linear_ref')).toBe(false);
        expect(hasTable(db, 'integration_config')).toBe(false);
        expect(hasTable(db, 'pomodoro_sessions')).toBe(false);

        const count = (
            db.prepare('SELECT COUNT(*) as c FROM _migrations WHERE name = ?').get('007-drop-unused') as { c: number }
        ).c;
        expect(count).toBe(1);
    });

    it('is idempotent across repeated runMigrations calls', () => {
        runMigrations(db);
        const second = runMigrations(db);
        expect(second).toEqual([]);
    });
});
