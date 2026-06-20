# BUG-013: TUI Bypasses getContext() Pattern

**Severity**: Medium
**Category**: Layer violation
**File**: `src/tui/hooks/useTasks.ts`, lines 16-27

## Description
The TUI hook creates its own repo instances, bypassing `getContext()`. This creates a second set of database connections and skips any middleware/hooks added to the shared context. Also runs migrations on every render.

## Fix
Import and use `getContext()` from `commands/context.ts`. Memoize initialization.
