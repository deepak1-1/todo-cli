import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../../src/storage/database.js';
import { runMigrations } from '../../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../../src/storage/repositories/project.repo.js';
import { TagRepository } from '../../../src/storage/repositories/tag.repo.js';
import { ActionLogRepository } from '../../../src/storage/repositories/action-log.repo.js';
import { StatusRepository } from '../../../src/storage/repositories/status.repo.js';
import { importRemoteTasks, contentChanges, applyReconcile, type MappedTask } from '../../../src/integrations/shared/import-tasks.js';
import type { ExternalTask, RegisteredPlugin } from '../../../src/plugins/index.js';

function makeIssue(over: Partial<ExternalTask> = {}): ExternalTask {
    return {
        externalId: '1',
        externalRef: 'owner/repo#1',
        externalUrl: 'https://example.test/1',
        title: 'Issue title',
        status: 'open',
        ...over,
    };
}

// Minimal plugin whose mapToLocal echoes the issue with optional extras.
function makePlugin(map: (issue: ExternalTask) => MappedTask): RegisteredPlugin {
    return {
        provider: { mapToLocal: map },
    } as unknown as RegisteredPlugin;
}

let db: Database.Database;
let taskRepo: TaskRepository;
let projectRepo: ProjectRepository;
let tagRepo: TagRepository;
let actionLog: ActionLogRepository;
let statusRepo: StatusRepository;

beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    taskRepo = new TaskRepository(db);
    projectRepo = new ProjectRepository(db);
    tagRepo = new TagRepository(db);
    actionLog = new ActionLogRepository(db);
    statusRepo = new StatusRepository(db);
});

afterEach(() => {
    db.close();
});

describe('importRemoteTasks', () => {
    it('creates a task per new issue and returns the created count', () => {
        const issues = [makeIssue({ externalRef: 'r#1' }), makeIssue({ externalRef: 'r#2' })];
        const result = importRemoteTasks({
            issues,
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            buildInput: (i, m) => ({ title: m.title || i.title, githubRef: i.externalRef }),
        });

        expect(result).toEqual({ created: 2, updated: 0, skipped: 0 });
        expect(taskRepo.findByGithubRef('r#1')).not.toBeNull();
        expect(taskRepo.findByGithubRef('r#2')).not.toBeNull();
    });

    it('skips issues that already exist locally (dedupe via findExisting)', () => {
        taskRepo.create({ title: 'pre-existing', githubRef: 'r#1' });
        const issues = [makeIssue({ externalRef: 'r#1' }), makeIssue({ externalRef: 'r#2' })];

        const result = importRemoteTasks({
            issues,
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            buildInput: (i) => ({ title: i.title, githubRef: i.externalRef }),
        });

        expect(result).toEqual({ created: 1, updated: 0, skipped: 1 });
    });

    it('resolves and caches the project, creating it once per unique name', () => {
        const issues = [
            makeIssue({ externalRef: 'r#1', project: 'Acme' }),
            makeIssue({ externalRef: 'r#2', project: 'Acme' }),
        ];
        let projectIdSeen: number | undefined;

        importRemoteTasks({
            issues,
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            projectName: (i) => i.project,
            projectDescription: () => 'desc',
            buildInput: (i, _m, projectId) => {
                projectIdSeen = projectId;
                return { title: i.title, githubRef: i.externalRef, projectId: projectId ?? null };
            },
        });

        // Only one project row for the two issues sharing the name.
        const acme = projectRepo.list().filter((p) => p.name === 'Acme');
        expect(acme).toHaveLength(1);
        expect(projectIdSeen).toBe(acme[0].id);
    });

    it('passes undefined project id when no projectName is supplied', () => {
        let seen: number | undefined = 999;
        importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            buildInput: (i, _m, projectId) => {
                seen = projectId;
                return { title: i.title, githubRef: i.externalRef };
            },
        });
        expect(seen).toBeUndefined();
    });

    it('runs the onCreated side effect (e.g. tags) for created tasks', () => {
        importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1', labels: ['bug', 'p1'] })],
            plugin: makePlugin((i) => ({ title: i.title, tags: i.labels })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            buildInput: (i) => ({ title: i.title, githubRef: i.externalRef }),
            onCreated: (taskId, _i, mapped) => {
                if (mapped.tags?.length) tagRepo.addTaskTags(taskId, mapped.tags);
            },
        });

        const task = taskRepo.findByGithubRef('r#1');
        expect(task).not.toBeNull();
        expect(tagRepo.getTaskTags(task!.id).sort()).toEqual(['bug', 'p1']);
    });

    it('catches per-issue errors via onError and continues with the rest', () => {
        const errors: string[] = [];
        const result = importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1' }), makeIssue({ externalRef: 'r#2' })],
            plugin: makePlugin((i) => {
                if (i.externalRef === 'r#1') throw new Error('boom');
                return { title: i.title };
            }),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            buildInput: (i) => ({ title: i.title, githubRef: i.externalRef }),
            onError: (i, err) => errors.push(`${i.externalRef}: ${(err as Error).message}`),
        });

        expect(result).toEqual({ created: 1, updated: 0, skipped: 0 });
        expect(errors).toEqual(['r#1: boom']);
        expect(taskRepo.findByGithubRef('r#2')).not.toBeNull();
    });

    it('dry-run counts would-creates without writing tasks or projects', () => {
        const projectsBefore = projectRepo.list().length;
        const result = importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1', project: 'BrandNewProj' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            dryRun: true,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            projectName: (i) => i.project,
            projectDescription: () => 'desc',
            buildInput: (i) => ({ title: i.title, githubRef: i.externalRef }),
        });

        expect(result).toEqual({ created: 1, updated: 0, skipped: 0 });
        // No task and — critically — no project row written during dry-run.
        expect(taskRepo.findByGithubRef('r#1')).toBeNull();
        expect(projectRepo.list().filter((p) => p.name === 'BrandNewProj')).toHaveLength(0);
        expect(projectRepo.list().length).toBe(projectsBefore);
    });

    it('reconcileExisting counts updated vs skipped and runs only for existing tasks', () => {
        taskRepo.create({ title: 'pre-existing', githubRef: 'r#1' });
        const seen: string[] = [];
        const result = importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1' }), makeIssue({ externalRef: 'r#2' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            buildInput: (i) => ({ title: i.title, githubRef: i.externalRef }),
            reconcileExisting: (existing) => {
                seen.push(existing.githubRef!);
                return true; // pretend a write happened
            },
        });

        // r#1 existed → reconciled (updated); r#2 new → created.
        expect(result).toEqual({ created: 1, updated: 1, skipped: 0 });
        expect(seen).toEqual(['r#1']);
    });

    it('reconcileExisting returning false counts as skipped', () => {
        taskRepo.create({ title: 'pre-existing', githubRef: 'r#1' });
        const result = importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            buildInput: (i) => ({ title: i.title, githubRef: i.externalRef }),
            reconcileExisting: () => false,
        });
        expect(result).toEqual({ created: 0, updated: 0, skipped: 1 });
    });

    it('propagates errors when no onError handler is given', () => {
        expect(() =>
            importRemoteTasks({
                issues: [makeIssue({ externalRef: 'r#1' })],
                plugin: makePlugin(() => {
                    throw new Error('boom');
                }),
                taskRepo,
                projectRepo,
                findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
                buildInput: (i) => ({ title: i.title, githubRef: i.externalRef }),
            }),
        ).toThrow('boom');
    });
});

// ──────────────────────────────────────────────
// contentChanges — pure diff of remote content vs local task
// ──────────────────────────────────────────────
describe('contentChanges', () => {
    it('returns only the fields whose remote value differs', () => {
        const existing = taskRepo.create({ title: 'A', description: 'old', priority: 'low' });
        expect(contentChanges(existing, { title: 'B' })).toEqual({ title: 'B' });
        expect(contentChanges(existing, { title: 'A', description: 'old', priority: 'low' })).toEqual({});
    });

    it('never emits status even when the mapped issue carries one', () => {
        const existing = taskRepo.create({ title: 'A' });
        const changes = contentChanges(existing, { title: 'B', status: 'done' });
        expect(changes).toEqual({ title: 'B' });
        expect('status' in changes).toBe(false);
    });

    it('keeps locally-set priority and due date when the remote omits them (!= null guard)', () => {
        const existing = taskRepo.create({ title: 'A', priority: 'high', dueDate: '2026-01-01' });
        // GitHub-style mapped: no dueDate, no priority label.
        expect(contentChanges(existing, { title: 'A', priority: undefined, dueDate: undefined })).toEqual({});
    });
});

// ──────────────────────────────────────────────
// applyReconcile — refresh existing task, preserve status, undoable
// ──────────────────────────────────────────────
describe('applyReconcile', () => {
    const deps = () => ({ taskRepo, tagRepo, actionLog });

    it('refreshes content but never changes local status', () => {
        const existing = taskRepo.create({ title: 'A', description: 'old' });
        taskRepo.update(existing.id, { status: 'in_progress' });
        const before = taskRepo.getById(existing.id)!;

        const changed = applyReconcile(deps(), before, { changes: contentChanges(before, { title: 'B', description: 'new' }), dryRun: false });

        expect(changed).toBe(true);
        const after = taskRepo.getById(existing.id)!;
        expect(after.title).toBe('B');
        expect(after.description).toBe('new');
        expect(after.status).toBe('in_progress'); // core guarantee
        expect(after.lastSyncedAt).not.toBeNull();
    });

    it('is a no-op (returns false, no lastSyncedAt churn) when nothing changed', () => {
        const existing = taskRepo.create({ title: 'A' });
        const before = taskRepo.getById(existing.id)!;
        const changed = applyReconcile(deps(), before, { changes: {}, dryRun: false });
        expect(changed).toBe(false);
        expect(taskRepo.getById(existing.id)!.lastSyncedAt).toBe(before.lastSyncedAt);
    });

    it('dry-run reports a change but writes neither the task nor its tags', () => {
        const existing = taskRepo.create({ title: 'A' });
        tagRepo.setTaskTags(existing.id, ['keep']);
        let printed = false;
        const changed = applyReconcile(deps(), existing, {
            changes: { title: 'B' }, tags: ['newtag'], dryRun: true, onDryRunLine: () => { printed = true; },
        });
        expect(changed).toBe(true);
        expect(printed).toBe(true);
        expect(taskRepo.getById(existing.id)!.title).toBe('A');
        expect(tagRepo.getTaskTags(existing.id)).toEqual(['keep']);
    });

    it('replaces tags and logs an undoable "update" carrying prior values', () => {
        const existing = taskRepo.create({ title: 'A', description: 'old' });
        tagRepo.setTaskTags(existing.id, ['old']);

        applyReconcile(deps(), existing, {
            changes: contentChanges(existing, { title: 'B', description: 'new' }),
            tags: ['a', 'b'],
            dryRun: false,
        });

        expect(tagRepo.getTaskTags(existing.id).sort()).toEqual(['a', 'b']);
        const last = actionLog.getLast()!;
        expect(last.action).toBe('update');
        expect(JSON.parse(last.prevState!)).toEqual({ title: 'A', description: 'old' });
        // Simulate `todo undo`: restoring prevState reverts the content refresh.
        taskRepo.update(existing.id, JSON.parse(last.prevState!));
        expect(taskRepo.getById(existing.id)!.title).toBe('A');
    });

    it('applies status and content together, logging both a status_ and an update action', () => {
        const existing = taskRepo.create({ title: 'A' });
        const other = statusRepo.list().find((d) => d.key !== existing.status)!.key;

        const changed = applyReconcile(deps(), existing, {
            changes: { title: 'B' },
            statusUpdate: { status: other },
            dryRun: false,
        });

        expect(changed).toBe(true);
        const after = taskRepo.getById(existing.id)!;
        expect(after.status).toBe(other);
        expect(after.title).toBe('B');
        const actions = actionLog.getByTaskId(existing.id).map((l) => l.action);
        expect(actions).toContain('update');
        expect(actions.some((a) => a.startsWith('status_'))).toBe(true);
    });
});

// ──────────────────────────────────────────────
// Marker upsert — project description backfill
// ──────────────────────────────────────────────
describe('importRemoteTasks — marker upsert', () => {
    it('writes the description marker when creating a new project', () => {
        importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1', project: 'NewProj' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            projectName: (i) => i.project,
            projectDescription: () => 'GitHub: acme/frontend',
            buildInput: (i, m, projectId) => ({ title: m.title || i.title, projectId: projectId ?? null, githubRef: i.externalRef }),
        });

        const proj = projectRepo.getByName('NewProj');
        expect(proj?.description).toBe('GitHub: acme/frontend');
    });

    it('upserts the marker on a pre-existing project with empty description', () => {
        projectRepo.create({ name: 'ExistingProj', description: '' });

        importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1', project: 'ExistingProj' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            projectName: (i) => i.project,
            projectDescription: () => 'GitHub: acme/frontend',
            buildInput: (i, m, projectId) => ({ title: m.title || i.title, projectId: projectId ?? null, githubRef: i.externalRef }),
        });

        const proj = projectRepo.getByName('ExistingProj');
        expect(proj?.description).toBe('GitHub: acme/frontend');
    });

    it('does NOT overwrite a pre-existing non-empty user description', () => {
        projectRepo.create({ name: 'OldProj', description: 'Some custom description' });

        importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1', project: 'OldProj' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            projectName: (i) => i.project,
            projectDescription: () => 'GitHub: acme/frontend',
            buildInput: (i, m, projectId) => ({ title: m.title || i.title, projectId: projectId ?? null, githubRef: i.externalRef }),
        });

        const proj = projectRepo.getByName('OldProj');
        // Non-empty user description is never overwritten — marker upsert only fills blanks.
        expect(proj?.description).toBe('Some custom description');
    });

    it('does NOT overwrite an existing integration marker description (even if caller differs)', () => {
        projectRepo.create({ name: 'MarkedProj', description: 'GitHub: acme/frontend' });

        importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1', project: 'MarkedProj' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            projectName: (i) => i.project,
            projectDescription: () => 'GitHub: acme/other',
            buildInput: (i, m, projectId) => ({ title: m.title || i.title, projectId: projectId ?? null, githubRef: i.externalRef }),
        });

        const proj = projectRepo.getByName('MarkedProj');
        // Any non-empty description is preserved — marker upsert only fills blanks.
        expect(proj?.description).toBe('GitHub: acme/frontend');
    });

    it('does not overwrite when description exactly matches the marker', () => {
        projectRepo.create({ name: 'SameMarker', description: 'GitHub: acme/frontend' });

        importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1', project: 'SameMarker' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            projectName: (i) => i.project,
            projectDescription: () => 'GitHub: acme/frontend',
            buildInput: (i, m, projectId) => ({ title: m.title || i.title, projectId: projectId ?? null, githubRef: i.externalRef }),
        });

        const proj = projectRepo.getByName('SameMarker');
        expect(proj?.description).toBe('GitHub: acme/frontend');
    });

    it('does not upsert when no projectDescription callback is provided (Jira/other path)', () => {
        projectRepo.create({ name: 'JiraProj', description: '' });

        importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1', project: 'JiraProj' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            projectName: (i) => i.project,
            // No projectDescription provided
            buildInput: (i, m, projectId) => ({ title: m.title || i.title, projectId: projectId ?? null, githubRef: i.externalRef }),
        });

        const proj = projectRepo.getByName('JiraProj');
        expect(proj?.description).toBe('');
    });

    it('Jira: backfills description marker onto pre-existing project with empty description', () => {
        projectRepo.create({ name: 'MyJiraProject', description: '' });

        importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1', project: 'MyJiraProject' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            projectName: (i) => i.project,
            projectDescription: () => 'Jira: MY-PROJECT',
            buildInput: (i, m, projectId) => ({ title: m.title || i.title, projectId: projectId ?? null, githubRef: i.externalRef }),
        });

        const proj = projectRepo.getByName('MyJiraProject');
        expect(proj?.description).toBe('Jira: MY-PROJECT');
    });

    it('does not upsert description during dry-run (project row is never written)', () => {
        // dry-run short-circuits before resolveProjectId, so no project is created and no marker upsert fires
        const result = importRemoteTasks({
            issues: [makeIssue({ externalRef: 'r#1', project: 'DryProj' })],
            plugin: makePlugin((i) => ({ title: i.title })),
            taskRepo,
            projectRepo,
            dryRun: true,
            findExisting: (i) => taskRepo.findByGithubRef(i.externalRef),
            projectName: (i) => i.project,
            projectDescription: () => 'GitHub: acme/frontend',
            buildInput: (i, m, projectId) => ({ title: m.title || i.title, projectId: projectId ?? null, githubRef: i.externalRef }),
        });

        expect(result.created).toBe(1);
        // No project row should exist — dry-run never reached resolveProjectId
        expect(projectRepo.getByName('DryProj')).toBeNull();
    });
});
