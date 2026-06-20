---
name: vitest-testing
description: Vitest patterns matching this project - in-memory SQLite for storage, pure-function tests for core, no flaky timing. Use for any test under tests/.
---

# Vitest in this codebase

## Layout
`tests/<area>/<name>.test.ts` mirroring `src/`. Globals enabled, so `describe`/`it`/`expect` are available without import.

## Commands
```
npm test                          # full suite
npx vitest run tests/core/task.test.ts
npx vitest run -t "should reject"  # filter by name pattern
npm run test:coverage             # v8, excludes src/index.ts and src/tui/**
```

## Patterns

### Pure unit (core / utils)
```ts
import { describe, it, expect } from 'vitest';
import { validateCreateInput } from '../../src/core/task.js';

describe('validateCreateInput', () => {
    it('rejects empty title', () => {
        expect(() => validateCreateInput({ title: '' })).toThrow(/title/i);
    });
});
```
No mocks. No DB. If a pure function needs a mock, it isn't pure — move I/O out.

### Repository / integration
```ts
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';

let db: Database.Database;
let repo: TaskRepository;
beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    repo = new TaskRepository(db);
});
```
Fresh DB per test — no `beforeAll` shared state.

### Time
Mock `Date.now()` via `vi.useFakeTimers({ shouldAdvanceTime: true })`. Do not write assertions against the real clock.

## What to test
- Core logic: happy + edge + error path.
- Repos: happy + empty result + invalid input + SQL-injection literal (`'; DROP TABLE tasks;--`).
- Migrations: implicitly covered by the `beforeEach` reset.

## What NOT to test
- Ink/React components (`src/tui/**`).
- `commander` parsing internals.
- `better-sqlite3` engine internals.
- LLM call output (mock at the boundary).

## Quality gates
- Suite under 5s. If you add a slow test, explain why in a comment.
- No `it.skip` in main. No `it.only` ever leaves the branch.
- Test names describe behavior in the present tense ("filters by status").
