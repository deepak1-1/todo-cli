# todo-cli

**Interactive terminal task management for developers**

A powerful, feature-rich CLI task manager designed for developers. Manage tasks directly from your terminal with a beautiful TUI, Pomodoro timer, integrations with your favorite tools, and an extensible plugin system.

## Features

### Core Features
- Create, update, and delete tasks
- Organize tasks with tags and categories
- Task search and advanced filtering
- Due date and deadline tracking
- Task priority levels (Low, Medium, High, Critical)
- Detailed task descriptions and notes

### Interactive Terminal UI
- Modern TUI built with Ink and React
- 11 purpose-built screens for different workflows
- 6 theme options: Dark, Light, Ocean, Forest, Dracula, Nord
- Vim-style navigation and keybindings
- Real-time filtering and sorting
- Responsive design that works in any terminal

### Integrations
Connect todo-cli with your favorite tools:
- **Jira** - Sync tasks with Jira projects
- **GitHub** - Create tasks from issues and PRs

### Productivity Features
- Pomodoro timer with configurable intervals
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

Install globally via npm:

```bash
npm install -g @todo-cli/todo
```

Or use with npx:

```bash
npx @todo-cli/todo
```

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

Start working on a task (Pomodoro timer):
```bash
todo start <task-id>
```

Mark task as done:
```bash
todo done <task-id>
```

Start the interactive TUI:
```bash
todo
```

Search tasks:
```bash
todo ls --search "keyword"
```

View task details:
```bash
todo show <task-id>
```

## Interactive TUI

Launch the interactive terminal UI for the best experience:

```bash
todo
```

### Navigation
- **j/k** - Move down/up in lists
- **h/l** - Navigate between screens
- **Enter** - Select/confirm
- **q** - Quit
- **/** - Search
- **:w** - Save changes
- **:q** - Quit

### Screens
1. **Dashboard** - Task overview with urgent/due/in-progress
2. **List** - Browsable task list with sorting
3. **Board** - Kanban-style columns
4. **Search** - Advanced search and filtering
5. **Detail** - Full task information
6. **Project** - Tasks grouped by project
7. **Stats** - Productivity metrics

## Configuration

Configure todo-cli via `~/.todo-cli/config.json`:

```json
{
  "theme": "dark",
  "timerWork": 25,
  "timerBreak": 5,
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

### Pomodoro Configuration
- `timerWork` - Work interval in minutes (default: 25)
- `timerBreak` - Break interval in minutes (default: 5)

## Integrations

### Connecting an Integration

1. Open todo-cli TUI
2. Navigate to Integrations screen
3. Select an integration to configure
4. Enter your credentials
5. Authorize and sync

### Available Integrations

| Service | Features | Status |
|---------|----------|--------|
| Jira | Create/sync tasks, track issues | Stable |
| GitHub | Create tasks from issues/PRs | Stable |

## Plugin Development

Extend todo-cli by creating custom plugins. See [Plugin Development Guide](./docs/PLUGIN_DEVELOPMENT.md) for detailed instructions.

### Quick Example

```typescript
import { IntegrationProvider } from '@todo-cli/core';

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

## Documentation

- [API Reference](./docs/API.md)
- [Plugin Development Guide](./docs/PLUGIN_DEVELOPMENT.md)
- [Architecture Overview](./docs/ARCHITECTURE.md)
- [CLI Reference](./docs/CLI.md)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on:
- Setting up your development environment
- Project structure
- Creating plugins
- PR guidelines
- Code style

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/yourusername/todo-cli/issues)
- Documentation: [docs/](./docs/)
- Discussions: [GitHub Discussions](https://github.com/yourusername/todo-cli/discussions)

## License

This project is licensed under the MIT License - see [LICENSE](./LICENSE) for details.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history and updates.

---

**Made with for developers, by developers.**
