// Tests for edit command -S / -s flag deprecation shim

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

vi.mock('../../src/plugins/hook-manager.js', () => ({
    getHookManager: () => ({
        onTaskCreate: vi.fn().mockResolvedValue(undefined),
        onTaskUpdate: vi.fn().mockResolvedValue(undefined),
        onTaskComplete: vi.fn().mockResolvedValue(undefined),
        onTaskDelete: vi.fn().mockResolvedValue(undefined),
    }),
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

vi.mock('../../src/commands/context.js', () => ({
    getContext: () => ctx,
}));

beforeEach(() => {
    vi.resetModules();
    db = createTestDb();
    runMigrations(db);
    ctx = buildCtx(db);
});

afterEach(() => {
    db.close();
    vi.restoreAllMocks();
});

// ──────────────────────────────────────────────
// -S (canonical new short flag)
// ──────────────────────────────────────────────
describe('edit -S (canonical short flag)', () => {
    it('routes status correctly via -S', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const task = ctx.taskRepo.create({ title: 'Canonical flag test', priority: 'medium' });
        ctx.taskRepo.update(task.id, { status: 'in_progress' });

        const { editCommand } = await import('../../src/commands/edit.js');
        await editCommand.parseAsync([String(task.id), '-S', 'done'], { from: 'user' });

        expect(ctx.taskRepo.getById(task.id)?.status).toBe('done');
    });

    it('does not emit a deprecation warning when -S is used', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const task = ctx.taskRepo.create({ title: 'No warning test', priority: 'medium' });
        ctx.taskRepo.update(task.id, { status: 'in_progress' });

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const { editCommand } = await import('../../src/commands/edit.js');
        await editCommand.parseAsync([String(task.id), '-S', 'done'], { from: 'user' });

        const stderrOutput = stderrSpy.mock.calls.map(c => String(c[0])).join('');
        expect(stderrOutput).not.toContain('deprecated');
    });
});

// ──────────────────────────────────────────────
// -s (deprecated alias — must still work + warn)
// ──────────────────────────────────────────────
describe('edit -s (deprecated alias)', () => {
    it('still routes status correctly when -s is used', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const task = ctx.taskRepo.create({ title: 'Deprecated flag test', priority: 'medium' });
        ctx.taskRepo.update(task.id, { status: 'in_progress' });

        const { editCommand } = await import('../../src/commands/edit.js');
        // -s maps to --status-deprecated (hidden alias); preAction promotes it to opts.status
        await editCommand.parseAsync([String(task.id), '-s', 'done'], { from: 'user' });

        expect(ctx.taskRepo.getById(task.id)?.status).toBe('done');
    });

    it('emits the deprecation warning to stderr when -s is used', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const task = ctx.taskRepo.create({ title: 'Warning emission test', priority: 'medium' });
        ctx.taskRepo.update(task.id, { status: 'in_progress' });

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const { editCommand } = await import('../../src/commands/edit.js');
        await editCommand.parseAsync([String(task.id), '-s', 'done'], { from: 'user' });

        const stderrOutput = stderrSpy.mock.calls.map(c => String(c[0])).join('');
        expect(stderrOutput).toContain("warning: -s for --status is deprecated on 'todo edit'");
        expect(stderrOutput).toContain('-S');
    });

    it('does not emit a warning to stderr when --json flag is also present', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const task = ctx.taskRepo.create({ title: 'JSON no-warn test', priority: 'medium' });
        ctx.taskRepo.update(task.id, { status: 'in_progress' });

        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const { editCommand } = await import('../../src/commands/edit.js');
        await editCommand.parseAsync([String(task.id), '-s', 'done', '--json'], { from: 'user' });

        const stderrOutput = stderrSpy.mock.calls.map(c => String(c[0])).join('');
        expect(stderrOutput).not.toContain('deprecated');
    });
});
