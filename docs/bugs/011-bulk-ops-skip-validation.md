# BUG-011: Bulk Operations Bypass Validation

**Severity**: Medium
**Category**: Data integrity
**File**: `src/commands/bulk.ts`

## Description
- `bulk done` bypasses `validateTransition()` — directly sets status to 'done' even for archived tasks
- `bulk priority` doesn't validate the priority value
- No action logging for bulk operations

## Fix
Call `validateTransition` for each task, validate priority, and log actions.
