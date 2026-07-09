// Shared MCP test scaffolding — stub server and context builder.
// Per-file vi.mock('...context.js') stays in each test file (vi.mock is hoisted).

import type Database from 'better-sqlite3';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../src/storage/repositories/project.repo.js';
import { TagRepository } from '../../src/storage/repositories/tag.repo.js';
import { ActionLogRepository } from '../../src/storage/repositories/action-log.repo.js';
import { DependencyRepository } from '../../src/storage/repositories/dependency.repo.js';
import { TrackingRepository } from '../../src/storage/repositories/tracking.repo.js';
import { StatusRepository } from '../../src/storage/repositories/status.repo.js';
import type { AppContext } from '../../src/commands/context.js';

/** Build a full AppContext wired to an in-memory test database. */
export function buildTestCtx(database: Database.Database): AppContext {
    return {
        taskRepo: new TaskRepository(database),
        projectRepo: new ProjectRepository(database),
        tagRepo: new TagRepository(database),
        actionLog: new ActionLogRepository(database),
        depRepo: new DependencyRepository(database),
        trackingRepo: new TrackingRepository(database),
        statusRepo: new StatusRepository(database),
    };
}

type HandlerFn = (args: Record<string, unknown>) => unknown;

/** Minimal McpServer stub: captures registered handlers by tool name. */
export function buildStubServer() {
    const handlers: Record<string, HandlerFn> = {};
    return {
        registerTool(name: string, _meta: unknown, handler: HandlerFn) {
            handlers[name] = handler;
        },
        call(name: string, args: Record<string, unknown>) {
            const fn = handlers[name];
            if (!fn) throw new Error(`Tool "${name}" not registered`);
            return fn(args);
        },
    };
}

export type StubServer = ReturnType<typeof buildStubServer>;
