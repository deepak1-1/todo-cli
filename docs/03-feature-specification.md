# 03 — Feature Specification

This document defines every feature of Todo CLI, organized by user persona. Each feature includes its purpose, how it works in both CLI and TUI modes, and edge cases.

## Feature Matrix

| Feature | General User | Pro Developer | Mode |
|---------|:---:|:---:|------|
| Task CRUD | Y | Y | CLI + TUI |
| Priority levels | Y | Y | CLI + TUI |
| Due dates (natural language) | Y | Y | CLI + TUI |
| Tags / Labels | Y | Y | CLI + TUI |
| Projects / Categories | Y | Y | CLI + TUI |
| Search (fuzzy) | Y | Y | CLI + TUI |
| Kanban board view | Y | Y | TUI |
| Recurring tasks | Y | Y | CLI + TUI |
| Export (JSON, CSV, MD) | Y | Y | CLI |
| Themes | Y | Y | TUI |
| Task dependencies | | Y | CLI + TUI |
| Git branch creation | | Y | CLI |
| Pomodoro timer | | Y | CLI + TUI |
| Jira integration | | Y | CLI + TUI |
| GitHub integration | | Y | CLI + TUI |
| Calendar sync | | Y | CLI |
| Slack notifications | | Y | CLI |
| CI/CD status | | Y | TUI |
| AI context export | | Y | CLI |

---

## Core Features (Everyone)

### 1. Task CRUD — Create, Read, Update, Delete

**Create** a task with a title and optional metadata:

```bash
# Minimal
todo add "Buy groceries"

# Full options
todo add "Fix authentication bug" \
  --priority urgent \
  --tag backend \
  --tag security \
  --project api-v2 \
  --due "next friday" \
  --description "JWT refresh token fails silently after 30 days"
```

Short flags: `-p` (priority), `-t` (tag), `-P` (project), `-d` (due), `-D` (description).

In TUI mode, pressing `a` opens an inline form with fields for each property. Tab moves between fields, Enter submits.

**Read** / List tasks:

```bash
todo ls                           # All pending tasks
todo ls --all                     # Including done/archived
todo ls --priority urgent         # Filter by priority
todo ls --tag backend             # Filter by tag
todo ls --project api-v2          # Filter by project
todo ls --due today               # Due today
todo ls --overdue                 # Past due date
todo ls --status in_progress      # By status
todo ls --sort due                # Sort by due date
todo ls --sort priority           # Sort by priority
todo ls --limit 10                # Limit output
```

Output is a formatted table with columns: ID, Priority (color-coded), Title, Project, Due Date, Tags, Status.

**Update** a task:

```bash
todo edit 42 --title "Fix JWT refresh token bug"
todo edit 42 --priority high
todo edit 42 --due "next monday"
todo edit 42 --tag +security      # Add tag
todo edit 42 --tag -backend       # Remove tag
todo edit 42 --project api-v3     # Move to different project
```

**Delete** a task:

```bash
todo rm 42                        # Soft delete (archive)
todo rm 42 --force                # Hard delete (permanent)
todo rm --done                    # Archive all completed tasks
```

**Status transitions:**

```bash
todo start 42                     # pending -> in_progress
todo done 42                      # -> done
todo archive 42                   # -> archived
todo reopen 42                    # done -> pending
```

### 2. Priority Levels

Four levels, each with a terminal color and sort weight:

| Level | Color | Weight | Indicator |
|-------|-------|--------|-----------|
| urgent | Red (bold) | 4 | (filled circle) |
| high | Yellow | 3 | (circle) |
| medium | Blue | 2 | (open circle) |
| low | Gray | 1 | (dot) |

Default priority is `medium` when not specified.

### 3. Due Dates with Natural Language

Powered by chrono-node, the `--due` flag accepts:

- Relative: `today`, `tomorrow`, `next friday`, `in 3 days`, `next week`
- Absolute: `2026-04-15`, `march 15`, `april 1st`
- Shorthand: `+1d` (1 day), `+3d`, `+1w` (1 week), `+2w`, `+1m` (1 month)

Overdue detection: tasks past their due date are highlighted in red in both CLI and TUI. The dashboard shows an "Overdue" section at the top.

### 4. Tags / Labels

Tags are arbitrary labels attached to tasks for cross-cutting categorization.

```bash
todo add "Review PR" -t code-review -t frontend
todo ls -t code-review                # All code review tasks
todo tags                              # List all tags with task counts
todo tags rename frontend ui           # Rename a tag globally
todo tags delete legacy                # Remove a tag from all tasks
```

Tags have an optional color, configurable via `todo config tag-color frontend cyan`.

### 5. Projects / Categories

Projects group related tasks into logical containers.

```bash
todo project create "API v2" --description "Next generation REST API"
todo project create "Personal" --color green
todo project ls                       # List all projects with task counts
todo project archive api-v2           # Archive a project + its tasks
```

Tasks belong to at most one project. In the TUI, the Project View shows a tree of projects with expandable task lists. Tasks without a project appear under "Inbox."

### 6. Search

```bash
todo ls --search "auth bug"           # Fuzzy search across title + description + tags + project
todo ls --search "auth" --tag backend # Search within filtered set
todo ls --search "auth" -P api-v2    # Search within project
```

Fuzzy matching via Fuse.js with weighted fields: title (weight 2.0), description (weight 1.0), tags (weight 0.5). Results are ranked by relevance score.

In TUI, pressing `/` opens a search bar with live results that update as you type.

### 7. Recurring Tasks

```bash
todo add "Weekly standup notes" --recur weekly
todo add "Monthly report" --recur monthly
todo add "Daily review" --recur daily
todo add "Sprint planning" --recur "0 10 * * 1"  # Cron: every Monday 10am
```

When a recurring task is marked done, a new instance is automatically created with the next due date. The completed instance is archived for history.

---

## Professional Developer Features

### 8. Task Dependencies

Dependencies are managed via the `edit` command:

```bash
todo edit 42 --depends +41            # Task 42 depends on task 41
todo edit 42 --depends +41,+43        # Depends on multiple tasks
todo edit 42 --depends -41            # Remove dependency
todo edit 42 --blocks +50             # Task 42 blocks task 50
```

Blocked tasks are displayed dimmed in the TUI board with a lock icon. Circular dependency detection prevents `A -> B -> A` chains.

### 9. Time Tracking

```bash
todo timer start <id>                 # Start tracking time on a task
todo timer stop [id]                  # Stop tracking
todo timer pomodoro <id>              # Start a pomodoro session
todo timer status                     # Show active sessions
todo timer history <id>               # Show tracking history
todo timer report [--days N]          # Unified time report
```

In the TUI, the Timer screen shows a large countdown display, the current task title, session count, and a progress ring. Notification fires on session complete.

### 10. Jira Integration

Full details in [07-integrations-guide.md](./07-integrations-guide.md).

```bash
todo jira auth                        # One-time setup
todo jira pull                        # Pull assigned issues
todo jira pull --sprint current       # Current sprint only
todo jira sync                        # Bidirectional sync
todo jira push 42                     # Push task status to Jira
todo jira link 42 PROJ-123            # Link local task to issue
todo jira open 42                     # Open in browser
```

### 11. GitHub Integration

```bash
todo gh auth                          # Setup via GitHub token
todo gh pull                          # Pull assigned issues
todo gh pull --repo owner/repo        # From specific repo
todo gh pr 42                         # Create PR from task's branch
todo gh link 42 owner/repo#123        # Link to GitHub issue
todo gh open 42                       # Open in browser
```

### 12. AI Context Export

```bash
todo context 42                       # Output structured context for AI tools
```

Produces a markdown block with task description, linked Jira context, git branch, recent commits, and modified files. Can be piped: `todo context 42 | pbcopy`.

### 13. Statistics & Reporting

```bash
todo stats                            # Task report (default: last 7 days)
todo stats --today                    # Today's tasks
todo stats --monthly                  # Last 30 days
todo stats --last 7d                  # Relative range (7d, 3m, 1y)
todo stats --from 2026-01-01 --to 2026-03-01  # Custom date range
todo stats --project api-v2           # Filter by project
todo stats --done                     # Show only done tasks
todo stats --search "auth"            # Fuzzy search
```

Shows a detailed task table with ID, Jira key, title, status, priority, project, created date, worked-on dates, and time spent. Includes a summary block.

### 14. Undo / History

```bash
todo undo                             # Undo last action
todo history                          # Show recent actions
todo history --task 42                # History for specific task
```

Every mutation is logged to an `action_log` table. `todo undo` reverses the last action.
