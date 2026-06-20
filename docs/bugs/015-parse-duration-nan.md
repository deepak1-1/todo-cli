# BUG-015: parseDuration Allows NaN Through

**Severity**: Medium
**Category**: Edge case
**File**: `src/commands/timer.ts`, lines 21-39

## Description
`parseDuration("")` produces `NaN`. The check `seconds <= 0` doesn't catch `NaN` since `NaN <= 0` is `false`. Invalid input can slip through to the database.

## Fix
Add explicit `isNaN` check after parsing.
