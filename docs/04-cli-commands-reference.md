# 04 — CLI Commands Reference

Complete reference for every direct CLI command. All commands follow the pattern `todo <command> [args] [options]`.

## Global Options

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help for any command |
| `--version`, `-V` | Show version number |
| `--no-color` | Disable colored output |
| `--json` | Output raw JSON (for scripting/piping) |
| `--quiet`, `-q` | Minimal output (just IDs or success/fail) |
| `--verbose`, `-v` | Verbose output with debug info |
| `--config <path>` | Use alternate config file |

---

## Core Commands

### `todo` (no arguments)

Launches the interactive TUI. See [05-tui-design.md](./05-tui-design.md).

### `todo add <title>`

Create a new task.

| Option | Short | Description | Example |
|--------|-------|-------------|---------|
| `--priority` | `-p` | Priority level | `-p urgent` |
| `--tag` | `-t` | Tag (repeatable) | `-t backend -t security` |
| `--project` | `-P` | Project name | `-P "API v2"` |
| `--due` | `-d` | Due date (natural language) | `-d "next friday"` |
| `--description` | `-D` | Long description | `-D "Detailed info..."` |
| `--depends` | | Task IDs this depends on | `--depends 41,43` |
| `--recur` | `-r` | Recurrence pattern | `-r weekly` |

**Output:** `Created task #42: Fix authentication bug [urgent] (due: Fri Mar 27)`

### `todo ls` / `todo list`

List tasks with filtering and sorting.

| Filter | Short | Description | Example |
|--------|-------|-------------|---------|
| `--priority` | `-p` | Filter by priority | `-p urgent` |
| `--tag` | `-t` | Filter by tag | `-t backend` |
| `--project` | `-P` | Filter by project | `-P "API v2"` |
| `--status` | `-s` | Filter by status | `-s in_progress` |
| `--due` | `-d` | Due date filter | `-d today`, `-d overdue` |
| `--all` | `-a` | Include done/archived | |
| `--sort` | | Sort field | `--sort due`, `--sort priority` |
| `--reverse` | | Reverse sort order | |
| `--limit` | `-n` | Limit results | `-n 10` |

### `todo show <id>`

Show full details of a single task including description, dependencies, integrations, and pomodoro history.

### `todo edit <id>`

Modify a task's properties. All options from `todo add` are available. Tag prefixes: `+` adds, `-` removes, no prefix replaces all tags.

```bash
todo edit 42 --title "Fix JWT refresh token bug"
todo edit 42 --priority high
todo edit 42 --tag +security          # Add tag
todo edit 42 --tag -backend           # Remove tag
```

### `todo rm <id>` / `todo delete <id>`

```bash
todo rm 42                            # Soft delete (archive)
todo rm 42 --force                    # Hard delete (permanent)
todo rm --done                        # Archive all completed tasks
```

### Status Transition Commands

```bash
todo start <id>                       # pending -> in_progress
todo done <id>                        # any -> done
todo archive <id>                     # done -> archived
todo reopen <id>                      # done/archived -> pending
```

---

## Project Commands

```bash
todo project create <name> [-D description] [-c color]
todo project ls
todo project show <name>
todo project rename <old> <new>
todo project archive <name>
todo project delete <name>
```

## Tag Commands

```bash
todo tag ls
todo tag rename <old> <new>
todo tag delete <name>
todo tag color <name> <color>
```

## Search

```bash
todo ls --search "auth bug"
todo ls --search "auth" --tag backend
todo ls --search "auth" --project api-v2
todo ls --search "auth" --all
```

---

## Developer Commands

### `todo timer`

```bash
todo timer start <id>                 # Start tracking time
todo timer stop [id]                  # Stop tracking
todo timer status                     # Show active sessions
todo timer log <id> <duration>        # Log time manually
todo timer history <id>               # Show tracking history
todo timer pomodoro <id>              # Start a pomodoro session
todo timer report [--days N]          # Unified time report
todo timer ls <id>                    # List sessions for a task
todo timer reduce <sessionId> <dur>   # Reduce time from session
todo timer delete <sessionId>         # Delete a session
```

### `todo context <id>`

```bash
todo context 42                       # AI-friendly context block
todo context 42 --format json         # JSON format
```

---

## Integration Commands

### `todo integrate`

```bash
todo integrate                        # List active integrations
todo integrate <name>                 # Setup wizard
todo integrate remove <name>          # Remove integration
todo integrate status                 # Health check all
```

### `todo jira`

```bash
todo jira auth
todo jira pull [--sprint current] [--project KEY] [--limit N]
todo jira sync
todo jira push <id>
todo jira link <id> <issue-key>
todo jira open <id>
todo jira unlink <id>
```

### `todo gh` (GitHub)

```bash
todo gh auth
todo gh pull [--repo owner/repo] [--label label]
todo gh pr <id>
todo gh link <id> <owner/repo#num>
todo gh open <id>
```

---

## Utility Commands

### `todo config`

```bash
todo config                           # Show current config
todo config set <key> <value>
todo config get <key>
todo config reset
todo config edit                      # Open in $EDITOR
```

### `todo stats`

```bash
todo stats [--today] [--weekly] [--monthly] [--last 7d] [--from DATE] [--to DATE]
todo stats [--done] [--in-progress] [--pending] [--project name] [--tag tags] [--search query]
```

### `todo undo`

```bash
todo undo                             # Undo last action
todo history                          # Show action log
todo history --task <id>              # History for task
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments / usage error |
| 3 | Task not found |
| 4 | Conflict (sync, dependency cycle) |
| 5 | Authentication failure (integration) |
| 6 | Network error (integration) |

## Shell Completions

```bash
todo completions bash >> ~/.bashrc
todo completions zsh >> ~/.zshrc
todo completions fish >> ~/.config/fish/completions/todo.fish
```
