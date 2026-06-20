# BUG-005: weeklyStats Returns Wrong Column Names

**Severity**: High
**Category**: Bug
**File**: `src/storage/repositories/task.repo.ts`, lines 367-376

## Description
SQL uses aliases `completed_count` and `total_time` (snake_case), but TypeScript expects `completedCount` and `totalTime` (camelCase). SQLite returns column names as defined in the query, so the stats command always shows 0.

## Steps to Reproduce
1. Create tasks, mark some done
2. Run `todo stats`

## Expected
Shows weekly completion count and time tracked.

## Actual
Shows 0 for both values.

## Fix
Use `AS completedCount` and `AS totalTime` aliases in the SQL query.
