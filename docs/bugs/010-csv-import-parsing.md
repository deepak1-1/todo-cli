# BUG-010: CSV Import Breaks on Quoted Commas

**Severity**: Medium
**Category**: Bug
**File**: `src/commands/import.ts`, line 35

## Description
CSV parsing uses naive `split(',')` which breaks on quoted fields containing commas. A CSV row like `1,"Fix the bug, please",done,medium` is split incorrectly.

## Fix
Implement proper CSV field parsing that respects quoted fields.
