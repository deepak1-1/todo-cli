# todo-cli

**Terminal task management for developers**

A powerful CLI task manager designed for developers. Manage tasks directly from your terminal with built-in time tracking, integrations with your favourite tools, an extensible plugin system, and native AI-agent support via the Model Context Protocol.

## Features

### Core Features
- Create, update, and delete tasks
- Organize tasks with tags and projects
- Task search and advanced filtering
- Due date and deadline tracking
- Task priority levels (low, medium, high, urgent)
- Detailed task descriptions and notes

### Integrations
Connect todo-cli with your favorite tools:
- **Jira** - Sync tasks with Jira projects
- **GitHub** - Create tasks from issues and PRs

### Productivity Features
- Stopwatch time tracking with manual logging
- Task completion tracking
- Time estimates and actual time spent
- Task history and activity logs
- Bulk task operations

### Developer-Friendly
- Extensible plugin system
- TypeScript support
- Secure credential management
- Easy integration development

## Installation

### curl (macOS / Linux, no Node required)

```bash
curl -fsSL https://raw.githubusercontent.com/deepak1-1/todo-cli/main/install.sh | bash
```

Installs a standalone binary to `~/.local/lib/todo-cli` and symlinks `todo` into `~/.local/bin`. Pin a version with `TODO_VERSION=vX.Y.Z`; uninstall with `... | bash -s -- --uninstall`.

### npm (all platforms, including Windows)

Requires Node >= 22:

```bash
npm install -g @deepak.tewatia/todo-cli
```

Or use with npx:

```bash
npx @deepak.tewatia/todo-cli
```

Note for Windows: npm is the supported install path. `better-sqlite3` ships prebuilt bindings; if your network blocks the prebuild download (e.g. a corporate proxy), npm falls back to compiling from source, which needs build tools.

## Quick Start

### Basic Commands

Add a new task:
```bash
todo add "Implement feature X" --priority high --due "2026-03-31"
```

List all tasks:
```bash
todo list
```

Mark a task in progress:
```bash
todo start <task-id>
```

Track time on a task with the stopwatch:
```bash
todo timer start <task-id>
todo timer stop <task-id>
```

Mark task as done:
```bash
todo done <task-id>
```

Search tasks:
```bash
todo ls --search "keyword"
```

View task details:
```bash
todo show <task-id>
```

## Use with your AI agent (MCP)

todo-cli includes a built-in Model Context Protocol stdio server. Any MCP-compatible AI agent (Claude Code, Claude Desktop, Cursor) can read and write your tasks directly.

### Quick setup

1. Start the server and print the config:
```bash
todo mcp --print-config
```

2. Paste the printed JSON into your MCP client's config file. The `--print-config` output already contains the correct absolute path to your installed binary — no editing required.

3. Restart your AI agent. It will now have access to the following tools:

   **Task management:**
   - `todo_add_task` — create a task
   - `todo_update_task` — edit title, priority, due date, tags, project
   - `todo_set_status` — change task status
   - `todo_delete_task` — archive (soft-delete, undoable via `todo undo`)
   - `todo_list_tasks` — list with filters
   - `todo_get_task` — get a single task with full relations

   **Time tracking:**
   - `todo_start_timer` — start a timer on a task (auto-advances status to in_progress)
   - `todo_stop_timer` — stop a timer by task ID, or all active timers
   - `todo_get_active_timers` — list all running timers with elapsed seconds and notes
   - `todo_log_time` — manually log time (e.g. "2h", "30m", "1h30m", "90" minutes)
   - `todo_list_sessions` — list all tracking sessions for a task
   - `todo_get_time_report` — time report grouped by task for the last N days
   - `todo_reduce_session` — subtract time from a completed session (cannot be undone)
   - `todo_delete_session` — permanently remove a session (requires `--allow-delete`)

### Safety

By default `todo_delete_task` **archives** tasks (recoverable with `todo undo`), and `todo_delete_session` is **disabled**. Permanent hard-delete and session deletion both require starting the server with `--allow-delete`:

```bash
todo mcp --allow-delete
```

## Configuration

Configure todo-cli via `~/.todo-cli/config.json`:

```json
{
  "theme": "dark",
  "defaultPriority": "medium",
  "storage": {
    "type": "sqlite",
    "path": "~/.todo-cli/tasks.db"
  }
}
```

### Theme Options
- `dark` - Dark theme with bright accents
- `light` - Light theme for bright environments
- `ocean` - Cool blue ocean-inspired colors
- `forest` - Green forest-inspired theme
- `dracula` - Popular Dracula color scheme
- `nord` - Arctic, north-bluish color palette

## Integrations

### Connecting an Integration

```bash
todo integrate          # list available integrations and their status
todo jira setup         # configure Jira credentials
todo gh auth            # check GitHub CLI authentication status
```

Once configured, run `todo jira sync` or `todo gh sync` to pull issues into your task list.

### Available Integrations

| Service | Features | Status |
|---------|----------|--------|
| Jira | Create/sync tasks, track issues | Stable |
| GitHub | Create tasks from issues/PRs, push tasks as issues | Stable |

### GitHub Integration

#### Pulling issues

Import assigned GitHub issues as local tasks:

```bash
todo gh pull                          # pull all assigned issues (all repos)
todo gh pull --repo acme/frontend     # filter by repository
todo gh pull -P myproject             # scope to a local project (derives repo from linked tasks)
todo gh pull --sync-status            # also reconcile status of already-imported tasks
todo gh pull --dry-run                # preview without writing
```

Note: `gh pull` creates new local tasks from remote issues. Already-imported tasks are skipped unless `--sync-status` is passed.

#### Pushing tasks as issues

Push local tasks to GitHub — update linked tasks and optionally create issues for unlinked ones:

```bash
todo gh push                          # update already-linked tasks only
todo gh push -P myproject             # create issues + update linked tasks in project "myproject"
todo gh push -P myproject --repo o/r  # override repo for new issue creation
todo gh push -P none --repo o/r       # push project-less tasks, creating issues in o/r
todo gh push -P myproject --dry-run   # preview without writing
todo gh push --json                   # machine-readable output
```

**Scope and creation rules:**
- Without `-P` or `--repo`, only already-linked tasks are updated (no new issues created).
- `-P <project>` scopes to that project's tasks. The repo is derived from sibling tasks' GitHub refs or the project's `GitHub: owner/repo` description marker; pass `--repo` to override.
- `-P none` scopes to project-less tasks; `--repo` is required for new issue creation.
- Done and archived tasks are never pushed as new issues.
- Subtasks become independent issues (no parent linkage on GitHub).

**Pull creates, push updates + creates:**
`gh pull` only creates local tasks (never updates them unless `--sync-status` is given). `gh push` both updates linked tasks (state, priority label) and creates new issues for unlinked ones when `-P` or `--repo` is set.

**Exit codes:**
- `0` — all tasks succeeded.
- `1` — one or more tasks failed (partial failure); created/updated tasks are still reported.

## Plugin Development

Extend todo-cli by creating custom plugins that implement the `IntegrationProvider` interface.

### Quick Example

```typescript
import { IntegrationProvider } from '@deepak.tewatia/todo-cli';

export class MyServicePlugin implements IntegrationProvider {
  name = 'my-service';
  description = 'My custom integration';

  async authenticate(credentials: Record<string, string>) {
    // Handle authentication
  }

  async sync(tasks: Task[]) {
    // Sync tasks
  }
}
```

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/deepak1-1/todo-cli/issues)
- Discussions: [GitHub Discussions](https://github.com/deepak1-1/todo-cli/discussions)

## License

This project is licensed under the MIT License - see [LICENSE](./LICENSE) for details.

---

**Made with for developers, by developers.**
