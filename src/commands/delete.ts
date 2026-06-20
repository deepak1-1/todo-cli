// ============================================================
// todo rm / todo delete — Remove a task
// ============================================================

import { Command } from 'commander';
import { getContext } from './context.js';
import { theme } from '../utils/theme.js';
import { getHookManager } from '../plugins/hook-manager.js';
import { success, parseId } from '../utils/format.js';
import { logWarn } from '../utils/logger.js';
import { fail, EXIT, requireEntity } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';
import type { Task } from '../core/types.js';
import type { AppContext } from './context.js';

/** Pure mutating core for delete: archive or hard-delete, fire hook, action-log. Throws if not found. */
export function applyDelete(ctx: AppContext, id: number, opts?: { force?: boolean }): { task: Task } {
    const task = ctx.taskRepo.getById(id);
    if (!task) throw new Error(`Task #${id} not found`);

    if (opts?.force) {
        ctx.taskRepo.delete(id);
        getHookManager().onTaskDelete(task).catch((e) => logWarn(`Hook error: ${e instanceof Error ? e.message : String(e)}`));
        ctx.actionLog.log({
            taskId: id,
            action: 'hard_delete',
            entityType: 'task',
            prevState: JSON.stringify(task),
            newState: null,
        });
    } else {
        ctx.taskRepo.archive(id);
        getHookManager().onTaskDelete(task).catch((e) => logWarn(`Hook error: ${e instanceof Error ? e.message : String(e)}`));
        // Retrieve archive status key from registry for the action log
        const archiveKey = ctx.statusRepo.list().find(d => d.archives)?.key ?? 'archived';
        ctx.actionLog.log({
            taskId: id,
            action: 'archive',
            entityType: 'task',
            prevState: JSON.stringify({ status: task.status }),
            newState: JSON.stringify({ status: archiveKey }),
        });
    }

    return { task };
}

export const deleteCommand = new Command('rm')
    .alias('delete')
    .description('Delete a task (soft delete by default)')
    .argument('[id]', 'Task ID')
    .option('--force', 'Hard delete (permanent)')
    .option('--done', 'Archive all completed tasks')
    .option('--json', 'Output JSON instead of human-readable text')
    .action((rawId: string | undefined, opts) => {
        const ctx = getContext();
        const jsonMode = !!opts.json;

        if (opts.done) {
            const count = ctx.taskRepo.archiveAllDone();
            if (jsonMode) {
                emitJson({ ok: true, command: 'delete', data: { archived: count } });
            } else {
                console.log(success(`Archived ${count} completed task${count !== 1 ? 's' : ''}`));
            }
            return;
        }

        if (!rawId) {
            return fail(EXIT.USAGE, 'Please provide a task ID or use --done', { json: jsonMode, command: 'delete' });
        }

        const id = parseId(rawId);

        const task = ctx.taskRepo.getById(id);
        if (!requireEntity(task, 'Task', `#${id}`, { json: jsonMode, command: 'delete' })) return;

        const { task: deleted } = applyDelete(ctx, id, { force: opts.force });

        if (opts.force) {
            if (jsonMode) {
                emitJson({ ok: true, command: 'delete', data: { id, deleted: true } });
            } else {
                console.log(success(`Permanently deleted task ${theme().heading.chalk('#' + id)}: ${deleted.title}`));
            }
        } else {
            if (jsonMode) {
                const archiveKey = ctx.statusRepo.list().find(d => d.archives)?.key ?? 'archived';
                emitJson({ ok: true, command: 'delete', data: { ...deleted, status: archiveKey } });
            } else {
                console.log(success(`Archived task ${theme().heading.chalk('#' + id)}: ${deleted.title}`));
            }
        }
    });
