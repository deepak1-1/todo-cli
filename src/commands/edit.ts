// ============================================================
// todo edit <id> — Modify a task (fields, status, dependencies)
// ============================================================

import { Command, Option } from 'commander';
import { getContext } from './context.js';
import { theme } from '../utils/theme.js';
import { getHookManager } from '../plugins/hook-manager.js';
import { validateTransition, getTransitionTimestamps, handleRecurringCompletion } from '../core/task.js';
import { parseDate } from '../utils/date.js';
import { success, error, formatStatus, parseId } from '../utils/format.js';
import { logWarn } from '../utils/logger.js';
import { fail, EXIT, requireEntity } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';
import { TASK_STATUSES, VALID_RECURRENCES, normalizePriority, PRIORITY_ERROR } from '../core/types.js';
import type { Task, TaskPriority, TaskStatus, RecurrencePattern, EditOptions } from '../core/types.js';
import type { AppContext } from './context.js';
import { format } from 'date-fns';

/** Pure mutating core for edit: validate, apply, hook, log. Throws on invalid input. */
export function applyEdit(
    ctx: AppContext,
    id: number,
    opts: EditOptions,
): { task: Task; recurring?: { id: number; dueDate: string } } {
    const task = ctx.taskRepo.getById(id);
    if (!task) throw new Error(`Task #${id} not found`);

    const prevState = JSON.stringify(task);
    const targetStatus = opts.status as TaskStatus | undefined;

    if (targetStatus) validateTransition(task, targetStatus);

    const changes: Record<string, unknown> = {};

    if (opts.title) changes.title = opts.title;
    if (opts.priority) changes.priority = opts.priority as TaskPriority;
    if (opts.description) changes.description = opts.description;
    if (opts.recur) changes.recurrence = opts.recur as RecurrencePattern;

    if (opts.due === false) {
        changes.dueDate = null;
    } else if (opts.due) {
        const parsed = parseDate(opts.due as string);
        if (!parsed) {
            throw new Error(`Could not parse --due "${opts.due}". Try a natural-language date like "tomorrow", "next monday", or an ISO date like "2026-07-01".`);
        }
        changes.dueDate = parsed;
    }

    if (opts.project === false) {
        changes.projectId = null;
    } else if (opts.project) {
        changes.projectId = ctx.projectRepo.getOrCreate(opts.project as string).id;
    }

    if (targetStatus) {
        changes.status = targetStatus;
        Object.assign(changes, getTransitionTimestamps(targetStatus));
    }

    const updated = ctx.taskRepo.update(id, changes);

    if (updated) {
        if (targetStatus === 'done') {
            getHookManager().onTaskComplete(updated).catch((e) => logWarn(`Hook error: ${e instanceof Error ? e.message : String(e)}`));
        } else if (Object.keys(changes).length > 0) {
            getHookManager().onTaskUpdate(updated, changes as Partial<Task>).catch((e) => logWarn(`Hook error: ${e instanceof Error ? e.message : String(e)}`));
        }
    }

    if (opts.tag && opts.tag.length > 0) {
        const addTags: string[] = [];
        const removeTags: string[] = [];
        const replaceTags: string[] = [];
        let hasPrefix = false;

        for (const t of opts.tag) {
            if (t.startsWith('+')) { addTags.push(t.slice(1)); hasPrefix = true; }
            else if (t.startsWith('-')) { removeTags.push(t.slice(1)); hasPrefix = true; }
            else { replaceTags.push(t); }
        }

        if (hasPrefix) {
            if (addTags.length > 0) ctx.tagRepo.addTaskTags(id, addTags);
            if (removeTags.length > 0) ctx.tagRepo.removeTaskTags(id, removeTags);
        } else {
            ctx.tagRepo.setTaskTags(id, replaceTags);
        }
    }

    if (targetStatus) {
        ctx.actionLog.log({
            taskId: id,
            action: `status_${targetStatus}`,
            entityType: 'task',
            prevState: JSON.stringify({ status: task.status }),
            newState: JSON.stringify({ status: targetStatus }),
        });
    }

    const hasFieldChanges = Object.keys(changes).some(k => k !== 'status' && k !== 'completedAt' && k !== 'archivedAt');
    if (hasFieldChanges || (opts.tag && opts.tag.length > 0)) {
        if (!targetStatus) {
            ctx.actionLog.log({
                taskId: id,
                action: 'update',
                entityType: 'task',
                prevState,
                newState: JSON.stringify(updated),
            });
        }
    }

    let recurring: { id: number; dueDate: string } | undefined;
    if (targetStatus === 'done' && task.recurrence) {
        const newTask = handleRecurringCompletion(task, ctx.taskRepo, ctx.tagRepo);
        if (newTask) {
            const nextDue = newTask.dueDate ? new Date(newTask.dueDate) : new Date();
            recurring = { id: newTask.id, dueDate: nextDue.toISOString() };
        }
    }

    return { task: updated ?? task, recurring };
}

export function executeEdit(id: number, opts: EditOptions, { silent = false, json = false } = {}): void {
    const ctx = getContext();

    // Validate priority/recur/status before calling applyEdit
    if (opts.priority && normalizePriority(opts.priority) === null) {
        return fail(EXIT.USAGE, PRIORITY_ERROR, { json, command: 'edit' });
    }

    if (opts.recur && !VALID_RECURRENCES.includes(opts.recur as RecurrencePattern)) {
        return fail(EXIT.USAGE, `Invalid recurrence "${opts.recur}". Valid values: ${VALID_RECURRENCES.join(', ')}`, { json, command: 'edit' });
    }

    if (opts.status && !TASK_STATUSES.includes(opts.status as TaskStatus)) {
        return fail(EXIT.USAGE, `Invalid status "${opts.status}". Valid values: ${TASK_STATUSES.join(', ')}`, { json, command: 'edit' });
    }

    const taskCheck = ctx.taskRepo.getById(id);
    if (!requireEntity(taskCheck, 'Task', `#${id}`, { json, command: 'edit' })) return;

    let result: { task: Task; recurring?: { id: number; dueDate: string } };
    try {
        result = applyEdit(ctx, id, opts);
    } catch (e: unknown) {
        return fail(EXIT.INVALID_TRANSITION, e instanceof Error ? e.message : String(e), { json, command: 'edit' });
    }

    const { task: updated, recurring: recurringInfo } = result;

    // Handle dependencies (CLI-only; not exposed via chat Intent)
    if (opts.depends && opts.depends.length > 0) {
        handleDependencyOption(id, opts.depends, 'depends', ctx, json);
    }

    if (opts.blocks && opts.blocks.length > 0) {
        handleDependencyOption(id, opts.blocks, 'blocks', ctx, json);
    }

    // Log dependency actions
    if ((opts.depends && opts.depends.length > 0) || (opts.blocks && opts.blocks.length > 0)) {
        if (!opts.status) {
            ctx.actionLog.log({
                taskId: id,
                action: 'update',
                entityType: 'task',
                prevState: JSON.stringify(taskCheck),
                newState: JSON.stringify(updated),
            });
        }
    }

    if (recurringInfo && !silent && !json) {
        const nextDue = new Date(recurringInfo.dueDate);
        console.log(
            success(`Created recurring task ${theme().heading.chalk('#' + recurringInfo.id)} (due: ${format(nextDue, 'MMM d yyyy')} | ${format(nextDue, 'EEE').toUpperCase()})`),
        );
    }

    if (json) {
        const payload = { ok: true as const, command: 'edit', data: updated };
        emitJson(recurringInfo ? { ...payload, recurring: recurringInfo } : payload);
    } else if (!silent) {
        if (opts.status) {
            console.log(success(`Task ${theme().heading.chalk('#' + id)} ${formatStatus(opts.status as TaskStatus)}`));
        } else {
            console.log(success(`Updated task ${theme().heading.chalk('#' + id)}`));
        }
    }
}

function handleDependencyOption(
    taskId: number,
    inputs: string[],
    direction: 'depends' | 'blocks',
    ctx: ReturnType<typeof getContext>,
    silent = false,
): void {
    for (const input of inputs) {
        // Parse comma-separated IDs within each input
        const parts = input.split(',').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
            const isAdd = part.startsWith('+');
            const isRemove = part.startsWith('-');
            const rawId = isAdd || isRemove ? part.slice(1) : part;
            const depId = parseInt(rawId, 10);

            if (isNaN(depId)) {
                console.error(error(`Invalid dependency ID: ${part}`));
                continue;
            }

            const depTask = ctx.taskRepo.getById(depId);
            if (!depTask) {
                console.error(error(`Task #${depId} not found`));
                continue;
            }

            // For 'depends': taskId depends on depId
            // For 'blocks': depId depends on taskId (reverse)
            const fromId = direction === 'depends' ? taskId : depId;
            const toId = direction === 'depends' ? depId : taskId;

            if (isRemove) {
                ctx.depRepo.remove(fromId, toId);
                if (!silent) {
                    if (direction === 'depends') {
                        console.log(success(`Removed dependency #${taskId} → #${depId}`));
                    } else {
                        console.log(success(`#${taskId} no longer blocks #${depId}`));
                    }
                }
            } else {
                // Add (with or without + prefix)
                if (ctx.depRepo.wouldCreateCycle(fromId, toId)) {
                    console.error(error(`Adding dependency would create a cycle`));
                    continue;
                }
                ctx.depRepo.add(fromId, toId);
                if (!silent) {
                    if (direction === 'depends') {
                        console.log(success(`#${taskId} now depends on #${depId}`));
                    } else {
                        console.log(success(`#${taskId} now blocks #${depId}`));
                    }
                }
            }
        }
    }
}

export const editCommand = new Command('edit')
    .description('Modify a task')
    .argument('<id>', 'Task ID')
    .option('--title <title>', 'New title')
    .option('-p, --priority <level>', 'New priority (urgent, high, medium, low)')
    .option('-t, --tag <tags...>', 'Tags (+add, -remove, or replace)')
    .option('-P, --project <name>', 'Move to project')
    .option('-d, --due <date>', 'New due date')
    .option('-D, --description <text>', 'New description')
    .option('-r, --recur <pattern>', 'Recurrence pattern')
    .option('--no-due', 'Remove due date')
    .option('--no-project', 'Remove from project')
    .option('-S, --status <state>', 'Transition status (pending, in_progress, done, archived)')
    // -s is a hidden backwards-compat alias; -S is the canonical short flag
    .addOption(new Option('-s, --status-deprecated <state>', 'Deprecated alias for --status; use -S').hideHelp(true))
    .option('--depends <ids...>', 'Dependencies (+id to add, -id to remove)')
    .option('--blocks <ids...>', 'Tasks this blocks (+id to add, -id to remove)')
    .option('--json', 'Output JSON instead of human-readable text')
    .addHelpText('after', `
Examples:
  $ todo edit 5 -S done          # canonical short flag
  $ todo edit 5 -s done          # deprecated: use -S; -s will become --search in a future release
  $ todo edit 5 --status done    # long form always works`)
    .hook('preAction', (cmd) => {
        // Promote deprecated -s value into status and warn unless in --json mode
        const opts = cmd.opts() as Record<string, unknown>;
        if (opts.statusDeprecated) {
            if (!opts.status) opts.status = opts.statusDeprecated;
            // Suppress warning in --json mode; structured callers must not get noise on stderr
            if (!opts.json) {
                process.stderr.write(
                    "warning: -s for --status is deprecated on 'todo edit'; use -S. -s will become --search in a future release.\n",
                );
            }
        }
    })
    .action((rawId: string, opts) => {
        const id = parseId(rawId);
        executeEdit(id, opts, { json: !!opts.json });
    });
