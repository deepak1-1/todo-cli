// ============================================================
// Pomodoro timer repository
// ============================================================

import type Database from 'better-sqlite3';
import type { PomodoroSession } from '../../core/types.js';
import type { PomodoroSessionRow } from './rows.js';
import { makeMapper, boolFromInt, stringOrEmpty } from './mapper.js';

// Maps PomodoroSessionRow columns to PomodoroSession domain fields.
const mapRow = makeMapper<PomodoroSessionRow, PomodoroSession>({
    id: { col: 'id' },
    taskId: { col: 'task_id' },
    startedAt: { col: 'started_at' },
    duration: { col: 'duration' },
    completed: { col: 'completed', transform: boolFromInt },
    notes: { col: 'notes', transform: stringOrEmpty },
});

// Extended row type for JOIN queries that include the task title.
type PomodoroSessionRowWithTitle = PomodoroSessionRow & { task_title: string };

// Maps JOIN rows (base session + task_title) to augmented domain object.
const mapRowWithTitle = makeMapper<PomodoroSessionRowWithTitle, PomodoroSession & { taskTitle: string }>({
    id: { col: 'id' },
    taskId: { col: 'task_id' },
    startedAt: { col: 'started_at' },
    duration: { col: 'duration' },
    completed: { col: 'completed', transform: boolFromInt },
    notes: { col: 'notes', transform: stringOrEmpty },
    taskTitle: { col: 'task_title' },
});

export class TimerRepository {
    constructor(private db: Database.Database) {}

    create(taskId: number, duration: number = 1500): PomodoroSession {
        const result = this.db.prepare(
            'INSERT INTO pomodoro_sessions (task_id, duration) VALUES (?, ?)',
        ).run(taskId, duration);
        return this.getById(Number(result.lastInsertRowid))!;
    }

    getById(id: number): PomodoroSession | null {
        const row = this.db.prepare('SELECT * FROM pomodoro_sessions WHERE id = ?').get(id) as PomodoroSessionRow | undefined;
        return row ? mapRow(row) : null;
    }

    complete(id: number): boolean {
        const result = this.db.prepare(
            'UPDATE pomodoro_sessions SET completed = 1 WHERE id = ?',
        ).run(id);
        return result.changes > 0;
    }

    /** Get sessions for a task */
    getByTaskId(taskId: number): PomodoroSession[] {
        const rows = this.db.prepare(
            'SELECT * FROM pomodoro_sessions WHERE task_id = ? ORDER BY started_at DESC',
        ).all(taskId) as PomodoroSessionRow[];
        return rows.map(mapRow);
    }

    /** Get today's sessions */
    getToday(): (PomodoroSession & { taskTitle: string })[] {
        const rows = this.db.prepare(`
            SELECT ps.*, t.title as task_title
            FROM pomodoro_sessions ps
            JOIN tasks t ON ps.task_id = t.id
            WHERE date(ps.started_at, 'localtime') = date('now', 'localtime')
            ORDER BY ps.started_at
        `).all() as PomodoroSessionRowWithTitle[];

        return rows.map(mapRowWithTitle);
    }

    /** Get sessions for this week */
    getThisWeek(): (PomodoroSession & { taskTitle: string })[] {
        const rows = this.db.prepare(`
            SELECT ps.*, t.title as task_title
            FROM pomodoro_sessions ps
            JOIN tasks t ON ps.task_id = t.id
            WHERE ps.started_at >= date('now', 'localtime', '-7 days')
            ORDER BY ps.started_at
        `).all() as PomodoroSessionRowWithTitle[];

        return rows.map(mapRowWithTitle);
    }

    /** Get time report grouped by task */
    getTimeReport(days: number = 7): { taskId: number; taskTitle: string; totalTime: number; sessions: number }[] {
        return this.db.prepare(`
            SELECT ps.task_id as taskId, t.title as taskTitle,
                   SUM(ps.duration) as totalTime, COUNT(*) as sessions
            FROM pomodoro_sessions ps
            JOIN tasks t ON ps.task_id = t.id
            WHERE ps.started_at >= date('now', 'localtime', '-' || ? || ' days') AND ps.completed = 1
            GROUP BY ps.task_id
            ORDER BY totalTime DESC
        `).all(days) as { taskId: number; taskTitle: string; totalTime: number; sessions: number }[];
    }
}
