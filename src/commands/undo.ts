// ============================================================
// todo undo — Undo last action
// todo history — Show action log
// ============================================================

import { Command } from 'commander';
import { getContext } from './context.js';
import { makeTable } from '../utils/table.js';
import { theme } from '../utils/theme.js';
import { success, error, warn, parseIntOption } from '../utils/format.js';
import { emitJson } from '../utils/json-output.js';

export const undoCommand = new Command('undo')
    .description('Undo the last action')
    .option('--json', 'Output as JSON')
    .action((opts) => {
        const ctx = getContext();
        const last = ctx.actionLog.getLast();

        if (!last) {
            if (opts.json) {
                emitJson({ ok: true, command: 'undo', data: { action: 'nothing_to_undo' } });
            } else {
                console.log(warn('Nothing to undo'));
            }
            return;
        }

        try {
            let undoneAction = '';
            switch (last.action) {
                case 'create': {
                    if (last.taskId) {
                        ctx.taskRepo.delete(last.taskId);
                        undoneAction = `removed created task #${last.taskId}`;
                        if (!opts.json) console.log(success(`Undone: ${undoneAction}`));
                    }
                    break;
                }
                case 'update':
                case 'status_pending':
                case 'status_in_progress':
                case 'status_done':
                case 'status_archived': {
                    if (last.taskId && last.prevState) {
                        const prev = JSON.parse(last.prevState);
                        ctx.taskRepo.update(last.taskId, prev);
                        undoneAction = `restored task #${last.taskId} to previous state`;
                        if (!opts.json) console.log(success(`Undone: ${undoneAction}`));
                    }
                    break;
                }
                case 'archive': {
                    if (last.taskId && last.prevState) {
                        const prev = JSON.parse(last.prevState);
                        ctx.taskRepo.update(last.taskId, { status: prev.status || 'pending', archivedAt: null });
                        undoneAction = `unarchived task #${last.taskId}`;
                        if (!opts.json) console.log(success(`Undone: ${undoneAction}`));
                    }
                    break;
                }
                default:
                    if (opts.json) {
                        emitJson({ ok: true, command: 'undo', data: { action: 'unsupported', type: last.action } });
                    } else {
                        console.log(warn(`Cannot undo action type: ${last.action}`));
                    }
                    return;
            }

            ctx.actionLog.deleteLast();
            if (opts.json) {
                emitJson({ ok: true, command: 'undo', data: { action: 'undone', taskId: last.taskId, description: undoneAction } });
            }
        } catch (e: unknown) {
            if (opts.json) {
                emitJson({ ok: false, command: 'undo', error: { code: 1, message: e instanceof Error ? e.message : String(e) } });
            } else {
                console.error(error(`Failed to undo: ${e instanceof Error ? e.message : String(e)}`));
            }
        }
    });

export const historyCommand = new Command('history')
    .description('Show action history')
    .option('--task <id>', 'Show history for a specific task')
    .option('-n, --limit <count>', 'Limit results')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ todo history --json | jq '.data[0]'
  $ todo history --task 42 --json | jq '.data | length'`)
    .action((opts) => {
        const ctx = getContext();

        const taskId = opts.task ? parseIntOption(opts.task, 'task') : undefined;
        const limit = opts.limit ? parseIntOption(opts.limit, 'limit') : 20;

        const entries = taskId
            ? ctx.actionLog.getByTaskId(taskId)
            : ctx.actionLog.getRecent(limit);

        if (entries.length === 0) {
            if (opts.json) {
                emitJson({ ok: true, command: 'history', data: [] });
            } else {
                console.log(theme().muted.chalk('  No history found.'));
            }
            return;
        }

        if (opts.json) {
            emitJson({ ok: true, command: 'history', data: entries });
            return;
        }

        const t = theme();
        const table = makeTable({
            head: ['#', 'Action', 'Task', 'Time'],
            style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
        });

        for (const entry of entries) {
            table.push([
                entry.id,
                entry.action,
                entry.taskId ? `#${entry.taskId}` : '-',
                entry.timestamp,
            ]);
        }

        console.log(table.toString());
    });
