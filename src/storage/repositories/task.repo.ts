// ============================================================
// Task repository — all task CRUD and queries
// ============================================================

import type Database from 'better-sqlite3';
import type {
    Task,
    TaskWithRelations,
    CreateTaskInput,
    TaskFilters,
    TaskSort,
} from '../../core/types.js';
import type { TaskRow, TaskRowWithRelations } from './rows.js';
import { makeMapper, nullable, stringOrEmpty, boolFromInt, csvToArray } from './mapper.js';

// Maps TaskRow columns to Task domain fields.
const mapRow = makeMapper<TaskRow, Task>({
    id: { col: 'id' },
    title: { col: 'title' },
    description: { col: 'description', transform: stringOrEmpty },
    status: { col: 'status', transform: (v) => v as Task['status'] },
    priority: { col: 'priority', transform: (v) => v as Task['priority'] },
    projectId: { col: 'project_id', transform: nullable },
    dueDate: { col: 'due_date', transform: nullable },
    recurrence: { col: 'recurrence', transform: (v) => (v as Task['recurrence']) ?? null },
    timeSpent: { col: 'time_spent', transform: (v) => (v as number) || 0 },
    jiraKey: { col: 'jira_key', transform: nullable },
    jiraId: { col: 'jira_id', transform: nullable },
    githubRef: { col: 'github_ref', transform: nullable },
    syncHash: { col: 'sync_hash', transform: nullable },
    lastSyncedAt: { col: 'last_synced_at', transform: nullable },
    createdAt: { col: 'created_at' },
    updatedAt: { col: 'updated_at' },
    completedAt: { col: 'completed_at', transform: nullable },
    archivedAt: { col: 'archived_at', transform: nullable },
    parentId: { col: 'parent_id', transform: nullable },
});

// Maps TaskRowWithRelations columns to TaskWithRelations; reuses Task fields + JOIN fields.
const mapRowWithRelations = makeMapper<TaskRowWithRelations, TaskWithRelations>({
    id: { col: 'id' },
    title: { col: 'title' },
    description: { col: 'description', transform: stringOrEmpty },
    status: { col: 'status', transform: (v) => v as Task['status'] },
    priority: { col: 'priority', transform: (v) => v as Task['priority'] },
    projectId: { col: 'project_id', transform: nullable },
    dueDate: { col: 'due_date', transform: nullable },
    recurrence: { col: 'recurrence', transform: (v) => (v as Task['recurrence']) ?? null },
    timeSpent: { col: 'time_spent', transform: (v) => (v as number) || 0 },
    jiraKey: { col: 'jira_key', transform: nullable },
    jiraId: { col: 'jira_id', transform: nullable },
    githubRef: { col: 'github_ref', transform: nullable },
    syncHash: { col: 'sync_hash', transform: nullable },
    lastSyncedAt: { col: 'last_synced_at', transform: nullable },
    createdAt: { col: 'created_at' },
    updatedAt: { col: 'updated_at' },
    completedAt: { col: 'completed_at', transform: nullable },
    archivedAt: { col: 'archived_at', transform: nullable },
    parentId: { col: 'parent_id', transform: nullable },
    projectName: { col: 'project_name', transform: nullable },
    projectColor: { col: 'project_color', transform: nullable },
    tagNames: { col: 'tag_names', transform: csvToArray },
    isBlocked: { col: 'is_blocked', transform: boolFromInt },
});

// SQL mirror of PRIORITY_ORDER in core/types.ts — keep the two in sync (source of truth: PRIORITY_ORDER).
const PRIORITY_SORT_EXPR = `CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 END`;
const DEFAULT_ORDER = `ORDER BY ${PRIORITY_SORT_EXPR} DESC, t.due_date ASC NULLS LAST`;

export class TaskRepository {
    constructor(private db: Database.Database) {}

    /** Find tasks by jiraKey */
    findByJiraKey(jiraKey: string): Task | null {
        const row = this.db.prepare('SELECT * FROM tasks WHERE jira_key = ? LIMIT 1').get(jiraKey) as TaskRow | undefined;
        return row ? mapRow(row) : null;
    }

    /** Find task by githubRef (e.g. owner/repo#123) */
    findByGithubRef(githubRef: string): Task | null {
        const row = this.db.prepare('SELECT * FROM tasks WHERE github_ref = ? LIMIT 1').get(githubRef) as TaskRow | undefined;
        return row ? mapRow(row) : null;
    }

    /**
     * List distinct owner/repo prefixes from github_ref for tasks in a project.
     * Relies on the owner/repo#N shape contract established by ref.ts.
     * Pass null for project_id to query project-less tasks.
     */
    listGithubRepos(projectId: number | null): string[] {
        const sql = projectId === null
            ? `SELECT DISTINCT substr(github_ref, 1, instr(github_ref, '#') - 1) AS repo
               FROM tasks WHERE github_ref IS NOT NULL AND project_id IS NULL AND instr(github_ref, '#') > 0`
            : `SELECT DISTINCT substr(github_ref, 1, instr(github_ref, '#') - 1) AS repo
               FROM tasks WHERE github_ref IS NOT NULL AND project_id = ? AND instr(github_ref, '#') > 0`;
        const rows = projectId === null
            ? this.db.prepare(sql).all() as { repo: string }[]
            : this.db.prepare(sql).all(projectId) as { repo: string }[];
        return rows.map(r => r.repo).filter(Boolean);
    }

    /** Create a new task, returns the created task */
    create(input: CreateTaskInput & {
        jiraKey?: string; jiraId?: string; githubRef?: string;
        syncHash?: string; lastSyncedAt?: string;
        status?: string;
    }): Task {
        // Ensure all values are SQLite-bindable (string, number, buffer, or null)
        const safe = (v: unknown): string | number | null => {
            if (v === undefined || v === null) return null;
            if (typeof v === 'string') return v;
            if (typeof v === 'number') return v;
            if (typeof v === 'object') return JSON.stringify(v);
            return String(v);
        };

        const statusKey = (safe(input.status) as string | null) || 'todo';

        // Stamp completion/archive timestamps when created with a terminal status.
        const statusInfo = this.db.prepare(
            'SELECT completes, archives FROM statuses WHERE key = ? LIMIT 1',
        ).get(statusKey) as { completes: number; archives: number } | undefined;
        const now = new Date().toISOString();
        const completedAt = statusInfo?.completes ? now : null;
        const archivedAt = statusInfo?.archives ? now : null;

        const sql = `INSERT INTO tasks (
            title, description, status, priority,
            project_id, due_date, recurrence,
            jira_key, jira_id, github_ref,
            sync_hash, last_synced_at, parent_id,
            completed_at, archived_at
        ) VALUES (
            @title, @description, @status, @priority,
            @projectId, @dueDate, @recurrence,
            @jiraKey, @jiraId, @githubRef,
            @syncHash, @lastSyncedAt, @parentId,
            @completedAt, @archivedAt
        )`;

        const params = {
            title: safe(input.title) || '',
            description: safe(input.description) || '',
            status: statusKey,
            priority: safe(input.priority) || 'medium',
            projectId: safe(input.projectId),
            dueDate: safe(input.dueDate),
            recurrence: safe(input.recurrence),
            jiraKey: safe(input.jiraKey),
            jiraId: safe(input.jiraId),
            githubRef: safe(input.githubRef),
            syncHash: safe(input.syncHash),
            lastSyncedAt: safe(input.lastSyncedAt),
            parentId: safe(input.parentId),
            completedAt,
            archivedAt,
        };

        const result = this.db.prepare(sql).run(params);
        return this.getById(Number(result.lastInsertRowid))!;
    }

    /** Get a task by ID */
    getById(id: number): Task | null {
        const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
        return row ? mapRow(row) : null;
    }

    /** Get a task with all relations (project, tags, blocked status) */
    getByIdWithRelations(id: number): TaskWithRelations | null {
        const row = this.db.prepare(`
            SELECT t.*,
                   p.name as project_name,
                   p.color as project_color,
                   GROUP_CONCAT(DISTINCT tg.name) as tag_names,
                   EXISTS(
                       SELECT 1 FROM dependencies d
                       JOIN tasks blocker ON d.depends_on_id = blocker.id
                       WHERE d.task_id = t.id
                         AND blocker.status NOT IN (SELECT key FROM statuses WHERE completes = 1 OR archives = 1)
                   ) as is_blocked
            FROM tasks t
            LEFT JOIN projects p ON t.project_id = p.id
            LEFT JOIN task_tags tt ON t.id = tt.task_id
            LEFT JOIN tags tg ON tt.tag_id = tg.id
            WHERE t.id = ?
            GROUP BY t.id
        `).get(id) as TaskRowWithRelations | undefined;

        if (!row) return null;
        const task = mapRowWithRelations(row);
        task.children = this.getChildren(id);
        task.progress = this.getChildProgress(id);
        return task;
    }

    /** Direct children of a task (non-archived), ordered like the default list. */
    getChildren(parentId: number): TaskWithRelations[] {
        return this.list({ parentId });
    }

    /**
     * Subtask progress rollup. Archived children are excluded from both done and total.
     * Filters independently of getChildren() (which relies on list()'s default archived
     * exclusion) — both intentionally treat archived children the same way.
     */
    getChildProgress(parentId: number): { done: number; total: number } {
        const row = this.db.prepare(`
            SELECT
                SUM(CASE WHEN status NOT IN (SELECT key FROM statuses WHERE archives = 1) THEN 1 ELSE 0 END) AS total,
                SUM(CASE WHEN status IN (SELECT key FROM statuses WHERE completes = 1 AND archives = 0) THEN 1 ELSE 0 END) AS done
            FROM tasks WHERE parent_id = ?
        `).get(parentId) as { total: number | null; done: number | null };
        return { done: row.done ?? 0, total: row.total ?? 0 };
    }

    /** Detach all children of a task (promote to root). Returns the promoted child IDs. */
    promoteChildren(parentId: number): number[] {
        const childIds = (this.db.prepare('SELECT id FROM tasks WHERE parent_id = ?').all(parentId) as { id: number }[])
            .map((r) => r.id);
        if (childIds.length > 0) {
            this.db.prepare(
                "UPDATE tasks SET parent_id = NULL, updated_at = datetime('now') WHERE parent_id = ?",
            ).run(parentId);
        }
        return childIds;
    }

    /** List tasks with filters, sorting, and relations */
    list(filters?: TaskFilters, sort?: TaskSort, limit?: number): TaskWithRelations[] {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filters) {
            if (filters.ids && filters.ids.length > 0) {
                conditions.push(`t.id IN (${filters.ids.map(() => '?').join(',')})`);
                params.push(...filters.ids);
            }

            if (filters.status) {
                const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
                conditions.push(`t.status IN (${statuses.map(() => '?').join(',')})`);
                params.push(...statuses);
            } else if (!filters.includeArchived) {
                // Exclude archived statuses via JOIN; avoids hardcoding keys
                conditions.push('t.status NOT IN (SELECT key FROM statuses WHERE archives = 1)');
            }

            if (filters.priority) {
                const priorities = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
                conditions.push(`t.priority IN (${priorities.map(() => '?').join(',')})`);
                params.push(...priorities);
            }

            if (filters.projectId) {
                conditions.push('t.project_id = ?');
                params.push(filters.projectId);
            }

            if (filters.projectName === null) {
                conditions.push('t.project_id IS NULL');
            } else if (filters.projectName) {
                conditions.push('p.name = ?');
                params.push(filters.projectName);
            }

            if (filters.dueDate) {
                switch (filters.dueDate) {
                    case 'today':
                        conditions.push("t.due_date = date('now', 'localtime')");
                        break;
                    case 'overdue':
                        conditions.push("t.due_date < date('now', 'localtime')");
                        conditions.push('t.status NOT IN (SELECT key FROM statuses WHERE completes = 1 OR archives = 1)');
                        break;
                    case 'this-week':
                        conditions.push("t.due_date BETWEEN date('now', 'localtime') AND date('now', 'localtime', '+7 days')");
                        break;
                    default:
                        conditions.push('t.due_date = ?');
                        params.push(filters.dueDate);
                }
            }

            if (filters.dueBefore) {
                conditions.push('t.due_date <= ?');
                params.push(filters.dueBefore);
            }

            if (filters.dueAfter) {
                conditions.push('t.due_date >= ?');
                params.push(filters.dueAfter);
            }

            if (filters.createdDate) {
                switch (filters.createdDate) {
                    case 'today':
                        conditions.push("date(t.created_at, 'localtime') = date('now', 'localtime')");
                        break;
                    case 'yesterday':
                        conditions.push("date(t.created_at, 'localtime') = date('now', 'localtime', '-1 day')");
                        break;
                    case 'this-week':
                        conditions.push("date(t.created_at, 'localtime') >= date('now', 'localtime', '-7 days')");
                        break;
                    default:
                        // ISO date string
                        conditions.push('date(t.created_at) = ?');
                        params.push(filters.createdDate);
                }
            }

            if (filters.createdAfter) {
                conditions.push('date(t.created_at) >= ?');
                params.push(filters.createdAfter);
            }

            if (filters.createdBefore) {
                conditions.push('date(t.created_at) <= ?');
                params.push(filters.createdBefore);
            }

            if (filters.completedAfter) {
                conditions.push('date(t.completed_at) >= ?');
                params.push(filters.completedAfter);
            }

            if (filters.completedBefore) {
                conditions.push('date(t.completed_at) <= ?');
                params.push(filters.completedBefore);
            }

            if (filters.tags && filters.tags.length > 0) {
                conditions.push(`t.id IN (
                    SELECT tt2.task_id FROM task_tags tt2
                    JOIN tags tg2 ON tt2.tag_id = tg2.id
                    WHERE tg2.name IN (${filters.tags.map(() => '?').join(',')})
                )`);
                params.push(...filters.tags);
            }

            if (filters.parentId === null) {
                conditions.push('t.parent_id IS NULL');
            } else if (filters.parentId !== undefined) {
                conditions.push('t.parent_id = ?');
                params.push(filters.parentId);
            }
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const SORT_COLUMN_MAP: Record<string, string> = {
            id: 't.id', title: 't.title', priority: 't.priority',
            due_date: 't.due_date', status: 't.status',
            created_at: 't.created_at', updated_at: 't.updated_at'
        };

        let orderClause: string;
        if (sort) {
            const col = sort.field === 'priority'
                ? PRIORITY_SORT_EXPR
                : SORT_COLUMN_MAP[sort.field];
            if (col) {
                const nulls = sort.direction === 'asc' ? 'NULLS LAST' : 'NULLS FIRST';
                orderClause = `ORDER BY ${col} ${sort.direction.toUpperCase()} ${nulls}`;
            } else {
                orderClause = DEFAULT_ORDER;
            }
        } else {
            orderClause = DEFAULT_ORDER;
        }

        let limitClause = '';
        if (limit) {
            limitClause = 'LIMIT ?';
            params.push(limit);
        }

        const rows = this.db.prepare(`
            SELECT t.*,
                   p.name as project_name,
                   p.color as project_color,
                   GROUP_CONCAT(DISTINCT tg.name) as tag_names,
                   EXISTS(
                       SELECT 1 FROM dependencies d
                       JOIN tasks blocker ON d.depends_on_id = blocker.id
                       WHERE d.task_id = t.id
                         AND blocker.status NOT IN (SELECT key FROM statuses WHERE completes = 1 OR archives = 1)
                   ) as is_blocked
            FROM tasks t
            LEFT JOIN projects p ON t.project_id = p.id
            LEFT JOIN task_tags tt ON t.id = tt.task_id
            LEFT JOIN tags tg ON tt.tag_id = tg.id
            ${whereClause}
            GROUP BY t.id
            ${orderClause}
            ${limitClause}
        `).all(...params) as TaskRowWithRelations[];

        return rows.map(mapRowWithRelations);
    }

    /** Update a task by ID */
    update(id: number, changes: Partial<import('../../core/types.js').UpdateTaskFields>): Task | null {
        const fieldMap: Record<string, string> = {
            title: 'title',
            description: 'description',
            status: 'status',
            priority: 'priority',
            projectId: 'project_id',
            dueDate: 'due_date',
            recurrence: 'recurrence',
            timeSpent: 'time_spent',
            completedAt: 'completed_at',
            archivedAt: 'archived_at',
            jiraKey: 'jira_key',
            jiraId: 'jira_id',
            githubRef: 'github_ref',
            syncHash: 'sync_hash',
            lastSyncedAt: 'last_synced_at',
            parentId: 'parent_id',
        };

        const sets: string[] = [];
        const params: unknown[] = [];

        for (const [key, value] of Object.entries(changes)) {
            const col = fieldMap[key];
            if (col) {
                sets.push(`${col} = ?`);
                params.push(value);
            }
        }

        if (sets.length === 0) return this.getById(id);

        sets.push("updated_at = datetime('now')");
        params.push(id);

        this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        return this.getById(id);
    }

    /** Soft delete (archive) a task — sets to the first archiving status */
    archive(id: number): boolean {
        const archiveStatus = (this.db.prepare(
            "SELECT key FROM statuses WHERE archives = 1 ORDER BY sort_order ASC LIMIT 1",
        ).get() as { key: string } | undefined)?.key ?? 'archived';
        const result = this.db.prepare(
            `UPDATE tasks SET status = ?, archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        ).run(archiveStatus, id);
        return result.changes > 0;
    }

    /** Hard delete a task */
    delete(id: number): boolean {
        const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
        return result.changes > 0;
    }

    /**
     * Archive all completing tasks (status.completes=1) — routes to first archiving status.
     * Children of archived parents are promoted to root; returns one entry per archived task
     * (with the IDs of any promoted children) so callers can log and undo each.
     */
    archiveAllDone(): { id: number; prevStatus: string; promotedChildIds: number[] }[] {
        const archiveStatus = (this.db.prepare(
            "SELECT key FROM statuses WHERE archives = 1 ORDER BY sort_order ASC LIMIT 1",
        ).get() as { key: string } | undefined)?.key ?? 'archived';

        const run = this.db.transaction(() => {
            const tasks = this.db.prepare(
                'SELECT id, status FROM tasks WHERE status IN (SELECT key FROM statuses WHERE completes = 1)',
            ).all() as { id: number; status: string }[];

            const archiveOne = this.db.prepare(
                `UPDATE tasks SET status = ?, archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
            );
            return tasks.map(({ id, status }) => {
                const promotedChildIds = this.promoteChildren(id);
                archiveOne.run(archiveStatus, id);
                return { id, prevStatus: status, promotedChildIds };
            });
        });
        return run();
    }

    /** Get task count by status (all known statuses, zero-filled from statuses table). */
    countByStatus(): Record<string, number> {
        const rows = this.db.prepare(
            'SELECT status, COUNT(*) as count FROM tasks GROUP BY status',
        ).all() as { status: string; count: number }[];

        const result: Record<string, number> = {};
        // Seed with zero for all known statuses
        const allStatuses = this.db.prepare('SELECT key FROM statuses').all() as { key: string }[];
        for (const { key } of allStatuses) result[key] = 0;
        for (const row of rows) {
            result[row.status] = row.count;
        }
        return result;
    }

    /** Get weekly stats — counts tasks with completes=1 or archives=1 status */
    weeklyStats(): { day: string; completedCount: number; totalTime: number }[] {
        return this.db.prepare(`
            SELECT date(completed_at, 'localtime') as day, COUNT(*) as completedCount,
                   SUM(time_spent) as totalTime
            FROM tasks
            WHERE completed_at >= date('now', 'localtime', '-7 days')
              AND status IN (SELECT key FROM statuses WHERE completes = 1 OR archives = 1)
            GROUP BY date(completed_at, 'localtime')
            ORDER BY day
        `).all() as { day: string; completedCount: number; totalTime: number }[];
    }

    /** Search tasks by title/description (basic LIKE, fuse.js used at service layer) */
    searchBasic(query: string, limit = 200): TaskWithRelations[] {
        const escaped = query.replace(/[%_]/g, '\\$&');
        const pattern = `%${escaped}%`;
        const rows = this.db.prepare(`
            SELECT t.*,
                   p.name as project_name,
                   p.color as project_color,
                   GROUP_CONCAT(DISTINCT tg.name) as tag_names,
                   0 as is_blocked
            FROM tasks t
            LEFT JOIN projects p ON t.project_id = p.id
            LEFT JOIN task_tags tt ON t.id = tt.task_id
            LEFT JOIN tags tg ON tt.tag_id = tg.id
            WHERE (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')
              AND t.status NOT IN (SELECT key FROM statuses WHERE archives = 1)
            GROUP BY t.id
            ORDER BY ${PRIORITY_SORT_EXPR} DESC
            LIMIT ?
        `).all(pattern, pattern, limit) as TaskRowWithRelations[];

        return rows.map(mapRowWithRelations);
    }
}
