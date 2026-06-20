---
name: regression-sweep
description: Mandatory verification pass after any code change. Hunts similar-shape issues, proves no flows are broken, no new bugs introduced, no dead code left. Use after EVERY implementation, before declaring done.
---

# Regression sweep — non-negotiable post-change pass

Every agent (dev, tester, code-reviewer, even arch when prototyping) runs this before saying "done". This is the single biggest leverage skill in the project.

## Step 1 — Similar-issue search
A bug is rarely unique. If you just fixed something, find the cousins.

For each fix or refactor, ask:
- **Shape**: what is the abstract pattern of the bug? (e.g. "sort column from user input concatenated into SQL", "parseInt on possibly-empty string", "missing status case in aggregate", "raw chalk call bypassing format.ts").
- **Surface**: where else could that shape live? Grep the codebase for the shape, not the symptom.

```bash
# Examples of shape-grep queries
grep -rn "ORDER BY \${" src/storage/        # dynamic ORDER BY
grep -rn "parseInt(" src/                   # parseInt without radix or guard
grep -rn "chalk\." src/commands/            # raw chalk in command (should use format.ts)
grep -rn "JSON.stringify(JSON" src/         # double-stringify
grep -rn "getDb()" src/ | grep -v storage/  # getDb outside storage layer
```

List every other location that exhibits the same shape and decide: fix-now, ticket, or accept.

## Step 2 — Flow regression check
List every CLI command and TUI screen that touches the changed module(s). For each, state explicitly:
- Still correct?  → why (mention the test/line that proves it)
- Possibly broken? → run it locally and observe

Cheap checklist to actually run:
```bash
npm run typecheck
npm test
node dist/index.js --help                      # commander tree intact
node dist/index.js list                        # core read path
node dist/index.js add "regression sweep test" # write path
node dist/index.js show <id>
node dist/index.js done <id>
node dist/index.js                              # chat boots (Ctrl+C immediately)
```
Add specific smoke commands for whatever you changed.

## Step 3 — New-bug audit
Look at the diff with fresh eyes and ask:
- Any new `as any`, `as unknown as`, `// @ts-ignore`, `// eslint-disable`?
- Any new `console.log` that should be `logger`?
- Any new SQL string interpolation?
- Any new `try { ... } catch {}` (empty catch)?
- Any new top-level `await import('ink' | 'node-llama-cpp')` that breaks lazy load?
- Any new `process.exit()` outside `src/index.ts`?
- Any unhandled rejection / unawaited promise in an action handler?
- Any new dependency missing from `external` / `noExternal` in `tsup.config.ts`?
- Any new migration not registered in `runner.ts`?
- Any new command not registered in `src/index.ts`?

## Step 4 — Dead-code scan
Anything orphaned by the change must go in the **same commit** as the change. Don't leave it for "later".

Check:
- Functions / classes whose only callers were removed → delete them.
- Imports that no longer resolve to anything used in the file → delete them.
- Migrations or repos that point to removed columns → delete or migrate.
- Types in `src/core/types.ts` that nothing references → delete.
- Commented-out blocks → delete (git keeps them).
- `// TODO` you just added with no ticket → either ticket it or delete it.
- Renamed-to-underscore vars (`_unused`) → delete instead of renaming.

```bash
grep -rn "TODO\|FIXME\|XXX" src/ | grep -v node_modules
npx tsc --noEmit                      # surfaces unused locals if strict
```

## Step 5 — Double verification
After steps 1–4 you read the diff one more time. Two specific traces:
- **Happy path**: pick a representative user invocation and walk it from CLI flag → command handler → core → repo → SQL → result → formatter. Note any layer you couldn't justify.
- **Error path**: pick the most likely user error (bad input, missing record, network down) and walk it. Confirm the error message is actionable and goes to stderr.

If either trace surfaces uncertainty, you are not done.

## Reporting
At the end of the change, the agent reports:
```
## Regression sweep

### Similar issues
- <file:line> — same shape, fixed
- <file:line> — same shape, ticketed as TD-NNN
- (or) no similar shapes found

### Flow check
- [✓] npm typecheck / lint / test / build
- [✓] commands touched: `todo list`, `todo show`, `todo done`
- [✓] chat boot

### New-bug audit
- Clean. (or: list with resolution)

### Dead code
- Removed <file:lines>. (or: none)

### Double-verify trace
- Happy: <one line>
- Error: <one line>
```

Skipping this pass is the single most common cause of regressions in this codebase. Don't.
