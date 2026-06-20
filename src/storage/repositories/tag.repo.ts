// ============================================================
// Tag repository
// ============================================================

import type Database from 'better-sqlite3';
import type { Tag } from '../../core/types.js';
import type { TagRow } from './rows.js';
import { makeMapper } from './mapper.js';

// Maps TagRow columns to Tag domain fields; color defaults to 'cyan' when absent.
const mapRow = makeMapper<TagRow, Tag>({
    id: { col: 'id' },
    name: { col: 'name' },
    color: { col: 'color', transform: (v) => (v as string) || 'cyan' },
});

export class TagRepository {
    constructor(private db: Database.Database) {}

    /** Get or create a tag by name. Trims whitespace; throws if the result is empty. */
    getOrCreate(name: string): Tag {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('Tag name cannot be empty');
        const existing = this.getByName(trimmed);
        if (existing) return existing;

        const result = this.db.prepare('INSERT INTO tags (name) VALUES (?)').run(trimmed);
        return this.getById(Number(result.lastInsertRowid))!;
    }

    getById(id: number): Tag | null {
        const row = this.db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined;
        return row ? mapRow(row) : null;
    }

    getByName(name: string): Tag | null {
        const row = this.db.prepare('SELECT * FROM tags WHERE name = ?').get(name) as TagRow | undefined;
        return row ? mapRow(row) : null;
    }

    list(): Tag[] {
        const rows = this.db.prepare('SELECT * FROM tags ORDER BY name').all() as TagRow[];
        return rows.map(mapRow);
    }

    /** List tags with usage count */
    listWithCounts(): (Tag & { count: number })[] {
        const rows = this.db.prepare(`
            SELECT t.*, COUNT(tt.task_id) as count
            FROM tags t
            LEFT JOIN task_tags tt ON t.id = tt.tag_id
            GROUP BY t.id
            ORDER BY count DESC, t.name
        `).all() as (TagRow & { count: number })[];

        return rows.map((r) => ({ ...mapRow(r), count: r.count as number }));
    }

    rename(oldName: string, newName: string): Tag | null {
        const tag = this.getByName(oldName);
        if (!tag) return null;
        this.db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(newName, tag.id);
        return this.getById(tag.id);
    }

    setColor(name: string, color: string): Tag | null {
        const tag = this.getByName(name);
        if (!tag) return null;
        this.db.prepare('UPDATE tags SET color = ? WHERE id = ?').run(color, tag.id);
        return this.getById(tag.id);
    }

    delete(name: string): boolean {
        const result = this.db.prepare('DELETE FROM tags WHERE name = ?').run(name);
        return result.changes > 0;
    }

    // ---- Task-Tag relations ----

    /** Set tags for a task (replaces all existing) */
    setTaskTags(taskId: number, tagNames: string[]): void {
        const tx = this.db.transaction(() => {
            this.db.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId);
            const insert = this.db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)');
            for (const name of tagNames) {
                const tag = this.getOrCreate(name);
                insert.run(taskId, tag.id);
            }
        });
        tx();
    }

    /** Add tags to a task */
    addTaskTags(taskId: number, tagNames: string[]): void {
        const insert = this.db.prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)');
        const tx = this.db.transaction(() => {
            for (const name of tagNames) {
                const tag = this.getOrCreate(name);
                insert.run(taskId, tag.id);
            }
        });
        tx();
    }

    /** Remove tags from a task */
    removeTaskTags(taskId: number, tagNames: string[]): void {
        const del = this.db.prepare(
            'DELETE FROM task_tags WHERE task_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)',
        );
        const tx = this.db.transaction(() => {
            for (const name of tagNames) {
                del.run(taskId, name);
            }
        });
        tx();
    }

    /** Get tag names for a task */
    getTaskTags(taskId: number): string[] {
        const rows = this.db.prepare(`
            SELECT tg.name FROM task_tags tt
            JOIN tags tg ON tt.tag_id = tg.id
            WHERE tt.task_id = ?
            ORDER BY tg.name
        `).all(taskId) as { name: string }[];
        return rows.map((r) => r.name);
    }
}
