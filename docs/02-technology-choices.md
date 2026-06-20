# 02 — Technology Choices

Every technology in this stack was chosen deliberately. This document explains what we're using, why we chose it, what alternatives were considered, and why they were rejected.

## Language: TypeScript on Node.js

**Choice:** TypeScript 5.x on Node.js 20+ (LTS)

**Why TypeScript over plain JavaScript?** Type safety catches entire categories of bugs at compile time — a task's `priority` field can only be `"urgent" | "high" | "medium" | "low"`, not an arbitrary string. For a tool that manages data integrity (tasks, sync state, dependencies), this matters. TypeScript also gives us self-documenting code through interfaces and type definitions, which is critical for the plugin system where third-party developers need clear contracts.

**Why Node.js over C++?** This was a deliberate decision. C++ offers raw performance and zero runtime dependency, but a TODO CLI doesn't need either. What it needs: cross-platform distribution via `npm install -g` (Node wins), a rich ecosystem of terminal UI libraries (Node wins), fast development iteration (Node wins), and a contributor-friendly codebase (Node wins). The performance difference is irrelevant — we're querying a local SQLite database with at most thousands of rows and rendering text to a terminal. If we were building the SQLite engine itself, C++ would be the answer. We're not.

**Why not Rust/Go/Python?**

- Rust: excellent for CLI tools (see ripgrep), but the learning curve locks out most contributors. The Ink/React TUI ecosystem doesn't exist in Rust. Distribution requires precompiled binaries per platform.
- Go: strong for single-binary CLIs, but the terminal UI ecosystem (bubbletea) is younger than Node's Ink. No npm distribution — requires Homebrew or manual install.
- Python: rich ecosystem but distribution is painful (pip, venv, version conflicts). Performance for TUI rendering is noticeably worse.

## CLI Framework: Commander.js

**Choice:** Commander.js 12.x

**Why?** Commander is the most mature, battle-tested CLI framework in the Node ecosystem. It handles subcommands, option parsing, variadic arguments, help generation, and error handling with zero configuration. The API is declarative and readable.

**Alternatives considered:**

- **yargs** — Equally capable but the API is more verbose. yargs uses a chained builder pattern that becomes hard to read for complex command trees. Commander's `.command()` + `.action()` pattern is cleaner.
- **oclif** — Salesforce's CLI framework. Powerful for enterprise tools with plugin architectures, but it's opinionated and heavy. It generates boilerplate, enforces a specific project structure, and adds 15+ dependencies. Overkill for a single-purpose tool.
- **clipanion** — Yarn's CLI framework. TypeScript-first with decorators, which is elegant but requires experimental decorator support and has a smaller community.
- **citty** — From the UnJS ecosystem. Lightweight and modern, but too young — limited documentation, small community, fewer edge cases handled.

## TUI Framework: Ink (React for Terminals)

**Choice:** Ink 5.x with React 18

**Why Ink?** Ink brings React's component model to the terminal. This gives us composable UI components (`<TaskCard>`, `<StatusBadge>`, `<Modal>`), proper state management via hooks (`useState`, `useEffect`, custom hooks), Flexbox layout (via Yoga), and a rendering model that only updates what changed. For a multi-screen TUI with dynamic data, this is the right abstraction.

**Alternatives considered:**

- **blessed** — The original Node.js terminal UI library. Feature-rich (windows, forms, lists, tables) but critically unmaintained since 2017. Known memory leaks in long-running sessions. No TypeScript types. Using blessed in 2026 is building on a dead foundation.
- **blessed-contrib** — Dashboard widgets built on blessed. Same maintenance problem.
- **terminal-kit** — Procedural API for terminal manipulation. Good for simple menus, but complex multi-screen apps become spaghetti without a component model. State management is manual. No declarative rendering.
- **neo-blessed** — Community fork of blessed. More active but still carries blessed's architectural baggage (event-driven, not declarative).
- **bubbletea (Go)** — Excellent TUI framework, but requires Go. Not applicable.
- **Raw ANSI codes** — Maximum control, zero dependencies, but enormous development cost. Every layout calculation, scroll handling, and resize event is manual. Not practical for a feature-rich TUI.

## Database: SQLite via better-sqlite3

**Choice:** better-sqlite3 11.x with SQLite 3.45+

**Why SQLite?** A TODO CLI needs to store structured data with relationships (tasks have tags, belong to projects, have dependencies). It needs to query efficiently (show me urgent tasks due this week in the backend project). It needs atomic writes (no corrupted data if the process crashes mid-write). And it needs to be a single portable file. SQLite is purpose-built for exactly this use case.

**Why better-sqlite3 over other SQLite bindings?**

- **better-sqlite3** — Synchronous API (no callback/promise overhead for inherently synchronous disk reads), 2-5x faster than node-sqlite3, ships prebuilt binaries for all platforms via `prebuild-install`. The synchronous API is a feature, not a limitation — SQLite operations on a local disk complete in microseconds.
- **node-sqlite3** — Async API adds unnecessary complexity for local disk I/O. Slower. Older codebase.
- **sql.js** — SQLite compiled to WebAssembly. Runs everywhere but is slower than native bindings and loads the entire database into memory. Good for browsers, wrong for a CLI.
- **Prisma/Drizzle/TypeORM** — ORMs add abstraction we don't need. Our schema is simple enough that raw SQL with a thin repository layer is clearer and faster. ORMs also complicate distribution (migration runners, code generation).

**Why not JSON files?** The moment you have 500+ tasks across multiple projects and need to show "urgent tasks due this week tagged 'backend' sorted by due date," JSON files mean: read entire file, parse, filter in memory, sort in memory, output. SQLite means a single indexed query that's instant regardless of dataset size.

**Why not PostgreSQL/MySQL?** Requiring a running database server for a personal CLI tool is a non-starter. SQLite is embedded — zero configuration, zero separate process.

## Build Tool: tsup

**Choice:** tsup 8.x

**Why?** tsup is a zero-config TypeScript bundler powered by esbuild. It compiles our entire TypeScript codebase into a single (or few) JavaScript file(s) in under a second. This matters for npm distribution — users get a small, fast package.

**Alternatives considered:**

- **tsc** (TypeScript compiler) — Produces unbundled output (hundreds of JS files). Slower. No tree-shaking.
- **esbuild** — What tsup wraps. Using it directly requires manual configuration for DTS generation, multiple entry points, and format options. tsup handles this.
- **webpack/rollup** — Heavy, complex configuration, designed for web bundles not CLI tools.
- **swc** — Fast compiler but less mature bundling story.

## Testing: Vitest

**Choice:** Vitest 2.x

**Why?** Native TypeScript support (no separate compile step), Jest-compatible API (familiar to everyone), fast execution via esbuild, built-in coverage. It's the modern default for TypeScript projects.

**Alternatives considered:**

- **Jest** — The incumbent. Requires ts-jest or babel for TypeScript, which adds configuration and slows execution. Vitest is faster and simpler.
- **Mocha + Chai** — Flexible but requires assembling multiple packages (test runner, assertions, mocking, coverage). More setup, more maintenance.
- **Node.js native test runner** — Maturing but still missing features (rich assertions, mocking, snapshot testing).

## Date Parsing: chrono-node

**Choice:** chrono-node 2.x

**Why?** Users will type `todo add "Fix bug" -d "next friday"` or `-d "in 3 days"` or `-d "march 15"`. chrono-node parses natural language dates in English (and other languages) into JavaScript Date objects. It handles relative dates, specific dates, and ambiguous formats gracefully.

**Alternatives considered:**

- **date-fns** — Excellent date manipulation library but doesn't parse natural language. We'll use date-fns alongside chrono-node for formatting and arithmetic.
- **dayjs/moment** — Date manipulation only, no NLP parsing.
- **Custom regex** — Fragile, handles only formats we anticipate. chrono-node handles edge cases we'd never think of.

## Credential Storage: keytar

**Choice:** keytar 7.x

**Why?** Integration credentials (Jira API tokens, GitHub tokens) must not be stored in plaintext config files. keytar uses the OS-native keychain (macOS Keychain, Windows Credential Vault, Linux libsecret/GNOME Keyring). This is the standard approach for CLI tools that store secrets.

**Fallback:** On systems without a keychain (headless Linux servers, Docker containers), we fall back to AES-256-GCM encrypted file storage in `~/.todo-cli/credentials.enc`, with the encryption key derived from a user-provided passphrase via PBKDF2.

## Output Styling: chalk + cli-table3

**Choice:** chalk 5.x + cli-table3

**Why chalk?** Terminal color and styling — bold, italic, colors, backgrounds. Zero dependencies, widely trusted. We use it for all CLI output formatting.

**Why cli-table3?** For `todo ls` output, we need aligned columns with borders. cli-table3 renders Unicode box-drawing tables that work in every terminal. It handles column width calculation, text wrapping, and alignment.

**Additional output utilities:**

- **ora** — Spinner for long operations (Jira sync, bulk exports)
- **terminal-link** — Clickable hyperlinks in terminals that support them (iTerm2, Windows Terminal, most modern terminals)
- **figures** — Cross-platform Unicode symbols (checkmarks, crosses, arrows) with ASCII fallbacks

## Fuzzy Search: fuse.js

**Choice:** Fuse.js 7.x

**Why?** The search command (`todo search "auth bug"`) and the TUI search screen need fuzzy matching — finding "authentication bug fix" when the user types "auth bug". Fuse.js is lightweight, configurable (weighted fields, threshold tuning), and runs client-side with no external service.

## Package Manager: pnpm (Development)

**Choice:** pnpm 9.x for development, npm for end-user installation

**Why pnpm for development?** Strict dependency resolution (no phantom dependencies), faster installs via content-addressable storage, disk space efficient with symlinks. For a project with 30+ dependencies across production and dev, pnpm keeps `node_modules` honest.

**Why npm for end users?** `npm install -g` is the universal installation method. We don't require end users to have pnpm.

## Full Dependency Summary

### Production Dependencies

| Package | Purpose |
|---------|---------|
| commander | CLI command parsing |
| ink + react | Terminal UI framework |
| better-sqlite3 | SQLite database |
| chalk | Terminal styling |
| cli-table3 | Table output |
| chrono-node | Natural language dates |
| date-fns | Date formatting/arithmetic |
| fuse.js | Fuzzy search |
| keytar | OS keychain access |
| ora | Loading spinners |
| terminal-link | Clickable terminal links |
| figures | Cross-platform symbols |
| conf | Config file management |
| node-fetch | HTTP client for integrations |

### Development Dependencies

| Package | Purpose |
|---------|---------|
| typescript | Type system |
| tsup | Bundler |
| vitest | Test framework |
| eslint + prettier | Code quality |
| @types/* | Type definitions |
| husky + lint-staged | Git hooks |
