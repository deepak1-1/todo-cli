// Bulk operations on filtered task sets
import { Command } from 'commander';
import { theme } from '../utils/theme.js';
import * as readline from 'node:readline';
import { getContext } from './context.js';
import { executeEdit } from './edit.js';
import { getHookManager } from '../plugins/hook-manager.js';
import { formatTaskTable, success } from '../utils/format.js';
import { logWarn } from '../utils/logger.js';
import { addFilterOptions, filterAndSearchTasks, hasAnyFilter } from '../utils/filter-options.js';
import { fail, EXIT } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';
import { normalizePriority, PRIORITY_ERROR } from '../core/types.js';
import type { Task, EditOptions } from '../core/types.js';
import type { StatusDef } from '../core/status.js';

async function confirm(message: string): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(message + ' [y/N] ', (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y');
        });
    });
}

function resolveMatchingTasks(opts: Record<string, unknown>, command?: string): Task[] | null {
    const json = !!opts.json;
    if (!hasAnyFilter(opts)) {
        fail(EXIT.USAGE, 'At least one filter is required for bulk operations', { json, command });
        return null;
    }

    const ctx = getContext();
    let tasks: Task[];
    try {
        const result = filterAndSearchTasks(ctx, opts);
        tasks = result.tasks;
    } catch (e: unknown) {
        fail(EXIT.USAGE, e instanceof Error ? e.message : String(e), { json, command });
        return null;
    }

    if (tasks.length === 0) {
        if (json) emitJson({ ok: true, command: command ?? '', data: { updated: 0, taskIds: [] } });
        else console.log(theme().muted.chalk('  No tasks match the given filters'));
        return null;
    }

    return tasks;
}

async function previewAndConfirm(tasks: Task[], actionLabel: string, yes: boolean): Promise<boolean> {
    console.log(formatTaskTable(tasks));
    console.log(theme().warning.chalk(`\n  ${tasks.length} task${tasks.length !== 1 ? 's' : ''} will be ${actionLabel}\n`));
    if (yes) return true;
    return confirm('  Continue?');
}

function makeStatusAction(targetStatusKey: string, label: string, command: string) {
    return async (opts: Record<string, unknown>) => {
        const json = !!opts.json;
        const tasks = resolveMatchingTasks(opts, command);
        if (!tasks) return;
        if (!json && !(await previewAndConfirm(tasks, `marked as ${label}`, !!opts.yes))) return;

        let count = 0;
        const taskIds: number[] = [];
        for (const task of tasks) {
            executeEdit(task.id, { status: targetStatusKey }, { silent: true });
            count++;
            taskIds.push(task.id);
        }
        if (json) emitJson({ ok: true, command, data: { updated: count, taskIds, status: targetStatusKey } });
        else console.log(success(`${count} task${count !== 1 ? 's' : ''} marked as ${label}`));
    };
}

function addSharedOptions(cmd: Command): Command {
    addFilterOptions(cmd);
    cmd.option('-y, --yes', 'Skip confirmation');
    cmd.option('--json', 'Output as JSON (implies --yes)');
    return cmd;
}

// -- Subcommands --

const sharedFilterExample = `
Examples:
  $ todo bulk done --priority high --tag backend --yes
  $ todo bulk done --status in_progress --project "My App" --yes`;

/** Build bulk status subcommands from pre-loaded registry defs (no DB access here). */
export function buildBulkStatusCommands(defs: StatusDef[]): Command[] {
    return defs.map(d => {
        const cmd = new Command(d.verb).description(`Mark matching tasks as ${d.label}`);
        addSharedOptions(cmd).addHelpText('after', sharedFilterExample).action(makeStatusAction(d.key, d.label, `bulk ${d.verb}`));
        return cmd;
    });
}

const deleteCmd = new Command('delete').description('Delete matching tasks');
addSharedOptions(deleteCmd)
    .option('--force', 'Hard delete (permanent)')
    .action(async (opts) => {
        const json = !!opts.json;
        const tasks = resolveMatchingTasks(opts, 'bulk delete');
        if (!tasks) return;
        const actionLabel = opts.force ? 'permanently deleted' : 'archived';
        if (!json && !(await previewAndConfirm(tasks, actionLabel, !!opts.yes))) return;

        const ctx = getContext();
        const archiveKey = ctx.statusRepo.list().find(d => d.archives)?.key ?? 'archived';
        const taskIds: number[] = [];
        for (const task of tasks) {
            if (opts.force) {
                ctx.taskRepo.delete(task.id);
                getHookManager().onTaskDelete(task).catch((e) => logWarn(`Hook error: ${e instanceof Error ? e.message : String(e)}`));
                ctx.actionLog.log({ taskId: task.id, action: 'hard_delete', entityType: 'task', prevState: JSON.stringify(task), newState: null });
            } else {
                ctx.taskRepo.archive(task.id);
                getHookManager().onTaskDelete(task).catch((e) => logWarn(`Hook error: ${e instanceof Error ? e.message : String(e)}`));
                ctx.actionLog.log({ taskId: task.id, action: 'archive', entityType: 'task', prevState: JSON.stringify({ status: task.status }), newState: JSON.stringify({ status: archiveKey }) });
            }
            taskIds.push(task.id);
        }
        if (json) emitJson({ ok: true, command: 'bulk delete', data: { updated: tasks.length, taskIds, action: actionLabel } });
        else console.log(success(`${tasks.length} task${tasks.length !== 1 ? 's' : ''} ${actionLabel}`));
    });

const editCmd = new Command('edit').description('Edit fields on matching tasks');
addSharedOptions(editCmd)
    .option('--set-priority <level>', 'Set priority (takes precedence over --priority when both given)')
    .option('--set-project <name>', 'Set project (takes precedence over --project when both given)')
    .option('--set-due <date>', 'Set due date (natural language, e.g. "next friday")')
    .option('--clear-due', 'Remove due date')
    .option('--clear-project', 'Remove from project')
    .addHelpText('after', `
Examples:
  $ todo bulk edit --tag backend --priority high --yes
  $ todo bulk edit --tag backend --set-priority high --yes
  $ todo bulk edit --project "My App" --set-due "next friday" --yes

  --priority/--project are dual-role on 'bulk edit': they FILTER selection AND
  (when no --set-* is given) act as the edit target. To change priority on a set filtered
  by something else (e.g. --tag), use --set-priority. --set-due is the only way to edit due.`)
    .action(async (opts) => {
        const json = !!opts.json;
        const tasks = resolveMatchingTasks(opts, 'bulk edit');
        if (!tasks) return;

        const resolvedPriority = (opts.setPriority as string | undefined) ?? (opts.priority as string | undefined);
        const resolvedProject = (opts.setProject as string | undefined) ?? (opts.project as string | undefined);
        const resolvedDue = opts.setDue as string | undefined;

        if (resolvedPriority && normalizePriority(resolvedPriority) === null) {
            return fail(EXIT.USAGE, PRIORITY_ERROR, { json, command: 'bulk edit' });
        }

        const editOpts: EditOptions = {};
        if (resolvedPriority) editOpts.priority = resolvedPriority;
        if (resolvedProject) editOpts.project = resolvedProject;
        if (resolvedDue) editOpts.due = resolvedDue;
        if (opts.clearDue) editOpts.due = false;
        if (opts.clearProject) editOpts.project = false;

        const fields = Object.keys(editOpts);
        if (fields.length === 0) {
            return fail(EXIT.USAGE, 'Provide at least one edit flag (--due, --priority, --project, --set-*, --clear-*)', { json, command: 'bulk edit' });
        }

        if (!json && !(await previewAndConfirm(tasks, `updated (${fields.join(', ')})`, !!opts.yes))) return;

        const taskIds: number[] = [];
        for (const task of tasks) {
            executeEdit(task.id, editOpts, { silent: true });
            taskIds.push(task.id);
        }
        if (json) emitJson({ ok: true, command: 'bulk edit', data: { updated: tasks.length, taskIds, fields } });
        else console.log(success(`${tasks.length} task${tasks.length !== 1 ? 's' : ''} updated`));
    });

const tagAddCmd = new Command('add')
    .description('Add a tag to matching tasks')
    .argument('<tagname>', 'Tag to add');
addSharedOptions(tagAddCmd).action(async (tagname: string, opts) => {
    const json = !!opts.json;
    const tasks = resolveMatchingTasks(opts, 'bulk tag add');
    if (!tasks) return;
    if (!json && !(await previewAndConfirm(tasks, `tagged with "${tagname}"`, !!opts.yes))) return;

    const ctx = getContext();
    const taskIds: number[] = [];
    for (const task of tasks) {
        ctx.tagRepo.addTaskTags(task.id, [tagname]);
        ctx.actionLog.log({ taskId: task.id, action: 'tag_add', entityType: 'task', prevState: null, newState: JSON.stringify({ tag: tagname }) });
        taskIds.push(task.id);
    }
    if (json) emitJson({ ok: true, command: 'bulk tag add', data: { updated: tasks.length, taskIds, tag: tagname } });
    else console.log(success(`Added tag "${tagname}" to ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`));
});

const tagRemoveCmd = new Command('remove')
    .description('Remove a tag from matching tasks')
    .argument('<tagname>', 'Tag to remove');
addSharedOptions(tagRemoveCmd).action(async (tagname: string, opts) => {
    const json = !!opts.json;
    const tasks = resolveMatchingTasks(opts, 'bulk tag remove');
    if (!tasks) return;
    if (!json && !(await previewAndConfirm(tasks, `untagged from "${tagname}"`, !!opts.yes))) return;

    const ctx = getContext();
    const taskIds: number[] = [];
    for (const task of tasks) {
        ctx.tagRepo.removeTaskTags(task.id, [tagname]);
        ctx.actionLog.log({ taskId: task.id, action: 'tag_remove', entityType: 'task', prevState: JSON.stringify({ tag: tagname }), newState: null });
        taskIds.push(task.id);
    }
    if (json) emitJson({ ok: true, command: 'bulk tag remove', data: { updated: tasks.length, taskIds, tag: tagname } });
    else console.log(success(`Removed tag "${tagname}" from ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`));
});

const tagCmd = new Command('tag').description('Bulk tag operations');
tagCmd.addCommand(tagAddCmd);
tagCmd.addCommand(tagRemoveCmd);

// -- Main bulk command --

export const bulkCommand = new Command('bulk')
    .description('Bulk operations on filtered task sets');

// Status subcommands are registered lazily from index.ts via buildBulkStatusCommands(defs).
bulkCommand.addCommand(deleteCmd);
bulkCommand.addCommand(editCmd);
bulkCommand.addCommand(tagCmd);
