# BUG-004: Double JSON.stringify Breaks Undo System

**Severity**: Critical
**Category**: Data integrity
**File**: `src/storage/repositories/action-log.repo.ts`, lines 31-32

## Description
The `log()` method calls `JSON.stringify(entry.prevState)`, but callers already pass `JSON.stringify(task)` as `prevState`. The stored value is double-encoded. When undo parses it, it gets a string instead of an object, breaking all undo operations.

## Steps to Reproduce
1. Create a task
2. Change its status: `todo done 1`
3. Run `todo undo`

## Expected
Task reverts to previous status.

## Actual
Update receives a string instead of object, silently fails or crashes.

## Fix
Remove `JSON.stringify()` in `action-log.repo.ts` — callers already serialize.
