// ============================================================
// Migration 005: Add 'in_qa' status to tasks
// ============================================================

import type Database from 'better-sqlite3';

export const requiresNoTransaction = true;

export function up(db: Database.Database): void {
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');

    const migrate = db.transaction(() => {
        db.exec(`
            CREATE TABLE tasks_new (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                title         TEXT NOT NULL,
                description   TEXT DEFAULT '',
                status        TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'in_progress', 'in_qa', 'done', 'archived')),
                priority      TEXT NOT NULL DEFAULT 'medium'
                                CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
                project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                due_date      TEXT,
                recurrence    TEXT,
                time_spent    INTEGER NOT NULL DEFAULT 0,
                jira_key      TEXT,
                jira_id       TEXT,
                github_ref    TEXT,
                gitlab_ref    TEXT,
                linear_ref    TEXT,
                sync_hash     TEXT,
                last_synced_at TEXT,
                created_at    TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at  TEXT,
                archived_at   TEXT
            )
        `);

        db.exec('INSERT INTO tasks_new SELECT * FROM tasks');
        db.exec('DROP TABLE tasks');
        db.exec('ALTER TABLE tasks_new RENAME TO tasks');

        // Recreate indexes
        db.exec(`
            CREATE INDEX idx_tasks_status ON tasks(status);
            CREATE INDEX idx_tasks_priority ON tasks(priority);
            CREATE INDEX idx_tasks_due_date ON tasks(due_date);
            CREATE INDEX idx_tasks_project_id ON tasks(project_id);
            CREATE INDEX idx_tasks_status_priority ON tasks(status, priority);
            CREATE INDEX idx_tasks_status_due ON tasks(status, due_date);
        `);
    });

    migrate();

    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
}

export function down(_db: Database.Database): void {
    throw new Error('Migration 005 is not reversible');
}
