// ============================================================
// Action log repository — undo support
// ============================================================

import type Database from 'better-sqlite3';
import type { ActionLogEntry } from '../../core/types.js';
import type { ActionLogRow } from './rows.js';
import { makeMapper, nullable } from './mapper.js';

// Maps ActionLogRow columns to ActionLogEntry domain fields.
const mapRow = makeMapper<ActionLogRow, ActionLogEntry>({
    id: { col: 'id' },
    taskId: { col: 'task_id', transform: nullable },
    action: { col: 'action' },
    entityType: { col: 'entity_type' },
    prevState: { col: 'prev_state', transform: nullable },
    newState: { col: 'new_state', transform: nullable },
    timestamp: { col: 'timestamp' },
});

export class ActionLogRepository {
    constructor(private db: Database.Database) {}

    log(entry: Omit<ActionLogEntry, 'id' | 'timestamp'>): ActionLogEntry {
        const result = this.db.prepare(`
            INSERT INTO action_log (task_id, action, entity_type, prev_state, new_state)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            entry.taskId,
            entry.action,
            entry.entityType,
            entry.prevState ?? null,
            entry.newState ?? null,
        );
        return this.getById(Number(result.lastInsertRowid))!;
    }

    getById(id: number): ActionLogEntry | null {
        const row = this.db.prepare('SELECT * FROM action_log WHERE id = ?').get(id) as ActionLogRow | undefined;
        return row ? mapRow(row) : null;
    }

    /** Get the most recent action (for undo) */
    getLast(): ActionLogEntry | null {
        const row = this.db.prepare('SELECT * FROM action_log ORDER BY id DESC LIMIT 1').get() as ActionLogRow | undefined;
        return row ? mapRow(row) : null;
    }

    /** Get recent actions */
    getRecent(limit: number = 20): ActionLogEntry[] {
        const rows = this.db.prepare(
            'SELECT * FROM action_log ORDER BY id DESC LIMIT ?',
        ).all(limit) as ActionLogRow[];
        return rows.map(mapRow);
    }

    /** Get actions for a specific task */
    getByTaskId(taskId: number): ActionLogEntry[] {
        const rows = this.db.prepare(
            'SELECT * FROM action_log WHERE task_id = ? ORDER BY id DESC',
        ).all(taskId) as ActionLogRow[];
        return rows.map(mapRow);
    }

    /** Delete the last action (after undo) */
    deleteLast(): boolean {
        const last = this.getLast();
        if (!last) return false;
        const result = this.db.prepare('DELETE FROM action_log WHERE id = ?').run(last.id);
        return result.changes > 0;
    }
}
