import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { format } from 'date-fns';
import { createTestDb } from '../../src/storage/database.js';
import { runMigrations } from '../../src/storage/migrations/runner.js';
import { TrackingRepository } from '../../src/storage/repositories/tracking.repo.js';
import { TaskRepository } from '../../src/storage/repositories/task.repo.js';
import { todayLocal, diffSeconds } from '../../src/utils/date.js';
import { insertTrackingSession } from '../helpers/tracking.js';

let db: Database.Database;
let trackingRepo: TrackingRepository;
let taskRepo: TaskRepository;

// Local binding over the shared fixture so call sites don't have to pass the per-test db.
const insertSession = (taskId: number, startedAt: string, endedAt: string | null, duration: number, note = ''): number =>
    insertTrackingSession(db, taskId, startedAt, endedAt, duration, note);

beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    taskRepo = new TaskRepository(db);
    trackingRepo = new TrackingRepository(db);
});

afterEach(() => {
    db.close();
});

// ----------------------------------------------------------------
// start()
// ----------------------------------------------------------------
describe('TrackingRepository.start', () => {
    it('should create an active session for a task', () => {
        const task = taskRepo.create({ title: 'Work item' });
        const session = trackingRepo.start(task.id);

        expect(session.id).toBe(1);
        expect(session.taskId).toBe(task.id);
        expect(session.endedAt).toBeNull();
        expect(session.duration).toBe(0);
        expect(session.note).toBe('');
    });

    it('should store the note when provided', () => {
        const task = taskRepo.create({ title: 'Noted work' });
        const session = trackingRepo.start(task.id, 'fixing login bug');

        expect(session.note).toBe('fixing login bug');
    });

    it('should throw when the same task is already being tracked', () => {
        const task = taskRepo.create({ title: 'Task 1' });
        trackingRepo.start(task.id);

        expect(() => trackingRepo.start(task.id)).toThrowError(/Timer already running/);
    });

    it('should allow tracking multiple different tasks concurrently', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });
        const t3 = taskRepo.create({ title: 'Task 3' });

        const s1 = trackingRepo.start(t1.id);
        const s2 = trackingRepo.start(t2.id, 'second task');
        const s3 = trackingRepo.start(t3.id);

        expect(s1.taskId).toBe(t1.id);
        expect(s2.taskId).toBe(t2.id);
        expect(s3.taskId).toBe(t3.id);

        const active = trackingRepo.getActiveSessions();
        expect(active).toHaveLength(3);
    });
});

// ----------------------------------------------------------------
// stop()
// ----------------------------------------------------------------
describe('TrackingRepository.stop', () => {
    it('should return null when no active session', () => {
        expect(trackingRepo.stop()).toBeNull();
    });

    it('should stop the only active session when no taskId given', () => {
        const task = taskRepo.create({ title: 'Timed task' });
        trackingRepo.start(task.id);

        const stopped = trackingRepo.stop();

        expect(stopped).not.toBeNull();
        expect(stopped!.endedAt).not.toBeNull();
        expect(stopped!.duration).toBeGreaterThanOrEqual(0);
    });

    it('should stop a specific task when taskId is provided', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });

        trackingRepo.start(t1.id);
        trackingRepo.start(t2.id);

        const stopped = trackingRepo.stop(t1.id);
        expect(stopped).not.toBeNull();
        expect(stopped!.taskId).toBe(t1.id);
        expect(stopped!.endedAt).not.toBeNull();

        // t2 should still be active
        const active = trackingRepo.getActiveSessions();
        expect(active).toHaveLength(1);
        expect(active[0].taskId).toBe(t2.id);
    });

    it('should return null when specified taskId is not being tracked', () => {
        const task = taskRepo.create({ title: 'Not tracked' });
        expect(trackingRepo.stop(task.id)).toBeNull();
    });

    it('should throw when multiple sessions active and no taskId given', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });

        trackingRepo.start(t1.id);
        trackingRepo.start(t2.id);

        expect(() => trackingRepo.stop()).toThrowError(/Multiple active sessions/);
    });

    it('should update the task time_spent column', () => {
        const task = taskRepo.create({ title: 'Accumulate time' });

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
            .toISOString().replace('T', ' ').slice(0, 19);
        insertSession(task.id, fiveMinutesAgo, null, 0);

        const stopped = trackingRepo.stop();
        expect(stopped).not.toBeNull();
        expect(stopped!.duration).toBeGreaterThanOrEqual(0);

        const updatedTask = taskRepo.getById(task.id);
        expect(updatedTask!.timeSpent).toBeGreaterThanOrEqual(0);
    });

    it('should allow starting a new session after stopping', () => {
        const task = taskRepo.create({ title: 'Restart' });
        trackingRepo.start(task.id);
        trackingRepo.stop();

        const newSession = trackingRepo.start(task.id);
        expect(newSession.id).toBe(2);
    });
});

// ----------------------------------------------------------------
// stopAll()
// ----------------------------------------------------------------
describe('TrackingRepository.stopAll', () => {
    it('should return empty array when no active sessions', () => {
        expect(trackingRepo.stopAll()).toEqual([]);
    });

    it('should stop all active sessions and return them', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });
        const t3 = taskRepo.create({ title: 'Task 3' });

        trackingRepo.start(t1.id);
        trackingRepo.start(t2.id);
        trackingRepo.start(t3.id);

        const stopped = trackingRepo.stopAll();
        expect(stopped).toHaveLength(3);
        for (const s of stopped) {
            expect(s.endedAt).not.toBeNull();
        }

        expect(trackingRepo.getActiveSessions()).toHaveLength(0);
    });

    it('should update time_spent for all stopped tasks', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });

        trackingRepo.start(t1.id);
        trackingRepo.start(t2.id);

        trackingRepo.stopAll();

        const updated1 = taskRepo.getById(t1.id);
        const updated2 = taskRepo.getById(t2.id);
        expect(updated1!.timeSpent).toBeGreaterThanOrEqual(0);
        expect(updated2!.timeSpent).toBeGreaterThanOrEqual(0);
    });
});

// ----------------------------------------------------------------
// getActiveForTask()
// ----------------------------------------------------------------
describe('TrackingRepository.getActiveForTask', () => {
    it('should return null when task has no active session', () => {
        const task = taskRepo.create({ title: 'No session' });
        expect(trackingRepo.getActiveForTask(task.id)).toBeNull();
    });

    it('should return the active session for a specific task', () => {
        const task = taskRepo.create({ title: 'Active' });
        trackingRepo.start(task.id, 'working on it');

        const active = trackingRepo.getActiveForTask(task.id);
        expect(active).not.toBeNull();
        expect(active!.taskId).toBe(task.id);
        expect(active!.note).toBe('working on it');
    });

    it('should return null when the task session is completed', () => {
        const task = taskRepo.create({ title: 'Completed' });
        insertSession(task.id, '2026-04-29 10:00:00', '2026-04-29 10:30:00', 1800);

        expect(trackingRepo.getActiveForTask(task.id)).toBeNull();
    });

    it('should not return sessions from other tasks', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });

        trackingRepo.start(t1.id);

        expect(trackingRepo.getActiveForTask(t2.id)).toBeNull();
    });
});

// ----------------------------------------------------------------
// getActiveSessions()
// ----------------------------------------------------------------
describe('TrackingRepository.getActiveSessions', () => {
    it('should return empty array when no active sessions', () => {
        expect(trackingRepo.getActiveSessions()).toEqual([]);
    });

    it('should return all active sessions ordered by started_at', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });
        const t3 = taskRepo.create({ title: 'Task 3' });

        trackingRepo.start(t1.id);
        trackingRepo.start(t2.id);
        trackingRepo.start(t3.id);

        const sessions = trackingRepo.getActiveSessions();
        expect(sessions).toHaveLength(3);
        expect(sessions[0].taskId).toBe(t1.id);
        expect(sessions[1].taskId).toBe(t2.id);
        expect(sessions[2].taskId).toBe(t3.id);
    });

    it('should not include completed sessions', () => {
        const t1 = taskRepo.create({ title: 'Completed' });
        const t2 = taskRepo.create({ title: 'Active' });

        insertSession(t1.id, '2026-04-29 08:00:00', '2026-04-29 08:30:00', 1800);
        trackingRepo.start(t2.id);

        const sessions = trackingRepo.getActiveSessions();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].taskId).toBe(t2.id);
    });
});

// ----------------------------------------------------------------
// getById()
// ----------------------------------------------------------------
describe('TrackingRepository.getById', () => {
    it('should return a session by id', () => {
        const task = taskRepo.create({ title: 'Find me' });
        const id = insertSession(task.id, '2026-04-29 08:00:00', '2026-04-29 08:45:00', 2700, 'coding');

        const session = trackingRepo.getById(id);
        expect(session).not.toBeNull();
        expect(session!.id).toBe(id);
        expect(session!.duration).toBe(2700);
        expect(session!.note).toBe('coding');
    });

    it('should return null for non-existent id', () => {
        expect(trackingRepo.getById(999)).toBeNull();
    });
});

// ----------------------------------------------------------------
// getByTaskId()
// ----------------------------------------------------------------
describe('TrackingRepository.getByTaskId', () => {
    it('should return empty array when task has no sessions', () => {
        const task = taskRepo.create({ title: 'No sessions' });
        expect(trackingRepo.getByTaskId(task.id)).toEqual([]);
    });

    it('should return all sessions for a task ordered by started_at DESC', () => {
        const task = taskRepo.create({ title: 'Multi session' });
        insertSession(task.id, '2026-04-27 10:00:00', '2026-04-27 10:30:00', 1800, 'first');
        insertSession(task.id, '2026-04-28 14:00:00', '2026-04-28 14:45:00', 2700, 'second');
        insertSession(task.id, '2026-04-29 09:00:00', '2026-04-29 09:15:00', 900, 'third');

        const sessions = trackingRepo.getByTaskId(task.id);
        expect(sessions).toHaveLength(3);
        // DESC order — most recent first
        expect(sessions[0].note).toBe('third');
        expect(sessions[2].note).toBe('first');
    });

    it('should not return sessions from other tasks', () => {
        const t1 = taskRepo.create({ title: 'Task A' });
        const t2 = taskRepo.create({ title: 'Task B' });
        insertSession(t1.id, '2026-04-29 10:00:00', '2026-04-29 10:30:00', 1800);
        insertSession(t2.id, '2026-04-29 11:00:00', '2026-04-29 11:30:00', 1800);

        const sessions = trackingRepo.getByTaskId(t1.id);
        expect(sessions).toHaveLength(1);
        expect(sessions[0].taskId).toBe(t1.id);
    });
});

// ----------------------------------------------------------------
// getTotalForTask()
// ----------------------------------------------------------------
describe('TrackingRepository.getTotalForTask', () => {
    it('should return 0 when no sessions exist', () => {
        const task = taskRepo.create({ title: 'Empty' });
        expect(trackingRepo.getTotalForTask(task.id)).toBe(0);
    });

    it('should sum durations of completed sessions', () => {
        const task = taskRepo.create({ title: 'Sum me' });
        insertSession(task.id, '2026-04-28 08:00:00', '2026-04-28 08:30:00', 1800);
        insertSession(task.id, '2026-04-29 09:00:00', '2026-04-29 09:15:00', 900);

        expect(trackingRepo.getTotalForTask(task.id)).toBe(2700);
    });

    it('should ignore active (incomplete) sessions', () => {
        const task = taskRepo.create({ title: 'Active ignored' });
        insertSession(task.id, '2026-04-28 08:00:00', '2026-04-28 08:30:00', 1800);
        insertSession(task.id, '2026-04-29 09:00:00', null, 0); // active

        expect(trackingRepo.getTotalForTask(task.id)).toBe(1800);
    });
});

// ----------------------------------------------------------------
// logManual()
// ----------------------------------------------------------------
describe('TrackingRepository.logManual', () => {
    it('should create a completed session with the given duration', () => {
        const task = taskRepo.create({ title: 'Manual log' });
        const session = trackingRepo.logManual(task.id, 3600, 'retro entry');

        expect(session.duration).toBe(3600);
        expect(session.endedAt).not.toBeNull();
        expect(session.note).toBe('retro entry');
    });

    it('should default note to "manual entry"', () => {
        const task = taskRepo.create({ title: 'No note' });
        const session = trackingRepo.logManual(task.id, 600);

        expect(session.note).toBe('manual entry');
    });

    it('should update the task time_spent', () => {
        const task = taskRepo.create({ title: 'Time update' });
        trackingRepo.logManual(task.id, 1200);

        const updated = taskRepo.getById(task.id);
        expect(updated!.timeSpent).toBe(1200);
    });

    it('should accumulate time_spent across multiple manual logs', () => {
        const task = taskRepo.create({ title: 'Accumulate' });
        trackingRepo.logManual(task.id, 600);
        trackingRepo.logManual(task.id, 900);

        const updated = taskRepo.getById(task.id);
        expect(updated!.timeSpent).toBe(1500);
    });
});

// ----------------------------------------------------------------
// getTaskIdsWorkedInRange()
// ----------------------------------------------------------------
describe('TrackingRepository.getTaskIdsWorkedInRange', () => {
    it('should return task IDs with completed sessions in the date range', () => {
        const t1 = taskRepo.create({ title: 'In range' });
        const t2 = taskRepo.create({ title: 'Out of range' });
        const t3 = taskRepo.create({ title: 'Also in range' });

        insertSession(t1.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800);
        insertSession(t2.id, '2026-04-20 10:00:00', '2026-04-20 10:30:00', 1800);
        insertSession(t3.id, '2026-04-27 14:00:00', '2026-04-27 14:30:00', 1800);

        const ids = trackingRepo.getTaskIdsWorkedInRange('2026-04-24', '2026-04-28');
        expect(ids).toContain(t1.id);
        expect(ids).toContain(t3.id);
        expect(ids).not.toContain(t2.id);
    });

    it('should ignore active sessions', () => {
        const task = taskRepo.create({ title: 'Active in range' });
        insertSession(task.id, '2026-04-26 10:00:00', null, 0); // active

        const ids = trackingRepo.getTaskIdsWorkedInRange('2026-04-24', '2026-04-28');
        expect(ids).toHaveLength(0);
    });

    it('should return empty when no sessions in range', () => {
        const task = taskRepo.create({ title: 'Outside' });
        insertSession(task.id, '2026-03-01 10:00:00', '2026-03-01 10:30:00', 1800);

        const ids = trackingRepo.getTaskIdsWorkedInRange('2026-04-01', '2026-04-30');
        expect(ids).toHaveLength(0);
    });

    it('should return distinct task IDs even with multiple sessions', () => {
        const task = taskRepo.create({ title: 'Repeated' });
        insertSession(task.id, '2026-04-25 08:00:00', '2026-04-25 08:30:00', 1800);
        insertSession(task.id, '2026-04-25 14:00:00', '2026-04-25 14:30:00', 1800);

        const ids = trackingRepo.getTaskIdsWorkedInRange('2026-04-24', '2026-04-28');
        expect(ids).toHaveLength(1);
        expect(ids[0]).toBe(task.id);
    });
});

// ----------------------------------------------------------------
// getWorkedDates()
// ----------------------------------------------------------------
describe('TrackingRepository.getWorkedDates', () => {
    it('should return empty map for empty input', () => {
        const result = trackingRepo.getWorkedDates([]);
        expect(result.size).toBe(0);
    });

    it('should return a map of task IDs to distinct worked dates', () => {
        const t1 = taskRepo.create({ title: 'Task 1' });
        const t2 = taskRepo.create({ title: 'Task 2' });

        insertSession(t1.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800);
        insertSession(t1.id, '2026-04-25 14:00:00', '2026-04-25 14:30:00', 1800); // same date
        insertSession(t1.id, '2026-04-26 09:00:00', '2026-04-26 09:30:00', 1800);
        insertSession(t2.id, '2026-04-27 11:00:00', '2026-04-27 11:45:00', 2700);

        const result = trackingRepo.getWorkedDates([t1.id, t2.id]);

        expect(result.get(t1.id)).toEqual(['2026-04-25', '2026-04-26']);
        expect(result.get(t2.id)).toEqual(['2026-04-27']);
    });

    it('should ignore active sessions', () => {
        const task = taskRepo.create({ title: 'Active' });
        insertSession(task.id, '2026-04-25 10:00:00', null, 0);

        const result = trackingRepo.getWorkedDates([task.id]);
        expect(result.has(task.id)).toBe(false);
    });

    it('should only return data for requested task IDs', () => {
        const t1 = taskRepo.create({ title: 'Requested' });
        const t2 = taskRepo.create({ title: 'Not requested' });
        insertSession(t1.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800);
        insertSession(t2.id, '2026-04-26 10:00:00', '2026-04-26 10:30:00', 1800);

        const result = trackingRepo.getWorkedDates([t1.id]);
        expect(result.has(t1.id)).toBe(true);
        expect(result.has(t2.id)).toBe(false);
    });
});

// ----------------------------------------------------------------
// getTimeReport()
// ----------------------------------------------------------------
describe('TrackingRepository.getTimeReport', () => {
    it('should return empty array when no sessions exist', () => {
        expect(trackingRepo.getTimeReport(7)).toEqual([]);
    });

    it('should group time by task and include task title', () => {
        const t1 = taskRepo.create({ title: 'Backend work' });
        const t2 = taskRepo.create({ title: 'Frontend work' });

        // Noon UTC keeps this session on the same local calendar day for all TZs UTC-12..UTC+11
        const today = todayLocal();
        insertSession(t1.id, `${today} 12:00:00`, `${today} 12:30:00`, 1800);
        insertSession(t1.id, `${today} 14:00:00`, `${today} 14:30:00`, 1800);
        insertSession(t2.id, `${today} 12:00:00`, `${today} 13:00:00`, 3600);

        const report = trackingRepo.getTimeReport(7);
        expect(report).toHaveLength(2);

        // Ordered by totalTime DESC — frontend (3600) first, then backend (3600 total but let's check)
        const backendEntry = report.find(r => r.taskTitle === 'Backend work');
        const frontendEntry = report.find(r => r.taskTitle === 'Frontend work');

        expect(backendEntry).toBeDefined();
        expect(backendEntry!.totalTime).toBe(3600);
        expect(backendEntry!.sessions).toBe(2);

        expect(frontendEntry).toBeDefined();
        expect(frontendEntry!.totalTime).toBe(3600);
        expect(frontendEntry!.sessions).toBe(1);
    });

    it('should respect the day range and exclude older sessions', () => {
        const task = taskRepo.create({ title: 'Old work' });

        // Session from 30 days ago — should be excluded from a 7-day report
        insertSession(task.id, '2026-03-01 10:00:00', '2026-03-01 10:30:00', 1800);

        const report = trackingRepo.getTimeReport(7);
        expect(report).toHaveLength(0);
    });

    it('should ignore active sessions', () => {
        const task = taskRepo.create({ title: 'Active task' });
        // Noon UTC — same local calendar day across all TZs UTC-12..UTC+11
        const today = todayLocal();
        insertSession(task.id, `${today} 12:00:00`, null, 0);

        const report = trackingRepo.getTimeReport(7);
        expect(report).toHaveLength(0);
    });

    it('should include a session whose local date is on the cutoff but whose stored UTC date is one day earlier', () => {
        const task = taskRepo.create({ title: 'Midnight straddle' });

        // Process TZ is pinned to Asia/Kolkata (UTC+5:30). For days=1 the local cutoff is
        // "yesterday". A session at local yesterday 00:30 is stored as UTC two-days-ago 19:00 —
        // the raw UTC string sorts BEFORE the local cutoff date, so the unfixed query drops it.
        const localMidnightYesterday = new Date();
        localMidnightYesterday.setDate(localMidnightYesterday.getDate() - 1);
        localMidnightYesterday.setHours(0, 30, 0, 0);
        const startedAtUtc = localMidnightYesterday.toISOString().slice(0, 19).replace('T', ' ');
        const endedAtUtc = new Date(localMidnightYesterday.getTime() + 15 * 60 * 1000)
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ');
        insertSession(task.id, startedAtUtc, endedAtUtc, 900);

        const report = trackingRepo.getTimeReport(1);
        expect(report).toHaveLength(1);
        expect(report[0].taskTitle).toBe('Midnight straddle');
        expect(report[0].totalTime).toBe(900);
    });

    it('should window by local calendar day at the boundary', () => {
        const onCutoff = taskRepo.create({ title: 'On cutoff' });
        const beforeCutoff = taskRepo.create({ title: 'Before cutoff' });

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 1);
        const cutoffLocal = format(cutoffDate, 'yyyy-MM-dd');

        const beforeDate = new Date();
        beforeDate.setDate(beforeDate.getDate() - 2);
        const beforeLocal = format(beforeDate, 'yyyy-MM-dd');

        insertSession(onCutoff.id, `${cutoffLocal} 12:00:00`, `${cutoffLocal} 12:30:00`, 1800);
        insertSession(beforeCutoff.id, `${beforeLocal} 12:00:00`, `${beforeLocal} 12:30:00`, 1800);

        const report = trackingRepo.getTimeReport(1);
        expect(report).toHaveLength(1);
        expect(report[0].taskTitle).toBe('On cutoff');
    });

    it('should agree with getWorkedDates for the same straddling session', () => {
        const task = taskRepo.create({ title: 'Cross-check task' });

        // Local date is yesterday (on the days=1 cutoff), stored UTC date is one day earlier still.
        const localMidnightYesterday = new Date();
        localMidnightYesterday.setDate(localMidnightYesterday.getDate() - 1);
        localMidnightYesterday.setHours(0, 30, 0, 0);
        const expectedLocalDate = format(localMidnightYesterday, 'yyyy-MM-dd');
        const startedAtUtc = localMidnightYesterday.toISOString().slice(0, 19).replace('T', ' ');
        const endedAtUtc = new Date(localMidnightYesterday.getTime() + 15 * 60 * 1000)
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ');
        insertSession(task.id, startedAtUtc, endedAtUtc, 900);

        const report = trackingRepo.getTimeReport(1);
        const workedDates = trackingRepo.getWorkedDates([task.id]);

        expect(report).toHaveLength(1);
        expect(report[0].taskId).toBe(task.id);
        expect(workedDates.get(task.id)).toEqual([expectedLocalDate]);
    });
});

// ----------------------------------------------------------------
// reduceSession()
// ----------------------------------------------------------------
describe('TrackingRepository.reduceSession', () => {
    it('should return null for a non-existent session', () => {
        expect(trackingRepo.reduceSession(999, 60)).toBeNull();
    });

    it('should throw when trying to reduce an active session', () => {
        const task = taskRepo.create({ title: 'Active reduce' });
        const session = trackingRepo.start(task.id);
        expect(() => trackingRepo.reduceSession(session.id, 10)).toThrowError(/Cannot reduce an active session/);
    });

    it('should reduce duration and adjust ended_at in SQLite format', () => {
        const task = taskRepo.create({ title: 'Reduce me' });
        const id = insertSession(task.id, '2026-04-29 10:00:00', '2026-04-29 10:10:00', 600);

        const updated = trackingRepo.reduceSession(id, 120);
        expect(updated).not.toBeNull();
        expect(updated!.duration).toBe(480);
        // ended_at must match the SQLite timestamp shape
        expect(updated!.endedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('should clamp duration to 0 when reduction exceeds session length', () => {
        const task = taskRepo.create({ title: 'Clamp' });
        const id = insertSession(task.id, '2026-04-29 10:00:00', '2026-04-29 10:01:00', 60);

        const updated = trackingRepo.reduceSession(id, 9999);
        expect(updated!.duration).toBe(0);
    });

    it('should subtract only the actual reduction from task time_spent', () => {
        const task = taskRepo.create({ title: 'Time adjust' });
        // Seed time_spent to 600 via logManual
        trackingRepo.logManual(task.id, 600, 'seed');
        const id = insertSession(task.id, '2026-04-29 10:00:00', '2026-04-29 10:10:00', 600);
        // Manually bump time_spent to account for the raw insert
        db.prepare('UPDATE tasks SET time_spent = time_spent + 600 WHERE id = ?').run(task.id);

        trackingRepo.reduceSession(id, 120); // reduce by 2 minutes
        const updated = taskRepo.getById(task.id);
        // Original 1200 − 120 = 1080
        expect(updated!.timeSpent).toBe(1080);
    });
});

// ----------------------------------------------------------------
// stop() round-trip shape test
// ----------------------------------------------------------------
describe('TrackingRepository stop shape', () => {
    it('should produce a positive duration and SQLite-shaped ended_at after stop()', () => {
        const task = taskRepo.create({ title: 'Shape check' });
        // Insert a session that started 30 seconds ago
        const startedAt = new Date(Date.now() - 30_000).toISOString().replace('T', ' ').slice(0, 19);
        insertSession(task.id, startedAt, null, 0);

        const stopped = trackingRepo.stop(task.id);
        expect(stopped).not.toBeNull();
        expect(stopped!.duration).toBeGreaterThan(0);
        expect(stopped!.endedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('should compute duration identical to diffSeconds(startedAt, endedAt)', () => {
        const task = taskRepo.create({ title: 'diffSeconds parity' });
        // Started exactly 90 seconds in the past, second-truncated like nowSqliteUtc()
        const startedAt = new Date(Date.now() - 90_000).toISOString().replace('T', ' ').slice(0, 19);
        insertSession(task.id, startedAt, null, 0);

        const stopped = trackingRepo.stop(task.id);
        expect(stopped).not.toBeNull();
        expect(stopped!.duration).toBe(diffSeconds(startedAt, stopped!.endedAt!));
        expect(stopped!.duration).toBe(90);
    });
});

// ----------------------------------------------------------------
// getToday()
// ----------------------------------------------------------------
describe('TrackingRepository.getToday', () => {
    it('should return empty array when no sessions today', () => {
        const task = taskRepo.create({ title: 'Yesterday' });
        insertSession(task.id, '2025-01-01 10:00:00', '2025-01-01 10:30:00', 1800);

        expect(trackingRepo.getToday()).toEqual([]);
    });

    it('should return sessions started today', () => {
        const task = taskRepo.create({ title: 'Today task' });
        // Noon UTC — same local calendar day across all TZs UTC-12..UTC+11
        const todayStr = todayLocal();

        insertSession(task.id, `${todayStr} 12:00:00`, `${todayStr} 12:30:00`, 1800, 'morning');
        insertSession(task.id, `${todayStr} 14:00:00`, `${todayStr} 14:15:00`, 900, 'afternoon');

        const sessions = trackingRepo.getToday();
        expect(sessions).toHaveLength(2);
        // DESC order
        expect(sessions[0].note).toBe('afternoon');
        expect(sessions[1].note).toBe('morning');
    });

    it('should include active sessions from today', () => {
        const task = taskRepo.create({ title: 'Active today' });
        // Noon UTC — same local calendar day across all TZs UTC-12..UTC+11
        const todayStr = todayLocal();
        insertSession(task.id, `${todayStr} 12:00:00`, null, 0, 'in progress');

        const sessions = trackingRepo.getToday();
        expect(sessions).toHaveLength(1);
        expect(sessions[0].endedAt).toBeNull();
    });

    it('should not include sessions from other days', () => {
        const task = taskRepo.create({ title: 'Mixed days' });
        // Noon UTC — same local calendar day across all TZs UTC-12..UTC+11
        const todayStr = todayLocal();

        insertSession(task.id, `${todayStr} 12:00:00`, `${todayStr} 12:30:00`, 1800);
        insertSession(task.id, '2025-06-15 10:00:00', '2025-06-15 10:30:00', 1800);

        const sessions = trackingRepo.getToday();
        expect(sessions).toHaveLength(1);
    });
});

// ----------------------------------------------------------------
// getTimeSpentInRange()
// ----------------------------------------------------------------
describe('TrackingRepository.getTimeSpentInRange', () => {
    it('returns empty Map for empty taskIds', () => {
        const result = trackingRepo.getTimeSpentInRange([], '2026-04-01', '2026-04-30');
        expect(result.size).toBe(0);
    });

    it('sums duration per task within the date range', () => {
        const t1 = taskRepo.create({ title: 'Task A' });
        const t2 = taskRepo.create({ title: 'Task B' });
        insertSession(t1.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800);
        insertSession(t1.id, '2026-04-26 14:00:00', '2026-04-26 14:15:00', 900);
        insertSession(t2.id, '2026-04-25 11:00:00', '2026-04-25 11:45:00', 2700);

        const result = trackingRepo.getTimeSpentInRange([t1.id, t2.id], '2026-04-24', '2026-04-28');

        expect(result.get(t1.id)).toBe(2700);
        expect(result.get(t2.id)).toBe(2700);
    });

    it('excludes sessions outside the date range', () => {
        const task = taskRepo.create({ title: 'Mixed dates' });
        insertSession(task.id, '2026-04-20 10:00:00', '2026-04-20 10:30:00', 999);
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800);
        insertSession(task.id, '2026-05-01 10:00:00', '2026-05-01 10:30:00', 999);

        const result = trackingRepo.getTimeSpentInRange([task.id], '2026-04-24', '2026-04-28');

        expect(result.get(task.id)).toBe(1800);
    });

    it('excludes active sessions (ended_at IS NULL)', () => {
        const task = taskRepo.create({ title: 'Active mix' });
        insertSession(task.id, '2026-04-25 10:00:00', null, 0);
        insertSession(task.id, '2026-04-25 14:00:00', '2026-04-25 14:30:00', 600);

        const result = trackingRepo.getTimeSpentInRange([task.id], '2026-04-24', '2026-04-28');

        expect(result.get(task.id)).toBe(600);
    });

    it('does not include tasks not in the input list', () => {
        const t1 = taskRepo.create({ title: 'Wanted' });
        const t2 = taskRepo.create({ title: 'Unwanted' });
        insertSession(t1.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800);
        insertSession(t2.id, '2026-04-25 11:00:00', '2026-04-25 11:30:00', 9999);

        const result = trackingRepo.getTimeSpentInRange([t1.id], '2026-04-24', '2026-04-28');

        expect(result.has(t1.id)).toBe(true);
        expect(result.has(t2.id)).toBe(false);
    });
});

// ----------------------------------------------------------------
// getSessionsInRange()
// ----------------------------------------------------------------
describe('TrackingRepository.getSessionsInRange', () => {
    it('returns empty Map for empty taskIds', () => {
        const result = trackingRepo.getSessionsInRange([], '2026-04-01', '2026-04-30');
        expect(result.size).toBe(0);
    });

    it('groups sessions by task id across multiple tasks', () => {
        const t1 = taskRepo.create({ title: 'Task A' });
        const t2 = taskRepo.create({ title: 'Task B' });
        insertSession(t1.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'a1');
        insertSession(t2.id, '2026-04-26 11:00:00', '2026-04-26 11:45:00', 2700, 'b1');
        insertSession(t1.id, '2026-04-27 09:00:00', '2026-04-27 09:15:00', 900, 'a2');

        const result = trackingRepo.getSessionsInRange([t1.id, t2.id], '2026-04-24', '2026-04-28');

        expect(result.get(t1.id)).toHaveLength(2);
        expect(result.get(t2.id)).toHaveLength(1);
    });

    it('excludes sessions outside the date range', () => {
        const task = taskRepo.create({ title: 'Date boundary' });
        insertSession(task.id, '2026-04-22 10:00:00', '2026-04-22 10:30:00', 1800, 'before');
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'inside');
        insertSession(task.id, '2026-04-30 10:00:00', '2026-04-30 10:30:00', 1800, 'after');

        const result = trackingRepo.getSessionsInRange([task.id], '2026-04-24', '2026-04-28');

        const sessions = result.get(task.id);
        expect(sessions).toHaveLength(1);
        expect(sessions![0].note).toBe('inside');
    });

    it('includes sessions on the boundary dates', () => {
        const task = taskRepo.create({ title: 'Boundary dates' });
        insertSession(task.id, '2026-04-24 10:00:00', '2026-04-24 10:30:00', 1800, 'from-day');
        insertSession(task.id, '2026-04-28 10:00:00', '2026-04-28 10:30:00', 1800, 'to-day');

        const result = trackingRepo.getSessionsInRange([task.id], '2026-04-24', '2026-04-28');

        expect(result.get(task.id)).toHaveLength(2);
    });

    it('excludes active sessions (ended_at IS NULL)', () => {
        const task = taskRepo.create({ title: 'Active mix' });
        insertSession(task.id, '2026-04-25 10:00:00', null, 0, 'running');
        insertSession(task.id, '2026-04-25 14:00:00', '2026-04-25 14:30:00', 1800, 'done');

        const result = trackingRepo.getSessionsInRange([task.id], '2026-04-24', '2026-04-28');

        const sessions = result.get(task.id);
        expect(sessions).toHaveLength(1);
        expect(sessions![0].note).toBe('done');
    });

    it('preserves non-empty note and maps empty note to empty string', () => {
        const task = taskRepo.create({ title: 'Note mapping' });
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'real note');
        insertSession(task.id, '2026-04-26 10:00:00', '2026-04-26 10:30:00', 1800, '');

        const result = trackingRepo.getSessionsInRange([task.id], '2026-04-24', '2026-04-28');

        const sessions = result.get(task.id)!;
        expect(sessions).toHaveLength(2);
        expect(sessions.some(s => s.note === 'real note')).toBe(true);
        expect(sessions.some(s => s.note === '')).toBe(true);
    });

    it('orders sessions ASC by started_at within a task', () => {
        const task = taskRepo.create({ title: 'Order check' });
        insertSession(task.id, '2026-04-27 14:00:00', '2026-04-27 14:30:00', 1800, 'third');
        insertSession(task.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800, 'first');
        insertSession(task.id, '2026-04-26 09:00:00', '2026-04-26 09:30:00', 1800, 'second');

        const result = trackingRepo.getSessionsInRange([task.id], '2026-04-24', '2026-04-28');

        const sessions = result.get(task.id)!;
        expect(sessions[0].note).toBe('first');
        expect(sessions[1].note).toBe('second');
        expect(sessions[2].note).toBe('third');
    });

    it('does not include sessions for tasks not in the input list', () => {
        const t1 = taskRepo.create({ title: 'Wanted' });
        const t2 = taskRepo.create({ title: 'Unwanted' });
        insertSession(t1.id, '2026-04-25 10:00:00', '2026-04-25 10:30:00', 1800);
        insertSession(t2.id, '2026-04-25 11:00:00', '2026-04-25 11:30:00', 1800);

        const result = trackingRepo.getSessionsInRange([t1.id], '2026-04-24', '2026-04-28');

        expect(result.has(t1.id)).toBe(true);
        expect(result.has(t2.id)).toBe(false);
    });

    it('returns empty Map when no sessions fall in the range', () => {
        const task = taskRepo.create({ title: 'Old task' });
        insertSession(task.id, '2026-03-01 10:00:00', '2026-03-01 10:30:00', 1800);

        const result = trackingRepo.getSessionsInRange([task.id], '2026-04-01', '2026-04-30');

        expect(result.size).toBe(0);
    });
});
