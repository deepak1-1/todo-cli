// MCP tool handlers — all 6 MVP task tools.
// Each handler calls existing apply-helpers or repos directly (no stdout writes).
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { applyAdd } from '../../commands/add.js';
import { applyEdit } from '../../commands/edit.js';
import { applyDelete } from '../../commands/delete.js';
import { getContext } from '../../commands/context.js';
import { normalizePriority, TASK_PRIORITIES, VALID_RECURRENCES } from '../../core/types.js';
import { findByKeyOrVerb } from '../../core/status.js';
import { parseDate } from '../../utils/date.js';
import { fuzzySearch } from '../../core/filter.js';
import type { TaskFilters, TaskSort, EditOptions } from '../../core/types.js';

const prioritySchema = z.enum(['urgent', 'high', 'medium', 'low']).optional();
const recurrenceSchema = z.enum(['daily', 'weekly', 'biweekly', 'monthly', 'yearly']).optional();

/** Return shape: text summary + structured JSON content. Arrays are wrapped under `items` so structuredContent is always a JSON object (MCP spec). */
function ok(data: unknown, summary: string) {
    return {
        content: [{ type: 'text' as const, text: summary }],
        structuredContent: Array.isArray(data) ? { items: data } : (data as Record<string, unknown>),
    };
}

/** Return shape for errors. */
function err(message: string) {
    return {
        content: [{ type: 'text' as const, text: message }],
        isError: true as const,
    };
}

export function registerTaskTools(server: McpServer, opts: { allowDelete: boolean }): void {
    // ── todo_add_task ──────────────────────────────────────────────────
    server.registerTool(
        'todo_add_task',
        {
            title: 'Add Task',
            description: 'Create a new task. Returns the created task.',
            inputSchema: {
                title: z.string().min(1).describe('Task title'),
                description: z.string().optional().describe('Longer description'),
                priority: prioritySchema.describe(`Priority: ${TASK_PRIORITIES.join(', ')}`),
                projectName: z.string().optional().describe('Project name (auto-created if absent)'),
                dueDate: z.string().optional().describe('Due date: ISO date or natural language like "next friday"'),
                tags: z.array(z.string()).optional().describe('Tag names'),
                recurrence: recurrenceSchema.describe(`Recurrence: ${VALID_RECURRENCES.join(', ')}`),
            },
        },
        (args) => {
            try {
                const ctx = getContext();
                const priority = args.priority ? normalizePriority(args.priority) ?? undefined : undefined;

                let projectId: number | null = null;
                if (args.projectName) {
                    projectId = ctx.projectRepo.getOrCreate(args.projectName).id;
                }

                let dueDate: string | null = null;
                if (args.dueDate) {
                    dueDate = parseDate(args.dueDate);
                    if (!dueDate) {
                        return err(`Could not parse dueDate "${args.dueDate}". Use ISO date or natural language like "next friday".`);
                    }
                }

                const { task } = applyAdd(ctx, {
                    title: args.title,
                    description: args.description,
                    priority,
                    projectId,
                    dueDate,
                    tags: args.tags,
                    recurrence: args.recurrence,
                });

                return ok(task, `Created task #${task.id}: ${task.title}`);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_update_task ───────────────────────────────────────────────
    server.registerTool(
        'todo_update_task',
        {
            title: 'Update Task',
            description: 'Update one or more fields of an existing task. Returns the updated task.',
            inputSchema: {
                id: z.number().int().positive().describe('Task ID'),
                title: z.string().trim().min(1, 'title cannot be empty').optional().describe('New title'),
                description: z.string().optional().describe('New description'),
                priority: prioritySchema.describe('New priority'),
                projectName: z.string().optional().describe('Move to project (empty string removes project)'),
                dueDate: z.string().optional().describe('New due date (empty string removes due date)'),
                tags: z.array(z.string()).optional().describe('Tags to add; prefix "-name" to remove. Bare names are added (existing tags kept). Empty array is a no-op.'),
                recurrence: recurrenceSchema.describe('New recurrence pattern'),
            },
        },
        (args) => {
            try {
                const ctx = getContext();

                const editOpts: EditOptions = {};
                if (args.title !== undefined) editOpts.title = args.title;
                if (args.description !== undefined) editOpts.description = args.description;
                if (args.priority !== undefined) editOpts.priority = args.priority;
                if (args.recurrence !== undefined) editOpts.recur = args.recurrence;

                // Empty string = remove due date / project
                if (args.dueDate === '') {
                    editOpts.due = false;
                } else if (args.dueDate !== undefined) {
                    const parsed = parseDate(args.dueDate);
                    if (!parsed) {
                        return err(`Could not parse dueDate "${args.dueDate}".`);
                    }
                    editOpts.due = parsed;
                }

                if (args.projectName === '') {
                    editOpts.project = false;
                } else if (args.projectName !== undefined) {
                    editOpts.project = args.projectName;
                }

                // Bare names are mapped to add-semantics (+name) to prevent silent tag replacement.
                if (args.tags !== undefined) editOpts.tag = args.tags.map(t => /^[+-]/.test(t) ? t : '+' + t);

                const { task } = applyEdit(ctx, args.id, editOpts);
                return ok(task, `Updated task #${task.id}: ${task.title}`);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_set_status ────────────────────────────────────────────────
    server.registerTool(
        'todo_set_status',
        {
            title: 'Set Task Status',
            description: 'Change the status of a task. Use todo_list_tasks to discover valid status keys.',
            inputSchema: {
                id: z.number().int().positive().describe('Task ID'),
                status: z.string().describe('Status key or verb (e.g. "done", "in_progress")'),
            },
        },
        (args) => {
            try {
                const ctx = getContext();
                const defs = ctx.statusRepo.list();
                const def = findByKeyOrVerb(defs, args.status);
                if (!def) {
                    const valid = defs.map(d => d.key).join(', ');
                    return err(`Invalid status "${args.status}". Valid: ${valid}`);
                }
                const { task } = applyEdit(ctx, args.id, { status: def.key });
                return ok(task, `Task #${task.id} is now "${def.label}"`);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_delete_task ───────────────────────────────────────────────
    server.registerTool(
        'todo_delete_task',
        {
            title: 'Delete Task',
            description: [
                'Archive (soft-delete) a task so it can be recovered with `todo undo`.',
                opts.allowDelete
                    ? 'Hard delete is enabled on this server — pass hard:true for permanent removal.'
                    : 'Hard delete is disabled on this server (start with --allow-delete to enable).',
            ].join(' '),
            inputSchema: {
                id: z.number().int().positive().describe('Task ID'),
                hard: z.boolean().optional().describe('Permanently delete (requires --allow-delete flag on server start)'),
            },
        },
        (args) => {
            try {
                const ctx = getContext();
                const force = !!args.hard && opts.allowDelete;
                if (args.hard && !opts.allowDelete) {
                    return err('Hard delete is disabled. Start the server with --allow-delete to enable it.');
                }
                const { task } = applyDelete(ctx, args.id, { force });
                const action = force ? 'Permanently deleted' : 'Archived';
                return ok({ id: args.id, title: task.title, archived: !force }, `${action} task #${args.id}: ${task.title}`);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_list_tasks ────────────────────────────────────────────────
    server.registerTool(
        'todo_list_tasks',
        {
            title: 'List Tasks',
            description: 'List tasks with optional filters. By default returns active (non-archived) tasks.',
            inputSchema: {
                status: z.union([z.string(), z.array(z.string())]).optional().describe('Filter by status key(s)'),
                priority: z.union([z.enum(['urgent', 'high', 'medium', 'low']), z.array(z.enum(['urgent', 'high', 'medium', 'low']))]).optional().describe('Filter by priority'),
                projectName: z.string().optional().describe('Filter by project name'),
                tags: z.array(z.string()).optional().describe('Filter by tags'),
                search: z.string().optional().describe('Full-text search'),
                dueDate: z.string().optional().describe('"today", "overdue", "this-week", or ISO date'),
                dueBefore: z.string().optional().describe('ISO date — due on or before'),
                dueAfter: z.string().optional().describe('ISO date — due on or after'),
                includeArchived: z.boolean().optional().describe('Include archived tasks'),
                sortField: z.enum(['id', 'title', 'priority', 'due_date', 'status', 'created_at', 'updated_at']).optional(),
                sortDirection: z.enum(['asc', 'desc']).optional(),
                limit: z.number().int().positive().optional().describe('Max results (default 100)'),
            },
        },
        (args) => {
            try {
                const ctx = getContext();
                const filters: TaskFilters = {};
                if (args.status !== undefined) filters.status = args.status as TaskFilters['status'];
                if (args.priority !== undefined) filters.priority = args.priority as TaskFilters['priority'];
                if (args.projectName !== undefined) filters.projectName = args.projectName;
                if (args.tags !== undefined) filters.tags = args.tags;
                if (args.dueDate !== undefined) filters.dueDate = args.dueDate;
                if (args.dueBefore !== undefined) filters.dueBefore = args.dueBefore;
                if (args.dueAfter !== undefined) filters.dueAfter = args.dueAfter;
                if (args.includeArchived !== undefined) filters.includeArchived = args.includeArchived;

                const sort: TaskSort | undefined = args.sortField
                    ? { field: args.sortField, direction: args.sortDirection ?? 'asc' }
                    : undefined;

                let tasks = ctx.taskRepo.list(filters, sort, args.limit ?? 100);
                if (args.search) tasks = fuzzySearch(tasks, args.search as string);
                return ok(tasks, `Found ${tasks.length} task(s)`);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_get_task ──────────────────────────────────────────────────
    server.registerTool(
        'todo_get_task',
        {
            title: 'Get Task',
            description: 'Get a single task by ID, including project, tags, and blocked status.',
            inputSchema: {
                id: z.number().int().positive().describe('Task ID'),
            },
        },
        (args) => {
            try {
                const ctx = getContext();
                const task = ctx.taskRepo.getByIdWithRelations(args.id);
                if (!task) {
                    return err(`Task #${args.id} not found.`);
                }
                return ok(task, `Task #${task.id}: ${task.title} [${task.status}]`);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );
}
