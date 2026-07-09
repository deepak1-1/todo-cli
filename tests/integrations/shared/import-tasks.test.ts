import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../../src/storage/database.js';
import { runMigrations } from '../../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../../src/storage/repositories/project.repo.js';
import { TagRepository } from '../../../src/storage/repositories/tag.repo.js';
import { importRemoteTasks, type MappedTask } from '../../../src/integrations/shared/import-tasks.js';
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

beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    taskRepo = new TaskRepository(db);
    projectRepo = new ProjectRepository(db);
    tagRepo = new TagRepository(db);
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
