// ============================================================
// todo ls / todo list — List tasks with filtering
// ============================================================

import { Command } from 'commander';
import { getContext } from './context.js';
import { theme } from '../utils/theme.js';
import { formatTaskTable, parseIntOption } from '../utils/format.js';
import { orderAsTree } from '../core/task.js';
import { addFilterOptions, filterAndSearchTasks } from './filter-options.js';
import { fail, EXIT } from '../utils/exit.js';
import { emptyStateMessage } from '../utils/empty-state.js';

const cmd = new Command('ls')
    .alias('list')
    .description('List tasks with filtering and sorting')
    .option('--json', 'Output as JSON')
    .option('--tree', 'Render tasks as an indented parent/child tree')
    .addHelpText('after', `
Examples:
  $ todo ls --priority high --tag backend
  $ todo ls --status in_progress --project "My App" --limit 20`);

addFilterOptions(cmd);

export const listCommand = cmd
    .action((opts) => {
        // Validate --limit via shared util (throws on NaN or <= 0)
        if (opts.limit) {
            try {
                parseIntOption(opts.limit, 'limit');
            } catch (e: unknown) {
                return fail(EXIT.USAGE, e instanceof Error ? e.message : String(e), { json: opts.json, command: 'list' });
            }
        }

        const ctx = getContext();
        let tasks;
        try {
            ({ tasks } = filterAndSearchTasks(ctx, opts));
        } catch (e: unknown) {
            return fail(EXIT.USAGE, e instanceof Error ? e.message : String(e), { json: opts.json, command: 'list' });
        }

        if (opts.json) {
            console.log(JSON.stringify(tasks, null, 2));
            return;
        }

        if (tasks.length === 0) {
            // Build a filter summary for the empty-state message
            const activeFilters: Record<string, unknown> = {};
            if (opts.search) activeFilters.search = opts.search;
            if (opts.priority) activeFilters.priority = opts.priority;
            if (opts.tag) activeFilters.tag = opts.tag;
            if (opts.project) activeFilters.project = opts.project;
            if (opts.status) activeFilters.status = opts.status;
            if (opts.due) activeFilters.due = opts.due;
            console.log(theme().muted.chalk(`  ${emptyStateMessage('tasks', activeFilters)}`));
            return;
        }

        if (opts.search) {
            console.log(theme().muted.chalk(`  ${tasks.length} result${tasks.length !== 1 ? 's' : ''} for "${opts.search}":\n`));
        }

        if (opts.tree) {
            const { ordered, depths } = orderAsTree(tasks);
            console.log(formatTaskTable(ordered, ctx.statusRepo.list(), depths));
        } else {
            console.log(formatTaskTable(tasks, ctx.statusRepo.list()));
        }
    });
