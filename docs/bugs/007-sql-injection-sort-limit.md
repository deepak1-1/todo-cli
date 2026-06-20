# BUG-007: SQL Injection via Sort Field and Limit

**Severity**: High
**Category**: Security
**File**: `src/storage/repositories/task.repo.ts`, lines 257, 266

## Description
`sort.field` is interpolated directly into SQL via `t.${sort.field}`. While TypeScript constrains the type at compile time, runtime values could bypass this. Similarly, `limit` is interpolated rather than parameterized.

## Fix
Add runtime whitelist check for sort field. Use parameterized query for limit.
