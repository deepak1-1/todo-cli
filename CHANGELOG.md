# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-24

### Added
- Complete documentation suite with API reference, plugin development guide, and architecture docs
- GitHub Actions CI/CD workflows for testing (Node 20, 22 on Ubuntu, macOS, Windows) and automated npm releases
- MIT License
- Contributing guidelines and issue templates
- Comprehensive README with quick start examples

### Changed
- Stabilized plugin API and CredentialStore interface
- Enhanced test coverage across all modules

## [0.9.0] - 2026-03-10

### Added
- Linear integration for issue tracking
- GitLab integration with CI/CD pipeline support
- Notion integration for knowledge management
- Sentry integration for error tracking
- Toggl integration for time tracking

## [0.7.0] - 2026-02-15

### Added
- Calendar integration with scheduling and deadline management
- Slack integration for task notifications and reminders
- Discord integration for team notifications

### Changed
- Improved TUI responsiveness with better event handling

## [0.5.0] - 2026-01-20

### Added
- Jira integration for enterprise task management
- GitHub integration for issue and PR tracking
- Integration marketplace in TUI

## [0.3.0] - 2025-12-15

### Added
- Plugin system with IntegrationProvider interface
- CredentialStore for secure credential management
- PluginLoader for dynamic plugin discovery and loading
- Example plugins demonstrating integration patterns

## [0.2.0] - 2025-11-01

### Added
- Interactive TUI built with Ink and React
- 11 primary screens (Home, Search, Details, Calendar, Integrations, etc.)
- 6 theme options (Dark, Light, Ocean, Forest, Dracula, Nord)
- Vim-style navigation and keybindings
- Real-time task filtering and sorting

### Changed
- Redesigned CLI architecture to support interactive mode
- Refactored data models for TUI compatibility

## [0.1.0] - 2025-09-15

### Added
- Core task engine with SQLite storage
- CLI commands: add, list, update, delete, done, search
- Pomodoro timer with configurable work/break intervals
- Task tagging and categorization
- Basic task filtering and sorting
