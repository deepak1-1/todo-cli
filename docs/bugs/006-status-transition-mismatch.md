# BUG-006: Status Transition Test/Code Mismatch

**Severity**: High
**Category**: Bug
**File**: `src/core/task.ts`, line 67; `tests/core/task.test.ts`, line 76

## Description
The code defines `done: ['archived', 'pending', 'in_progress']` allowing done→in_progress, but the test expects this transition to be invalid. Either the code or test is wrong — currently causes a failing test.

## Fix
Align code and test. If done→in_progress should be allowed (restarting work), update the test. Otherwise, remove `in_progress` from the allowed transitions.
