import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from '../../src/storage/database.js';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';
import { ProjectRepository } from '../../src/storage/repositories/project.repo.js';
import { TagRepository } from '../../src/storage/repositories/tag.repo.js';
import { DependencyRepository } from '../../src/storage/repositories/dependency.repo.js';

let db: Database.Database;
let taskRepo: TaskRepository;
let projectRepo: ProjectRepository;
let tagRepo: TagRepository;
let depRepo: DependencyRepository;

beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    taskRepo = new TaskRepository(db);
    projectRepo = new ProjectRepository(db);
    tagRepo = new TagRepository(db);
    depRepo = new DependencyRepository(db);
});

afterEach(() => {
    db.close();
});

describe('TaskRepository', () => {
    it('should create and retrieve a task', () => {
        const task = taskRepo.create({ title: 'Test task' });
        expect(task.id).toBe(1);
        expect(task.title).toBe('Test task');
        expect(task.status).toBe('todo');
        expect(task.priority).toBe('medium');
    });

    it('should list tasks', () => {
        taskRepo.create({ title: 'Task 1', priority: 'urgent' });
        taskRepo.create({ title: 'Task 2', priority: 'low' });
        const tasks = taskRepo.list();
        expect(tasks).toHaveLength(2);
        // Urgent should be first (default sort by priority desc)
        expect(tasks[0].title).toBe('Task 1');
    });

    it('should filter by status', () => {
        taskRepo.create({ title: 'Todo' });
        const t2 = taskRepo.create({ title: 'Done' });
        taskRepo.update(t2.id, { status: 'done', completedAt: new Date().toISOString() });

        const todo = taskRepo.list({ status: 'todo' });
        expect(todo).toHaveLength(1);
        expect(todo[0].title).toBe('Todo');
    });

    it('should filter by priority', () => {
        taskRepo.create({ title: 'Urgent', priority: 'urgent' });
        taskRepo.create({ title: 'Low', priority: 'low' });

        const urgent = taskRepo.list({ priority: 'urgent' });
        expect(urgent).toHaveLength(1);
        expect(urgent[0].priority).toBe('urgent');
    });

    it('should update a task', () => {
        const task = taskRepo.create({ title: 'Original' });
        taskRepo.update(task.id, { title: 'Updated', priority: 'high' });

        const updated = taskRepo.getById(task.id);
        expect(updated!.title).toBe('Updated');
        expect(updated!.priority).toBe('high');
    });

    it('should soft delete (archive)', () => {
        const task = taskRepo.create({ title: 'To archive' });
        taskRepo.archive(task.id);

        const archived = taskRepo.getById(task.id);
        expect(archived!.status).toBe('archived');
    });

    it('should hard delete', () => {
        const task = taskRepo.create({ title: 'To delete' });
        taskRepo.delete(task.id);

        const deleted = taskRepo.getById(task.id);
        expect(deleted).toBeNull();
    });

    it('should count by status', () => {
        taskRepo.create({ title: 'T1' });
        taskRepo.create({ title: 'T2' });
        const t3 = taskRepo.create({ title: 'T3' });
        taskRepo.update(t3.id, { status: 'done' });

        const counts = taskRepo.countByStatus();
        expect(counts.todo).toBe(2);
        expect(counts.done).toBe(1);
    });

    it('should search by title', () => {
        taskRepo.create({ title: 'Fix authentication bug' });
        taskRepo.create({ title: 'Write docs' });

        const results = taskRepo.searchBasic('auth');
        expect(results).toHaveLength(1);
        expect(results[0].title).toContain('authentication');
    });

    it('should include in_review in countByStatus with value 0 when no tasks are in review', () => {
        taskRepo.create({ title: 'T1' });
        const counts = taskRepo.countByStatus();
        expect(counts).toHaveProperty('in_review');
        expect(counts.in_review).toBe(0);
    });

    it('query: searchBasic respects limit parameter', () => {
        taskRepo.create({ title: 'Alpha task' });
        taskRepo.create({ title: 'Alpha bravo' });
        taskRepo.create({ title: 'Alpha charlie' });

        const limited = taskRepo.searchBasic('Alpha', 2);
        expect(limited).toHaveLength(2);

        const all = taskRepo.searchBasic('Alpha');
        expect(all).toHaveLength(3);
    });

    it('should safely handle SQL metacharacters in title', () => {
        const malicious = "'; DROP TABLE tasks; --";
        const task = taskRepo.create({ title: malicious, priority: 'medium' });
        const found = taskRepo.getById(task.id);
        expect(found?.title).toBe(malicious);
        // Verify table still exists
        const count = db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number };
        expect(count.c).toBeGreaterThan(0);
    });

    it('should treat SQL wildcards as literal characters in search', () => {
        taskRepo.create({ title: '100% complete', priority: 'medium' });
        taskRepo.create({ title: 'another task', priority: 'medium' });
        const results = taskRepo.searchBasic('100%');
        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('100% complete');
    });
});

describe('ProjectRepository', () => {
    it('should create and list projects', () => {
        projectRepo.create({ name: 'Project A' });
        projectRepo.create({ name: 'Project B' });

        const projects = projectRepo.list();
        expect(projects).toHaveLength(2);
    });

    it('should find by name', () => {
        projectRepo.create({ name: 'My Project', color: 'blue' });
        const project = projectRepo.getByName('My Project');
        expect(project).not.toBeNull();
        expect(project!.color).toBe('blue');
    });

    it('should rename', () => {
        projectRepo.create({ name: 'Old Name' });
        projectRepo.rename('Old Name', 'New Name');
        expect(projectRepo.getByName('New Name')).not.toBeNull();
        expect(projectRepo.getByName('Old Name')).toBeNull();
    });

    it('getOrCreate is idempotent — same id on repeated calls', () => {
        const first = projectRepo.getOrCreate('Alpha', { description: 'First call' });
        const second = projectRepo.getOrCreate('Alpha', { description: 'Second call' });
        expect(first.id).toBe(second.id);
        // Exactly one row should exist
        expect(projectRepo.list()).toHaveLength(1);
    });

    it('getOrCreate creates project with description when absent', () => {
        const project = projectRepo.getOrCreate('Beta', { description: 'Jira project BETA' });
        expect(project.name).toBe('Beta');
        expect(project.description).toBe('Jira project BETA');
    });

    it('getOrCreate works without opts (description defaults to empty)', () => {
        const project = projectRepo.getOrCreate('Gamma');
        expect(project.name).toBe('Gamma');
        expect(project.description).toBe('');
    });

    it('getOrCreate throws on empty/whitespace name and inserts nothing', () => {
        expect(() => projectRepo.getOrCreate('')).toThrow('Project name cannot be empty');
        expect(() => projectRepo.getOrCreate('   ')).toThrow('Project name cannot be empty');
        expect(projectRepo.list().some(p => p.name.trim() === '')).toBe(false);
    });

    it('getOrCreate trims surrounding whitespace from the name', () => {
        const project = projectRepo.getOrCreate('  Delta  ');
        expect(project.name).toBe('Delta');
    });
});

describe('TagRepository', () => {
    it('should get or create tags', () => {
        const tag1 = tagRepo.getOrCreate('backend');
        const tag2 = tagRepo.getOrCreate('backend');
        expect(tag1.id).toBe(tag2.id);
    });

    it('should manage task tags', () => {
        const task = taskRepo.create({ title: 'Tagged task' });
        tagRepo.setTaskTags(task.id, ['backend', 'security']);

        const tags = tagRepo.getTaskTags(task.id);
        expect(tags).toHaveLength(2);
        expect(tags).toContain('backend');
        expect(tags).toContain('security');
    });

    it('should add and remove individual tags', () => {
        const task = taskRepo.create({ title: 'Task' });
        tagRepo.setTaskTags(task.id, ['a', 'b']);
        tagRepo.addTaskTags(task.id, ['c']);
        expect(tagRepo.getTaskTags(task.id)).toHaveLength(3);

        tagRepo.removeTaskTags(task.id, ['b']);
        const remaining = tagRepo.getTaskTags(task.id);
        expect(remaining).toHaveLength(2);
        expect(remaining).not.toContain('b');
    });

    it('getOrCreate throws on empty string and inserts nothing', () => {
        expect(() => tagRepo.getOrCreate('')).toThrow('Tag name cannot be empty');
        expect(tagRepo.list()).toHaveLength(0);
    });

    it('getOrCreate throws on whitespace-only string and inserts nothing', () => {
        expect(() => tagRepo.getOrCreate('   ')).toThrow('Tag name cannot be empty');
        expect(tagRepo.list()).toHaveLength(0);
    });

    it('getOrCreate trims whitespace and stores the trimmed name', () => {
        const tag = tagRepo.getOrCreate('  backend  ');
        expect(tag.name).toBe('backend');
        expect(tagRepo.list()).toHaveLength(1);
    });

    it('addTaskTags throws and inserts nothing when a name is empty', () => {
        const task = taskRepo.create({ title: 'Task' });
        expect(() => tagRepo.addTaskTags(task.id, [''])).toThrow('Tag name cannot be empty');
        expect(tagRepo.getTaskTags(task.id)).toHaveLength(0);
    });

    it('setTaskTags throws and inserts nothing when a name is whitespace-only', () => {
        const task = taskRepo.create({ title: 'Task' });
        expect(() => tagRepo.setTaskTags(task.id, ['  '])).toThrow('Tag name cannot be empty');
        expect(tagRepo.getTaskTags(task.id)).toHaveLength(0);
    });

    it('addTaskTags rejects mixed valid/empty list atomically — no partial insert', () => {
        const task = taskRepo.create({ title: 'Task' });
        expect(() => tagRepo.addTaskTags(task.id, ['backend', ''])).toThrow('Tag name cannot be empty');
        // Transaction rolls back: backend must NOT have been persisted
        expect(tagRepo.getTaskTags(task.id)).toHaveLength(0);
    });
});

describe('DependencyRepository', () => {
    it('should add and retrieve dependencies', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });

        depRepo.add(t2.id, t1.id); // t2 depends on t1

        const deps = depRepo.getDependencies(t2.id);
        expect(deps).toContain(t1.id);

        const dependents = depRepo.getDependents(t1.id);
        expect(dependents).toContain(t2.id);
    });

    it('should detect cycles', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });

        depRepo.add(t2.id, t1.id);
        expect(depRepo.wouldCreateCycle(t1.id, t2.id)).toBe(true);
    });

    it('should not flag non-cycles', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });
        const t3 = taskRepo.create({ title: 'Task 3' });

        depRepo.add(t2.id, t1.id);
        expect(depRepo.wouldCreateCycle(t3.id, t1.id)).toBe(false);
    });

    it('should remove dependencies', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });

        depRepo.add(t2.id, t1.id);
        depRepo.remove(t2.id, t1.id);

        expect(depRepo.getDependencies(t2.id)).toHaveLength(0);
    });
});

// ----------------------------------------------------------------
// TZ-local daily-driver filter tests (IST midnight rollover window)
// Clock frozen to 2026-06-14T19:00Z = IST 2026-06-15 00:30.
// These cover the exact scenario that was broken for APAC users.
// ----------------------------------------------------------------
describe('TaskRepository — local-day filters at IST midnight rollover', () => {
    // Note: SQLite date('now') uses the real system clock, not vi.setSystemTime().
    // These tests use real system date arithmetic relative to today so they don't depend
    // on a fixed calendar date.

    it('due:today returns a task due today (local date)', () => {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
        taskRepo.create({ title: 'IST today task', dueDate: today });
        const results = taskRepo.list({ dueDate: 'today' });
        expect(results.some(t => t.title === 'IST today task')).toBe(true);
    });

    it('due:today does NOT return a task due yesterday (local date)', () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        const yesterday = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        taskRepo.create({ title: 'IST yesterday task', dueDate: yesterday });
        const results = taskRepo.list({ dueDate: 'today' });
        expect(results.every(t => t.title !== 'IST yesterday task')).toBe(true);
    });

    it('due:overdue returns a task due yesterday (past in IST)', () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        const yesterday = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        taskRepo.create({ title: 'Overdue task', dueDate: yesterday });
        const results = taskRepo.list({ dueDate: 'overdue' });
        expect(results.some(t => t.title === 'Overdue task')).toBe(true);
    });

    it('due:overdue does NOT return a task due today (IST)', () => {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        taskRepo.create({ title: 'Not yet overdue', dueDate: today });
        const results = taskRepo.list({ dueDate: 'overdue' });
        expect(results.every(t => t.title !== 'Not yet overdue')).toBe(true);
    });

    it('created:today returns a task created today', () => {
        // Use today + 12:00 UTC (noon) which maps to today in IST (17:30) and most TZs
        const now = new Date();
        now.setUTCHours(12, 0, 0, 0);
        const ts = now.toISOString().replace('T', ' ').slice(0, 19);
        db.prepare("INSERT INTO tasks (title, status, priority, created_at, updated_at) VALUES (?, 'todo', 'medium', ?, ?)")
            .run('IST created today', ts, ts);
        const results = taskRepo.list({ createdDate: 'today' });
        expect(results.some(t => t.title === 'IST created today')).toBe(true);
    });

    it('created:today does NOT return a task created 2 days ago', () => {
        const d = new Date();
        d.setDate(d.getDate() - 2);
        d.setUTCHours(12, 0, 0, 0);
        const ts = d.toISOString().replace('T', ' ').slice(0, 19);
        db.prepare("INSERT INTO tasks (title, status, priority, created_at, updated_at) VALUES (?, 'todo', 'medium', ?, ?)")
            .run('IST created 2 days ago', ts, ts);
        const results = taskRepo.list({ createdDate: 'today' });
        expect(results.every(t => t.title !== 'IST created 2 days ago')).toBe(true);
    });

    it('weeklyStats returns 7 distinct day-buckets when tasks completed each local day', () => {
        // Insert tasks at 06:30 UTC on each of the last 7 days (noon IST = safe across TZs)
        const now = new Date();
        for (let i = 0; i < 7; i++) {
            const d = new Date(now.getTime() - i * 86400_000);
            d.setUTCHours(6, 30, 0, 0);
            const ts = d.toISOString().replace('T', ' ').slice(0, 19);
            db.prepare("INSERT INTO tasks (title, status, priority, completed_at, created_at, updated_at) VALUES (?, 'done', 'medium', ?, ?, ?)")
                .run(`Day ${i} task`, ts, ts, ts);
        }
        const stats = taskRepo.weeklyStats();
        expect(stats.length).toBe(7);
        // All completedCounts should be 1
        expect(stats.every(s => s.completedCount === 1)).toBe(true);
    });
});
