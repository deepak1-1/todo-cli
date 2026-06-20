# BUG-012: Duplicate formatDuration Implementations

**Severity**: Medium
**Category**: Inconsistent patterns
**Files**: `src/commands/show.ts:10-16`, `src/commands/timer.ts:12-19`, `src/core/timer.ts:18-25`

## Description
Three separate `formatDuration` implementations exist with different behavior (e.g., timer.ts includes seconds, core/timer.ts does not). The local versions shadow the import from `core/timer.ts`.

## Fix
Consolidate into a single implementation in `core/timer.ts` with optional seconds parameter.
