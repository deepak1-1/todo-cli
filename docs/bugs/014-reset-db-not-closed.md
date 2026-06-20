# BUG-014: Reset Command Doesn't Close DB Before Deletion

**Severity**: Medium
**Category**: Bug
**File**: `src/commands/reset.ts`, lines 29-33

## Description
The reset command deletes the database file without closing the connection first. On Windows this fails; on Unix it leaves a stale connection.

## Fix
Call `closeDb()` before deleting the files.
