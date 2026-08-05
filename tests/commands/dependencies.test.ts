// Regression tests for add/edit --depends partial-state and silent-failure bugs
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { EXIT } from '../../src/utils/exit.js';

let db: Database.Database;
let ctx: AppContext;

function buildCtx(database: Database.Database): AppContext {
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

// Wire ctx into getContext so commands use the test DB
vi.mock('../../src/commands/context.js', () => ({
    getContext: () => ctx,
}));

beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    ctx = buildCtx(db);
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
});

describe('add --depends: no partial state on invalid dependency', () => {
    it('leaves no partial state when the dependency ID does not exist', async () => {
        ctx.taskRepo.create({ title: 'Base' });
        const before = ctx.taskRepo.list({}).length;
        const { addCommand } = await import('../../src/commands/add.js');
        const origExitCode = process.exitCode;
        process.exitCode = 0;
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        addCommand.parse(['Fix login', '--depends', '999'], { from: 'user' });
        expect(process.exitCode).toBe(EXIT.NOT_FOUND);
        process.exitCode = origExitCode;
        expect(ctx.taskRepo.list({}).length).toBe(before);
        expect(ctx.taskRepo.list({}).some(t => t.title === 'Fix login')).toBe(false);
    });

    it('rejects the whole add when one of multiple dependency IDs is missing', async () => {
        const base = ctx.taskRepo.create({ title: 'Base' });
        const before = ctx.taskRepo.list({}).length;
        const { addCommand } = await import('../../src/commands/add.js');
        const origExitCode = process.exitCode;
        process.exitCode = 0;
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        addCommand.parse(['Mixed', '--depends', `${base.id},999`], { from: 'user' });
        expect(process.exitCode).toBe(EXIT.NOT_FOUND);
        process.exitCode = origExitCode;
        expect(ctx.taskRepo.list({}).length).toBe(before);
        expect(ctx.depRepo.getDependencies(base.id)).toEqual([]);
    });

    it('exits USAGE with no task created when the dependency list is entirely non-numeric', async () => {
        const before = ctx.taskRepo.list({}).length;
        const { addCommand } = await import('../../src/commands/add.js');
        const origExitCode = process.exitCode;
        process.exitCode = 0;
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        addCommand.parse(['Bad deps', '--depends', 'abc'], { from: 'user' });
        expect(process.exitCode).toBe(EXIT.USAGE);
        process.exitCode = origExitCode;
        expect(ctx.taskRepo.list({}).length).toBe(before);
    });

    it('documents pre-existing parseIds behavior: a mixed numeric/non-numeric token list silently drops the bad token', async () => {
        const base = ctx.taskRepo.create({ title: 'Base' });
        const { addCommand } = await import('../../src/commands/add.js');
        const origExitCode = process.exitCode;
        process.exitCode = 0;
        addCommand.parse(['Typo', '--depends', `${base.id},abc`], { from: 'user' });
        expect(process.exitCode).toBe(0);
        process.exitCode = origExitCode;
        const created = ctx.taskRepo.list({}).find(t => t.title === 'Typo');
        expect(created).toBeDefined();
        expect(ctx.depRepo.getDependencies(created!.id)).toEqual([base.id]);
    });

    it('happy path: a valid dependency ID creates the task and the dependency row', async () => {
        const base = ctx.taskRepo.create({ title: 'Base' });
        const { addCommand } = await import('../../src/commands/add.js');
        const origExitCode = process.exitCode;
        process.exitCode = 0;
        addCommand.parse(['Real dep', '--depends', String(base.id)], { from: 'user' });
        expect(process.exitCode).toBe(0);
        process.exitCode = origExitCode;
        const created = ctx.taskRepo.list({}).find(t => t.title === 'Real dep');
        expect(created).toBeDefined();
        expect(ctx.depRepo.getDependencies(created!.id)).toEqual([base.id]);
    });
});

describe('edit --depends: removing a dependency from a nonexistent task surfaces an error', () => {
    it('sets a non-zero exit code instead of a silent no-op success', async () => {
        const task = ctx.taskRepo.create({ title: 'Edit me' });
        const { editCommand } = await import('../../src/commands/edit.js');
        const origExitCode = process.exitCode;
        process.exitCode = 0;
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        editCommand.parse([String(task.id), '--depends', '-999'], { from: 'user' });
        expect(process.exitCode).not.toBe(0);
        process.exitCode = origExitCode;
    });
});
