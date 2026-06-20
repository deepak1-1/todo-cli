---
name: ink-tui
description: Patterns for Ink 5 + React 18 terminal UI in this codebase. Use for any change under src/chat/components/ or future src/tui/. Triggers - editing .tsx terminal screens, useInput, render(), measuring terminal, chat UI.
---

# Ink/React TUI patterns

## Lazy-load Ink at the entrypoint
`ink`, `ink-spinner`, `ink-text-input`, `react`, `react/jsx-runtime`, `yoga-layout` are marked `external` in `tsup.config.ts`. Always `await import('ink')` inside the action handler (see `src/index.ts` chat action), never top-level — top-level imports balloon CLI cold start.

## Component rules
- Function components only. Hooks only. No class components.
- `useInput((input, key) => {...})` for keystrokes. Always early-return when `key.escape` / `key.ctrl && input === 'c'` to give users an exit.
- Width-aware layouts: read terminal width via `useStdout().stdout.columns`; never hardcode column widths.
- Do not set state during render. Schedule with `useEffect`.
- Suspense / lazy-loading children is fine; the Ink renderer handles it.

## Async + DB
- TUI must call `getContext()` from `src/commands/context.ts` for repos (see `dev` agent layer rules).
- Never call `getDb()` or `runMigrations()` from a component. Pass repos via props or a single `AppContext` provider.

## Output discipline
- Render `<Text color="...">` rather than embedding ANSI escapes — Ink owns the renderer.
- Do not `console.log` from a mounted component (it disrupts the alt-screen). Use `<Static>` or push to log state.

## Exit
The host calls `instance.waitUntilExit()`. To exit cleanly: `useApp().exit()`. Never `process.exit()` from inside a component.

## Testing
Coverage excludes `src/tui/**`. Don't write Vitest tests against Ink components; test their pure helpers in `src/core/` instead.
