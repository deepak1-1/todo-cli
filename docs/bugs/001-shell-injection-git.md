# BUG-001: Shell Injection in Git Utilities (RESOLVED — removed)

**Severity**: Critical
**Category**: Security
**File**: `src/utils/git.ts` (deleted), `src/commands/branch.ts` (deleted)
**Status**: Resolved — `branch` command and `git.ts` utility removed from CLI

## Description
`createBranch()`, `checkoutBranch()`, and `branchExists()` pass user-supplied branch names directly into `execSync()` shell commands without sanitization. A malicious branch name like `; rm -rf /` would execute arbitrary shell commands.

## Steps to Reproduce
```bash
todo branch --name "; echo PWNED" 1
```

## Expected
Command should reject invalid branch names or safely escape them.

## Actual
Shell command is executed with injected content.

## Fix
Use `execFileSync('git', ['checkout', '-b', name, baseBranch])` which avoids shell interpretation.
