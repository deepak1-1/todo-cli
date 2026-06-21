// ============================================================
// Migration 007: Drop unused columns and tables
// ============================================================
// Removes never-used integration ref columns, the unused integration_config
// table, and the legacy pomodoro_sessions table (replaced by time_tracking).

import type Database from 'better-sqlite3';

// Self-managed so it runs after the table-rebuild migrations (003–006), which
// are also self-managed; the runner applies transactional migrations first.
export const requiresNoTransaction = true;

export function up(db: Database.Database, markApplied?: () => void): void {
    const migrate = db.transaction(() => {
        // gitlab_ref / linear_ref are plain TEXT columns with no index, constraint,
        // or FK — safe to drop directly (SQLite >= 3.35 supports ALTER ... DROP COLUMN).
        db.exec(`
            ALTER TABLE tasks DROP COLUMN gitlab_ref;
            ALTER TABLE tasks DROP COLUMN linear_ref;
            DROP TABLE IF EXISTS integration_config;
            DROP TABLE IF EXISTS pomodoro_sessions;
        `);
        // Record completion in the same transaction as the (non-idempotent) DROP COLUMNs,
        // so a crash can never leave the schema changed but the migration unrecorded.
        markApplied?.();
    });
    migrate();
}

export function down(_db: Database.Database): void {
    throw new Error('Migration 007 is not reversible');
}
