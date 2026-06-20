# 10 — Development Roadmap

Phased build plan with milestones, priorities, and estimated effort.

## Phase Overview

```
Phase 1 --> Phase 2 --> Phase 3 --> Phase 4 --> Phase 5
Core        TUI         Plugin      Jira +      Polish +
Engine      Interface   System      GitHub +    Release
                                    Git
v0.1.0      v0.2.0      v0.3.0      v0.5.0      v1.0.0
```

---

## Phase 1 — Core Engine + CLI Commands (v0.1.0)

A fully functional CLI tool with all direct commands. No TUI, no integrations.

### Tasks

1.1 Project scaffolding (TypeScript, tsup, ESLint, Prettier, Vitest, pnpm)

1.2 Storage layer (SQLite connection, migration runner, all repositories)

1.3 Core business logic (Task/Project entities, filter engine, sort engine, date parsing, recurring scheduler, dependency resolver)

1.4 CLI commands via commander.js (add, ls, show, edit, rm, start, done, archive, reopen, project, tag, search, depends, bulk, export, import, stats, undo, config, completions)

1.5 Configuration management (config file, defaults, validation)

1.6 Testing (unit tests for core, integration tests for CLI, 90%+ coverage)

1.7 Output formatting (chalk, cli-table3, JSON mode, quiet mode)

### Exit Criteria

All CLI commands work as documented. Tests pass on macOS, Linux, Windows.

---

## Phase 2 — Interactive TUI (v0.2.0)

Full-screen terminal UI with all screens navigable and functional.

### Tasks

2.1 Ink + React setup (App.tsx, screen router, keyboard hooks)
2.2 Dashboard screen
2.3 Board View (Kanban, vim navigation, status transitions)
2.4 List View (sortable table, inline priority)
2.5 Detail View (full task info, integrations, pomodoro history)
2.6 Project View (tree layout, expand/collapse)
2.7 Search View (live fuzzy search)
2.8 Add/Edit forms (inline overlay, autocomplete)
2.9 Theming system (6 built-in themes + custom)
2.10 Command palette
2.11 Responsive layout
2.12 Help overlay

### Exit Criteria

TUI works in iTerm2, Terminal.app, Windows Terminal, GNOME Terminal, Alacritty. No memory leaks in 30-minute sessions.

---

## Phase 3 — Plugin System (v0.3.0)

IntegrationProvider interface defined, plugin loader working.

### Tasks

3.1 Define IntegrationProvider interface
3.2 Define PluginAPI surface
3.3 Build CredentialStore (keytar + encrypted fallback)
3.4 Build PluginLoader (discover, validate, register)
3.5 Build PluginRegistry
3.6 Add `todo integrate` command
3.7 Add plugin hook system
3.8 Publish @todo-cli/plugin-api package
3.9 Plugin development docs
3.10 Implement Jira as first plugin (validates interface)

---

## Phase 4 — Jira + GitHub + Git (v0.5.0)

The three most-requested developer integrations.

### Tasks

4.1 Jira (auth, pull, push, sync, conflict detection, TUI badges)
4.2 GitHub (auth, pull issues, create PR, CI status polling)
4.3 Git (branch creation, auto-prefix, commit references)
4.4 Pomodoro timer (countdown, sessions, breaks, time tracking, TUI screen)

---

## Phase 5 — Polish + v1.0.0 Release

Production-ready, published, documented.

### Tasks

7.1 Performance (startup < 200ms, TUI < 16ms render, bundle < 5MB)
7.2 Error handling (graceful messages, retry logic, corruption recovery)
7.3 Documentation (README + demo GIF, man pages, --help, CHANGELOG)
7.4 Distribution (npm, Homebrew, shell installer, GitHub Releases)
7.5 Community (CONTRIBUTING.md, issue templates, Code of Conduct)
7.6 QA (E2E tests, benchmarks, security audit, cross-platform testing)
7.7 Launch (npm publish, Homebrew, blog post, Hacker News, Reddit, Product Hunt)

---

## Post v1.0.0 Ideas

- Team sync via shared SQLite or lightweight sync server
- Mobile companion (web TUI via SSH or PWA)
- VS Code extension with task sidebar
- Obsidian plugin for bidirectional sync
- AI task suggestions based on history and calendar
- Plugin marketplace
- Browser extension for quick-add
- Apple Shortcuts / Raycast integration

---

## Contribution Areas

**Easy:** New themes, export formats, shell completions, formatting fixes.

**Medium:** Community plugins (Asana, Monday, ClickUp), new TUI components, accessibility, i18n.

**Hard:** Plugin sandboxing, real-time sync, performance optimization, offline-first engine.
