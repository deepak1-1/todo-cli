# Contributing to todo-cli

Thank you for your interest in contributing to todo-cli! This guide will help you get started.

## Development Setup

### Prerequisites
- Node.js 20 or higher
- npm 9 or higher

### Getting Started

1. Clone the repository:
```bash
git clone https://github.com/yourusername/todo-cli.git
cd todo-cli
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Run tests:
```bash
npm test
```

5. Run the CLI in development mode:
```bash
npm run dev
```

## Project Structure

```
todo-cli/
├── src/
│   ├── cli/              # CLI command handlers
│   ├── core/             # Core task engine and models
│   ├── integrations/     # Built-in integrations
│   ├── plugins/          # Plugin system and loaders
│   ├── storage/          # SQLite storage adapter
│   ├── tui/              # Terminal UI with Ink/React
│   └── timer/            # Pomodoro timer implementation
├── docs/                 # Documentation and guides
├── tests/                # Test suites
├── package.json          # Project metadata and dependencies
└── tsconfig.json         # TypeScript configuration
```

## Creating a Plugin

Plugins extend todo-cli with external service integrations. Here's how to create one:

### 1. Create the Plugin Class

```typescript
import { IntegrationProvider } from '@todo-cli/core';

export class MyServicePlugin implements IntegrationProvider {
  name = 'my-service';
  description = 'Integrates with My Service';

  async authenticate(credentials: Record<string, string>) {
    // Handle authentication with My Service
  }

  async sync(tasks: Task[]) {
    // Sync tasks to/from My Service
  }

  async createTask(task: Task) {
    // Create task in My Service
  }
}
```

### 2. Register the Plugin

Plugins are auto-discovered from the `plugins/` directory. Place your plugin there and it will be loaded automatically.

### 3. Handle Credentials

Use the `CredentialStore` for secure credential management:

```typescript
import { CredentialStore } from '@todo-cli/core';

const store = new CredentialStore();
await store.set('my-service', 'api_key', apiKey);
const apiKey = await store.get('my-service', 'api_key');
```

### 4. Test Your Plugin

```bash
npm test -- plugins/my-service.test.ts
```

## Pull Request Guidelines

1. Fork the repository and create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes and write tests for new functionality
3. Ensure all tests pass: `npm test`
4. Format your code: `npm run format`
5. Commit with clear messages: `git commit -m 'Add feature: description'`
6. Push to your branch and open a pull request

## Code Style

- **Formatting**: Use Prettier with the project's configuration
- **Indentation**: 4 spaces (not tabs)
- **Quotes**: Single quotes for strings
- **Naming**: camelCase for variables/functions, PascalCase for classes

Run the formatter:
```bash
npm run format
```

## Testing

Write tests for all new features. We use Jest:

```bash
npm test                    # Run all tests
npm test -- --watch        # Run in watch mode
npm test -- --coverage     # Generate coverage report
```

## Reporting Issues

When reporting bugs, include:
- A clear description of the issue
- Steps to reproduce
- Expected vs. actual behavior
- Your environment (Node version, OS, etc.)

## Questions?

- Check the [documentation](/docs)
- Open a discussion on GitHub
- Review existing plugin examples

Thank you for contributing!
