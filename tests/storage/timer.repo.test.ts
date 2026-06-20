import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TimerRepository } from '../../src/storage/repositories/timer.repo.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';
import { todayLocal } from '../../src/utils/date.js';

let db: Database.Database;
let timerRepo: TimerRepository;
let taskRepo: TaskRepository;

beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    timerRepo = new TimerRepository(db);
    taskRepo = new TaskRepository(db);
});

describe('TimerRepository', () => {
    describe('create', () => {
        it('should create a pomodoro session with default duration', () => {
            const task = taskRepo.create({ title: 'Test task' });
            const session = timerRepo.create(task.id);

            expect(session.id).toBe(1);
            expect(session.taskId).toBe(task.id);
            expect(session.duration).toBe(1500); // default 25 minutes
            expect(session.completed).toBe(false);
            expect(session.notes).toBe('');
            expect(session.startedAt).toBeTruthy();
        });

        it('should create a session with custom duration', () => {
            const task = taskRepo.create({ title: 'Test task' });
            const session = timerRepo.create(task.id, 900);

            expect(session.duration).toBe(900);
        });

        it('should auto-increment session ids', () => {
            const task = taskRepo.create({ title: 'Test task' });
            const s1 = timerRepo.create(task.id);
            const s2 = timerRepo.create(task.id);

            expect(s2.id).toBe(s1.id + 1);
        });

        it('should create sessions for different tasks', () => {
            const t1 = taskRepo.create({ title: 'Task 1' });
            const t2 = taskRepo.create({ title: 'Task 2' });

            const s1 = timerRepo.create(t1.id);
            const s2 = timerRepo.create(t2.id);

            expect(s1.taskId).toBe(t1.id);
            expect(s2.taskId).toBe(t2.id);
        });
    });

    describe('getById', () => {
        it('should retrieve a session by id', () => {
            const task = taskRepo.create({ title: 'Test task' });
            const created = timerRepo.create(task.id);
            const found = timerRepo.getById(created.id);

            expect(found).not.toBeNull();
            expect(found!.id).toBe(created.id);
            expect(found!.taskId).toBe(task.id);
        });

        it('should return null for non-existent id', () => {
            expect(timerRepo.getById(999)).toBeNull();
        });
    });

    describe('complete', () => {
        it('should mark a session as completed', () => {
            const task = taskRepo.create({ title: 'Test task' });
            const session = timerRepo.create(task.id);

            const result = timerRepo.complete(session.id);
            expect(result).toBe(true);

            const updated = timerRepo.getById(session.id);
            expect(updated!.completed).toBe(true);
        });

        it('should return false for non-existent session', () => {
            const result = timerRepo.complete(999);
            expect(result).toBe(false);
        });

        it('should not affect other sessions when completing one', () => {
            const task = taskRepo.create({ title: 'Test task' });
            const s1 = timerRepo.create(task.id);
            const s2 = timerRepo.create(task.id);

            timerRepo.complete(s1.id);

            expect(timerRepo.getById(s1.id)!.completed).toBe(true);
            expect(timerRepo.getById(s2.id)!.completed).toBe(false);
        });
    });

    describe('getByTaskId', () => {
        it('should return sessions for a specific task', () => {
            const task = taskRepo.create({ title: 'Test task' });
            timerRepo.create(task.id);
            timerRepo.create(task.id);

            const sessions = timerRepo.getByTaskId(task.id);
            expect(sessions).toHaveLength(2);
            sessions.forEach((s) => expect(s.taskId).toBe(task.id));
        });

        it('should not return sessions from other tasks', () => {
            const t1 = taskRepo.create({ title: 'Task 1' });
            const t2 = taskRepo.create({ title: 'Task 2' });

            timerRepo.create(t1.id);
            timerRepo.create(t2.id);
            timerRepo.create(t2.id);

            expect(timerRepo.getByTaskId(t1.id)).toHaveLength(1);
            expect(timerRepo.getByTaskId(t2.id)).toHaveLength(2);
        });

        it('should return empty array for task with no sessions', () => {
            const task = taskRepo.create({ title: 'Test task' });
            expect(timerRepo.getByTaskId(task.id)).toHaveLength(0);
        });

        it('should return sessions ordered by started_at descending', () => {
            const task = taskRepo.create({ title: 'Test task' });

            // Insert sessions with explicit timestamps to control order
            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, datetime('now', '-2 hours'), 1500)",
            ).run(task.id);
            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, datetime('now', '-1 hours'), 1500)",
            ).run(task.id);
            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, datetime('now'), 1500)",
            ).run(task.id);

            const sessions = timerRepo.getByTaskId(task.id);
            expect(sessions).toHaveLength(3);
            // Most recent first (descending)
            expect(sessions[0].startedAt > sessions[1].startedAt).toBe(true);
            expect(sessions[1].startedAt > sessions[2].startedAt).toBe(true);
        });
    });

    describe('getToday', () => {
        it('should return sessions from today with task titles', () => {
            const task = taskRepo.create({ title: 'Today task' });
            timerRepo.create(task.id);

            const today = timerRepo.getToday();
            expect(today).toHaveLength(1);
            expect(today[0].taskTitle).toBe('Today task');
            expect(today[0].taskId).toBe(task.id);
        });

        it('should not return sessions from previous days', () => {
            const task = taskRepo.create({ title: 'Old task' });

            // Insert a session dated yesterday
            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, datetime('now', '-1 day'), 1500)",
            ).run(task.id);

            // Insert a session dated today
            timerRepo.create(task.id);

            const today = timerRepo.getToday();
            expect(today).toHaveLength(1);
        });

        it('should return empty array when no sessions today', () => {
            const task = taskRepo.create({ title: 'Old task' });
            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, datetime('now', '-2 days'), 1500)",
            ).run(task.id);

            expect(timerRepo.getToday()).toHaveLength(0);
        });

        it('should return sessions ordered by started_at ascending', () => {
            const task = taskRepo.create({ title: 'Task' });
            // Use noon-UTC local-date strings so sessions land on today in any TZ UTC-12..UTC+11
            const todayDate = todayLocal();
            db.prepare(
                'INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, ?, 1500)',
            ).run(task.id, `${todayDate} 12:00:00`);
            db.prepare(
                'INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, ?, 1500)',
            ).run(task.id, `${todayDate} 13:00:00`);

            const sessions = timerRepo.getToday();
            expect(sessions).toHaveLength(2);
            // Ascending order
            expect(sessions[0].startedAt <= sessions[1].startedAt).toBe(true);
        });

        it('should include sessions from multiple tasks', () => {
            const t1 = taskRepo.create({ title: 'Task A' });
            const t2 = taskRepo.create({ title: 'Task B' });
            timerRepo.create(t1.id);
            timerRepo.create(t2.id);

            const today = timerRepo.getToday();
            expect(today).toHaveLength(2);
            const titles = today.map((s) => s.taskTitle);
            expect(titles).toContain('Task A');
            expect(titles).toContain('Task B');
        });
    });

    describe('getThisWeek', () => {
        it('should return sessions from the last 7 days', () => {
            const task = taskRepo.create({ title: 'Recent task' });

            // Today
            timerRepo.create(task.id);
            // 3 days ago
            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, datetime('now', '-3 days'), 1500)",
            ).run(task.id);
            // 6 days ago (still within 7 days)
            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, datetime('now', '-6 days'), 1500)",
            ).run(task.id);

            const week = timerRepo.getThisWeek();
            expect(week).toHaveLength(3);
            week.forEach((s) => expect(s.taskTitle).toBe('Recent task'));
        });

        it('should not return sessions older than 7 days', () => {
            const task = taskRepo.create({ title: 'Old task' });

            // 8 days ago
            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, datetime('now', '-8 days'), 1500)",
            ).run(task.id);
            // Today
            timerRepo.create(task.id);

            const week = timerRepo.getThisWeek();
            expect(week).toHaveLength(1);
        });

        it('should return empty array when no sessions this week', () => {
            const task = taskRepo.create({ title: 'Old task' });
            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, datetime('now', '-10 days'), 1500)",
            ).run(task.id);

            expect(timerRepo.getThisWeek()).toHaveLength(0);
        });

        it('should include task titles via join', () => {
            const task = taskRepo.create({ title: 'Weekly task' });
            timerRepo.create(task.id);

            const week = timerRepo.getThisWeek();
            expect(week[0].taskTitle).toBe('Weekly task');
        });

        it('should return sessions ordered by started_at ascending', () => {
            const task = taskRepo.create({ title: 'Task' });

            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration) VALUES (?, datetime('now', '-2 days'), 1500)",
            ).run(task.id);
            timerRepo.create(task.id);

            const week = timerRepo.getThisWeek();
            expect(week).toHaveLength(2);
            expect(week[0].startedAt <= week[1].startedAt).toBe(true);
        });
    });

    describe('getTimeReport', () => {
        it('should group time by task', () => {
            const t1 = taskRepo.create({ title: 'Task A' });
            const t2 = taskRepo.create({ title: 'Task B' });

            const s1 = timerRepo.create(t1.id, 1500);
            timerRepo.complete(s1.id);
            const s2 = timerRepo.create(t1.id, 1500);
            timerRepo.complete(s2.id);
            const s3 = timerRepo.create(t2.id, 900);
            timerRepo.complete(s3.id);

            const report = timerRepo.getTimeReport();
            expect(report).toHaveLength(2);

            const taskA = report.find((r) => r.taskTitle === 'Task A');
            expect(taskA).toBeDefined();
            expect(taskA!.totalTime).toBe(3000);
            expect(taskA!.sessions).toBe(2);

            const taskB = report.find((r) => r.taskTitle === 'Task B');
            expect(taskB).toBeDefined();
            expect(taskB!.totalTime).toBe(900);
            expect(taskB!.sessions).toBe(1);
        });

        it('should only include completed sessions', () => {
            const task = taskRepo.create({ title: 'Task' });

            // Completed session
            const s1 = timerRepo.create(task.id, 1500);
            timerRepo.complete(s1.id);
            // Incomplete session
            timerRepo.create(task.id, 1500);

            const report = timerRepo.getTimeReport();
            expect(report).toHaveLength(1);
            expect(report[0].sessions).toBe(1);
            expect(report[0].totalTime).toBe(1500);
        });

        it('should respect the days parameter', () => {
            const task = taskRepo.create({ title: 'Task' });

            // Session from today
            const s1 = timerRepo.create(task.id, 1500);
            timerRepo.complete(s1.id);

            // Session from 5 days ago
            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration, completed) VALUES (?, datetime('now', '-5 days'), 1500, 1)",
            ).run(task.id);

            // With 3 days, should only get 1 session
            const shortReport = timerRepo.getTimeReport(3);
            expect(shortReport).toHaveLength(1);
            expect(shortReport[0].sessions).toBe(1);

            // With 7 days (default), should get both
            const fullReport = timerRepo.getTimeReport(7);
            expect(fullReport).toHaveLength(1);
            expect(fullReport[0].sessions).toBe(2);
        });

        it('should order by total time descending', () => {
            const t1 = taskRepo.create({ title: 'Short task' });
            const t2 = taskRepo.create({ title: 'Long task' });

            const s1 = timerRepo.create(t1.id, 300);
            timerRepo.complete(s1.id);
            const s2 = timerRepo.create(t2.id, 3000);
            timerRepo.complete(s2.id);

            const report = timerRepo.getTimeReport();
            expect(report[0].taskTitle).toBe('Long task');
            expect(report[1].taskTitle).toBe('Short task');
        });

        it('should return empty array when no completed sessions exist', () => {
            const task = taskRepo.create({ title: 'Task' });
            timerRepo.create(task.id); // not completed

            expect(timerRepo.getTimeReport()).toHaveLength(0);
        });

        it('should use default of 7 days', () => {
            const task = taskRepo.create({ title: 'Task' });

            // Session from 8 days ago (should be excluded by default)
            db.prepare(
                "INSERT INTO pomodoro_sessions (task_id, started_at, duration, completed) VALUES (?, datetime('now', '-8 days'), 1500, 1)",
            ).run(task.id);

            expect(timerRepo.getTimeReport()).toHaveLength(0);
        });

        it('should include task id in report', () => {
            const task = taskRepo.create({ title: 'Task' });
            const s = timerRepo.create(task.id, 1500);
            timerRepo.complete(s.id);

            const report = timerRepo.getTimeReport();
            expect(report[0].taskId).toBe(task.id);
        });
    });
});
