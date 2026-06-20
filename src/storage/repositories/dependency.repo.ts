// ============================================================
// Dependency repository
// ============================================================

import type Database from 'better-sqlite3';

export class DependencyRepository {
    constructor(private db: Database.Database) {}

    /** Add a dependency: taskId depends on dependsOnId */
    add(taskId: number, dependsOnId: number): void {
        this.db.prepare(
            'INSERT OR IGNORE INTO dependencies (task_id, depends_on_id) VALUES (?, ?)',
        ).run(taskId, dependsOnId);
    }

    /** Remove a dependency */
    remove(taskId: number, dependsOnId: number): boolean {
        const result = this.db.prepare(
            'DELETE FROM dependencies WHERE task_id = ? AND depends_on_id = ?',
        ).run(taskId, dependsOnId);
        return result.changes > 0;
    }

    /** Get IDs of tasks that taskId depends on */
    getDependencies(taskId: number): number[] {
        const rows = this.db.prepare(
            'SELECT depends_on_id FROM dependencies WHERE task_id = ?',
        ).all(taskId) as { depends_on_id: number }[];
        return rows.map((r) => r.depends_on_id);
    }

    /** Get IDs of tasks that depend on taskId (dependents/blockers) */
    getDependents(taskId: number): number[] {
        const rows = this.db.prepare(
            'SELECT task_id FROM dependencies WHERE depends_on_id = ?',
        ).all(taskId) as { task_id: number }[];
        return rows.map((r) => r.task_id);
    }

    /** Check if adding a dependency would create a cycle */
    wouldCreateCycle(taskId: number, dependsOnId: number): boolean {
        // BFS from dependsOnId's dependencies to see if we reach taskId
        const visited = new Set<number>();
        const queue = [taskId];

        while (queue.length > 0) {
            const current = queue.shift()!;
            if (current === dependsOnId) return true;
            if (visited.has(current)) continue;
            visited.add(current);

            const deps = this.getDependents(current);
            queue.push(...deps);
        }

        return false;
    }

    /** Check if a task is blocked (has incomplete dependencies) */
    isBlocked(taskId: number): boolean {
        const row = this.db.prepare(`
            SELECT EXISTS(
                SELECT 1 FROM dependencies d
                JOIN tasks t ON d.depends_on_id = t.id
                WHERE d.task_id = ? AND t.status NOT IN ('done', 'archived')
            ) as blocked
        `).get(taskId) as { blocked: number };
        return row.blocked === 1;
    }
}
