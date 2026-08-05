// Tests for TaskRepository.listGithubRepos

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/storage/database.js';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../src/storage/repositories/project.repo.js';
import { resolveProjectRepo } from '../../src/integrations/github/repo-resolution.js';

let db: Database.Database;
let taskRepo: TaskRepository;
let projectRepo: ProjectRepository;

beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    taskRepo = new TaskRepository(db);
    projectRepo = new ProjectRepository(db);
});

afterEach(() => {
    db.close();
});

describe('TaskRepository.listGithubRepos', () => {
    it('returns empty array when no tasks have a github_ref', () => {
        const p = projectRepo.create({ name: 'proj' });
        taskRepo.create({ title: 'no ref', projectId: p.id });
        expect(taskRepo.listGithubRepos(p.id)).toEqual([]);
    });

    it('returns distinct owner/repo prefixes for tasks in the project', () => {
        const p = projectRepo.create({ name: 'proj' });
        taskRepo.create({ title: 't1', githubRef: 'acme/frontend#1', projectId: p.id });
        taskRepo.create({ title: 't2', githubRef: 'acme/frontend#2', projectId: p.id });
        taskRepo.create({ title: 't3', githubRef: 'acme/backend#1', projectId: p.id });
        const repos = taskRepo.listGithubRepos(p.id);
        expect(repos.sort()).toEqual(['acme/backend', 'acme/frontend']);
    });

    it('ignores tasks in other projects', () => {
        const p1 = projectRepo.create({ name: 'proj1' });
        const p2 = projectRepo.create({ name: 'proj2' });
        taskRepo.create({ title: 't1', githubRef: 'acme/frontend#1', projectId: p1.id });
        taskRepo.create({ title: 't2', githubRef: 'other/repo#1', projectId: p2.id });
        expect(taskRepo.listGithubRepos(p1.id)).toEqual(['acme/frontend']);
    });

    it('handles null projectId (project-less tasks)', () => {
        taskRepo.create({ title: 'no project', githubRef: 'acme/standalone#7' });
        const repos = taskRepo.listGithubRepos(null);
        expect(repos).toEqual(['acme/standalone']);
    });

    it('null project query ignores tasks that have a project', () => {
        const p = projectRepo.create({ name: 'proj' });
        taskRepo.create({ title: 'with project', githubRef: 'acme/frontend#1', projectId: p.id });
        taskRepo.create({ title: 'no project', githubRef: 'acme/standalone#1' });
        expect(taskRepo.listGithubRepos(null)).toEqual(['acme/standalone']);
    });

    it('ignores tasks where github_ref is NULL (not null projectId variant)', () => {
        taskRepo.create({ title: 'null ref' });
        expect(taskRepo.listGithubRepos(null)).toEqual([]);
    });

    it('edge: github_ref stored without # is excluded by instr guard', () => {
        // Malformed refs (no '#') must not produce garbage substr output — SQL instr > 0 guard
        const p = projectRepo.create({ name: 'proj' });
        taskRepo.create({ title: 'malformed', githubRef: 'acme/frontend', projectId: p.id });
        taskRepo.create({ title: 'valid', githubRef: 'acme/frontend#5', projectId: p.id });
        expect(taskRepo.listGithubRepos(p.id)).toEqual(['acme/frontend']);
    });

    it('edge: github_ref stored without # is excluded for null-project query', () => {
        taskRepo.create({ title: 'malformed no-proj', githubRef: 'owner/repo' });
        taskRepo.create({ title: 'valid no-proj', githubRef: 'owner/repo#3' });
        expect(taskRepo.listGithubRepos(null)).toEqual(['owner/repo']);
    });
});

// Seam test: listGithubRepos output feeds directly into resolveProjectRepo — this is the pipe that was broken.
describe('listGithubRepos → resolveProjectRepo integration', () => {
    it('resolves the repo when tasks with github_refs exist in the project', () => {
        const p = projectRepo.create({ name: 'myproj' });
        taskRepo.create({ title: 't1', githubRef: 'acme/frontend#1', projectId: p.id });
        taskRepo.create({ title: 't2', githubRef: 'acme/frontend#2', projectId: p.id });
        const repos = taskRepo.listGithubRepos(p.id);
        // repos are bare owner/repo strings — pass directly to resolveProjectRepo
        const result = resolveProjectRepo(repos);
        expect(result).toEqual({ repo: 'acme/frontend' });
    });

    it('returns ambiguous when tasks link to multiple repos', () => {
        const p = projectRepo.create({ name: 'multi' });
        taskRepo.create({ title: 'a', githubRef: 'acme/frontend#1', projectId: p.id });
        taskRepo.create({ title: 'b', githubRef: 'acme/backend#1', projectId: p.id });
        const repos = taskRepo.listGithubRepos(p.id);
        const result = resolveProjectRepo(repos);
        expect('error' in result && result.error).toBe('ambiguous');
    });

    it('returns error:none when project has no linked tasks', () => {
        const p = projectRepo.create({ name: 'empty' });
        const repos = taskRepo.listGithubRepos(p.id);
        const result = resolveProjectRepo(repos);
        expect(result).toEqual({ error: 'none', candidates: [] });
    });
});
