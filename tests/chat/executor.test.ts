// Tests for IntentExecutor: hook counts, invalid-transition clarify, recurring spawns

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../../src/storage/database.js';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../src/storage/repositories/project.repo.js';
import { TagRepository } from '../../src/storage/repositories/tag.repo.js';
import { TimerRepository } from '../../src/storage/repositories/timer.repo.js';
import { ActionLogRepository } from '../../src/storage/repositories/action-log.repo.js';
import { DependencyRepository } from '../../src/storage/repositories/dependency.repo.js';
import { TrackingRepository } from '../../src/storage/repositories/tracking.repo.js';
import { IntentExecutor } from '../../src/chat/executor.js';
import type { AppContext } from '../../src/commands/context.js';
import type { Intent } from '../../src/chat/intent.js';
import type { ExternalTask } from '../../src/plugins/types.js';

// Stub Jira provider for sync-path hook tests
vi.mock('../../src/integrations/jira/index.js', () => ({
    default: {
        pull: vi.fn(async () => [] as ExternalTask[]),
        mapToLocal: vi.fn((ext: ExternalTask) => ({ title: ext.title, priority: ext.priority, description: ext.description, dueDate: ext.dueDate })),
        push: vi.fn(async () => ({ success: true, message: 'ok', externalRef: '', updatedFields: [] })),
    },
}));

// Stub GitHub provider for sync-path hook tests
vi.mock('../../src/integrations/github/index.js', () => ({
    default: {
        pull: vi.fn(async () => [] as ExternalTask[]),
        mapToLocal: vi.fn((ext: ExternalTask) => ({ title: ext.title, priority: ext.priority, description: ext.description, dueDate: ext.dueDate, tags: ext.labels })),
        push: vi.fn(async () => ({ success: true, message: 'ok', externalRef: '', updatedFields: [] })),
    },
}));

// Stub EncryptedCredentialStore so no filesystem access occurs
vi.mock('../../src/plugins/index.js', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../../src/plugins/index.js')>();
    return {
        ...orig,
        EncryptedCredentialStore: vi.fn().mockImplementation(() => ({
            get: vi.fn(async () => null),
            getOrThrow: vi.fn(async () => { throw new Error('not found'); }),
            set: vi.fn(async () => {}),
            delete: vi.fn(async () => {}),
            list: vi.fn(async () => []),
        })),
    };
});

// Stub hook-manager so we can count invocations without side effects
vi.mock('../../src/plugins/hook-manager.js', () => {
    const counts = { create: 0, update: 0, complete: 0, delete: 0 };
    return {
        getHookManager: () => ({
            onTaskCreate: vi.fn(async () => { counts.create++; }),
            onTaskUpdate: vi.fn(async () => { counts.update++; }),
            onTaskComplete: vi.fn(async () => { counts.complete++; }),
            onTaskDelete: vi.fn(async () => { counts.delete++; }),
        }),
        __counts: counts,
    };
});

// Reset counts before each test
let hookCounts: { create: number; update: number; complete: number; delete: number };

function buildCtx(): AppContext {
    const db = createTestDb();
    runMigrations(db);
    return {
        taskRepo: new TaskRepository(db),
        projectRepo: new ProjectRepository(db),
        tagRepo: new TagRepository(db),
        timerRepo: new TimerRepository(db),
        actionLog: new ActionLogRepository(db),
        depRepo: new DependencyRepository(db),
        trackingRepo: new TrackingRepository(db),
    };
}

// Helper to reset hook spy counts between tests
async function resetCounts(): Promise<void> {
    const mod = await import('../../src/plugins/hook-manager.js') as { __counts?: typeof hookCounts };
    if (mod.__counts) {
        mod.__counts.create = 0;
        mod.__counts.update = 0;
        mod.__counts.complete = 0;
        mod.__counts.delete = 0;
        hookCounts = mod.__counts;
    }
}

beforeEach(async () => {
    await resetCounts();
});

describe('IntentExecutor — hook fire count', () => {
    it('fires onTaskCreate exactly once on chat create', async () => {
        const ctx = buildCtx();
        const executor = new IntentExecutor(ctx);

        const intent: Intent = { action: 'create_task', title: 'test task' };
        await executor.execute(intent);

        // Flush micro-task queue so the .catch() chain resolves
        await new Promise(r => setTimeout(r, 10));

        const mod = await import('../../src/plugins/hook-manager.js') as { __counts?: typeof hookCounts };
        expect(mod.__counts?.create).toBe(1);
    });

    it('fires onTaskUpdate exactly once on chat update_task', async () => {
        const ctx = buildCtx();
        const task = ctx.taskRepo.create({ title: 'edit me' });
        const executor = new IntentExecutor(ctx);

        await executor.execute({ action: 'update_task', taskId: task.id, title: 'edited title' });
        await new Promise(r => setTimeout(r, 10));

        const mod = await import('../../src/plugins/hook-manager.js') as { __counts?: typeof hookCounts };
        expect(mod.__counts?.update).toBe(1);
    });

    it('fires onTaskDelete exactly once on chat delete confirmed', async () => {
        const ctx = buildCtx();
        const task = ctx.taskRepo.create({ title: 'bye' });
        const executor = new IntentExecutor(ctx);

        // Step 1: trigger pending delete
        await executor.execute({ action: 'delete_task', taskId: task.id });
        // Step 2: confirm
        await executor.execute({ action: 'clarify', message: 'yes' });
        await new Promise(r => setTimeout(r, 10));

        const mod = await import('../../src/plugins/hook-manager.js') as { __counts?: typeof hookCounts };
        expect(mod.__counts?.delete).toBe(1);
    });

    it('fires onTaskComplete exactly once on chat update_status done', async () => {
        const ctx = buildCtx();
        const task = ctx.taskRepo.create({ title: 'finish me' });
        const executor = new IntentExecutor(ctx);

        await executor.execute({ action: 'update_status', taskId: task.id, status: 'done' });
        await new Promise(r => setTimeout(r, 10));

        const mod = await import('../../src/plugins/hook-manager.js') as { __counts?: typeof hookCounts };
        expect(mod.__counts?.complete).toBe(1);
    });
});

describe('IntentExecutor — invalid transition returns clarify message', () => {
    it('returns a message (not a crash) when status is unknown', async () => {
        const ctx = buildCtx();
        const task = ctx.taskRepo.create({ title: 'transition test' });
        const executor = new IntentExecutor(ctx);

        // 'bogus_status' is not a valid TaskStatus — validateTransition should throw
        const result = await executor.execute({
            action: 'update_status',
            taskId: task.id,
            status: 'bogus_status' as 'done',
        });

        // Must return a message — must not throw, must not exit
        expect(result.message).toBeTruthy();
        expect(result.message).toContain('bogus_status');
    });

    it('does not throw when task not found on update_status', async () => {
        const ctx = buildCtx();
        const executor = new IntentExecutor(ctx);

        const result = await executor.execute({ action: 'update_status', taskId: 9999, status: 'done' });
        expect(result.message).toBeTruthy();
        expect(result.message.toLowerCase()).toContain('not found');
    });
});

describe('IntentExecutor — recurring task spawns on completion', () => {
    it('creates next occurrence when a recurring task is completed via chat', async () => {
        const ctx = buildCtx();
        const task = ctx.taskRepo.create({
            title: 'weekly standup',
            recurrence: 'weekly',
            dueDate: '2026-06-14',
        });
        const executor = new IntentExecutor(ctx);

        const result = await executor.execute({ action: 'update_status', taskId: task.id, status: 'done' });

        // The completed task should now be done
        const completed = ctx.taskRepo.getById(task.id);
        expect(completed?.status).toBe('done');

        // A new task with the same title should exist
        const allTasks = ctx.taskRepo.list({ includeArchived: false });
        const recurring = allTasks.find(t => t.id !== task.id && t.title === 'weekly standup');
        expect(recurring).toBeTruthy();
        expect(recurring?.recurrence).toBe('weekly');
        expect(recurring?.dueDate).toBeTruthy();

        // Chat output should mention the new task
        expect(result.message).toContain(String(recurring?.id));
    });
});

describe('IntentExecutor — sync-path hook firing (F4)', () => {
    it('fires onTaskUpdate exactly once on chat adjust_time', async () => {
        const ctx = buildCtx();
        const task = ctx.taskRepo.create({ title: 'timed task' });
        const executor = new IntentExecutor(ctx);

        await executor.execute({ action: 'adjust_time', taskId: task.id, timeAdjustSeconds: 3600 });
        await new Promise(r => setTimeout(r, 10));

        const mod = await import('../../src/plugins/hook-manager.js') as { __counts?: typeof hookCounts };
        expect(mod.__counts?.update).toBe(1);
        expect(mod.__counts?.create).toBe(0);
    });

    it('fires onTaskCreate once per imported task on chat jira_pull', async () => {
        // Configure mock to return two issues that have not been imported yet
        const jiraProvider = (await import('../../src/integrations/jira/index.js')).default as {
            pull: ReturnType<typeof vi.fn>;
            mapToLocal: ReturnType<typeof vi.fn>;
        };
        const fakeIssues: ExternalTask[] = [
            { externalId: '1', externalRef: 'PROJ-1', externalUrl: '', title: 'Issue A', status: 'open' },
            { externalId: '2', externalRef: 'PROJ-2', externalUrl: '', title: 'Issue B', status: 'open' },
        ];
        jiraProvider.pull.mockResolvedValueOnce(fakeIssues);

        const ctx = buildCtx();
        const executor = new IntentExecutor(ctx);

        await executor.execute({ action: 'jira_pull' });
        await new Promise(r => setTimeout(r, 10));

        const mod = await import('../../src/plugins/hook-manager.js') as { __counts?: typeof hookCounts };
        // One hook fire per created task, not per batch
        expect(mod.__counts?.create).toBe(2);
        expect(mod.__counts?.update).toBe(0);
    });

    it('fires onTaskCreate once per imported task on chat github_pull', async () => {
        // Configure mock to return one issue
        const ghProvider = (await import('../../src/integrations/github/index.js')).default as {
            pull: ReturnType<typeof vi.fn>;
            mapToLocal: ReturnType<typeof vi.fn>;
        };
        const fakeIssues: ExternalTask[] = [
            { externalId: '42', externalRef: 'acme/repo#42', externalUrl: '', title: 'GH Issue', status: 'open' },
        ];
        ghProvider.pull.mockResolvedValueOnce(fakeIssues);

        const ctx = buildCtx();
        const executor = new IntentExecutor(ctx);

        await executor.execute({ action: 'github_pull' });
        await new Promise(r => setTimeout(r, 10));

        const mod = await import('../../src/plugins/hook-manager.js') as { __counts?: typeof hookCounts };
        expect(mod.__counts?.create).toBe(1);
        expect(mod.__counts?.update).toBe(0);
    });
});
