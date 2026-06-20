# BUG-008: Missing Input Validation Across Commands

**Severity**: High
**Category**: Validation
**Files**: `src/commands/add.ts:44`, `edit.ts:40`, `bulk.ts:97`, `import.ts:42`, `list.ts:32`

## Description
User-supplied priority strings are cast directly to `TaskPriority` without validation. Invalid values like `--priority extreme` pass through unchecked. Same issue with recurrence pattern in `add.ts:47` and `edit.ts:42`.

## Fix
Validate against `TASK_PRIORITIES` and `RecurrencePattern` values before proceeding.
