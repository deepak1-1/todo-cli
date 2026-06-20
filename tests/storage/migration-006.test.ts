// Tests for migration 006: dynamic-statuses schema change.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { up } from '../../src/storage/migrations/006-dynamic-statuses.js';
import * as migration001 from '../../src/storage/migrations/001-initial.js';
import * as migration002 from '../../src/storage/migrations/002-time-tracking.js';
import * as migration003 from '../../src/storage/migrations/003-project-name-nocase.js';
import * as migration004 from '../../src/storage/migrations/004-fix-tasks-fk.js';
import * as migration005 from '../../src/storage/migrations/005-add-in-qa-status.js';

// Build a DB that has only migrations 001-005 applied (pre-006 state)
function buildPre006Db(): Database.Database {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    // tracking table
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
    // apply 001 through 005 in order
    migration001.up(db);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('001-initial');
    migration002.up(db);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('002-time-tracking');
    migration003.up(db);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('003-project-name-nocase');
    migration004.up(db);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('004-fix-tasks-fk');
    migration005.up(db);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run('005-add-in-qa-status');
    return db;
}

let db: Database.Database;

beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
});

afterEach(() => {
    db.close();
});

describe('migration 006 — statuses table seeded with 6 rows', () => {
    it('seeds exactly 6 builtin statuses after full migration', () => {
        runMigrations(db);
        const count = (db.prepare('SELECT COUNT(*) as c FROM statuses').get() as { c: number }).c;
        expect(count).toBe(6);
    });

    it('every seeded status has a non-null, non-empty verb', () => {
        runMigrations(db);
        const rows = db.prepare("SELECT verb FROM statuses WHERE verb IS NULL OR verb = ''").all();
        expect(rows).toHaveLength(0);
    });

    it('seeds the 6 expected keys', () => {
        runMigrations(db);
        const rows = db.prepare('SELECT key FROM statuses ORDER BY sort_order').all() as { key: string }[];
        expect(rows.map(r => r.key)).toEqual([
            'todo', 'in_progress', 'in_review', 'blocked', 'done', 'archived',
        ]);
    });

    it('seeds the 6 expected verbs (each unique)', () => {
        runMigrations(db);
        const rows = db.prepare('SELECT verb FROM statuses ORDER BY sort_order').all() as { verb: string }[];
        expect(rows.map(r => r.verb)).toEqual([
            'reopen', 'start', 'review', 'block', 'done', 'archive',
        ]);
        // Verify uniqueness
        const verbs = rows.map(r => r.verb);
        expect(new Set(verbs).size).toBe(verbs.length);
    });

    it('marks all 6 seeded statuses as builtin', () => {
        runMigrations(db);
        const nonBuiltin = (db.prepare('SELECT COUNT(*) as c FROM statuses WHERE is_builtin = 0').get() as { c: number }).c;
        expect(nonBuiltin).toBe(0);
    });
});

describe('migration 006 — row-count preservation', () => {
    it('preserves task row count across the migration', () => {
        const pre = buildPre006Db();

        // Insert 5 tasks with old status values
        pre.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('A', 'pending');
        pre.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('B', 'in_progress');
        pre.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('C', 'in_qa');
        pre.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('D', 'done');
        pre.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('E', 'archived');
        const preCt = (pre.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number }).c;

        up(pre);

        const postCt = (pre.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number }).c;
        expect(postCt).toBe(preCt);
        pre.close();
    });

    it('remaps "pending" → "todo" and "in_qa" → "in_review"', () => {
        const pre = buildPre006Db();
        pre.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('A', 'pending');
        pre.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('B', 'in_qa');

        up(pre);

        const todo = (pre.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'todo'").get() as { c: number }).c;
        const inReview = (pre.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'in_review'").get() as { c: number }).c;
        const pending = (pre.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'pending'").get() as { c: number }).c;
        const inQa = (pre.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'in_qa'").get() as { c: number }).c;

        expect(todo).toBe(1);
        expect(inReview).toBe(1);
        expect(pending).toBe(0);
        expect(inQa).toBe(0);
        pre.close();
    });

    it('leaves in_progress, done, archived statuses unchanged', () => {
        const pre = buildPre006Db();
        pre.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('A', 'in_progress');
        pre.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('B', 'done');
        pre.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('C', 'archived');

        up(pre);

        const inProgress = (pre.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'in_progress'").get() as { c: number }).c;
        const done = (pre.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done'").get() as { c: number }).c;
        const archived = (pre.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'archived'").get() as { c: number }).c;

        expect(inProgress).toBe(1);
        expect(done).toBe(1);
        expect(archived).toBe(1);
        pre.close();
    });
});

describe('migration 006 — pre-flight throws on unknown status', () => {
    it('aborts when a task has an unrecognized status value', () => {
        // Simulate an externally-corrupted pre-006 db: build schema manually
        // without the CHECK constraint so we can insert an invalid status value.
        const db2 = new Database(':memory:');
        db2.exec(`
            CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        // Minimal schema that mirrors the pre-006 state but without CHECK constraint
        db2.exec(`
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT DEFAULT '',
                color TEXT DEFAULT 'white',
                archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                priority TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
                project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                due_date TEXT,
                recurrence TEXT,
                time_spent INTEGER NOT NULL DEFAULT 0,
                jira_key TEXT, jira_id TEXT, github_ref TEXT, gitlab_ref TEXT,
                linear_ref TEXT, sync_hash TEXT, last_synced_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT, archived_at TEXT
            );
        `);
        // Insert tasks with a valid old status and one completely unknown one
        db2.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('ok', 'pending');
        db2.prepare("INSERT INTO tasks (title, status) VALUES (?, ?)").run('bad', 'completely_invalid');

        expect(() => up(db2)).toThrow(/Migration 006 aborted/);
        db2.close();
    });
});

describe('migration 006 — idempotency (full runMigrations)', () => {
    it('calling runMigrations twice does not double-apply migration 006', () => {
        runMigrations(db);
        // Second call should be a no-op
        runMigrations(db);
        const count = (db.prepare('SELECT COUNT(*) as c FROM statuses').get() as { c: number }).c;
        expect(count).toBe(6);
    });

    it('_migrations table records 006-dynamic-statuses exactly once', () => {
        runMigrations(db);
        runMigrations(db);
        const rows = db.prepare("SELECT COUNT(*) as c FROM _migrations WHERE name = '006-dynamic-statuses'")
            .get() as { c: number };
        expect(rows.c).toBe(1);
    });
});

describe('migration 006 — FK rejects old status values', () => {
    it('inserting "pending" into tasks after migration throws FK violation', () => {
        runMigrations(db);
        db.pragma('foreign_keys = ON');
        expect(() => {
            db.prepare("INSERT INTO tasks (title, status) VALUES ('x', 'pending')").run();
        }).toThrow();
    });

    it('inserting "in_qa" into tasks after migration throws FK violation', () => {
        runMigrations(db);
        db.pragma('foreign_keys = ON');
        expect(() => {
            db.prepare("INSERT INTO tasks (title, status) VALUES ('x', 'in_qa')").run();
        }).toThrow();
    });

    it('inserting "todo" after migration succeeds', () => {
        runMigrations(db);
        db.pragma('foreign_keys = ON');
        expect(() => {
            db.prepare("INSERT INTO tasks (title, status) VALUES ('ok', 'todo')").run();
        }).not.toThrow();
    });

    it('inserting "in_review" after migration succeeds', () => {
        runMigrations(db);
        db.pragma('foreign_keys = ON');
        expect(() => {
            db.prepare("INSERT INTO tasks (title, status) VALUES ('ok', 'in_review')").run();
        }).not.toThrow();
    });
});
