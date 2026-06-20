# BUG-016: HookManager Never Invoked by Commands

**Severity**: Medium
**Category**: Dead code
**File**: `src/plugins/hook-manager.ts`

## Description
The HookManager has lifecycle hooks (onTaskCreate, onTaskUpdate, etc.) but no command handler calls them. The plugin hook system is completely disconnected.

## Fix
Wire the hook manager into command handlers at appropriate lifecycle points.
