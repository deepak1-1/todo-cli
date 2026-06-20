# 09 — Publishing and Distribution

How Todo CLI gets from source code to users' machines.

## Distribution Channels

| Channel | Command | Audience |
|---------|---------|----------|
| npm (primary) | `npm install -g @todo-cli/todo` | Everyone |
| Homebrew | `brew install todo-cli` | macOS/Linux |
| Shell script | `curl -fsSL ... \| sh` | Quick install |
| GitHub Releases | Download binary | Offline/air-gapped |

## npm Package Configuration

```json
{
    "name": "@todo-cli/todo",
    "version": "1.0.0",
    "description": "Interactive terminal task management for developers",
    "bin": { "todo": "./dist/index.js" },
    "files": ["dist/", "README.md", "LICENSE"],
    "engines": { "node": ">=20.0.0" },
    "keywords": ["todo", "task", "cli", "terminal", "tui", "kanban",
                 "pomodoro", "jira", "github", "productivity"],
    "license": "MIT",
    "author": "Vivek Injal <vivek.injal@sorigin.com>"
}
```

## Build Pipeline

tsup compiles TypeScript into a single bundled JS file with a shebang header. Native modules (better-sqlite3, keytar) are kept as external dependencies with prebuilt binaries.

```typescript
// tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs'],
    target: 'node20',
    outDir: 'dist',
    clean: true,
    splitting: false,
    dts: true,
    banner: { js: '#!/usr/bin/env node' },
    external: ['better-sqlite3', 'keytar'],
});
```

## Versioning (Semver)

- **MAJOR** (2.0.0): Breaking CLI commands, plugin API, or schema changes
- **MINOR** (1.1.0): New features, commands, integrations
- **PATCH** (1.0.1): Bug fixes, performance improvements

Plugin API versioned separately as `@todo-cli/plugin-api`.

## CI/CD Pipeline

### GitHub Actions: CI (every PR)

```yaml
name: CI
on: [pull_request, push]
jobs:
    test:
        runs-on: ${{ matrix.os }}
        strategy:
            matrix:
                os: [ubuntu-latest, macos-latest, windows-latest]
                node: [20, 22]
        steps:
            - uses: actions/checkout@v4
            - uses: pnpm/action-setup@v4
            - uses: actions/setup-node@v4
              with: { node-version: '${{ matrix.node }}', cache: 'pnpm' }
            - run: pnpm install --frozen-lockfile
            - run: pnpm lint
            - run: pnpm typecheck
            - run: pnpm test
            - run: pnpm build
```

### GitHub Actions: Release (on tag)

```yaml
name: Release
on:
    push:
        tags: ['v*']
jobs:
    publish-npm:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: pnpm/action-setup@v4
            - uses: actions/setup-node@v4
              with: { node-version: 20, registry-url: 'https://registry.npmjs.org' }
            - run: pnpm install --frozen-lockfile && pnpm build
            - run: npm publish --access public
              env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' }
    github-release:
        needs: publish-npm
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4
            - uses: softprops/action-gh-release@v2
              with: { generate_release_notes: true }
```

## Homebrew

Maintained as a tap at `vivekinjal/homebrew-tap`:

```bash
brew tap vivekinjal/tap
brew install todo-cli
```

Auto-updated by the release pipeline.

## Shell Installer

```bash
curl -fsSL https://raw.githubusercontent.com/vivekinjal/todo-cli/main/install.sh | sh
```

Detects platform, checks for Node.js >= 20, runs npm install.

## Quality Checklist Before v1.0.0

- All CLI commands implemented and tested
- TUI screens functional on macOS, Linux, Windows Terminal
- SQLite tested with 1000+ tasks
- Jira and GitHub integrations tested
- Plugin API documented with JSDoc
- Shell completions working (bash, zsh, fish)
- --help for every command
- --json output mode for scripting
- Error messages clear and actionable
- README with demo GIF
- CHANGELOG.md
- LICENSE (MIT)
- CI passing all platforms
- npm package size under 5MB
- Startup time under 200ms
