// ============================================================
// todo add <title> — Create a new task
// ============================================================

import { Command } from 'commander';
import { getContext } from './context.js';
import { theme } from '../utils/theme.js';
import { getHookManager } from '../plugins/hook-manager.js';
import { validateCreateInput } from '../core/task.js';
import { parseDate, formatDateDisplay } from '../utils/date.js';
import { success, formatPriorityLabel, parseIds as parseIdList } from '../utils/format.js';
import { logWarn } from '../utils/logger.js';
import { fail, EXIT } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';
import { VALID_RECURRENCES, normalizePriority, PRIORITY_ERROR } from '../core/types.js';
import type { Task, TaskPriority, RecurrencePattern } from '../core/types.js';
import type { AppContext } from './context.js';

export interface ApplyAddInput {
    title: string;
    description?: string;
    priority?: TaskPriority;
    projectId?: number | null;
    dueDate?: string | null;
    recurrence?: RecurrencePattern;
    tags?: string[];
}

/** Pure mutating core: validate, create, hook, action-log. Throws on invalid input. */
export function applyAdd(ctx: AppContext, input: ApplyAddInput): { task: Task } {
    const validated = validateCreateInput({
        title: input.title,
        description: input.description,
        priority: input.priority,
        projectId: input.projectId,
        dueDate: input.dueDate,
        recurrence: input.recurrence,
    });

    const task = ctx.taskRepo.create(validated);
    getHookManager().onTaskCreate(task).catch((e) => logWarn(`Hook error: ${e instanceof Error ? e.message : String(e)}`));

    if (input.tags && input.tags.length > 0) {
        ctx.tagRepo.setTaskTags(task.id, input.tags);
    }

    ctx.actionLog.log({
        taskId: task.id,
        action: 'create',
        entityType: 'task',
        prevState: null,
        newState: JSON.stringify({ title: task.title, priority: task.priority }),
    });

    return { task };
}

export const addCommand = new Command('add')
    .description('Create a new task')
    .argument('<title>', 'Task title')
    .option('-p, --priority <level>', 'Priority: urgent, high, medium, low', 'medium')
    .option('-t, --tag <tags...>', 'Tags (repeatable)')
    .option('-P, --project <name>', 'Project name')
    .option('-d, --due <date>', 'Due date (natural language)')
    .option('-D, --description <text>', 'Long description')
    .option('--depends <ids>', 'Comma-separated task IDs this depends on')
    .option('-r, --recur <pattern>', 'Recurrence: daily, weekly, biweekly, monthly, yearly')
    .option('--json', 'Output JSON instead of human-readable text')
    .addHelpText('after', `
Examples:
  $ todo add "Fix login bug" --priority high --due "next monday"
  $ todo add "Weekly review" --recur weekly --due "next friday" --tag ops`)
    .action((title: string, opts) => {
        const ctx = getContext();
        const jsonMode = !!opts.json;

        const priority = normalizePriority(opts.priority);
        if (opts.priority && priority === null) {
            return fail(EXIT.USAGE, PRIORITY_ERROR, { json: jsonMode, command: 'add' });
        }

        if (opts.recur && !VALID_RECURRENCES.includes(opts.recur as RecurrencePattern)) {
            return fail(EXIT.USAGE, `Invalid recurrence "${opts.recur}". Valid values: ${VALID_RECURRENCES.join(', ')}`, { json: jsonMode, command: 'add' });
        }

        // Resolve project (auto-creates if not found)
        let projectId: number | null = null;
        if (opts.project) {
            projectId = ctx.projectRepo.getOrCreate(opts.project).id;
        }

        let dueDate: string | null = null;
        if (opts.due) {
            dueDate = parseDate(opts.due);
            if (!dueDate) {
                return fail(EXIT.USAGE, `Could not parse --due "${opts.due}". Try a natural-language date like "tomorrow", "next monday", or an ISO date like "2026-07-01".`, { json: jsonMode, command: 'add' });
            }
        }

        const { task } = applyAdd(ctx, {
            title,
            description: opts.description,
            priority: priority ?? undefined,
            projectId,
            dueDate,
            recurrence: opts.recur as RecurrencePattern | undefined,
            tags: opts.tag,
        });

        // Set dependencies (CLI-only; not exposed via MCP tools)
        if (opts.depends) {
            const depIds = parseIdList(opts.depends);
            for (const depId of depIds) {
                ctx.depRepo.add(task.id, depId);
            }
        }

        // Output
        if (jsonMode) {
            emitJson({ ok: true, command: 'add', data: task });
        } else {
            const parts = [
                success(`Created task ${theme().heading.chalk('#' + task.id)}: `) + theme().title.chalk(task.title),
                `[${formatPriorityLabel(task.priority)}]`,
            ];
            if (task.dueDate) parts.push(`(due: ${formatDateDisplay(task.dueDate)})`);
            console.log(parts.join(' '));
        }
    });
