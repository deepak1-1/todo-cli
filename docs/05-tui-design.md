# 05 — TUI Design (Terminal User Interface)

Built with Ink (React for terminals). Launched by running `todo` with no arguments.

## Screen Architecture

```
todo (launch) -> Dashboard
                   |
                   +-- 'b' -> Board View (Kanban)
                   +-- 'l' -> List View (Table)
                   +-- 'p' -> Project View (Tree)
                   +-- '/' -> Search View
                   +-- 's' -> Stats View
                   +-- '?' -> Help Overlay
                   |
                   +-- Any screen:
                       +-- Enter -> Detail View (single task)
                       +-- 'a' -> Add Task (inline form)
                       +-- 'e' -> Edit Task (inline form)
                       +-- Esc -> Back / Close
```

---

## Screen Specifications

### Dashboard (Home Screen)

The landing screen. Answers "what should I work on right now?"

```
+---------------------------------------------------------------------+
|  Todo CLI v1.0.0                            Mon, March 23 2026      |
|---------------------------------------------------------------------|
|                                                                      |
|  OVERDUE (2)                                                         |
|  +-------------------------------------------------------------+    |
|  | #38  [!] Fix JWT token expiry       API v2    Mar 20  backend|    |
|  | #35  [!] Update user migration      API v2    Mar 21  db     |    |
|  +-------------------------------------------------------------+    |
|                                                                      |
|  DUE TODAY (3)                                                       |
|  +-------------------------------------------------------------+    |
|  | #42  [!] Fix authentication bug     API v2    Today   backend|    |
|  | #44  [ ] Review PR #891             API v2    Today   review |    |
|  | #45  [ ] Buy groceries              Personal  Today          |    |
|  +-------------------------------------------------------------+    |
|                                                                      |
|  THIS WEEK                                                           |
|  Completed: 12 | Remaining: 8 | Pomodoros: 6 (2h 30m)              |
|  ============------------ 60%                                        |
|                                                                      |
|  ACTIVE TIMER: #42 Fix auth bug -- 18:32 remaining                  |
|                                                                      |
|---------------------------------------------------------------------|
|  [b]oard  [l]ist  [p]rojects  [t]imer  [/]search  [a]dd  [?]help   |
+---------------------------------------------------------------------+
```

### Board View (Kanban)

Four-column Kanban board. Navigate with arrow keys or h/j/k/l.

```
+---------------------------------------------------------------------+
|  Board: All Projects                                    [?] help    |
|---------------------------------------------------------------------|
|  PENDING (5)     | IN PROGRESS (3) | DONE (8)       | ARCHIVED      |
|  -----------     | ---------------  | --------       | --------      |
|                  |                  |                 |               |
| +--------------+ | +--------------+ | +--------------+ |              |
| |[!] Fix auth  | | |[*] Write API | | |[x] Setup CI | |              |
| |  API v2      | | |  docs        | | |  API v2      | |              |
| |  Mar 27      | | |  API v2      | | |  Mar 19      | |              |
| |  backend,sec | | |  docs        | | |              | |              |
| | [BACK-789]   | | |              | | |              | |              |
| +--------------+ | +--------------+ | +--------------+ |              |
|                  |                  |                 |               |
| +--------------+ | +--------------+ | +--------------+ |              |
| |[*] Update    | | |[ ] Refactor  | | |[x] Add logs | |              |
| |  deps        | | |  auth module | | |  API v2      | |              |
| |  API v2      | | |  API v2      | | |  Mar 18      | |              |
| +--------------+ | +--------------+ | +--------------+ |              |
|                  |                  |                 |               |
| +--------------+ |                  |                 |               |
| |LOCKED        | |                  |                 |               |
| |  Deploy v2   | |                  |                 |               |
| |  blocked #42 | |                  |                 |               |
| +--------------+ |                  |                 |               |
|---------------------------------------------------------------------|
|  arrows/hjkl:navigate  Enter:open  d:done  s:start  Space:select    |
+---------------------------------------------------------------------+
```

**Board keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `h`/left | Move to left column |
| `l`/right | Move to right column |
| `j`/down | Move down within column |
| `k`/up | Move up within column |
| `Enter` | Open task detail view |
| `d` | Mark task done |
| `s` | Start task |
| `Space` | Toggle select (bulk operations) |
| `m` | Move selected tasks |
| `a` | Add new task |
| `e` | Edit highlighted task |
| `x` | Delete highlighted task |
| `f` | Filter (opens filter bar) |
| `P` | Switch project filter |

### List View

Sortable table with all tasks.

```
+---------------------------------------------------------------------+
|  List View                Sort: priority desc      Filter: pending   |
|---------------------------------------------------------------------|
|                                                                      |
|  ID  | Pri | Title                    | Project  | Due     | Tags    |
| -----+-----+--------------------------+----------+---------+-------- |
|> 42  | [!] | Fix authentication bug   | API v2   | Mar 27  | back.. |
|  38  | [!] | Fix JWT token expiry     | API v2   | Mar 20! | back.. |
|  35  | [*] | Update user migration    | API v2   | Mar 21! | db     |
|  44  | [ ] | Review PR #891           | API v2   | Today   | review |
|  45  | [ ] | Buy groceries            | Personal | Today   |        |
|  47  | [ ] | Refactor auth module     | API v2   |         | back.. |
|  48  | [.] | Update README            | API v2   |         | docs   |
|                                                                      |
|---------------------------------------------------------------------|
|  j/k:navigate  Enter:detail  1-4:set priority  Tab:sort column      |
+---------------------------------------------------------------------+
```

### Detail View

Full task information, accessed by pressing Enter on any task.

```
+---------------------------------------------------------------------+
|  <- Esc to go back                                     Task #42     |
|---------------------------------------------------------------------|
|                                                                      |
|  Fix authentication bug                                              |
|  ======================                                              |
|                                                                      |
|  Status:     PENDING (urgent)                                        |
|  Project:    API v2                                                  |
|  Due:        Friday, March 27, 2026 (4 days from now)               |
|  Tags:       backend  security                                       |
|  Created:    March 23, 2026 at 2:15 PM                              |
|  Time:       1h 25m across 3 pomodoro sessions                      |
|                                                                      |
|  -- Description ---------------------------------------------------  |
|  JWT refresh token fails silently after 30 days. Users get logged   |
|  out without error. Need to implement token rotation.               |
|                                                                      |
|  -- Dependencies --------------------------------------------------  |
|  BLOCKED BY: #41 Add token rotation endpoint (pending)              |
|  BLOCKING:   #50 Deploy v2 to staging                               |
|                                                                      |
|  -- Integrations --------------------------------------------------  |
|  Jira:    BACKEND-789 (3 comments, updated 2h ago)                  |
|  Branch:  fix/42-fix-auth-bug (CI: passing)                         |
|                                                                      |
|  -- Pomodoro History ----------------------------------------------  |
|  Mar 23  25min done | 25min done | 25min done                      |
|                                                                      |
|---------------------------------------------------------------------|
|  [e]dit  [d]one  [s]tart  [t]imer  [o]pen jira  [b]ranch           |
+---------------------------------------------------------------------+
```

### Timer View (Pomodoro)

```
+---------------------------------------------------------------------+
|  Pomodoro Timer                                                      |
|---------------------------------------------------------------------|
|                                                                      |
|                         +-----------+                                |
|                         |           |                                |
|                         |   18:32   |                                |
|                         |           |                                |
|                         +-----------+                                |
|                                                                      |
|                    Session 3 of 4  ***_                               |
|                                                                      |
|              Working on: #42 Fix authentication bug                  |
|              Project:    API v2                                       |
|                                                                      |
|              ================----------------  52%                   |
|                                                                      |
|  -- Today's Sessions --------------------------------------------- --|
|  #42  Fix auth bug           25min +  25min +  18:32...             |
|  #44  Review PR #891         25min +                                 |
|                                                                      |
|  Total today: 1h 43m (4 sessions completed)                         |
|                                                                      |
|---------------------------------------------------------------------|
|  [Space]:pause/resume  [s]:skip  [q]:quit timer  [+/-]: +/- 5 min  |
+---------------------------------------------------------------------+
```

### Search View

```
+---------------------------------------------------------------------+
|  Search                                                              |
|---------------------------------------------------------------------|
|                                                                      |
|  > auth bu|                                                          |
|                                                                      |
|  3 results:                                                          |
|                                                                      |
|  > #42  [!]  Fix authentication bug         API v2     backend      |
|    #38  [!]  Fix JWT token auth expiry      API v2     backend      |
|    #47  [ ]  Refactor auth module           API v2     backend      |
|                                                                      |
|---------------------------------------------------------------------|
|  Type to search  |  Enter:open  |  Esc:close                        |
+---------------------------------------------------------------------+
```

### Project View

```
+---------------------------------------------------------------------+
|  Projects                                                            |
|---------------------------------------------------------------------|
|                                                                      |
|  v API v2                              12 tasks (3 urgent)          |
|    |  [!] #42  Fix authentication bug    Mar 27                     |
|    |  [!] #38  Fix JWT token expiry      Mar 20 !                   |
|    |  [*] #35  Update user migration     Mar 21 !                   |
|    |  [ ] #44  Review PR #891            Today                      |
|    +  ... 8 more                                                    |
|                                                                      |
|  > Personal                            3 tasks                      |
|  > DevOps                              5 tasks (1 urgent)           |
|                                                                      |
|  -- Inbox (no project) --                                           |
|    [ ] #51  Read Rust book                                          |
|    [.] #52  Organize bookmarks                                      |
|                                                                      |
|---------------------------------------------------------------------|
|  Enter:expand/collapse  Tab:switch project  a:add to project        |
+---------------------------------------------------------------------+
```

---

## Global Keyboard Shortcuts

These work on every screen:

| Key | Action |
|-----|--------|
| `q` / `Ctrl+C` | Quit TUI |
| `Esc` | Go back / Close modal |
| `?` | Toggle help overlay |
| `a` | Add new task |
| `/` | Open search |
| `b` | Go to Board |
| `l` | Go to List |
| `p` | Go to Projects |
| `t` | Go to Timer |
| `s` (on dashboard) | Go to Stats |
| `i` | Go to Integrations |
| `R` | Refresh data |
| `1`-`4` | Quick-set priority on highlighted task |
| `:` | Command palette (type any CLI command) |

## Command Palette

Pressing `:` opens a command input at the bottom of any screen:

```
: add "New task" -p urgent -t backend
: jira pull --sprint current
: export --format md
: config set theme nord
```

---

## Theming

### Built-in Themes

- **Default (Dark)** — Dark background, high contrast
- **Dracula** — Purple-based dark theme
- **Nord** — Cool blue-gray palette
- **Solarized Dark** — Classic warm dark
- **Solarized Light** — Light variant
- **Monokai** — Warm dark, Sublime Text feel

### Theme Configuration

```bash
todo config set theme dracula
```

### Custom Themes

Create `~/.todo-cli/themes/mytheme.json`:

```json
{
    "name": "My Theme",
    "colors": {
        "background": "#1a1a2e",
        "foreground": "#eaeaea",
        "accent": "#e94560",
        "success": "#0f9d58",
        "warning": "#f4b400",
        "error": "#db4437",
        "muted": "#555555",
        "border": "#333366",
        "priority": {
            "urgent": "#ff0000",
            "high": "#ff9900",
            "medium": "#4a86e8",
            "low": "#999999"
        }
    }
}
```

---

## Responsive Design

- **Width < 80 columns:** Single-column layout. Board shows one column at a time.
- **Width 80-120:** Standard layout as shown above.
- **Width > 120:** Expanded layout with more detail visible inline.
- **Height < 24 rows:** Compact mode with reduced padding.

## Accessibility

- All colors meet WCAG AA contrast ratio
- No information conveyed by color alone (icons + text accompany every indicator)
- All elements keyboard-accessible
- `--no-color` flag disables all coloring
