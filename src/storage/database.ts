// ============================================================
// SQLite connection manager
// ============================================================

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
// Aliased — the tsup ESM banner already declares a top-level `createRequire` binding
import { createRequire as createNodeRequire } from 'node:module';
import { getDataDir } from '../utils/data-dir.js';

let db: Database.Database | null = null;

/** SEA detection via runtime require — a static node:sea import breaks vitest's builtin resolution */
function isSeaBinary(): boolean {
    try {
        const req = createNodeRequire(process.execPath);
        return (req('node:sea') as { isSea(): boolean }).isSea();
    } catch {
        return false;
    }
}

/** Inside a SEA binary the native addon ships as a sidecar file next to the executable */
function seaOptions(): Database.Options {
    if (!isSeaBinary()) return {};
    try {
        const req = createNodeRequire(process.execPath);
        const sidecar = path.join(path.dirname(fs.realpathSync(process.execPath)), 'better_sqlite3.node');
        // Runtime accepts a pre-loaded addon object; @types only declares the string form
        return { nativeBinding: req(sidecar) as unknown as string };
    } catch {
        throw new Error('todo binary is missing its better_sqlite3.node sidecar — reinstall todo-cli');
    }
}

/** Get the database directory path */
export function getDbDir(): string {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/** Get the database file path */
export function getDbPath(): string {
    return path.join(getDbDir(), 'todo.db');
}

/** Get (or create) the singleton database connection */
export function getDb(dbPath?: string): Database.Database {
    if (db) return db;

    const resolvedPath = dbPath || getDbPath();
    db = new Database(resolvedPath, seaOptions());

    // Enable WAL mode for better concurrent read performance
    db.pragma('journal_mode = WAL');
    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    return db;
}

/** Close the database connection */
export function closeDb(): void {
    if (db) {
        db.close();
        db = null;
    }
}

/** Get a fresh connection for testing (doesn't use singleton) */
export function createTestDb(): Database.Database {
    const testDb = new Database(':memory:', seaOptions());
    testDb.pragma('journal_mode = WAL');
    testDb.pragma('foreign_keys = ON');
    return testDb;
}
