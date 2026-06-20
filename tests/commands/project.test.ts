import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/storage/database.js';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../src/storage/repositories/project.repo.js';
import { TagRepository } from '../../src/storage/repositories/tag.repo.js';
import { TimerRepository } from '../../src/storage/repositories/timer.repo.js';
import { ActionLogRepository } from '../../src/storage/repositories/action-log.repo.js';
import { DependencyRepository } from '../../src/storage/repositories/dependency.repo.js';
import { TrackingRepository } from '../../src/storage/repositories/tracking.repo.js';
import type { AppContext } from '../../src/commands/context.js';
import '../../src/utils/initThemes.js';
import { disableColors } from '../../src/utils/theme.js';
import { EXIT } from '../../src/utils/exit.js';

vi.mock('../../src/commands/context.js', () => ({
    getContext: () => ctx,
}));

let db: Database.Database;
let ctx: AppContext;

function buildCtx(database: Database.Database): AppContext {
    return {
        taskRepo: new TaskRepository(database),
        projectRepo: new ProjectRepository(database),
        tagRepo: new TagRepository(database),
        timerRepo: new TimerRepository(database),
        actionLog: new ActionLogRepository(database),
        depRepo: new DependencyRepository(database),
        trackingRepo: new TrackingRepository(database),
    };
}

beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    ctx = buildCtx(db);
    disableColors();
    process.exitCode = 0;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    db.close();
    process.exitCode = 0;
    vi.restoreAllMocks();
});

describe('project create --color', () => {
    it('accepts a palette name and persists as hex', async () => {
        const { projectCommand } = await import('../../src/commands/project.js');
        await projectCommand.parseAsync(['create', 'TestProject', '--color', 'mint'], { from: 'user' });

        const project = ctx.projectRepo.getByName('TestProject');
        expect(project).not.toBeNull();
        expect(project!.color).toBe('#2dd4bf');
    });

    it('sets exitCode EXIT.USAGE when --color is invalid', async () => {
        const { projectCommand } = await import('../../src/commands/project.js');
        await projectCommand.parseAsync(['create', 'TestProject', '--color', 'bogus'], { from: 'user' });

        expect(process.exitCode).toBe(EXIT.USAGE);
        // Project should not have been created
        expect(ctx.projectRepo.getByName('TestProject')).toBeNull();
    });
});

describe('project color subcommand', () => {
    it('updates project color by palette name', async () => {
        ctx.projectRepo.create({ name: 'MyProject' });

        const { projectCommand } = await import('../../src/commands/project.js');
        await projectCommand.parseAsync(['color', 'MyProject', 'teal'], { from: 'user' });

        const project = ctx.projectRepo.getByName('MyProject');
        expect(project!.color).toBe('#14b8a6');
    });

    it('accepts hex directly', async () => {
        ctx.projectRepo.create({ name: 'HexProject' });

        const { projectCommand } = await import('../../src/commands/project.js');
        await projectCommand.parseAsync(['color', 'HexProject', '#fabd2f'], { from: 'user' });

        const project = ctx.projectRepo.getByName('HexProject');
        expect(project!.color).toBe('#fabd2f');
    });

    it('sets exitCode EXIT.USAGE when color is invalid', async () => {
        ctx.projectRepo.create({ name: 'MyProject' });

        const { projectCommand } = await import('../../src/commands/project.js');
        await projectCommand.parseAsync(['color', 'MyProject', 'bogus'], { from: 'user' });

        expect(process.exitCode).toBe(EXIT.USAGE);
    });
});
