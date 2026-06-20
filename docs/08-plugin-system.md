# 08 — Plugin System

The plugin architecture that makes Todo CLI extensible by third-party developers.

## Why a Plugin System?

We can't support every project tracker, time tracker, and notification service ourselves. But we can define a clean interface that lets anyone write an integration and publish it as an npm package. The community extends the tool; we maintain the core.

## Architecture

```
+------------------------------------------------------+
|                    Todo CLI Core                      |
|                                                       |
|  +-------------+  +--------------+  +-------------+  |
|  | Plugin      |  | Plugin       |  | Plugin      |  |
|  | Loader      |  | Registry     |  | API         |  |
|  | (discovers) |  | (tracks)     |  | (sandboxed) |  |
|  +------+------+  +--------------+  +------+------+  |
|         |         Plugin Interface         |          |
| ========+==================================+========  |
|         |                                  |          |
|  +------+------+  +-----------+                      |
|  | Built-in    |  | Built-in  |                      |
|  | jira/       |  | github/   |                      |
|  +-------------+  +-----------+                      |
+------------------------------------------------------+
              |
    npm packages (third-party)
              |
     +--------+--------+--------+
     |        |        |        |
  asana    monday   clickup  ...
```

## IntegrationProvider Interface

Every plugin implements this TypeScript interface:

```typescript
export interface IntegrationProvider {
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    readonly version: string;

    auth(store: CredentialStore, prompt: PromptFn): Promise<void>;
    healthCheck(store: CredentialStore): Promise<boolean>;
    pull(store: CredentialStore, filters: PullFilters): Promise<ExternalTask[]>;
    push(store: CredentialStore, task: Task, externalRef: string): Promise<PushResult>;
    mapToLocal(external: ExternalTask): Partial<TaskCreateInput>;
    mapToRemote(task: Task): Record<string, unknown>;

    // Optional extensions
    commands?(): PluginCommand[];
    tuiComponents?(): PluginTuiComponent[];
    hooks?: {
        onTaskCreate?(task: Task): Promise<void>;
        onTaskUpdate?(task: Task, changes: Partial<Task>): Promise<void>;
        onTaskComplete?(task: Task): Promise<void>;
        onTaskDelete?(task: Task): Promise<void>;
        onTimerStart?(task: Task): Promise<void>;
        onTimerComplete?(task: Task, duration: number): Promise<void>;
    };
}
```

## Supporting Types

```typescript
export interface ExternalTask {
    externalId: string;
    externalRef: string;           // e.g., 'PROJ-123'
    externalUrl: string;
    title: string;
    description?: string;
    status: string;
    priority?: string;
    dueDate?: string;
    labels?: string[];
    project?: string;
    assignee?: string;
    metadata?: Record<string, unknown>;
}

export interface PullFilters {
    project?: string;
    status?: string;
    sprint?: string;
    label?: string;
    maxResults?: number;
    since?: string;
}

export interface PushResult {
    success: boolean;
    externalRef: string;
    message: string;
    updatedFields: string[];
}

export interface CredentialStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
}
```

## Plugin Manifest

Third-party plugins declare themselves in package.json:

```json
{
    "name": "todo-plugin-asana",
    "version": "1.0.0",
    "keywords": ["todo-cli-plugin"],
    "todoCli": {
        "name": "asana",
        "displayName": "Asana",
        "minCoreVersion": "1.0.0"
    },
    "peerDependencies": {
        "@todo-cli/plugin-api": "^1.0.0"
    }
}
```

## Plugin Discovery

The loader searches in order:

1. **Built-in plugins** — `src/integrations/jira/`, `src/integrations/github/`, etc.
2. **Global npm packages** — Any `todo-plugin-*` in global node_modules
3. **Local plugins** — `~/.todo-cli/plugins/` directory

## Plugin API Surface (Sandboxed)

Plugins interact through a controlled API, not raw database access:

```typescript
export interface PluginAPI {
    getTasks(filters?: TaskFilters): Promise<Task[]>;
    getTask(id: number): Promise<Task | null>;
    createTask(input: TaskCreateInput): Promise<Task>;
    updateTask(id: number, changes: Partial<Task>): Promise<Task>;
    getProjects(): Promise<Project[]>;
    getTags(): Promise<Tag[]>;
    getConfig<T>(key: string): Promise<T | null>;
    setConfig<T>(key: string, value: T): Promise<void>;
    credentials: CredentialStore;
    notify(message: string, type: 'info' | 'success' | 'warning' | 'error'): void;
    log: PluginLogger;
}
```

## Plugin Lifecycle

```
Installation:  npm install -g todo-plugin-asana
        |
        v
Discovery:     PluginLoader finds it in global node_modules
               Validates manifest, checks version compatibility
               Registers in PluginRegistry
        |
        v
Auth setup:    todo integrate asana
               Calls provider.auth()
               Credentials stored in OS keychain
        |
        v
Usage:         todo asana pull
               Calls provider.pull()
               Core maps results via provider.mapToLocal()
               Tasks stored in database
        |
        v
Hooks:         User marks task done
               Core calls provider.hooks.onTaskComplete()
               Provider optionally updates external system
```

## Writing a Plugin (Example)

```typescript
// todo-plugin-asana/src/index.ts
import type { IntegrationProvider, CredentialStore, PromptFn,
    ExternalTask, PullFilters, PushResult, Task } from '@todo-cli/plugin-api';

export default class AsanaProvider implements IntegrationProvider {
    readonly name = 'asana';
    readonly displayName = 'Asana';
    readonly description = 'Sync tasks with Asana workspaces';
    readonly version = '1.0.0';

    async auth(store: CredentialStore, prompt: PromptFn): Promise<void> {
        const token = await prompt('Asana Personal Access Token:', { type: 'password' });
        await store.set('asana_token', token);
        // verify token against Asana API
    }

    async healthCheck(store: CredentialStore): Promise<boolean> {
        const token = await store.get('asana_token');
        if (!token) return false;
        // check token validity
        return true;
    }

    async pull(store: CredentialStore, filters: PullFilters): Promise<ExternalTask[]> {
        // Call Asana API, return ExternalTask[]
        return [];
    }

    async push(store: CredentialStore, task: Task, ref: string): Promise<PushResult> {
        return { success: true, externalRef: ref, message: 'Updated', updatedFields: ['status'] };
    }

    mapToLocal(external: ExternalTask) {
        return { title: external.title, description: external.description };
    }

    mapToRemote(task: Task) {
        return { name: task.title, notes: task.description };
    }
}
```

### Publishing

```bash
cd todo-plugin-asana && npm publish
# Users install: npm install -g todo-plugin-asana
# Then: todo integrate asana
```

## Security

Plugins run in the same Node.js process but interact through the sandboxed PluginAPI. Credentials are isolated by provider name. `todo plugins audit` runs npm audit on installed plugins.

Future: Plugin sandboxing via worker threads for untrusted plugins.
