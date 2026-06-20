// ============================================================
// Migration runner — tracks and applies schema migrations
// ============================================================

import type Database from 'better-sqlite3';
import * as migration001 from './001-initial.js';
import * as migration002 from './002-time-tracking.js';
import * as migration003 from './003-project-name-nocase.js';
import * as migration004 from './004-fix-tasks-fk.js';
import * as migration005 from './005-add-in-qa-status.js';
import * as migration006 from './006-dynamic-statuses.js';

interface Migration {
    name: string;
    up: (db: Database.Database) => void;
    down: (db: Database.Database) => void;
    /** If true, migration manages its own transaction (e.g. needs PRAGMA foreign_keys = OFF) */
    requiresNoTransaction?: boolean;
}

const migrations: Migration[] = [
    { name: '001-initial', up: migration001.up, down: migration001.down },
    { name: '002-time-tracking', up: migration002.up, down: migration002.down },
    { name: '003-project-name-nocase', up: migration003.up, down: migration003.down, requiresNoTransaction: migration003.requiresNoTransaction },
    { name: '004-fix-tasks-fk', up: migration004.up, down: migration004.down, requiresNoTransaction: migration004.requiresNoTransaction },
    { name: '005-add-in-qa-status', up: migration005.up, down: migration005.down, requiresNoTransaction: migration005.requiresNoTransaction },
    { name: '006-dynamic-statuses', up: migration006.up, down: migration006.down, requiresNoTransaction: migration006.requiresNoTransaction },
];

/** Ensure the _migrations tracking table exists */
function ensureMigrationsTable(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    `);
}

/** Get list of already-applied migration names */
function getAppliedMigrations(db: Database.Database): Set<string> {
    const rows = db.prepare('SELECT name FROM _migrations ORDER BY id').all() as { name: string }[];
    return new Set(rows.map((r) => r.name));
}

/** Run all pending migrations in a transaction */
export function runMigrations(db: Database.Database): string[] {
    ensureMigrationsTable(db);
    const applied = getAppliedMigrations(db);
    const pending = migrations.filter((m) => !applied.has(m.name));

    if (pending.length === 0) return [];

    const appliedNames: string[] = [];

    // Split into transactional and self-managed migrations
    const transactional = pending.filter((m) => !m.requiresNoTransaction);
    const selfManaged = pending.filter((m) => m.requiresNoTransaction);

    // Run transactional migrations together
    if (transactional.length > 0) {
        const runTx = db.transaction(() => {
            for (const migration of transactional) {
                migration.up(db);
                db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name);
                appliedNames.push(migration.name);
            }
        });
        runTx();
    }

    // Run self-managed migrations outside any transaction (they handle their own)
    for (const migration of selfManaged) {
        migration.up(db);
        db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(migration.name);
        appliedNames.push(migration.name);
    }

    return appliedNames;
}

/** Rollback the last migration */
export function rollbackLast(db: Database.Database): string | null {
    ensureMigrationsTable(db);
    const applied = getAppliedMigrations(db);
    const lastApplied = migrations.filter((m) => applied.has(m.name)).pop();

    if (!lastApplied) return null;

    const rollback = db.transaction(() => {
        lastApplied.down(db);
        db.prepare('DELETE FROM _migrations WHERE name = ?').run(lastApplied.name);
    });

    rollback();
    return lastApplied.name;
}
