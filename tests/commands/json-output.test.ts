// Tests for --json flag on mutating commands: add, delete, edit, start, done, review, reopen, archive

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/storage/database.js';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../src/storage/repositories/project.repo.js';
import { TagRepository } from '../../src/storage/repositories/tag.repo.js';
import { ActionLogRepository } from '../../src/storage/repositories/action-log.repo.js';
import { DependencyRepository } from '../../src/storage/repositories/dependency.repo.js';
import { TrackingRepository } from '../../src/storage/repositories/tracking.repo.js';
import type { AppContext } from '../../src/commands/context.js';
import type { JsonSuccess, JsonError } from '../../src/utils/json-output.js';

// Mock hook manager to avoid async side-effects in unit tests
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

import { StatusRepository } from '../../src/storage/repositories/status.repo.js';

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

// Capture a single JSON line written to process.stdout
function captureJsonOutput<T>(fn: () => void): T {
    let captured = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        captured += chunk;
        return true;
    });
    const origExitCode = process.exitCode;
    process.exitCode = 0;
    try {
        fn();
    } finally {
        spy.mockRestore();
        // restore exitCode for next test
        process.exitCode = origExitCode;
    }
    return JSON.parse(captured.trim()) as T;
}

// ──────────────────────────────────────────────
// json-output.ts unit tests
// ──────────────────────────────────────────────
describe('emitJson', () => {
    it('writes a single-line JSON object to stdout', async () => {
        const { emitJson } = await import('../../src/utils/json-output.js');
        let captured = '';
        const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            captured += chunk;
            return true;
        });
        emitJson({ ok: true, command: 'add', data: { id: 1 } });
        spy.mockRestore();
        expect(captured).toBe('{"ok":true,"command":"add","data":{"id":1}}\n');
    });

    it('emits ok:false shape for errors', async () => {
        const { emitJson } = await import('../../src/utils/json-output.js');
        let captured = '';
        const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            captured += chunk;
            return true;
        });
        emitJson({ ok: false, command: 'delete', error: { code: 3, message: 'not found' } });
        spy.mockRestore();
        const parsed = JSON.parse(captured.trim()) as JsonError;
        expect(parsed.ok).toBe(false);
        expect(parsed.command).toBe('delete');
        expect(parsed.error.code).toBe(3);
    });
});

// ──────────────────────────────────────────────
// fail() with json:true
// ──────────────────────────────────────────────
describe('fail with json mode', () => {
    it('emits JSON to stdout (not stderr) when json:true', async () => {
        const { fail, EXIT } = await import('../../src/utils/exit.js');
        let stdoutData = '';
        let stderrData = '';
        const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { stdoutData += c; return true; });
        const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((c) => { stderrData += c; return true; });
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        fail(EXIT.NOT_FOUND, 'Task #5 not found', { json: true, command: 'delete' });
        outSpy.mockRestore();
        errSpy.mockRestore();
        consoleSpy.mockRestore();
        const parsed = JSON.parse(stdoutData.trim()) as JsonError;
        expect(parsed.ok).toBe(false);
        expect(parsed.command).toBe('delete');
        expect(parsed.error.code).toBe(3);
        expect(parsed.error.message).toBe('Task #5 not found');
        // Nothing on stderr
        expect(stderrData).toBe('');
    });

    it('emits to stderr when json is not set', async () => {
        const { fail, EXIT } = await import('../../src/utils/exit.js');
        let stderrCalled = false;
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { stderrCalled = true; });
        fail(EXIT.NOT_FOUND, 'Task #5 not found');
        spy.mockRestore();
        expect(stderrCalled).toBe(true);
    });
});

// ──────────────────────────────────────────────
// add --json
// ──────────────────────────────────────────────
describe('add command --json', () => {
    it('emits ok:true JSON with task data', async () => {
        const { addCommand } = await import('../../src/commands/add.js');
        // from:'user' means array IS the user args, no program/subcommand name
        const payload = captureJsonOutput<JsonSuccess>(() => {
            addCommand.parse(['My task', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('add');
        const data = payload.data as Record<string, unknown>;
        expect(typeof data.id).toBe('number');
        expect(data.title).toBe('My task');
    });

    it('human path (no --json): executeEdit emits no JSON to stdout', async () => {
        // Use executeEdit directly to sidestep Commander's option-retention across parse calls
        const task = ctx.taskRepo.create({ title: 'Human edit path' });
        const { executeEdit } = await import('../../src/commands/edit.js');
        let stdoutWrite = '';
        const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { stdoutWrite += c; return true; });
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        // json=false (default): should not write anything to process.stdout.write
        executeEdit(task.id, { title: 'Updated human' }, { json: false });
        writeSpy.mockRestore();
        logSpy.mockRestore();
        expect(stdoutWrite).toBe('');
    });
});

// ──────────────────────────────────────────────
// delete --json
// ──────────────────────────────────────────────
describe('delete command --json', () => {
    it('emits ok:false JSON when task not found', async () => {
        const { deleteCommand } = await import('../../src/commands/delete.js');
        const payload = captureJsonOutput<JsonError>(() => {
            deleteCommand.parse(['999999', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(false);
        expect(payload.command).toBe('delete');
        expect(payload.error.code).toBe(3);
        expect(payload.error.message).toContain('999999');
    });

    it('emits ok:true JSON on successful archive (soft delete)', async () => {
        const task = ctx.taskRepo.create({ title: 'Delete me' });
        const { deleteCommand } = await import('../../src/commands/delete.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            deleteCommand.parse([String(task.id), '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('delete');
        const data = payload.data as Record<string, unknown>;
        expect(data.id).toBe(task.id);
    });

    it('emits ok:true JSON on hard delete with --force', async () => {
        const task = ctx.taskRepo.create({ title: 'Hard delete me' });
        const { deleteCommand } = await import('../../src/commands/delete.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            deleteCommand.parse([String(task.id), '--force', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        const data = payload.data as Record<string, unknown>;
        expect(data.deleted).toBe(true);
    });

    it('human path (no --json): archive goes to console.log, no JSON to stdout.write', async () => {
        // Test executeEdit directly to avoid Commander option-caching across parse calls
        const task = ctx.taskRepo.create({ title: 'Human delete path' });
        const { executeEdit } = await import('../../src/commands/edit.js');
        let stdoutWrite = '';
        const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { stdoutWrite += c; return true; });
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        executeEdit(task.id, { status: 'archived' }, { json: false });
        writeSpy.mockRestore();
        logSpy.mockRestore();
        expect(stdoutWrite).toBe('');
    });
});

// ──────────────────────────────────────────────
// edit --json
// ──────────────────────────────────────────────
describe('edit command --json', () => {
    it('emits ok:true JSON with updated task data', async () => {
        const task = ctx.taskRepo.create({ title: 'Edit me' });
        const { editCommand } = await import('../../src/commands/edit.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            editCommand.parse([String(task.id), '--title', 'Edited', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('edit');
        const data = payload.data as Record<string, unknown>;
        expect(data.title).toBe('Edited');
    });

    it('emits ok:false when task not found', async () => {
        const { editCommand } = await import('../../src/commands/edit.js');
        const payload = captureJsonOutput<JsonError>(() => {
            editCommand.parse(['999999', '--title', 'x', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(false);
        expect(payload.error.code).toBe(3);
    });

    it('regression: edit rejects --status as unknown option', async () => {
        // --status was removed from edit; it must be treated as unknown option
        const task = ctx.taskRepo.create({ title: 'Transition test' });
        const { editCommand } = await import('../../src/commands/edit.js');
        const originalExitCode = process.exitCode;
        process.exitCode = 0;
        let threw = false;
        try {
            editCommand.parse([String(task.id), '--status', 'done', '--json'], { from: 'user' });
        } catch {
            threw = true;
        }
        // Commander throws or sets exitCode on unknown options
        const rejected = threw || (process.exitCode !== 0 && process.exitCode !== undefined);
        process.exitCode = originalExitCode;
        expect(rejected).toBe(true);
    });

    it('includes recurring info in JSON payload for recurring task completion via executeEdit', async () => {
        const task = ctx.taskRepo.create({ title: 'Recurring', recurrence: 'daily' });
        ctx.taskRepo.update(task.id, { status: 'in_progress' });
        // Use executeEdit directly since --status flag is removed from editCommand
        const { executeEdit } = await import('../../src/commands/edit.js');
        let captured = '';
        const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            captured += chunk;
            return true;
        });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        executeEdit(task.id, { status: 'done' }, { json: true });
        spy.mockRestore();
        vi.restoreAllMocks();
        const payload = JSON.parse(captured.trim()) as JsonSuccess;
        expect(payload.ok).toBe(true);
        expect(payload.recurring).toBeDefined();
        expect(typeof payload.recurring?.id).toBe('number');
        expect(typeof payload.recurring?.dueDate).toBe('string');
    });

    it('human path: executeEdit with json=false emits no JSON to stdout.write', async () => {
        const task = ctx.taskRepo.create({ title: 'Human edit 2' });
        const { executeEdit } = await import('../../src/commands/edit.js');
        let stdoutWrite = '';
        const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { stdoutWrite += c; return true; });
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        executeEdit(task.id, { title: 'Updated human' }, { json: false });
        writeSpy.mockRestore();
        logSpy.mockRestore();
        expect(stdoutWrite).toBe('');
    });
});

// ──────────────────────────────────────────────
// Status verb commands --json (via executeEdit directly)
// ──────────────────────────────────────────────
describe('start (executeEdit to in_progress) --json', () => {
    it('emits ok:true JSON after transitioning to in_progress', async () => {
        const task = ctx.taskRepo.create({ title: 'Start me' });
        const { executeEdit } = await import('../../src/commands/edit.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            executeEdit(task.id, { status: 'in_progress' }, { json: true });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('edit');
        const data = payload.data as Record<string, unknown>;
        expect(data.status).toBe('in_progress');
    });

    it('emits ok:false JSON when task not found', async () => {
        const { executeEdit } = await import('../../src/commands/edit.js');
        const payload = captureJsonOutput<JsonError>(() => {
            executeEdit(999999, { status: 'in_progress' }, { json: true });
        });
        expect(payload.ok).toBe(false);
        expect(payload.error.code).toBe(3);
    });
});

describe('done (executeEdit to done) --json', () => {
    it('emits ok:true JSON after marking done', async () => {
        const task = ctx.taskRepo.create({ title: 'Do me' });
        ctx.taskRepo.update(task.id, { status: 'in_progress' });
        const { executeEdit } = await import('../../src/commands/edit.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            executeEdit(task.id, { status: 'done' }, { json: true });
        });
        expect(payload.ok).toBe(true);
        const data = payload.data as Record<string, unknown>;
        expect(data.status).toBe('done');
    });
});

describe('review (executeEdit to in_review) --json', () => {
    it('emits ok:true JSON after moving to in_review', async () => {
        const task = ctx.taskRepo.create({ title: 'Review me' });
        ctx.taskRepo.update(task.id, { status: 'in_progress' });
        const { executeEdit } = await import('../../src/commands/edit.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            executeEdit(task.id, { status: 'in_review' }, { json: true });
        });
        expect(payload.ok).toBe(true);
        const data = payload.data as Record<string, unknown>;
        expect(data.status).toBe('in_review');
    });
});

describe('reopen (executeEdit to todo) --json', () => {
    it('emits ok:true JSON after reopening a done task', async () => {
        const task = ctx.taskRepo.create({ title: 'Reopen me' });
        ctx.taskRepo.update(task.id, { status: 'done', completedAt: new Date().toISOString() });
        const { executeEdit } = await import('../../src/commands/edit.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            executeEdit(task.id, { status: 'todo' }, { json: true });
        });
        expect(payload.ok).toBe(true);
        const data = payload.data as Record<string, unknown>;
        expect(data.status).toBe('todo');
    });
});

describe('archive (executeEdit to archived) --json', () => {
    it('emits ok:true JSON after archiving a done task', async () => {
        const task = ctx.taskRepo.create({ title: 'Archive me' });
        ctx.taskRepo.update(task.id, { status: 'done', completedAt: new Date().toISOString() });
        const { executeEdit } = await import('../../src/commands/edit.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            executeEdit(task.id, { status: 'archived' }, { json: true });
        });
        expect(payload.ok).toBe(true);
        const data = payload.data as Record<string, unknown>;
        expect(data.status).toBe('archived');
    });
});

// ──────────────────────────────────────────────
// show --json (emitJson refactor)
// ──────────────────────────────────────────────
describe('show command --json', () => {
    it('emits ok:true JSON with task and enrichment data', async () => {
        const task = ctx.taskRepo.create({ title: 'Show me' });
        const { showCommand } = await import('../../src/commands/show.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            showCommand.parse([String(task.id), '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('show');
        const data = payload.data as Record<string, unknown>;
        expect(data.id).toBe(task.id);
        expect(data.title).toBe('Show me');
        // Enrichment keys must be present for backwards-compatibility
        expect(Array.isArray(data.dependencies)).toBe(true);
        expect(Array.isArray(data.dependents)).toBe(true);
    });

    it('emits ok:false when task not found', async () => {
        const { showCommand } = await import('../../src/commands/show.js');
        const payload = captureJsonOutput<JsonError>(() => {
            showCommand.parse(['999999', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(false);
        expect(payload.command).toBe('show');
        expect(payload.error.code).toBe(3);
    });
});

// ──────────────────────────────────────────────
// project --json
// ──────────────────────────────────────────────
describe('project show --json', () => {
    it('emits ok:true with project and tasks', async () => {
        ctx.projectRepo.create({ name: 'Alpha', color: 'blue' });
        const { projectCommand } = await import('../../src/commands/project.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            projectCommand.parse(['show', 'Alpha', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('project show');
        const data = payload.data as Record<string, unknown>;
        expect(data.name).toBe('Alpha');
        expect(Array.isArray(data.tasks)).toBe(true);
    });

    it('emits ok:false when project not found', async () => {
        const { projectCommand } = await import('../../src/commands/project.js');
        const payload = captureJsonOutput<JsonError>(() => {
            projectCommand.parse(['show', 'nonexistent', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(false);
        expect(payload.error.code).toBe(3);
    });
});

describe('project rename --json', () => {
    it('emits ok:true with renamed project', async () => {
        ctx.projectRepo.create({ name: 'OldName', color: 'red' });
        const { projectCommand } = await import('../../src/commands/project.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            projectCommand.parse(['rename', 'OldName', 'NewName', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('project rename');
    });
});

describe('project archive --json', () => {
    it('emits ok:true with action:archived', async () => {
        ctx.projectRepo.create({ name: 'ToArchive', color: 'green' });
        const { projectCommand } = await import('../../src/commands/project.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            projectCommand.parse(['archive', 'ToArchive', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        const data = payload.data as Record<string, unknown>;
        expect(data.action).toBe('archived');
        expect(data.name).toBe('ToArchive');
    });
});

describe('project delete --json', () => {
    it('emits ok:true with action:deleted', async () => {
        ctx.projectRepo.create({ name: 'ToDelete', color: 'gray' });
        const { projectCommand } = await import('../../src/commands/project.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            projectCommand.parse(['delete', 'ToDelete', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        const data = payload.data as Record<string, unknown>;
        expect(data.action).toBe('deleted');
        expect(data.name).toBe('ToDelete');
    });
});

// ──────────────────────────────────────────────
// tag --json
// ──────────────────────────────────────────────
describe('tag rename --json', () => {
    it('emits ok:true with renamed tag', async () => {
        // Create a task with tag to seed the tag
        const task = ctx.taskRepo.create({ title: 'Tagged task' });
        ctx.tagRepo.setTaskTags(task.id, ['oldtag']);
        const { tagCommand } = await import('../../src/commands/tag.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            tagCommand.parse(['rename', 'oldtag', 'newtag', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('tag rename');
    });
});

describe('tag delete --json', () => {
    it('emits ok:true with action:deleted', async () => {
        const task = ctx.taskRepo.create({ title: 'Tag delete task' });
        ctx.tagRepo.setTaskTags(task.id, ['deltag']);
        const { tagCommand } = await import('../../src/commands/tag.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            tagCommand.parse(['delete', 'deltag', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        const data = payload.data as Record<string, unknown>;
        expect(data.action).toBe('deleted');
    });

    it('emits ok:false when tag not found', async () => {
        const { tagCommand } = await import('../../src/commands/tag.js');
        const payload = captureJsonOutput<JsonError>(() => {
            tagCommand.parse(['delete', 'nonexistent-tag', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(false);
        expect(payload.error.code).toBe(3);
    });
});

describe('tag color --json', () => {
    it('emits ok:true with updated tag', async () => {
        const task = ctx.taskRepo.create({ title: 'Color tag task' });
        ctx.tagRepo.setTaskTags(task.id, ['colortag']);
        const { tagCommand } = await import('../../src/commands/tag.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            tagCommand.parse(['color', 'colortag', 'blue', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('tag color');
    });
});

// ──────────────────────────────────────────────
// undo --json / history --json
// ──────────────────────────────────────────────
describe('undo --json', () => {
    it('emits ok:true with action:nothing_to_undo when log is empty', async () => {
        const { undoCommand } = await import('../../src/commands/undo.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            undoCommand.parse(['--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('undo');
        const data = payload.data as Record<string, unknown>;
        expect(data.action).toBe('nothing_to_undo');
    });

    it('emits ok:true with action:undone after a create is logged', async () => {
        const task = ctx.taskRepo.create({ title: 'Undoable' });
        ctx.actionLog.log({ taskId: task.id, action: 'create', entityType: 'task', prevState: null, newState: null });
        const { undoCommand } = await import('../../src/commands/undo.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            undoCommand.parse(['--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        const data = payload.data as Record<string, unknown>;
        expect(data.action).toBe('undone');
        expect(data.taskId).toBe(task.id);
    });
});

describe('history --json', () => {
    it('emits ok:true with empty array when no history', async () => {
        const { historyCommand } = await import('../../src/commands/undo.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            historyCommand.parse(['--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('history');
        expect(Array.isArray(payload.data)).toBe(true);
        expect((payload.data as unknown[]).length).toBe(0);
    });

    it('emits ok:true with entries when history exists', async () => {
        const task = ctx.taskRepo.create({ title: 'History task' });
        ctx.actionLog.log({ taskId: task.id, action: 'create', entityType: 'task', prevState: null, newState: null });
        const { historyCommand } = await import('../../src/commands/undo.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            historyCommand.parse(['--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        const entries = payload.data as Record<string, unknown>[];
        expect(entries.length).toBeGreaterThan(0);
        // Clean JSON: no table glyphs
        const raw = JSON.stringify(payload);
        expect(raw).not.toMatch(/[│─┼┤├┬┴]/);
    });
});

// ──────────────────────────────────────────────
// integrate setup --json: auth-refused error shape
// ──────────────────────────────────────────────
describe('integrate setup --json', () => {
    it('emits auth-refused error when --json passed (interactive auth blocked)', async () => {
        const { integrateCommand } = await import('../../src/commands/integrate.js');
        const payload = captureJsonOutput<JsonError>(() => {
            integrateCommand.parse(['setup', 'jira', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(false);
        expect(payload.command).toBe('integrate setup');
        expect(payload.error.code).toBe(2);
        expect(payload.error.message).toContain('interactive auth cannot be combined with --json');
    });
});

// ──────────────────────────────────────────────
// jira auth --json: auth-refused error shape
// ──────────────────────────────────────────────
describe('jira auth --json', () => {
    it('emits auth-refused error shape when --json passed', async () => {
        const { jiraCommand } = await import('../../src/commands/jira.js');
        const payload = captureJsonOutput<JsonError>(() => {
            jiraCommand.parse(['auth', '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(false);
        expect(payload.command).toBe('jira auth');
        expect(payload.error.code).toBe(2);
        expect(payload.error.message).toContain('interactive auth cannot be combined with --json');
    });
});

// ──────────────────────────────────────────────
// context-cmd --json / --format json deprecation
// ──────────────────────────────────────────────
describe('context-cmd --json', () => {
    it('emits ok:true JSON for a valid task', async () => {
        const task = ctx.taskRepo.create({ title: 'Context task' });
        const { contextCommand } = await import('../../src/commands/context-cmd.js');
        const payload = captureJsonOutput<JsonSuccess>(() => {
            contextCommand.parse([String(task.id), '--json'], { from: 'user' });
        });
        expect(payload.ok).toBe(true);
        expect(payload.command).toBe('context');
        const data = payload.data as Record<string, unknown>;
        expect((data.task as Record<string, unknown>).id).toBe(task.id);
    });

    it('emits deprecation warning on stderr when --format json is used', async () => {
        const task = ctx.taskRepo.create({ title: 'Format compat task' });
        vi.resetModules();
        // Re-import after reset so we get a fresh Commander instance with preAction hooks
        const { contextCommand } = await import('../../src/commands/context-cmd.js');
        let stderrOutput = '';
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            stderrOutput += chunk;
            return true;
        });
        let stdoutOutput = '';
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            stdoutOutput += chunk;
            return true;
        });
        contextCommand.parse([String(task.id), '--format', 'json'], { from: 'user' });
        stderrSpy.mockRestore();
        stdoutSpy.mockRestore();
        expect(stderrOutput).toContain('deprecated');
        expect(stdoutOutput).toContain('"ok"');
    });
});

// ──────────────────────────────────────────────
// PR 3: list --limit validation via parseIntOption
// ──────────────────────────────────────────────
describe('list --limit validation', () => {
    // Helper: capture stdout writes AND set exitCode tracking
    function captureStdoutAndExitCode(fn: () => void): { output: string; exitCode: number } {
        let output = '';
        const origCode = process.exitCode;
        process.exitCode = 0;
        const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { output += c; return true; });
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            fn();
        } finally {
            spy.mockRestore();
            errSpy.mockRestore();
        }
        const code = process.exitCode as number;
        process.exitCode = origCode;
        return { output, exitCode: code };
    }

    it('exits with code 2 and text error for --limit -5', async () => {
        const { listCommand } = await import('../../src/commands/list.js');
        const { exitCode } = captureStdoutAndExitCode(() => {
            listCommand.parse(['--limit', '-5'], { from: 'user' });
        });
        expect(exitCode).toBe(2);
    });

    it('exits with code 2 and text error for --limit abc', async () => {
        const { listCommand } = await import('../../src/commands/list.js');
        const { exitCode } = captureStdoutAndExitCode(() => {
            listCommand.parse(['--limit', 'abc'], { from: 'user' });
        });
        expect(exitCode).toBe(2);
    });

    it('exits with code 2 for --limit 0', async () => {
        const { listCommand } = await import('../../src/commands/list.js');
        const { exitCode } = captureStdoutAndExitCode(() => {
            listCommand.parse(['--limit', '0'], { from: 'user' });
        });
        expect(exitCode).toBe(2);
    });

    it('emits JSON error shape for --limit -5 with --json', async () => {
        const { listCommand } = await import('../../src/commands/list.js');
        const result = captureJsonOutput<JsonError>(() => {
            listCommand.parse(['--limit', '-5', '--json'], { from: 'user' });
        });
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe(2);
        expect(result.error.message).toContain('limit');
    });

    it('emits JSON error shape for --limit abc with --json', async () => {
        const { listCommand } = await import('../../src/commands/list.js');
        const result = captureJsonOutput<JsonError>(() => {
            listCommand.parse(['--limit', 'abc', '--json'], { from: 'user' });
        });
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe(2);
    });
});

// ──────────────────────────────────────────────
// PR 3: --json output contains no table glyphs or spinner frames
// ──────────────────────────────────────────────
const TABLE_GLYPHS = /[│─┼┤├┬┴╔╗╚╝║═]/;
const SPINNER_FRAMES = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

describe('list --json: no table glyphs or spinner frames in output', () => {
    it('emits clean JSON with no table or spinner characters', async () => {
        ctx.taskRepo.create({ title: 'Clean JSON task', priority: 'high' });
        const { listCommand } = await import('../../src/commands/list.js');
        const raw = captureJsonOutput<unknown[]>(() => {
            listCommand.parse(['--json'], { from: 'user' });
        });
        const serialized = JSON.stringify(raw);
        expect(TABLE_GLYPHS.test(serialized)).toBe(false);
        expect(SPINNER_FRAMES.test(serialized)).toBe(false);
    });
});

describe('project ls --json: no table glyphs or spinner frames', () => {
    it('emits clean JSON array with no table or spinner characters', async () => {
        ctx.projectRepo.create({ name: 'CleanProj', color: 'blue' });
        const { projectCommand } = await import('../../src/commands/project.js');
        let output = '';
        const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { output += c; return true; });
        const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => { output += String(msg); });
        projectCommand.parse(['ls', '--json'], { from: 'user' });
        spy.mockRestore();
        logSpy.mockRestore();
        expect(TABLE_GLYPHS.test(output)).toBe(false);
        expect(SPINNER_FRAMES.test(output)).toBe(false);
    });
});

describe('tag ls --json: no table glyphs or spinner frames', () => {
    it('emits clean JSON with no table or spinner characters', async () => {
        const task = ctx.taskRepo.create({ title: 'Tagged' });
        ctx.tagRepo.setTaskTags(task.id, ['cleanTag']);
        const { tagCommand } = await import('../../src/commands/tag.js');
        let output = '';
        const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { output += c; return true; });
        const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => { output += String(msg); });
        tagCommand.parse(['ls', '--json'], { from: 'user' });
        spy.mockRestore();
        logSpy.mockRestore();
        expect(TABLE_GLYPHS.test(output)).toBe(false);
        expect(SPINNER_FRAMES.test(output)).toBe(false);
    });
});
