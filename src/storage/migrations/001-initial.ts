// ============================================================
// Migration 001: Initial schema
// ============================================================

import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL UNIQUE,
            description   TEXT DEFAULT '',
            color         TEXT DEFAULT 'white',
            archived      INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            title         TEXT NOT NULL,
            description   TEXT DEFAULT '',
            status        TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'in_progress', 'done', 'archived')),
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
        );

        CREATE TABLE IF NOT EXISTS tags (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL UNIQUE,
            color         TEXT DEFAULT 'cyan'
        );

        CREATE TABLE IF NOT EXISTS task_tags (
            task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS dependencies (
            task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (task_id, depends_on_id),
            CHECK (task_id != depends_on_id)
        );

        CREATE TABLE IF NOT EXISTS pomodoro_sessions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            started_at    TEXT NOT NULL DEFAULT (datetime('now')),
            duration      INTEGER NOT NULL DEFAULT 1500,
            completed     INTEGER NOT NULL DEFAULT 0,
            notes         TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS action_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id       INTEGER,
            action        TEXT NOT NULL,
            entity_type   TEXT NOT NULL DEFAULT 'task',
            prev_state    TEXT,
            new_state     TEXT,
            timestamp     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS integration_config (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            provider      TEXT NOT NULL UNIQUE,
            config        TEXT NOT NULL DEFAULT '{}',
            enabled       INTEGER NOT NULL DEFAULT 1,
            last_sync_at  TEXT,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
        CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority);
        CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_date);
        CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_pomodoro_task ON pomodoro_sessions(task_id);
        CREATE INDEX IF NOT EXISTS idx_pomodoro_date ON pomodoro_sessions(started_at);
        CREATE INDEX IF NOT EXISTS idx_action_log_task ON action_log(task_id);
        CREATE INDEX IF NOT EXISTS idx_action_log_time ON action_log(timestamp);
        CREATE INDEX IF NOT EXISTS idx_deps_depends_on ON dependencies(depends_on_id);
    `);
}

export function down(db: Database.Database): void {
    db.exec(`
        DROP TABLE IF EXISTS action_log;
        DROP TABLE IF EXISTS pomodoro_sessions;
        DROP TABLE IF EXISTS dependencies;
        DROP TABLE IF EXISTS task_tags;
        DROP TABLE IF EXISTS tags;
        DROP TABLE IF EXISTS integration_config;
        DROP TABLE IF EXISTS tasks;
        DROP TABLE IF EXISTS projects;
    `);
}
