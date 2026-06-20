---
name: commander-cli
description: Commander.js 12 patterns for src/commands/*. Use when adding/editing a CLI subcommand, flag, or argument. Triggers - "add a command", new flag, --json output, exit code design.
---

# Commander.js patterns for this project

## Subcommand skeleton
```ts
// src/commands/<name>.ts
import { Command } from 'commander';
import { getContext } from './context.js';

export const fooCommand = new Command('foo')
    .description('One-line, sentence case, no trailing period')
    .argument('<id>', 'task id')
    .option('-p, --priority <level>', 'urgent|high|medium|low')
    .option('--json', 'output as JSON')
    .action(async (id, opts) => {
        const ctx = getContext();
        // 1. validate    2. call core/repo    3. format
    });
```
Register in `src/index.ts` with `program.addCommand(fooCommand)`. Forgetting registration is the #1 reason a "missing" command isn't missing.

## Flag conventions (from PM agent)
- Short flags reserved: `-s` search, `-p` priority, `-t` tag, `-q` quiet, `-v` verbose.
- Self-documenting long flags: `--from`, `--to`, `--json`, `--no-color`.
- `--json` must be supported on any command that emits data.

## Output discipline
- Data → stdout. Errors → stderr (use `console.error(error(msg))` from `src/utils/format.ts`).
- Never `process.exit()` inside a command — throw, let `reportCliError` in `src/index.ts` exit.
- Respect `--quiet` (suppress non-essential lines) and `--no-color` (chalk auto-detects via env, but check before emitting raw ANSI).

## Argument parsing
- Use `.argument('<required>')` / `[optional]` rather than reading `process.argv`.
- Numeric args: pass `(val) => Number.parseInt(val, 10)` as the parser; validate `Number.isFinite`. Never trust `parseInt('')` (BUG-015).
- Enum-ish opts: validate with `normalizeStatus()` / `normalizePriority()` from `src/core/task.ts`.

## Help text
Help and version are auto-wired by Commander — do not re-implement. Add examples via `.addHelpText('after', '...')` when the command has multiple modes.

## Async actions
Commander 12 supports `async (opts) => {...}`. Unhandled rejections route to `process.on('unhandledRejection', reportCliError)`. Do not swallow.

## Cross-command imports
Commands may import from `./context.js` and `./edit.js#executeEdit` only. No other cross-command imports.
