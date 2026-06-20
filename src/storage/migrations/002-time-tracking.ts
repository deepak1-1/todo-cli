// ============================================================
// Migration 002: Time tracking sessions
// ============================================================

import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS time_tracking (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            started_at    TEXT NOT NULL DEFAULT (datetime('now')),
            ended_at      TEXT,
            duration      INTEGER NOT NULL DEFAULT 0,
            note          TEXT DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_time_tracking_task ON time_tracking(task_id);
        CREATE INDEX IF NOT EXISTS idx_time_tracking_active ON time_tracking(ended_at) WHERE ended_at IS NULL;
    `);
}

export function down(db: Database.Database): void {
    db.exec(`DROP TABLE IF EXISTS time_tracking;`);
}
