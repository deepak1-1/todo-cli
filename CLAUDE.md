# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build              # Bundle to dist/ via tsup (ESM, node22 target)
npm run dev                # tsup --watch
npm run typecheck          # tsc --noEmit (no emit, types only)
npm run lint               # eslint src/ tests/
npm run lint:fix
npm run format             # prettier write src/ + tests/
npm test                   # vitest run
npm run test:watch
npm run test:coverage      # v8 coverage; excludes src/index.ts and src/tui/**

# Run a single test file
npx vitest run tests/core/task.test.ts
npx vitest run -t "name pattern"   # filter by test name
```

Requires Node >= 22. `postinstall` rebuilds the native `better-sqlite3` binding (failure is tolerated so npm install doesn't break in environments lacking build tools).

After `npm run build`, the CLI is executable as `./dist/index.js` (bin name `todo`).

## High-Level Architecture

### Dual entry: subcommand CLI + AI chat
`src/index.ts` registers ~25 commander subcommands. **Invoking `todo` with no subcommand (or `todo chat`) launches an Ink/React chat UI** (`src/chat/`) that parses natural language into an `Intent` and dispatches it through the same repositories the CLI commands use. The chat backend prefers the user's installed `claude` CLI and falls back to a local Llama-3 GGUF model via `node-llama-cpp`; the model JSON-schema-constrains output to the `Intent` shape declared in `src/chat/intent.ts`.

### Core / storage / commands separation
- `src/core/` — pure domain logic (types, filters, scheduler, timer math, dependency resolution). No I/O. Tests here should not touch SQLite.
- `src/storage/` — `database.ts` owns a **singleton** `better-sqlite3` connection (WAL + foreign keys ON) under `~/.todo-cli/todo.db`. `migrations/runner.ts` applies numbered migrations in `src/storage/migrations/` inside a transaction, tracked in a `_migrations` table. Migrations that need `PRAGMA foreign_keys = OFF` set `requiresNoTransaction = true` and run outside the wrapping transaction. Each entity has its own repository in `src/storage/repositories/`.
- `src/commands/` — commander subcommand wiring. Every command obtains the wired-up repos via `getContext()` in `src/commands/context.ts`, which lazily opens the DB, runs migrations, and constructs `AppContext` (`taskRepo`, `projectRepo`, `tagRepo`, `timerRepo`, `actionLog`, `depRepo`, `trackingRepo`). Do not instantiate repositories directly in command code — go through `getContext()`.

When adding a schema change, append a new `NNN-name.ts` migration and register it in `runner.ts`; never edit applied migrations.

### Plugins & integrations
- `src/plugins/` — built-in plugin system: `plugin-registry`, `plugin-loader` (builtin / local / global), `credential-store` (encrypted), `hook-manager`, and a `PluginAPI` factory. Public surface is re-exported from `src/plugins/index.ts`.
- `src/integrations/jira/` and `src/integrations/github/` — concrete `IntegrationProvider` implementations consumed by `commands/jira.ts` and `commands/github.ts`.

### Bundling notes (tsup)
`tsup.config.ts` marks `better-sqlite3`, `node-llama-cpp`, `ink`, `react`, and yoga as `external` (native or runtime-resolved), while `commander`, `chalk`, `chrono-node`, `date-fns`, `fuse.js`, `ora`, etc. are bundled (`noExternal`). New native or Ink-adjacent deps almost always need to be added to `external`.

### Test layout
Vitest tests live in `tests/` mirroring `src/` (`tests/core`, `tests/commands`, `tests/storage`, `tests/integrations`, `tests/utils`). For storage tests use `createTestDb()` from `src/storage/database.ts` to get an in-memory connection instead of the singleton. Coverage excludes `src/index.ts` and `src/tui/**`.

## Style

- 4-space indent, single quotes, Prettier-enforced.
- ESM throughout — all relative imports use `.js` extensions (e.g. `'./foo.js'`) even when importing `.ts` source. Keep this convention in new files.

## Agents (.claude/agents/)

Five project-local agents are wired with skill bindings, a model assignment per role, and a mandatory verification protocol. Invoke via the Agent tool with the listed `subagent_type`.

| Agent | Model | Use for |
|---|---|---|
| `arch` | **Opus** | Architecture, SOLID, layering, ADRs, refactor blast-radius |
| `pm` | **Opus** | Feature scoping, requirements, bug triage, UX consistency |
| `dev` | **Sonnet** | All implementation — commands, repos, migrations, TUI, chat, integrations |
| `tester` | **Sonnet** | Vitest test writing, coverage gaps, edge-case generation |
| `code-reviewer` | **Sonnet** | Final gate before merge — third independent regression sweep |

**Model rationale (per user contract):**
- **Opus** for thinking-heavy work: architecture decisions and product scoping.
- **Sonnet** for implementation and verification: dev work, test writing, code review.

**Standard flow:** `pm` → `arch` → `dev` → `tester` → `code-reviewer`. Each agent does not implement the next stage; it hands off explicitly.

## Reuse Before Writing (Duplication Check)

**Applies to every agent and every change.** Before adding a function, helper, type, validator, formatter, repo method, SQL statement, command, flag, fixture, or test helper, you MUST first prove there isn't an existing equivalent.

**The protocol:**

1. **Grep first** — `rg -n "<name or intent>" src/` (and `tests/` for test helpers). Search for the concept, not just the literal name.
2. **Check the canonical locations** — `src/utils/`, `src/core/`, `src/core/types.ts`, `src/storage/repositories/`, `src/commands/`, `tests/helpers/`.
3. **Decide:**
   - **Exact equivalent exists** → use it. Do not rewrite.
   - **Near-equivalent exists** → extend it (add a parameter, broaden the filter), do not clone.
   - **Two existing pieces already overlap** → unify them as part of your change. Do not add a third.
   - **Nothing exists** → write it once, in the right layer, so it can be reused next time.
4. **After the change**, if the same logic is now present in two or more files, extract it to a shared module in the same commit. Two is the threshold, not three.

**Per agent:**
- `pm` — confirm no existing command/flag covers the request before scoping a new one.
- `arch` — confirm no existing module/helper/repo covers the design before introducing a new one; cite files the plan touches.
- `dev` — run the greps above before writing code; cite the existing function being reused (or the file where the new shared helper landed).
- `tester` — reuse `createTestDb()`, existing fixtures, and existing helpers; extend an existing test before writing a parallel one.
- `code-reviewer` — duplicate of an existing function is **Critical** (block). Near-duplicate that should have been extracted is **Major**.

## Skills (.claude/skills/)

Twelve project-local skills, each as `<name>/SKILL.md`. Picked up automatically by the harness; agents reference them by `[[name]]`.

| Skill | Use when |
|---|---|
| `commander-cli` | Adding/editing a CLI subcommand or flag in `src/commands/*` |
| `ink-tui` | Editing `src/chat/components/*` or any future `src/tui/*` |
| `better-sqlite3` | New SQL, repository method, transaction, or schema in `src/storage/*` |
| `sqlite-migrations` | Any schema change — write + register a numbered migration |
| `node-llama-cpp` | Touching `src/chat/model.ts`, `model-finder.ts`, `intent.ts`, `prompt.ts` |
| `vitest-testing` | Writing tests under `tests/**` |
| `tsup-bundling` | Adding/removing a dep, or editing `tsup.config.ts` (external/noExternal) |
| `terminal-styling` | Any command emitting styled output (chalk, ora, figures, cli-table3) |
| `jira-integration` | `src/integrations/jira/*` and `jira_pull`/`jira_push` intents |
| `github-integration` | `src/integrations/github/*` and `github_pull`/`github_push` intents |
| `npm-publishing` | Cutting a release or changing the bin/files surface |
| `regression-sweep` | **Mandatory after every code change — see below** |

### Agent → skills attachment

| Agent | Skills it owns |
|---|---|
| `arch` | `regression-sweep`, `better-sqlite3`, `sqlite-migrations`, `commander-cli`, `ink-tui`, `node-llama-cpp`, `tsup-bundling` |
| `pm` | `regression-sweep`, `commander-cli`, `ink-tui`, `terminal-styling`, `jira-integration`, `github-integration` |
| `dev` | All twelve — chooses per layer touched |
| `tester` | `vitest-testing`, `better-sqlite3`, `sqlite-migrations`, `regression-sweep` |
| `code-reviewer` | All twelve — independently re-runs `regression-sweep` |

## Verification protocol (non-negotiable)

Every code change runs the **`regression-sweep`** skill before being declared done. Three independent passes:

1. **`dev` pass** — implements, runs the sweep, reports in the change summary.
2. **`tester` pass** — re-runs the sweep through the test lens.
3. **`code-reviewer` pass** — third independent run; promotes severity of anything the prior passes missed.

Each pass covers four checks:

- **Similar-issue search** — grep the codebase for the same *shape* of bug/anti-pattern (not the literal text). Fix all twins in the same commit or ticket them explicitly.
- **No-broken-flow** — `npm run typecheck && npm run lint && npm test && npm run build`, then smoke at least `todo --help`, `todo list`, and one command touching the changed module. For every CLI / TUI / chat path that touches the changed module, state explicitly whether it still works.
- **No-new-bug audit** — grep the diff for: new `any`, new `console.log`, new SQL interpolation, new empty catches, new top-level `ink`/`node-llama-cpp` imports, new `process.exit` outside `src/index.ts`, new dep missing from `tsup.config.ts` `external`/`noExternal`, new migration not registered in `runner.ts`, new command not registered in `src/index.ts`.
- **No-dead-code** — anything orphaned by the change is removed in the same commit (unused functions, dangling imports, removed-column references, commented-out blocks, drive-by `// TODO` without ticket, `_unused` renames).
- **Double-verify trace** — walk one happy path and one error path top-to-bottom through every layer (CLI/intent → handler → core → repo → SQL → output).

A change without the sweep report block at the bottom is **incomplete** and gets sent back from `code-reviewer`. See `.claude/skills/regression-sweep/SKILL.md` for the executable details and the exact report shape.
