// Backfill project colors for legacy projects created before auto-assignment.
import type Database from 'better-sqlite3';
import { pickNextProjectColor } from '../utils/project-color.js';

/** Assign palette colors to any project whose color is NULL or 'white'. Idempotent. */
export function backfillProjectColors(db: Database.Database): void {
    const count = (db.prepare(
        "SELECT COUNT(*) AS c FROM projects WHERE color IS NULL OR color = 'white'",
    ).get() as { c: number }).c;
    if (count === 0) return;

    const used = (db.prepare(
        "SELECT color FROM projects WHERE color IS NOT NULL AND color != 'white'",
    ).all() as { color: string }[]).map(r => r.color);

    const stale = db.prepare(
        "SELECT id, name FROM projects WHERE color IS NULL OR color = 'white' ORDER BY created_at, id",
    ).all() as { id: number; name: string }[];

    const update = db.prepare('UPDATE projects SET color = ? WHERE id = ?');
    const tx = db.transaction((rows: typeof stale) => {
        for (const row of rows) {
            const hex = pickNextProjectColor(used, row.name);
            update.run(hex, row.id);
            used.push(hex);
        }
    });
    tx(stale);
}
