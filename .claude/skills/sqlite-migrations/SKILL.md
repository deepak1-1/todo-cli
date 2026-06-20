---
name: sqlite-migrations
description: Numbered migration discipline for src/storage/migrations/. Use any time the schema changes. Triggers - new column, new table, new index, status enum change, backfill.
---

# Migration discipline

## File naming
`NNN-short-description.ts` where `NNN` is the next free zero-padded number (currently up to `005-add-in-qa-status.ts`). One concern per migration.

## Shape
```ts
import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
    db.exec(`ALTER TABLE tasks ADD COLUMN ...`);
}

export function down(db: Database.Database): void {
    // True reverse if possible. If SQLite can't reverse (e.g. DROP COLUMN before 3.35),
    // document it and provide best-effort restore from preserved columns.
}

// Only when you need PRAGMA foreign_keys = OFF or your own transaction:
export const requiresNoTransaction = true;
```

## Register
Add to `migrations[]` in `src/storage/migrations/runner.ts` in numeric order. Forgetting to register is invisible at compile time and the migration silently won't run.

## Rules
- **Never edit a migration after it has been applied** (i.e. landed on `main`). Add a follow-up migration instead.
- Idempotent SQL: `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`, etc. Migrations may be re-run after manual recovery.
- Default values must be backwards-compatible with existing rows. Provide a backfill `UPDATE` for `NOT NULL` columns.
- CHECK constraints on enum-like columns must be updated whenever the enum grows (see `005-add-in-qa-status.ts` for the rebuild pattern).
- Foreign-key alterations on existing tables require `requiresNoTransaction = true` + `PRAGMA foreign_keys = OFF` + manual `BEGIN/COMMIT` because SQLite can't disable FKs mid-transaction.

## Verification
After writing a migration:
1. `npm test` — repository tests run all migrations on a fresh `:memory:` DB.
2. Manually open `~/.todo-cli/todo.db` with the SQLite CLI and confirm the schema.
3. Confirm `_migrations` row is recorded (the runner inserts it).
4. Confirm at least one existing repository test still passes against the new schema.

## Rollback
`rollbackLast()` is wired in `runner.ts` for ops use. Never rely on it as part of a normal flow; treat it as recovery only.
