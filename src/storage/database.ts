// ============================================================
// SQLite connection manager
// ============================================================

import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

let db: Database.Database | null = null;

/** Get the database directory path */
export function getDbDir(): string {
    const dir = path.join(os.homedir(), '.todo-cli');
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
    db = new Database(resolvedPath);

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
    const testDb = new Database(':memory:');
    testDb.pragma('journal_mode = WAL');
    testDb.pragma('foreign_keys = ON');
    return testDb;
}
