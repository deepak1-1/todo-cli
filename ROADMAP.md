# Features to Add — todo-cli Roadmap

## In progress: Chat → MCP migration

Remove the bundled local-model chat; ship `todo mcp` (MCP stdio server) so any AI agent
(Claude Code / Claude Desktop / Cursor) drives todo-cli in natural language. Instead of
shipping a local Llama model + Ink TUI, expose the task database as MCP tools.

- **MVP (Phase 1):** 6 task tools — `todo_add_task`, `todo_update_task`, `todo_set_status`,
  `todo_delete_task` (guarded, archives by default), `todo_list_tasks`, `todo_get_task`.
- **Phase 2:** `todo_get_stats`, timer tools (`todo_start_timer`, `todo_stop_timer`, `todo_add_time`).
- **Phase 3:** `todo_jira_pull/push`, `todo_github_pull/push`.
- Onboarding: `todo mcp --print-config` emits paste-ready JSON for the host config.
- Safety: reads free; safe writes undoable via action-log; delete off unless `--allow-delete`.

### Follow-ups ticketed from the MCP multi-agent review

- **Tag merge/replace as explicit `tagMode` on `EditOptions`** — MCP currently merges (bare names → `+`) while CLI `-t` replaces; the policy lives as a regex in the MCP handler. Promote to a first-class `EditOptions.tagMode: 'merge' | 'replace'` resolved inside `applyEdit` so a third surface can't silently inherit the wrong default.
- **limit-before-search ordering (all surfaces)** — `taskRepo.list(limit)` truncates before `fuzzySearch` runs, so a search can miss matches beyond the limit window. Pre-existing in the CLI; MCP now has parity. Fix once across list/bulk/stats/MCP (search-before-limit or push search into SQL).
- **stdout-redirect hardening** — `console.log = console.error` doesn't cover `process.stdout.write` in `json-output.ts`/`exit.ts`. Not reachable from the MCP path today, but document that MCP handlers must never call `fail()`/`emitJson()`, or guard `process.stdout.write` for the server lifetime.
- **`unhandledRejection → process.exit(1)`** — the CLI-global fatal handler stays installed under the long-running MCP server; a future floating promise would kill it. Scope/remove the exit-on-rejection behavior for the server lifetime.
- **Version drift** — `src/mcp/server.ts` hardcodes `version: '1.0.0'`; derive from `package.json` to avoid drift on release.
- **`todo_list_tasks` response-shape consistency** — with `search` the items are `SearchResult[]` (extra `_matchedIn` field) vs `TaskWithRelations[]` without; tags surface via `tagNames` on `todo_get_task` but task-returning tools omit them. Decide on a uniform, documented tool-output shape.
- **SQLite error text leakage** — MCP `err(e.message)` can surface raw `SQLITE_CONSTRAINT: ...` messages (table/column names). Harmless for a local single-user CLI; sanitize before any networked MCP deployment.
- **Dead trim in `validateUpdateInput`** — `applyEdit` discards its return value, so the title/description trim never persists on edit (only the throw-on-empty is load-bearing). Decide: persist the trimmed value, or drop the dead normalization.
- **Untrimmed `rename` paths** — `TagRepository.rename`/`ProjectRepository.rename` accept unvalidated new names; apply the same trim+empty guard now in `getOrCreate`.

## Tier 1 — highest leverage, little/no schema

1. **Urgency scoring + `todo next` + `--sort urgency`** — Taskwarrior formula (due 12,
   blocking 8, priority H/M/L 6/3.9/1.8, scheduled 5, active 4, age 2, tags/notes/project 1,
   blocked -5, waiting -3; coefficients config-tunable). Pure `src/core/urgency.ts`, no schema change.
2. **Inline quick-add + NLP capture** — `add "Fix login +acme @backend !high due:fri"` and
   free-form ("remind me to email Sam tomorrow 2pm"). Reuse chrono-node + parseDate.
3. **Shell completion (bash/zsh/fish)** — `todo completion <shell>`.
4. **Saved views / contexts** — named filters + an active context scoping `ls`/`next`.

## Tier 2 — light-to-moderate build

5. **Task notes + annotations** — per-task markdown note (GitHub-style checklists) +
   timestamped annotations; `006-annotations` migration.
6. **Snooze/scheduled + effort estimate** — hide a task until a date; effort field feeds
   urgency & GTD selection.
7. **Reminders + `todo agenda` + weekly `todo review`** — desktop notifications via
   notify-send/osascript driven by `todo remind --check`.
8. **ICS / calendar export** — `todo export --ics` subscribable feed.

## Tier 3 — bigger bets & rounding out

9. **Git-backed sync / export-import** — dstask model (git files, pull→push auto-merge,
   undo = git revert); start with `todo export` / `import`.
10. **Interactive TUI board (kanban + list)** — full-screen view in the reserved `src/tui/**`.
11. **Templates** — reusable task templates.
12. **Subtasks / hierarchy** — parent/child (distinct from blocking deps) + progress rollups.
13. **Finish recurrence + natural-language recurrence** — complete `handleRecurringCompletion`;
    parse "every second Monday".
14. **Productivity analytics** — streaks, burndown, velocity on stats + action-log.
15. **GitLab / Linear providers** — `gitlab_ref` / `linear_ref` columns already exist.
16. **AI-chat depth via MCP** — planning tools ("plan my week", "reschedule overdue") layered
    on the urgency engine.

---

Research sources: taskwarrior.org/docs/urgency & /commands, github.com/naggie/dstask,
github.com/gammons/ultralist, todotxt.org, mcpservers.org, modelcontextprotocol.io,
morgen.so, orgmode.org/worg.
