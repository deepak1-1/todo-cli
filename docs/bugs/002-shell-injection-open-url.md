# BUG-002: Shell Injection in URL Opening

**Severity**: Critical
**Category**: Security
**File**: `src/utils/open-url.ts`, line 13

## Description
`openUrl()` passes user-supplied URLs into a shell command via `exec()`. A crafted URL could inject shell commands.

## Fix
Use `execFile` with an array of arguments instead of `exec` with string interpolation.
