// ============================================================
// Migration 008: Subtask hierarchy — tasks.parent_id
// ============================================================

import type Database from 'better-sqlite3';

// Self-managed so it runs in the second migration batch — after the self-managed table
// rebuilds in 004/006/007. (The runner applies all transactional migrations before any
// self-managed one, so a transactional 008 would run before those rebuilds on a fresh DB.)
// A nullable ADD COLUMN with a SET NULL FK needs no table rebuild, but is wrapped in its
// own transaction so the schema change and the _migrations record commit atomically.
export const requiresNoTransaction = true;

export function up(db: Database.Database, markApplied?: () => void): void {
    const migrate = db.transaction(() => {
        db.exec(`
            ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
            CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
        `);
        // Record completion in the same transaction as the (non-idempotent) ADD COLUMN,
        // so a crash can never leave the schema changed but unrecorded.
        markApplied?.();
    });
    migrate();
}

export function down(): void {
    throw new Error('Migration 008 is not reversible');
}
