// ============================================================
// Time tracking repository — stopwatch-style work sessions
// ============================================================

import type Database from 'better-sqlite3';
import type { TrackingSessionRow } from './rows.js';
import { makeMapper, nullable, stringOrEmpty } from './mapper.js';
import { nowSqliteUtc, sqliteUtcFromDate, parseSqliteUtc } from '../../utils/date.js';

export interface TrackingSession {
    id: number;
    taskId: number;
    startedAt: string;
    endedAt: string | null;
    duration: number; // seconds
    note: string;
}

// Maps TrackingSessionRow columns to TrackingSession domain fields.
const mapRow = makeMapper<TrackingSessionRow, TrackingSession>({
    id: { col: 'id' },
    taskId: { col: 'task_id' },
    startedAt: { col: 'started_at' },
    endedAt: { col: 'ended_at', transform: nullable },
    duration: { col: 'duration' },
    note: { col: 'note', transform: stringOrEmpty },
});

export class TrackingRepository {
    constructor(private db: Database.Database) {}

    /** Start tracking time on a task. Returns the new session. */
    start(taskId: number, note?: string): TrackingSession {
        // Prevent double-tracking the same task
        const existing = this.getActiveForTask(taskId);
        if (existing) {
            throw new Error(`Timer already running for task #${taskId} since ${existing.startedAt}.`);
        }

        const result = this.db.prepare(
            'INSERT INTO time_tracking (task_id, note) VALUES (?, ?)'
        ).run(taskId, note || '');

        return this.getById(Number(result.lastInsertRowid))!;
    }

    /** Stop a tracking session. If taskId given, stops that task. Otherwise stops the only active session. */
    stop(taskId?: number): TrackingSession | null {
        let active: TrackingSession | null;

        if (taskId !== undefined) {
            active = this.getActiveForTask(taskId);
        } else {
            const allActive = this.getActiveSessions();
            if (allActive.length === 0) return null;
            if (allActive.length > 1) {
                const ids = allActive.map(s => `#${s.taskId}`).join(', ');
                throw new Error(
                    `Multiple active sessions (${ids}). Specify a task ID to stop, or use "todo timer stop --all".`
                );
            }
            active = allActive[0];
        }

        if (!active) return null;

        const now = nowSqliteUtc();
        const startTime = parseSqliteUtc(active.startedAt).getTime();
        const endTime = parseSqliteUtc(now).getTime();
        const duration = Math.round((endTime - startTime) / 1000);

        this.db.prepare(
            'UPDATE time_tracking SET ended_at = ?, duration = ? WHERE id = ?'
        ).run(now, duration, active.id);

        // Also update the task's time_spent
        this.db.prepare(
            'UPDATE tasks SET time_spent = time_spent + ? WHERE id = ?'
        ).run(duration, active.taskId);

        return this.getById(active.id)!;
    }

    /** Stop all active tracking sessions. */
    stopAll(): TrackingSession[] {
        const allActive = this.getActiveSessions();
        const stopped: TrackingSession[] = [];
        for (const session of allActive) {
            const result = this.stop(session.taskId);
            if (result) stopped.push(result);
        }
        return stopped;
    }

    /** Get the active session for a specific task */
    getActiveForTask(taskId: number): TrackingSession | null {
        const row = this.db.prepare(
            'SELECT * FROM time_tracking WHERE task_id = ? AND ended_at IS NULL LIMIT 1'
        ).get(taskId) as TrackingSessionRow | undefined;

        return row ? mapRow(row) : null;
    }

    /** Get all active (running) sessions */
    getActiveSessions(): TrackingSession[] {
        const rows = this.db.prepare(
            'SELECT * FROM time_tracking WHERE ended_at IS NULL ORDER BY started_at ASC'
        ).all() as TrackingSessionRow[];

        return rows.map(mapRow);
    }

    /** Get the first active session (for backward compatibility) */
    getActive(): TrackingSession | null {
        const row = this.db.prepare(
            'SELECT * FROM time_tracking WHERE ended_at IS NULL LIMIT 1'
        ).get() as TrackingSessionRow | undefined;

        return row ? mapRow(row) : null;
    }

    /** Get a session by ID */
    getById(id: number): TrackingSession | null {
        const row = this.db.prepare(
            'SELECT * FROM time_tracking WHERE id = ?'
        ).get(id) as TrackingSessionRow | undefined;

        return row ? mapRow(row) : null;
    }

    /** Get all sessions for a task */
    getByTaskId(taskId: number): TrackingSession[] {
        const rows = this.db.prepare(
            'SELECT * FROM time_tracking WHERE task_id = ? ORDER BY started_at DESC'
        ).all(taskId) as TrackingSessionRow[];

        return rows.map(mapRow);
    }

    /** Get total tracked time for a task (in seconds) */
    getTotalForTask(taskId: number): number {
        const row = this.db.prepare(
            'SELECT COALESCE(SUM(duration), 0) as total FROM time_tracking WHERE task_id = ? AND ended_at IS NOT NULL'
        ).get(taskId) as { total: number };

        return row.total;
    }

    /** Log a manual time entry */
    logManual(taskId: number, durationSeconds: number, note?: string): TrackingSession {
        const now = nowSqliteUtc();
        const startDate = new Date(Date.now() - durationSeconds * 1000);
        const startedAt = sqliteUtcFromDate(startDate);

        const result = this.db.prepare(
            'INSERT INTO time_tracking (task_id, started_at, ended_at, duration, note) VALUES (?, ?, ?, ?, ?)'
        ).run(taskId, startedAt, now, durationSeconds, note || 'manual entry');

        // Update task time_spent
        this.db.prepare(
            'UPDATE tasks SET time_spent = time_spent + ? WHERE id = ?'
        ).run(durationSeconds, taskId);

        return this.getById(Number(result.lastInsertRowid))!;
    }

    /** Get time report grouped by task for the last N days */
    getTimeReport(days: number = 7): { taskId: number; taskTitle: string; totalTime: number; sessions: number }[] {
        return this.db.prepare(`
            SELECT tt.task_id as taskId, t.title as taskTitle,
                   SUM(tt.duration) as totalTime, COUNT(*) as sessions
            FROM time_tracking tt
            JOIN tasks t ON tt.task_id = t.id
            WHERE tt.started_at >= date('now', 'localtime', '-' || ? || ' days') AND tt.ended_at IS NOT NULL
            GROUP BY tt.task_id
            ORDER BY totalTime DESC
        `).all(days) as { taskId: number; taskTitle: string; totalTime: number; sessions: number }[];
    }

    /** Get task IDs that have tracking sessions within a date range */
    getTaskIdsWorkedInRange(from: string, to: string): number[] {
        const rows = this.db.prepare(`
            SELECT DISTINCT task_id
            FROM time_tracking
            WHERE date(started_at, 'localtime') >= ? AND date(started_at, 'localtime') <= ? AND ended_at IS NOT NULL
        `).all(from, to) as { task_id: number }[];

        return rows.map(r => r.task_id);
    }

    /** Get distinct worked-on dates for multiple tasks, optionally filtered to a date range */
    getWorkedDates(taskIds: number[], from?: string, to?: string): Map<number, string[]> {
        if (taskIds.length === 0) return new Map();

        const placeholders = taskIds.map(() => '?').join(',');
        const rangeClause = from && to ? `AND date(started_at, 'localtime') >= ? AND date(started_at, 'localtime') <= ?` : '';
        const params: unknown[] = [...taskIds, ...(from && to ? [from, to] : [])];

        const rows = this.db.prepare(`
            SELECT task_id, date(started_at, 'localtime') as work_date
            FROM time_tracking
            WHERE task_id IN (${placeholders}) AND ended_at IS NOT NULL ${rangeClause}
            GROUP BY task_id, date(started_at, 'localtime')
            ORDER BY task_id, work_date
        `).all(...params) as { task_id: number; work_date: string }[];

        const result = new Map<number, string[]>();
        for (const row of rows) {
            const dates = result.get(row.task_id) || [];
            dates.push(row.work_date);
            result.set(row.task_id, dates);
        }
        return result;
    }

    /** Get time spent per task within a date range (in seconds) */
    getTimeSpentInRange(taskIds: number[], from: string, to: string): Map<number, number> {
        if (taskIds.length === 0) return new Map();

        const placeholders = taskIds.map(() => '?').join(',');
        const rows = this.db.prepare(`
            SELECT task_id, COALESCE(SUM(duration), 0) as total
            FROM time_tracking
            WHERE task_id IN (${placeholders}) AND ended_at IS NOT NULL
              AND date(started_at, 'localtime') >= ? AND date(started_at, 'localtime') <= ?
            GROUP BY task_id
        `).all(...taskIds, from, to) as { task_id: number; total: number }[];

        const result = new Map<number, number>();
        for (const row of rows) {
            result.set(row.task_id, row.total);
        }
        return result;
    }

    /** Reduce duration of a specific session by the given seconds. Adjusts ended_at accordingly. */
    reduceSession(sessionId: number, reduceBySeconds: number): TrackingSession | null {
        const session = this.getById(sessionId);
        if (!session) return null;
        if (!session.endedAt) throw new Error('Cannot reduce an active session. Stop it first.');

        const newDuration = Math.max(0, session.duration - reduceBySeconds);
        const actualReduction = session.duration - newDuration;

        // Compute new ended_at by moving it earlier by the actual reduction
        const startTime = parseSqliteUtc(session.startedAt).getTime();
        const newEndTime = new Date(startTime + newDuration * 1000);
        const newEndedAt = sqliteUtcFromDate(newEndTime);

        // Update session duration and ended_at
        this.db.prepare(
            'UPDATE time_tracking SET duration = ?, ended_at = ? WHERE id = ?'
        ).run(newDuration, newEndedAt, sessionId);

        // Reduce task time_spent accordingly
        this.db.prepare(
            'UPDATE tasks SET time_spent = MAX(0, time_spent - ?) WHERE id = ?'
        ).run(actualReduction, session.taskId);

        return this.getById(sessionId)!;
    }

    /** Delete a specific tracking session by ID and subtract its duration from the task */
    deleteSession(sessionId: number): TrackingSession | null {
        const session = this.getById(sessionId);
        if (!session) return null;

        // Only subtract positive durations from task time_spent
        if (session.duration > 0) {
            this.db.prepare(
                'UPDATE tasks SET time_spent = MAX(0, time_spent - ?) WHERE id = ?'
            ).run(session.duration, session.taskId);
        }

        this.db.prepare('DELETE FROM time_tracking WHERE id = ?').run(sessionId);
        return session;
    }

    /** Get today's tracking sessions */
    getToday(): TrackingSession[] {
        const rows = this.db.prepare(
            "SELECT * FROM time_tracking WHERE date(started_at, 'localtime') = date('now', 'localtime') ORDER BY started_at DESC"
        ).all() as TrackingSessionRow[];

        return rows.map(mapRow);
    }
}
