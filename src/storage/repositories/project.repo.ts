// ============================================================
// Project repository
// ============================================================

import type Database from 'better-sqlite3';
import type { Project, CreateProjectInput, UpdateProjectInput } from '../../core/types.js';
import type { ProjectRow } from './rows.js';
import { makeMapper, boolFromInt, stringOrEmpty } from './mapper.js';
import { pickNextProjectColor } from '../../utils/project-color.js';

// Maps ProjectRow columns to Project domain fields; color defaults to 'white'.
const mapRow = makeMapper<ProjectRow, Project>({
    id: { col: 'id' },
    name: { col: 'name' },
    description: { col: 'description', transform: stringOrEmpty },
    color: { col: 'color', transform: (v) => (v as string) || 'white' },
    archived: { col: 'archived', transform: boolFromInt },
    createdAt: { col: 'created_at' },
    updatedAt: { col: 'updated_at' },
});

export class ProjectRepository {
    constructor(private db: Database.Database) {}

    create(input: CreateProjectInput): Project {
        if (!input.color) {
            const rows = this.db.prepare(
                "SELECT color FROM projects WHERE color IS NOT NULL AND color != 'white'",
            ).all() as { color: string }[];
            input.color = pickNextProjectColor(rows.map(r => r.color), input.name);
        }
        const stmt = this.db.prepare(
            'INSERT INTO projects (name, description, color) VALUES (?, ?, ?)',
        );
        const result = stmt.run(input.name, input.description || '', input.color);
        return this.getById(Number(result.lastInsertRowid))!;
    }

    getById(id: number): Project | null {
        const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
        return row ? mapRow(row) : null;
    }

    getByName(name: string): Project | null {
        const row = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as ProjectRow | undefined;
        return row ? mapRow(row) : null;
    }

    /** Find project by name, creating it with optional description if absent. */
    getOrCreate(name: string, opts?: { description?: string }): Project {
        return this.getByName(name) ?? this.create({ name, description: opts?.description });
    }

    list(includeArchived = false): Project[] {
        const query = includeArchived
            ? 'SELECT * FROM projects ORDER BY name'
            : 'SELECT * FROM projects WHERE archived = 0 ORDER BY name';
        const rows = this.db.prepare(query).all() as ProjectRow[];
        return rows.map(mapRow);
    }

    update(id: number, input: UpdateProjectInput): Project | null {
        const sets: string[] = [];
        const params: unknown[] = [];

        if (input.name !== undefined) { sets.push('name = ?'); params.push(input.name); }
        if (input.description !== undefined) { sets.push('description = ?'); params.push(input.description); }
        if (input.color !== undefined) { sets.push('color = ?'); params.push(input.color); }

        if (sets.length === 0) return this.getById(id);

        sets.push("updated_at = datetime('now')");
        params.push(id);

        this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        return this.getById(id);
    }

    archive(id: number): boolean {
        const result = this.db.prepare(
            "UPDATE projects SET archived = 1, updated_at = datetime('now') WHERE id = ?",
        ).run(id);
        return result.changes > 0;
    }

    delete(id: number): boolean {
        const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
        return result.changes > 0;
    }

    rename(oldName: string, newName: string): Project | null {
        const project = this.getByName(oldName);
        if (!project) return null;

        // Block rename if newName collides with a different project (case-insensitive)
        const collision = this.getByName(newName);
        if (collision && collision.id !== project.id) {
            throw new Error(`Project "${collision.name}" already exists (names are case-insensitive)`);
        }

        return this.update(project.id, { name: newName });
    }

    /** Get task counts per project */
    getTaskCounts(): { projectId: number; projectName: string; total: number; urgent: number }[] {
        return this.db.prepare(`
            SELECT p.id as projectId, p.name as projectName,
                   COUNT(t.id) as total,
                   SUM(CASE WHEN t.priority = 'urgent' THEN 1 ELSE 0 END) as urgent
            FROM projects p
            LEFT JOIN tasks t ON t.project_id = p.id AND t.status NOT IN (SELECT key FROM statuses WHERE archives = 1)
            WHERE p.archived = 0
            GROUP BY p.id
            ORDER BY p.name
        `).all() as { projectId: number; projectName: string; total: number; urgent: number }[];
    }
}
