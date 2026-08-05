// Status repository — CRUD + validation guards for the statuses table.

import type Database from 'better-sqlite3';
import type { StatusDef } from '../../core/status.js';
import { normalizeStatusInput } from '../../core/status.js';

interface StatusRow {
    key: string;
    label: string;
    icon: string;
    color: string;
    sort_order: number;
    verb: string;
    completes: number;
    archives: number;
    is_builtin: number;
}

function mapRow(row: StatusRow): StatusDef {
    return {
        key: row.key,
        label: row.label,
        icon: row.icon,
        color: row.color,
        sortOrder: row.sort_order,
        verb: row.verb,
        completes: row.completes === 1,
        archives: row.archives === 1,
        isBuiltin: row.is_builtin === 1,
    };
}

export class StatusRepository {
    private cache: StatusDef[] | null = null;

    constructor(private db: Database.Database) {}

    /** Return all statuses ordered by sort_order. Result is memoized for the process lifetime. */
    list(): StatusDef[] {
        if (this.cache) return this.cache;
        const rows = this.db.prepare(
            'SELECT key, label, icon, color, sort_order, verb, completes, archives, is_builtin FROM statuses ORDER BY sort_order ASC',
        ).all() as StatusRow[];
        this.cache = rows.map(mapRow);
        return this.cache;
    }

    /** Invalidate the memo cache (call after any write). */
    private invalidate(): void {
        this.cache = null;
    }

    /** Find by key or verb (hyphen/underscore/case-insensitive). */
    getByKeyOrVerb(input: string): StatusDef | undefined {
        const norm = normalizeStatusInput(input);
        const row = this.db.prepare(
            'SELECT key, label, icon, color, sort_order, verb, completes, archives, is_builtin FROM statuses WHERE key = ? OR verb = ? LIMIT 1',
        ).get(norm, norm) as StatusRow | undefined;
        return row ? mapRow(row) : undefined;
    }

    /** Create a new custom status. Throws on duplicate key or verb. */
    create(input: {
        key: string;
        label: string;
        verb: string;
        icon?: string;
        color?: string;
        sortOrder?: number;
        completes?: boolean;
        archives?: boolean;
    }): StatusDef {
        const maxOrder = (this.db.prepare(
            'SELECT MAX(sort_order) as m FROM statuses',
        ).get() as { m: number | null }).m ?? 0;

        this.db.prepare(`
            INSERT INTO statuses (key, label, icon, color, sort_order, verb, completes, archives, is_builtin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(
            input.key,
            input.label,
            input.icon ?? '○',
            input.color ?? 'white',
            input.sortOrder ?? maxOrder + 1,
            input.verb,
            input.completes ? 1 : 0,
            input.archives ? 1 : 0,
        );
        this.invalidate();
        return this.getByKeyOrVerb(input.key)!;
    }

    /** Update an existing status. Throws if key not found or would violate guards. */
    update(key: string, changes: {
        label?: string;
        verb?: string;
        icon?: string;
        color?: string;
        sortOrder?: number;
        completes?: boolean;
        archives?: boolean;
        newKey?: string;
    }): StatusDef {
        const existing = this.getByKeyOrVerb(key);
        if (!existing) throw new Error(`Status "${key}" not found`);

        // Guard: builtin keys are referenced by fallbacks (reset/undo/timer) and cannot be renamed
        if (changes.newKey !== undefined && changes.newKey !== existing.key && existing.isBuiltin) {
            throw new Error('Cannot rename a builtin status key');
        }

        // Guard: cannot remove the last completes status
        if (changes.completes === false && existing.completes) {
            const completesCount = (this.db.prepare(
                "SELECT COUNT(*) as c FROM statuses WHERE completes = 1",
            ).get() as { c: number }).c;
            if (completesCount <= 1) {
                throw new Error('Cannot remove "completes" from the last completing status');
            }
        }

        const sets: string[] = [];
        const params: unknown[] = [];

        if (changes.newKey !== undefined) { sets.push('key = ?'); params.push(changes.newKey); }
        if (changes.label !== undefined) { sets.push('label = ?'); params.push(changes.label); }
        if (changes.verb !== undefined) { sets.push('verb = ?'); params.push(changes.verb); }
        if (changes.icon !== undefined) { sets.push('icon = ?'); params.push(changes.icon); }
        if (changes.color !== undefined) { sets.push('color = ?'); params.push(changes.color); }
        if (changes.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(changes.sortOrder); }
        if (changes.completes !== undefined) { sets.push('completes = ?'); params.push(changes.completes ? 1 : 0); }
        if (changes.archives !== undefined) { sets.push('archives = ?'); params.push(changes.archives ? 1 : 0); }

        if (sets.length === 0) return existing;
        params.push(key);

        const isRename = changes.newKey !== undefined && changes.newKey !== existing.key;
        const updateStatusStmt = this.db.prepare(`UPDATE statuses SET ${sets.join(', ')} WHERE key = ?`);

        if (isRename) {
            // Rename must remap tasks.status in the same transaction — the FK has no ON UPDATE CASCADE
            const remapTasksStmt = this.db.prepare('UPDATE tasks SET status = ? WHERE status = ?');
            const renameTx = this.db.transaction((newKey: string, oldKey: string) => {
                this.db.pragma('defer_foreign_keys = ON');
                updateStatusStmt.run(...params);
                remapTasksStmt.run(newKey, oldKey);
            });
            renameTx(changes.newKey as string, key);
        } else {
            updateStatusStmt.run(...params);
        }

        this.invalidate();
        return this.getByKeyOrVerb(changes.newKey ?? key)!;
    }

    /** Delete a status. Requires --remap if in use. Refuses to delete builtin or last completes. */
    delete(key: string, remapTo?: string): void {
        const existing = this.getByKeyOrVerb(key);
        if (!existing) throw new Error(`Status "${key}" not found`);
        if (existing.isBuiltin) throw new Error(`Cannot delete builtin status "${key}"`);

        if (existing.completes) {
            const completesCount = (this.db.prepare(
                "SELECT COUNT(*) as c FROM statuses WHERE completes = 1",
            ).get() as { c: number }).c;
            if (completesCount <= 1) throw new Error('Cannot delete the last completing status');
        }

        const inUseCount = (this.db.prepare(
            'SELECT COUNT(*) as c FROM tasks WHERE status = ?',
        ).get(key) as { c: number }).c;

        if (inUseCount > 0) {
            if (!remapTo) {
                throw new Error(
                    `Status "${key}" is used by ${inUseCount} task(s). Provide --remap <key> to reassign them.`,
                );
            }
            const remapTarget = this.getByKeyOrVerb(remapTo);
            if (!remapTarget) throw new Error(`Remap target "${remapTo}" not found`);
            this.db.prepare('UPDATE tasks SET status = ? WHERE status = ?').run(remapTarget.key, key);
        }

        this.db.prepare('DELETE FROM statuses WHERE key = ?').run(key);
        this.invalidate();
    }

    /** Reset to default builtin statuses only (removes custom ones, remaps tasks to "todo"). */
    reset(): void {
        this.db.prepare("UPDATE tasks SET status = 'todo' WHERE status NOT IN (SELECT key FROM statuses WHERE is_builtin = 1)").run();
        this.db.prepare('DELETE FROM statuses WHERE is_builtin = 0').run();
        this.invalidate();
    }
}
