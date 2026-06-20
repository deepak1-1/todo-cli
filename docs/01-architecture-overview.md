# 01 — Architecture Overview

## Design Philosophy

Todo CLI is built on three core principles:

1. **Dual personality** — The tool has two distinct presentation layers (direct CLI commands and an interactive TUI) that share a single core engine. A user can do everything through quick commands or through the full-screen interactive interface. Neither is a second-class citizen.

2. **Core purity** — Business logic lives in `src/core/` and has zero I/O dependencies. It doesn't know about databases, terminals, or APIs. This makes it trivially testable and guarantees that adding a new UI surface or integration never risks breaking task logic.

3. **Plugin-first extensibility** — Every integration (Jira, GitHub, etc.) implements the same `IntegrationProvider` interface. Third-party developers can write their own plugins as npm packages. The tool grows through its ecosystem, not through monolithic feature additions.

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Entry Point                          │
│                     src/index.ts                          │
│          (Routes to CLI mode or TUI mode)                │
└──────────┬─────────────────────────────────┬─────────────┘
           │                                 │
           ▼                                 ▼
┌─────────────────────┐          ┌─────────────────────────┐
│    CLI Layer         │          │      TUI Layer           │
│   src/commands/      │          │      src/tui/            │
│                      │          │                          │
│  commander.js based  │          │  Ink (React) based       │
│  Parses argv         │          │  Full-screen terminal UI │
│  Executes commands   │          │  Keyboard-driven         │
│  Outputs to stdout   │          │  Multiple screens        │
└──────────┬───────────┘          └────────────┬────────────┘
           │                                    │
           └──────────────┬─────────────────────┘
                          │
                          ▼
           ┌──────────────────────────┐
           │       Core Engine         │
           │       src/core/           │
           │                           │
           │  TaskService              │
           │  ProjectService           │
           │  FilterEngine             │
           │  Scheduler                │
           │  TimerService             │
           │  DependencyResolver       │
           │                           │
           │  (Pure logic, zero I/O)   │
           └─────────────┬────────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
┌──────────────────────┐  ┌────────────────────────┐
│   Storage Layer       │  │  Integration Layer      │
│   src/storage/        │  │  src/integrations/      │
│                       │  │                         │
│   SQLite via          │  │  Jira, GitHub            │
│   better-sqlite3      │  │                         │
│                       │  │                         │
│   MigrationRunner     │  │                         │
│   TaskRepository      │  │  Plugin loader          │
│   ProjectRepository   │  │  Provider interface     │
│   TagRepository       │  │                         │
└──────────────────────┘  └────────────────────────┘
```

## Directory Structure

```
todo-cli/
├── docs/                          # Documentation (this folder)
├── src/
│   ├── index.ts                   # Entry point — detects CLI vs TUI mode
│   ├── commands/                  # CLI command definitions
│   │   ├── add.ts                 # todo add
│   │   ├── list.ts                # todo ls
│   │   ├── edit.ts                # todo edit
│   │   ├── done.ts                # todo done
│   │   ├── delete.ts              # todo rm
│   │   ├── board.ts               # todo board (launches TUI)
│   │   ├── timer.ts               # todo timer
│   │   ├── integrate.ts           # todo integrate
│   │   └── config.ts              # todo config
│   ├── tui/                       # Interactive terminal UI
│   │   ├── App.tsx                # Root Ink component
│   │   ├── screens/
│   │   │   ├── Dashboard.tsx      # Landing screen
│   │   │   ├── BoardView.tsx      # Kanban columns
│   │   │   ├── ListView.tsx       # Sortable table
│   │   │   ├── DetailView.tsx     # Single task detail
│   │   │   ├── ProjectView.tsx    # Project tree
│   │   │   ├── TimerView.tsx      # Pomodoro screen
│   │   │   ├── SearchView.tsx     # Fuzzy search
│   │   │   └── IntegrationView.tsx# Integration status
│   │   ├── components/
│   │   │   ├── TaskCard.tsx
│   │   │   ├── StatusBadge.tsx
│   │   │   ├── PriorityIndicator.tsx
│   │   │   ├── ProgressBar.tsx
│   │   │   ├── KeyHint.tsx
│   │   │   └── Modal.tsx
│   │   ├── hooks/
│   │   │   ├── useTasks.ts
│   │   │   ├── useNavigation.ts
│   │   │   ├── useKeyboard.ts
│   │   │   └── useTimer.ts
│   │   └── theme/
│   │       ├── index.ts
│   │       ├── dracula.ts
│   │       ├── nord.ts
│   │       └── solarized.ts
│   ├── core/                      # Pure business logic
│   │   ├── task.ts                # Task entity + operations
│   │   ├── project.ts             # Project entity + operations
│   │   ├── filter.ts              # Filter/sort/search engine
│   │   ├── scheduler.ts           # Recurring task scheduler
│   │   ├── dependency.ts          # Task dependency resolver
│   │   ├── timer.ts               # Pomodoro timer logic
│   │   └── types.ts               # Shared type definitions
│   ├── storage/                   # Persistence layer
│   │   ├── database.ts            # SQLite connection manager
│   │   ├── migrations/            # Schema versioning
│   │   │   ├── 001-initial.ts
│   │   │   ├── 002-integrations.ts
│   │   │   └── runner.ts
│   │   ├── repositories/
│   │   │   ├── task.repo.ts
│   │   │   ├── project.repo.ts
│   │   │   ├── tag.repo.ts
│   │   │   └── timer.repo.ts
│   │   └── seed.ts                # Optional sample data
│   ├── integrations/              # External service connectors
│   │   ├── provider.ts            # Abstract IntegrationProvider interface
│   │   ├── jira/
│   │   │   ├── client.ts
│   │   │   ├── mapper.ts
│   │   │   └── sync.ts
│   │   ├── github/
│   │   │   ├── client.ts
│   │   │   ├── mapper.ts
│   │   │   └── sync.ts
│   ├── plugins/                   # Plugin system
│   │   ├── loader.ts              # Dynamic plugin discovery
│   │   ├── api.ts                 # Plugin API surface
│   │   └── validator.ts           # Plugin manifest validation
│   ├── config/                    # Configuration management
│   │   ├── manager.ts             # Read/write config
│   │   ├── defaults.ts            # Default values
│   │   └── keychain.ts            # Credential storage
│   └── utils/                     # Shared helpers
│       ├── date.ts                # Date parsing (natural language)
│       ├── format.ts              # Output formatters
│       ├── git.ts                 # Git operations
│       ├── logger.ts              # Structured logging
│       └── id.ts                  # ID generation
├── tests/
│   ├── core/                      # Unit tests for pure logic
│   ├── commands/                  # CLI command integration tests
│   ├── storage/                   # Repository tests
│   └── integrations/              # Integration tests (mocked)
├── package.json
├── tsconfig.json
├── tsup.config.ts                 # Build configuration
├── .eslintrc.js
├── .prettierrc
├── .github/
│   └── workflows/
│       ├── ci.yml                 # Test + lint on PR
│       └── release.yml            # Publish to npm on tag
└── README.md
```

## Data Flow Examples

### Adding a task via CLI

```
User runs: todo add "Fix auth bug" -p urgent -t backend -d friday

  1. src/index.ts → detects subcommand "add" → routes to commander.js
  2. src/commands/add.ts → parses flags → constructs CreateTaskInput
  3. src/core/task.ts → validates input, resolves "friday" to date, assigns ID
  4. src/storage/repositories/task.repo.ts → INSERT into SQLite
  5. src/commands/add.ts → formats success output → prints to stdout
```

### Viewing the board in TUI

```
User runs: todo (no subcommand)

  1. src/index.ts → no subcommand detected → launches TUI mode
  2. src/tui/App.tsx → mounts Ink application → renders Dashboard
  3. User presses 'b' → navigates to BoardView
  4. src/tui/hooks/useTasks.ts → queries TaskRepository
  5. src/tui/screens/BoardView.tsx → renders Kanban columns
  6. User presses 'j'/'k' to navigate, Enter to view detail, 'd' to mark done
```

### Jira sync flow

```
User runs: todo jira pull

  1. src/commands/integrate.ts → routes to Jira subcommand
  2. src/integrations/jira/client.ts → calls Jira REST API with JQL
  3. src/integrations/jira/mapper.ts → maps Jira fields to local Task schema
  4. src/integrations/jira/sync.ts → compares sync_hash, resolves conflicts
  5. src/storage/repositories/task.repo.ts → UPSERT tasks
  6. Output: "Synced 12 tasks from PROJ (3 new, 7 updated, 2 conflicts)"
```

## Key Design Decisions

**Why separate commands/ from core/?** Commands handle I/O concerns — parsing argv, formatting output, handling errors with exit codes. Core handles pure logic — validation, transformation, business rules. This separation means we can test 90% of the application without touching a terminal or database.

**Why SQLite over JSON files?** The moment you need indexed queries (filter by date range, search across projects, sort by priority + due date), JSON files mean loading everything into memory and writing custom sort/filter logic. SQLite gives us this for free, with ACID guarantees on writes. A single `.db` file is just as portable and backupable as a JSON file.

**Why Ink over blessed/terminal-kit?** Ink uses React's component model, which means the TUI is built from composable, testable components with proper state management via hooks. Blessed is unmaintained (last commit 2017). Terminal-kit is procedural, which makes complex multi-screen UIs hard to maintain.

**Why a plugin system so early?** Because retrofitting extensibility is always harder than designing it in. By defining the `IntegrationProvider` interface in Phase 1 and implementing Jira as the first plugin, we validate the abstraction before the community needs it.
