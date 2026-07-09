// ============================================================
// Migration 009: Backfill completed_at / archived_at for rows created before create() stamped them
// ============================================================

// Required (not optional): self-managed so it runs in the second batch, after 006 creates the statuses table.
// If transactional, this would run in batch 1 before statuses exists and the subquery would fail on a fresh DB.
export const requiresNoTransaction = true;

import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
    const migrate = db.transaction(() => {
        db.prepare(
            'UPDATE tasks SET completed_at = COALESCE(updated_at, created_at) WHERE completed_at IS NULL AND status IN (SELECT key FROM statuses WHERE completes = 1)',
        ).run();
        db.prepare(
            'UPDATE tasks SET archived_at = COALESCE(updated_at, created_at) WHERE archived_at IS NULL AND status IN (SELECT key FROM statuses WHERE archives = 1)',
        ).run();
    });
    migrate();
}

export function down(): void {
    throw new Error('Migration 009 is not reversible');
}
