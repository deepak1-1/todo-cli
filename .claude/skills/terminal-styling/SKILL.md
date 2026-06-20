---
name: terminal-styling
description: chalk, ora, figures, cli-table3 usage with TTY / NO_COLOR / --no-color honoring. Use whenever a command emits styled output.
---

# Terminal styling

## Use the project helpers, not chalk directly
`src/utils/format.ts` exports `success`, `error`, `formatTaskDetail`, etc. Commands should import these, not call `chalk.red(...)` inline. This keeps theming in one place.

Direct `chalk` use is fine in `src/utils/format.ts` itself and in `src/chat/executor.ts` (output formatter is the responsibility surface).

## Honor user opt-outs
- `--no-color` (Commander global option in `src/index.ts`).
- `NO_COLOR` env var (de-facto standard).
- Non-TTY stdout (`!process.stdout.isTTY`) — chalk auto-detects, but spinners and tables also need to fall back to plain output.

Before emitting ANSI sequences manually, guard:
```ts
const colorOn = process.stdout.isTTY && !process.env.NO_COLOR && opts.color !== false;
```

## Spinners (ora)
- Only when `process.stdout.isTTY` and not `--quiet`. Otherwise log a one-liner.
- Always `.stop()` (or `.succeed()` / `.fail()`) in `finally`. A leaked spinner ruins subsequent terminal output.

## Tables
- `cli-table3` for fixed columnar output (CLI list view).
- For width-variable output in chat, use the `formatPlainTable` helper already in `src/chat/executor.ts` — it has no borders and survives narrow terminals.

## Figures / symbols
`figures` resolves to unicode on capable terminals, ASCII fallback otherwise. Use it for ✓ / ✗ / ▸ — do not hardcode unicode.

## Color semantics (PM contract)
- cyan → in-progress
- green → done
- red → urgent / error
- yellow → in_qa / warning
- gray → archived / muted
- magenta → project label

Don't invent new color meanings. If you need a new state color, get PM sign-off.

## Stderr vs stdout
Errors → stderr (via `console.error(error(msg))`). Data → stdout. Tests and `| jq` pipelines depend on this split.
