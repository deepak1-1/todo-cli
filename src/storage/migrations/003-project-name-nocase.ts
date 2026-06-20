// ============================================================
// Migration 003: Case-insensitive project names
// ============================================================
//
// Adds COLLATE NOCASE to projects.name so all lookups, uniqueness
// checks, and filters are case-insensitive automatically.
//
// Uses create-new → drop-old → rename-new pattern so the tasks FK
// (which references "projects") stays valid after the rename.

import type Database from 'better-sqlite3';

export const requiresNoTransaction = true;

export function up(db: Database.Database): void {
    db.pragma('foreign_keys = OFF');
    // Prevent SQLite 3.25+ from rewriting FK references in other tables
    // during ALTER TABLE RENAME (which would corrupt tasks.project_id FK)
    db.pragma('legacy_alter_table = ON');

    const migrate = db.transaction(() => {
        // Step 1: Deduplicate case-colliding projects (keep lowest id)
        db.exec(`
            UPDATE tasks SET project_id = (
                SELECT MIN(p2.id) FROM projects p2
                WHERE p2.name = (
                    SELECT p3.name FROM projects p3 WHERE p3.id = tasks.project_id
                ) COLLATE NOCASE
            )
            WHERE project_id IN (
                SELECT id FROM projects
                WHERE id NOT IN (
                    SELECT MIN(id) FROM projects GROUP BY name COLLATE NOCASE
                )
            )
        `);

        db.exec(`
            DELETE FROM projects
            WHERE id NOT IN (
                SELECT MIN(id) FROM projects GROUP BY name COLLATE NOCASE
            )
        `);

        // Step 2: Create new table, copy, drop old, rename new
        db.exec(`
            CREATE TABLE projects_new (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
                description   TEXT DEFAULT '',
                color         TEXT DEFAULT 'white',
                archived      INTEGER NOT NULL DEFAULT 0,
                created_at    TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);

        db.exec('INSERT INTO projects_new SELECT * FROM projects');
        db.exec('DROP TABLE projects');
        db.exec('ALTER TABLE projects_new RENAME TO projects');
    });

    migrate();

    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
}

export function down(_db: Database.Database): void {
    throw new Error('Migration 003 is not reversible (project names were deduplicated)');
}
