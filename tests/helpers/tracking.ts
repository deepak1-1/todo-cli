// Shared test fixture: insert a tracking session directly via SQL with explicit timestamps.

import type Database from 'better-sqlite3';

export function insertTrackingSession(
    db: Database.Database,
    taskId: number,
    startedAt: string,
    endedAt: string | null,
    duration: number,
    note = ''
): number {
    const result = db.prepare(
        'INSERT INTO time_tracking (task_id, started_at, ended_at, duration, note) VALUES (?, ?, ?, ?, ?)'
    ).run(taskId, startedAt, endedAt, duration, note);
    return Number(result.lastInsertRowid);
}
