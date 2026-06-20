// Tests for createPluginAPI — focused on SafeTaskUpdate runtime key filtering

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { up } from '../../src/storage/migrations/001-initial.js';
import { up as up002 } from '../../src/storage/migrations/002-time-tracking.js';
import { up as up003 } from '../../src/storage/migrations/003-project-name-nocase.js';
import { up as up004 } from '../../src/storage/migrations/004-fix-tasks-fk.js';
import { up as up005 } from '../../src/storage/migrations/005-add-in-qa-status.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';

// Mock getContext so plugin-api uses our in-memory repo, not the singleton.
vi.mock('../../src/commands/context.js', () => ({
    getContext: vi.fn(),
}));

import { getContext } from '../../src/commands/context.js';
import { createPluginAPI } from '../../src/plugins/plugin-api.js';
import type { SafeTaskUpdate } from '../../src/plugins/types.js';

// Minimal credential store stub — not exercised in these tests.
const stubCredentials = {
    get: async () => null,
    set: async () => undefined,
    delete: async () => undefined,
    list: async () => [],
};

let db: Database.Database;
let taskRepo: TaskRepository;

beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    // Apply all migrations to get current schema.
    up(db);
    up002(db);
    up003(db);
    up004(db);
    up005(db);
    taskRepo = new TaskRepository(db);

    // Wire getContext mock to return our in-memory repo.
    vi.mocked(getContext).mockReturnValue({
        taskRepo,
        projectRepo: {} as never,
        tagRepo: {} as never,
        timerRepo: {} as never,
        actionLog: {} as never,
        depRepo: {} as never,
        trackingRepo: {} as never,
    });
});

describe('createPluginAPI.updateTask', () => {
    it('passes allowed keys (title, status, priority) through to the repo', async () => {
        const task = taskRepo.create({ title: 'original', priority: 'low' });
        const api = createPluginAPI('test-plugin', stubCredentials);

        const updated = await api.updateTask(task.id, { title: 'updated', priority: 'high', status: 'in_progress' });

        expect(updated).not.toBeNull();
        expect(updated!.title).toBe('updated');
        expect(updated!.priority).toBe('high');
        expect(updated!.status).toBe('in_progress');
    });

    it('silently strips forbidden key id', async () => {
        const task = taskRepo.create({ title: 'strip-id test' });
        const api = createPluginAPI('test-plugin', stubCredentials);

        // TypeScript won't allow passing id directly — cast to test the runtime guard.
        const malicious = { id: 9999, title: 'safe title' } as SafeTaskUpdate & { id: number };
        const updated = await api.updateTask(task.id, malicious);

        expect(updated).not.toBeNull();
        // id must remain the original task id, not 9999.
        expect(updated!.id).toBe(task.id);
        expect(updated!.title).toBe('safe title');
    });

    it('silently strips forbidden key createdAt', async () => {
        const task = taskRepo.create({ title: 'strip-createdAt test' });
        const originalCreatedAt = task.createdAt;
        const api = createPluginAPI('test-plugin', stubCredentials);

        const malicious = { createdAt: '1970-01-01T00:00:00.000Z', title: 'ok' } as SafeTaskUpdate & { createdAt: string };
        await api.updateTask(task.id, malicious);

        const fetched = taskRepo.getById(task.id)!;
        expect(fetched.createdAt).toBe(originalCreatedAt);
    });

    it('silently strips forbidden keys updatedAt, completedAt, archivedAt', async () => {
        const task = taskRepo.create({ title: 'strip-timestamps test' });
        const api = createPluginAPI('test-plugin', stubCredentials);

        const malicious = {
            updatedAt: '1970-01-01T00:00:00.000Z',
            completedAt: '1970-01-01T00:00:00.000Z',
            archivedAt: '1970-01-01T00:00:00.000Z',
            title: 'safe',
        } as SafeTaskUpdate & { updatedAt: string; completedAt: string; archivedAt: string };

        const updated = await api.updateTask(task.id, malicious);

        expect(updated).not.toBeNull();
        // Timestamps must not be set to the injected bogus value.
        expect(updated!.completedAt).toBeNull();
        expect(updated!.archivedAt).toBeNull();
        // updatedAt is managed by the repo — it will differ from '1970-01-01T00:00:00.000Z'.
        expect(updated!.updatedAt).not.toBe('1970-01-01T00:00:00.000Z');
        expect(updated!.title).toBe('safe');
    });

    it('is a no-op when called with an empty object', async () => {
        const task = taskRepo.create({ title: 'no-op test', priority: 'urgent' });
        const api = createPluginAPI('test-plugin', stubCredentials);

        const updateSpy = vi.spyOn(taskRepo, 'update');
        const result = await api.updateTask(task.id, {});

        // update is still called but with an empty safe object — repo returns current row.
        expect(result).not.toBeNull();
        expect(result!.title).toBe('no-op test');
        expect(result!.priority).toBe('urgent');
        expect(updateSpy).toHaveBeenCalledOnce();
        updateSpy.mockRestore();
    });

    it('returns null for a non-existent task id', async () => {
        const api = createPluginAPI('test-plugin', stubCredentials);
        const result = await api.updateTask(99999, { title: 'ghost' });
        expect(result).toBeNull();
    });

    it('passes all allowed sync fields through (jiraKey, jiraId, githubRef, syncHash, lastSyncedAt)', async () => {
        const task = taskRepo.create({ title: 'sync test' });
        const api = createPluginAPI('test-plugin', stubCredentials);

        const update: SafeTaskUpdate = {
            jiraKey: 'PROJ-42',
            jiraId: 'abc123',
            githubRef: 'owner/repo#7',
            syncHash: 'deadbeef',
            lastSyncedAt: '2026-01-01T00:00:00.000Z',
        };
        const updated = await api.updateTask(task.id, update);

        expect(updated).not.toBeNull();
        expect(updated!.jiraKey).toBe('PROJ-42');
        expect(updated!.jiraId).toBe('abc123');
        expect(updated!.githubRef).toBe('owner/repo#7');
        expect(updated!.syncHash).toBe('deadbeef');
        expect(updated!.lastSyncedAt).toBe('2026-01-01T00:00:00.000Z');
    });
});
