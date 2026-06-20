---
name: better-sqlite3
description: better-sqlite3 patterns - singleton connection, WAL, prepared statements, transactions. Use for any change in src/storage/. Triggers - new SQL, repository method, transaction, schema column.
---

# better-sqlite3 in this codebase

## Connection
- `getDb()` in `src/storage/database.ts` is the sole singleton. Never `new Database(...)` outside `database.ts` or test helpers.
- WAL + `foreign_keys = ON` are pragmas applied on first open. Any new migration that needs FKs disabled must set `requiresNoTransaction: true` (see `004-fix-tasks-fk.ts`).
- Test isolation uses `createTestDb()` → `:memory:`. Same pragmas. Run `runMigrations(db)` in `beforeEach`.

## Statement style
- Synchronous API only — `better-sqlite3` is sync by design. **Do not** wrap in `Promise`/`async`.
- Always prepare + parameterize:
  ```ts
  this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  ```
- Never interpolate user input into SQL. Sort columns from user input require an allowlist map (BUG-007).
- Cache hot prepared statements as class members when called in tight loops.

## Reads / writes
- `.get(...)` → single row or `undefined`.
- `.all(...)` → array (may be empty).
- `.run(...)` → `{ changes, lastInsertRowid }`. Coerce `lastInsertRowid` to `Number` when used downstream.

## Transactions
Wrap multi-statement writes:
```ts
const insertWithTags = db.transaction((task, tagIds) => {
    const id = insertTask.run(task).lastInsertRowid;
    for (const t of tagIds) insertTaskTag.run(id, t);
    return id;
});
```
A throw inside rolls back. Don't catch-and-ignore inside the body.

## Row mapping
Cast `.all()` results to `Record<string, unknown>[]` then map through a typed `mapRow` function — do not cast straight to `Task[]`. Treat the boundary as untrusted.

## JSON columns
- Action-log `prev_state`/`new_state` are TEXT containing JSON. Stringify once at write, parse once at read. BUG-004 was a double-stringify.

## Indexes
Add an index in a new migration whenever a `WHERE`/`ORDER BY` column is hot (status, priority, due_date). Verify with `EXPLAIN QUERY PLAN`.

## What lives where
- All raw SQL: `src/storage/repositories/*.repo.ts`.
- No SQL in `src/commands/`, `src/core/`, `src/integrations/`, `src/tui/`.
