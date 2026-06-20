import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { up } from '../../src/storage/migrations/001-initial.js';
import { up as trackingMigration } from '../../src/storage/migrations/002-time-tracking.js';
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
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    up(db);
    trackingMigration(db);
    taskRepo = new TaskRepository(db);
    projectRepo = new ProjectRepository(db);
    tagRepo = new TagRepository(db);
    depRepo = new DependencyRepository(db);
});

describe('TaskRepository', () => {
    it('should create and retrieve a task', () => {
        const task = taskRepo.create({ title: 'Test task' });
        expect(task.id).toBe(1);
        expect(task.title).toBe('Test task');
        expect(task.status).toBe('pending');
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
        taskRepo.create({ title: 'Pending' });
        const t2 = taskRepo.create({ title: 'Done' });
        taskRepo.update(t2.id, { status: 'done', completedAt: new Date().toISOString() });

        const pending = taskRepo.list({ status: 'pending' });
        expect(pending).toHaveLength(1);
        expect(pending[0].title).toBe('Pending');
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
        expect(counts.pending).toBe(2);
        expect(counts.done).toBe(1);
    });

    it('should search by title', () => {
        taskRepo.create({ title: 'Fix authentication bug' });
        taskRepo.create({ title: 'Write docs' });

        const results = taskRepo.searchBasic('auth');
        expect(results).toHaveLength(1);
        expect(results[0].title).toContain('authentication');
    });

    it('should include in_qa in countByStatus with value 0 when no tasks are in QA', () => {
        taskRepo.create({ title: 'T1' });
        const counts = taskRepo.countByStatus();
        expect(counts).toHaveProperty('in_qa');
        expect(counts.in_qa).toBe(0);
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
    // 2026-06-14T19:00Z = IST 2026-06-15 00:30 (UTC date is June 14, local date is June 15)
    const FROZEN_UTC = '2026-06-14T19:00:00Z';

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('due:today returns a task due 2026-06-15 when local date is 2026-06-15', () => {
        // due_date stored as plain date string — no TZ conversion needed
        taskRepo.create({ title: 'IST today task', dueDate: '2026-06-15' });
        const results = taskRepo.list({ dueDate: 'today' });
        expect(results.some(t => t.title === 'IST today task')).toBe(true);
    });

    it('due:today does NOT return a task due 2026-06-14 (yesterday in IST)', () => {
        taskRepo.create({ title: 'IST yesterday task', dueDate: '2026-06-14' });
        const results = taskRepo.list({ dueDate: 'today' });
        expect(results.every(t => t.title !== 'IST yesterday task')).toBe(true);
    });

    it('due:overdue returns a task due 2026-06-14 (past in IST) during rollover window', () => {
        taskRepo.create({ title: 'Overdue task', dueDate: '2026-06-14' });
        const results = taskRepo.list({ dueDate: 'overdue' });
        expect(results.some(t => t.title === 'Overdue task')).toBe(true);
    });

    it('due:overdue does NOT return a task due 2026-06-15 (today in IST)', () => {
        taskRepo.create({ title: 'Not yet overdue', dueDate: '2026-06-15' });
        const results = taskRepo.list({ dueDate: 'overdue' });
        expect(results.every(t => t.title !== 'Not yet overdue')).toBe(true);
    });

    it('created:today returns a task created at 2026-06-14 20:30 UTC (= IST 02:00 June 15)', () => {
        // Insert directly with a UTC timestamp that is after local midnight
        db.prepare("INSERT INTO tasks (title, status, priority, created_at, updated_at) VALUES (?, 'pending', 'medium', ?, ?)")
            .run('IST created today', '2026-06-14 20:30:00', '2026-06-14 20:30:00');
        const results = taskRepo.list({ createdDate: 'today' });
        expect(results.some(t => t.title === 'IST created today')).toBe(true);
    });

    it('created:today does NOT return a task created at 2026-06-14 18:00 UTC (= IST June 14 23:30)', () => {
        // That UTC time is before IST midnight so it belongs to the previous local day
        db.prepare("INSERT INTO tasks (title, status, priority, created_at, updated_at) VALUES (?, 'pending', 'medium', ?, ?)")
            .run('IST created yesterday', '2026-06-14 18:00:00', '2026-06-14 18:00:00');
        const results = taskRepo.list({ createdDate: 'today' });
        expect(results.every(t => t.title !== 'IST created yesterday')).toBe(true);
    });

    it('weeklyStats returns 7 distinct day-buckets when tasks completed each local day', () => {
        // Complete a task for each of the 7 local days ending today (IST June 15)
        for (let i = 0; i < 7; i++) {
            const d = new Date(new Date(FROZEN_UTC).getTime() - i * 86400_000);
            // 06:30 UTC = 12:00 IST — same local day in all TZs UTC-12..UTC+11
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
