// Migration 006: Replace hardcoded status CHECK with foreign-key reference to statuses table.

import type Database from 'better-sqlite3';

export const requiresNoTransaction = true;

export function up(db: Database.Database): void {
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');

    const migrate = db.transaction(() => {
        // Pre-flight: reject unknown statuses before we remap
        const unknownCount = (db.prepare(`
            SELECT COUNT(*) as c FROM tasks
            WHERE status NOT IN ('pending', 'in_progress', 'in_qa', 'done', 'archived')
        `).get() as { c: number }).c;
        if (unknownCount > 0) {
            throw new Error(
                `Migration 006 aborted: ${unknownCount} task(s) have unknown status values. ` +
                'Fix those rows before migrating.',
            );
        }

        // Create statuses table and seed the 6 builtin rows
        db.exec(`
            CREATE TABLE statuses (
                key        TEXT PRIMARY KEY,
                label      TEXT NOT NULL,
                icon       TEXT NOT NULL DEFAULT '○',
                color      TEXT NOT NULL DEFAULT 'white',
                sort_order INTEGER NOT NULL DEFAULT 0,
                verb       TEXT NOT NULL UNIQUE,
                completes  INTEGER NOT NULL DEFAULT 0,
                archives   INTEGER NOT NULL DEFAULT 0,
                is_builtin INTEGER NOT NULL DEFAULT 0
            )
        `);

        db.exec(`
            INSERT INTO statuses (key, label, icon, color, sort_order, verb, completes, archives, is_builtin) VALUES
                ('todo',        'To Do',       '○',  'gray',   1, 'reopen',  0, 0, 1),
                ('in_progress', 'In Progress', '◐',  'cyan',   2, 'start',   0, 0, 1),
                ('in_review',   'In Review',   '◔',  'yellow', 3, 'review',  0, 0, 1),
                ('blocked',     'Blocked',     '⊘',  'red',    4, 'block',   0, 0, 1),
                ('done',        'Done',        '✓',  'green',  5, 'done',    1, 0, 1),
                ('archived',    'Archived',    '⌀',  'dim',    6, 'archive', 0, 1, 1)
        `);

        // Rebuild tasks table with FK to statuses instead of CHECK constraint
        db.exec(`
            CREATE TABLE tasks_new (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                title          TEXT NOT NULL,
                description    TEXT DEFAULT '',
                status         TEXT NOT NULL DEFAULT 'todo' REFERENCES statuses(key),
                priority       TEXT NOT NULL DEFAULT 'medium'
                                   CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
                project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                due_date       TEXT,
                recurrence     TEXT,
                time_spent     INTEGER NOT NULL DEFAULT 0,
                jira_key       TEXT,
                jira_id        TEXT,
                github_ref     TEXT,
                gitlab_ref     TEXT,
                linear_ref     TEXT,
                sync_hash      TEXT,
                last_synced_at TEXT,
                created_at     TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at   TEXT,
                archived_at    TEXT
            )
        `);

        // Migrate rows: remap pending→todo, in_qa→in_review; keep the rest as-is
        db.exec(`
            INSERT INTO tasks_new (
                id, title, description, status, priority, project_id, due_date, recurrence,
                time_spent, jira_key, jira_id, github_ref, gitlab_ref, linear_ref,
                sync_hash, last_synced_at, created_at, updated_at, completed_at, archived_at
            )
            SELECT
                id, title, description,
                CASE status
                    WHEN 'pending'   THEN 'todo'
                    WHEN 'in_qa'     THEN 'in_review'
                    ELSE status
                END,
                priority, project_id, due_date, recurrence,
                time_spent, jira_key, jira_id, github_ref, gitlab_ref, linear_ref,
                sync_hash, last_synced_at, created_at, updated_at, completed_at, archived_at
            FROM tasks
        `);

        // Verify row counts match before destroying original
        const origCount = (db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number }).c;
        const newCount  = (db.prepare('SELECT COUNT(*) as c FROM tasks_new').get() as { c: number }).c;
        if (origCount !== newCount) {
            throw new Error(
                `Migration 006 aborted: row count mismatch — tasks=${origCount}, tasks_new=${newCount}`,
            );
        }

        db.exec('DROP TABLE tasks');
        db.exec('ALTER TABLE tasks_new RENAME TO tasks');

        // Recreate all 6 indexes from migration 005 (same names)
        db.exec(`
            CREATE INDEX idx_tasks_status          ON tasks(status);
            CREATE INDEX idx_tasks_priority        ON tasks(priority);
            CREATE INDEX idx_tasks_due_date        ON tasks(due_date);
            CREATE INDEX idx_tasks_project_id      ON tasks(project_id);
            CREATE INDEX idx_tasks_status_priority ON tasks(status, priority);
            CREATE INDEX idx_tasks_status_due      ON tasks(status, due_date);
        `);
    });

    migrate();

    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
}

export function down(_db: Database.Database): void {
    throw new Error('Migration 006 is not reversible');
}
