# Features to Add — todo-cli Roadmap

## Recommended sequence (2026-07 analysis)

Commit the in-flight `--sync-status` work → search-before-limit fix (#0) → urgency + `todo next`
(#1) → dependency enforcement + virtual-tag subset (#24) → inline quick-add (#2); slot
`todo log` (#25) anywhere as a cheap win.

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
- **stdout-redirect hardening** — `console.log = console.error` doesn't cover `process.stdout.write` in `json-output.ts`/`exit.ts`. Not reachable from the MCP path today, but document that MCP handlers must never call `fail()`/`emitJson()`, or guard `process.stdout.write` for the server lifetime.
- **`unhandledRejection → process.exit(1)`** — the CLI-global fatal handler stays installed under the long-running MCP server; a future floating promise would kill it. Scope/remove the exit-on-rejection behavior for the server lifetime.
- **Version drift** — `src/mcp/server.ts` hardcodes `version: '1.0.0'`; derive from `package.json` to avoid drift on release.
- **`todo_list_tasks` response-shape consistency** — with `search` the items are `SearchResult[]` (extra `_matchedIn` field) vs `TaskWithRelations[]` without; tags surface via `tagNames` on `todo_get_task` but task-returning tools omit them. Decide on a uniform, documented tool-output shape.
- **SQLite error text leakage** — MCP `err(e.message)` can surface raw `SQLITE_CONSTRAINT: ...` messages (table/column names). Harmless for a local single-user CLI; sanitize before any networked MCP deployment.
- **Dead trim in `validateUpdateInput`** — `applyEdit` discards its return value, so the title/description trim never persists on edit (only the throw-on-empty is load-bearing). Decide: persist the trimmed value, or drop the dead normalization.
- **Untrimmed `rename` paths** — `TagRepository.rename`/`ProjectRepository.rename` accept unvalidated new names; apply the same trim+empty guard now in `getOrCreate`.

Slot the small follow-ups (version drift, `tagMode`, response-shape, dead trim) into whichever PR
next touches those files rather than as standalone work.

## Tier 1 — highest leverage, little/no schema

0. **Search-before-limit fix + SQL search (promoted from the follow-ups list)** — verified
   wrong-output bug: `filter-options.ts` runs `fuzzySearch` after the SQL `LIMIT` is applied in
   `task.repo.ts`, so `ls -s login -n 20` searches only the first 20 rows; uniform across
   list/bulk/stats and MCP `todo_list_tasks` (an agent seeing a falsely-empty result acts on it).
   Fix once by pushing search into SQL — which also covers list/search performance at 10k tasks.
1. **Urgency scoring + `todo next` + `--sort urgency`** — Taskwarrior formula (due 12,
   blocking 8, priority H/M/L 6/3.9/1.8, scheduled 5, active 4, age 2, tags/notes/project 1,
   blocked -5, waiting -3; coefficients config-tunable). Pure `src/core/urgency.ts`, no schema change.
2. **Inline quick-add + NLP capture** — `add "Fix login +acme @backend !high due:fri"` and
   free-form ("remind me to email Sam tomorrow 2pm"). Reuse chrono-node + parseDate.
3. **Shell completion (bash/zsh/fish)** — `todo completion <shell>`.
4. **Saved views / contexts** — named filters + an active context scoping `ls`/`next`.
24. **Dependency enforcement on completion (+ virtual-tag subset)** — `core/status.ts` never
    consults blockers before a terminal transition, so `todo done` succeeds with open deps: the
    tool records constraints it doesn't honor. Guard terminal transitions (`--force` escape
    hatch; error names the blocker) and bundle the derived `+BLOCKED`/`+OVERDUE`/`+DUETODAY`
    subset of virtual tags (#19) so blocked state is visible in `ls` before completion time.

## Tier 2 — light-to-moderate build

5. **Task notes + annotations** — per-task markdown note (GitHub-style checklists) +
   timestamped annotations; `006-annotations` migration.
6. **Snooze/scheduled + effort estimate + `until`** — hide a task until a date; `until`
   date auto-drops/expires the task (Taskwarrior parity); effort field feeds urgency & GTD.
7. **Reminders + `todo agenda` + weekly `todo review`** — desktop notifications via
   notify-send/osascript driven by `todo remind --check`.
8. **Standards interop (two-way)** — `todo export --ics` subscribable feed, two-way
   CalDAV/iCal sync (todoman parity — Nextcloud / Apple Reminders / Google Tasks), and
   todo.txt import/export for migration on/off the tool.
25. **`todo log` — done/activity view** — chronological "what did I complete today / this week"
    read over the existing action_log (the events are already stored — near-free). Distinct from
    `stats` counts and from analytics (#14): this is the raw standup/GTD-review feed.
26. **ID-resolution ergonomics** — act on a task without copy-pasting its ID:
    `todo done <partial-title>` (fuzzy, must resolve unambiguously), interactive pick on
    ambiguity. Complements `next` (#1), which answers "what"; this fixes "act on it".
27. **One-shot import** — standalone `todo import` from Taskwarrior JSON / Todoist CSV / generic
    CSV as the adoption on-ramp; deliberately lighter than two-way interop (#8) and
    git-backed sync (#9).

## Tier 3 — bigger bets & rounding out

9. **Git-backed sync / export-import** — dstask model (git files, pull→push auto-merge,
   undo = git revert); start with `todo export` / `import`.
10. **Interactive TUI board (kanban + list)** — full-screen view in the reserved `src/tui/**`.
11. **Templates** — reusable task templates.
12. ~~Subtasks / hierarchy~~ — **shipped** (b9afa29): `parent_id` + migration 008, `--tree`,
    progress rollups.
13. **Finish recurrence + natural-language recurrence** — complete `handleRecurringCompletion`;
    parse "every second Monday".
14. **Productivity analytics** — streaks, burndown, velocity on stats + action-log.
15. **GitLab / Linear providers** — add `gitlab_ref` / `linear_ref` columns + provider implementations (the unused placeholder columns were removed in migration 007).
16. **AI-chat depth via MCP — full surface, not just tools** — planning tools ("plan my week",
    "reschedule overdue") layered on the urgency engine (#1), plus MCP **resources** (expose
    saved views / task lists as subscribable resources) and MCP **prompts** ("plan my week" as
    a first-class prompt template).
28. **Workspaces / multi-DB** — `--workspace`-scoped databases (work vs side-project vs
    personal). Distinct from contexts (#4), which scope filters, not storage. Touches the
    `database.ts` singleton — scope carefully, real blast radius.

## Tier 4 — competitive parity (from CLI-landscape survey)

17. **User-Defined Attributes (UDAs) / custom fields** — arbitrary typed fields on a task
    (Taskwarrior parity); usable in filters, sorts, and urgency coefficients.
18. **Custom named reports** — saved column-set + filter + sort views invoked as a verb
    (`todo standup`, `todo waiting`); distinct from contexts (#4), which only scope filters.
19. **Virtual tags (remainder)** — auto-computed tags usable in filters: `+ACTIVE`, `+WAITING`
    and the UDA-backed set (Taskwarrior parity), derived, never stored. The
    `+OVERDUE`/`+DUETODAY`/`+BLOCKED` MVP subset ships with dependency enforcement (#24).
20. **Hooks / event scripting** — opt-in user scripts on task lifecycle (`on-add`,
    `on-modify`, `on-exit`); re-introduces, behind a flag, the machinery removed on
    `refactor/remove-dead-features`. Powers custom automation Taskwarrior users rely on.
21. **Encryption at rest** — optional encrypted task DB (we already have an encrypted
    credential store; extend the pattern to task data for privacy parity).
22. **Mobile / web companion (sync-gated)** — read/light-write access off the terminal
    (Ultralist Pro parity). Gated behind git-backed sync (#9); longest-horizon item.
23. **Pull status sync — active↔active mirroring** — extend `--sync-status` (which today only
    recovers mistaken completions: remote-active + local-terminal → reopen) to also mirror active
    sub-states when both sides are active (e.g. Jira "In Progress" → local `in_progress`). Deferred
    from the GitHub/Jira `--sync-status` work because it is the only path that can downgrade
    legitimate local progress (Jira lag could knock a local `in_progress` back to `todo`); needs a
    conflict policy (newest-wins / remote-wins / prompt) before it's safe. GitHub stays no-op here
    (open/closed carries no sub-state signal).

---

## Engineering debt (non-feature)

- **Command-layer test coverage** — 15 command files have zero tests (add, edit, list, show,
  delete, status, stats, jira, github, tag, undo, config, context, reserved-verbs) while core
  and storage are well covered. Policy: pay the debt inside whichever PR touches each command
  (start with list/stats/add/status alongside #0/#1), using `createTestDb()` per the existing
  test pattern — not as a standalone quarter of work.

---

Research sources: taskwarrior.org/docs/urgency & /commands, github.com/naggie/dstask,
github.com/gammons/ultralist, github.com/klaudiosinani/taskbook, github.com/pimutils/todoman,
todotxt.org, medevel.com/tasks-cli-279, mcpservers.org, modelcontextprotocol.io,
morgen.so, orgmode.org/worg.
