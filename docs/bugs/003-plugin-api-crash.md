# BUG-003: Plugin API Calls Non-existent Method

**Severity**: Critical
**Category**: Runtime crash
**File**: `src/plugins/plugin-api.ts`, line 19

## Description
`ctx.taskRepo.find(filters)` is called, but `TaskRepository` has no `find()` method. This crashes when any plugin calls `getTasks()`.

## Fix
Change `ctx.taskRepo.find(filters)` to `ctx.taskRepo.list(filters)`.
