# Todo CLI — Documentation Index

> A powerful, interactive terminal-based task management system for developers and professionals.

## Documents

| # | Document | Description |
|---|----------|-------------|
| 01 | [Architecture Overview](./01-architecture-overview.md) | System design, project structure, layered architecture, data flow |
| 02 | [Technology Choices](./02-technology-choices.md) | Every technology decision with rationale and alternatives considered |
| 03 | [Feature Specification](./03-feature-specification.md) | Complete feature list for general users and professional developers |
| 04 | [CLI Commands Reference](./04-cli-commands-reference.md) | Every direct command, flags, options, and usage examples |
| 05 | [TUI Design](./05-tui-design.md) | Interactive terminal UI — screens, navigation, keyboard shortcuts, theming |
| 06 | [Database Schema](./06-database-schema.md) | SQLite schema, migrations, indexing strategy, data model |
| 07 | [Integrations Guide](./07-integrations-guide.md) | Jira, GitHub, GitLab, Calendar, Slack, Notion, Linear, and more |
| 08 | [Plugin System](./08-plugin-system.md) | Plugin architecture, Provider interface, third-party extension API |
| 09 | [Publishing & Distribution](./09-publishing-distribution.md) | npm publishing, Homebrew, CI/CD, versioning, release strategy |
| 10 | [Development Roadmap](./10-development-roadmap.md) | Phased build plan, milestones, priorities, timeline |

## Quick Start (After Build)

```bash
# Install globally
npm install -g @todo-cli/todo

# Add your first task
todo add "Read the documentation" -p high -t onboarding

# Launch interactive TUI
todo

# Connect Jira
todo integrate jira
```

## Project Repository Structure

```
todo-cli/
├── docs/                  # ← You are here
├── src/
│   ├── commands/          # CLI command handlers
│   ├── tui/               # Interactive terminal UI
│   ├── core/              # Business logic
│   ├── storage/           # SQLite persistence
│   ├── integrations/      # External service connectors
│   ├── plugins/           # Plugin system
│   ├── config/            # Configuration management
│   └── index.ts           # Entry point
├── tests/
├── package.json
├── tsconfig.json
└── README.md
```
