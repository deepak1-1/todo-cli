// Smoke tests for buildMcpServer — verifies construction without real transport.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/storage/database.js';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../src/storage/repositories/project.repo.js';
import { TagRepository } from '../../src/storage/repositories/tag.repo.js';
import { ActionLogRepository } from '../../src/storage/repositories/action-log.repo.js';
import { DependencyRepository } from '../../src/storage/repositories/dependency.repo.js';
import { TrackingRepository } from '../../src/storage/repositories/tracking.repo.js';
import { StatusRepository } from '../../src/storage/repositories/status.repo.js';
import type { AppContext } from '../../src/commands/context.js';

// Provide a real in-memory context so tool registration doesn't blow up.
let db: Database.Database;
let ctx: AppContext;

vi.mock('../../src/commands/context.js', () => ({
    getContext: () => ctx,
}));

vi.mock('../../src/plugins/hook-manager.js', () => ({
    getHookManager: () => ({
        onTaskCreate: vi.fn().mockResolvedValue(undefined),
        onTaskUpdate: vi.fn().mockResolvedValue(undefined),
        onTaskComplete: vi.fn().mockResolvedValue(undefined),
        onTaskDelete: vi.fn().mockResolvedValue(undefined),
    }),
}));

beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    ctx = {
        taskRepo: new TaskRepository(db),
        projectRepo: new ProjectRepository(db),
        tagRepo: new TagRepository(db),
        actionLog: new ActionLogRepository(db),
        depRepo: new DependencyRepository(db),
        trackingRepo: new TrackingRepository(db),
        statusRepo: new StatusRepository(db),
    };
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
});

describe('buildMcpServer', () => {
    it('returns a defined server object when allowDelete is false', async () => {
        const { buildMcpServer } = await import('../../src/mcp/server.js');
        const server = buildMcpServer({ allowDelete: false });
        expect(server).toBeDefined();
    });

    it('returns a defined server object when allowDelete is true', async () => {
        const { buildMcpServer } = await import('../../src/mcp/server.js');
        const server = buildMcpServer({ allowDelete: true });
        expect(server).toBeDefined();
    });

    it('does not throw during construction', async () => {
        const { buildMcpServer } = await import('../../src/mcp/server.js');
        expect(() => buildMcpServer({ allowDelete: false })).not.toThrow();
    });
});
