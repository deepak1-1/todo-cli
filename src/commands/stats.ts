// todo stats — Task stats with date range & time tracking.

import { Command } from 'commander';
import { getContext } from './context.js';
import { makeTable } from '../utils/table.js';
import { formatDuration } from '../core/timer.js';
import { PRIORITY_ORDER } from '../core/types.js';
import type { TaskFilters } from '../core/types.js';
import { fuzzySearch } from '../core/filter.js';
import { parseRelativeDuration, formatDateDisplay, todayLocal, toLocalDateString } from '../utils/date.js';
import { priorityChalkFn, statusChalkFn } from '../utils/format.js';
import { theme } from '../utils/theme.js';
import { fail, EXIT } from '../utils/exit.js';
import { emptyStateMessage } from '../utils/empty-state.js';

// Status labels are loaded dynamically from the registry

export function formatLastLabel(duration: string): string {
    const match = duration.match(/^(\d+)(d|m|y)$/i);
    if (!match) return `Last ${duration}`;
    const value = parseInt(match[1], 10);
    const units: Record<string, string> = { d: 'day', m: 'month', y: 'year' };
    const unit = units[match[2].toLowerCase()];
    return `Last ${value} ${unit}${value !== 1 ? 's' : ''}`;
}

export function getDateRange(opts: { today?: boolean; weekly?: boolean; monthly?: boolean; last?: string; from?: string; to?: string }): { from: string; to: string } {
    const now = new Date();
    const toDate = opts.to || todayLocal();

    if (opts.today) {
        const today = todayLocal();
        return { from: today, to: today };
    }

    if (opts.from) {
        return { from: opts.from, to: toDate };
    }

    if (opts.last) {
        const baseDate = opts.to ? new Date(opts.to) : now;
        const fromDate = parseRelativeDuration(opts.last, baseDate);
        if (!fromDate) {
            throw new Error(`Invalid --last format "${opts.last}". Use a number followed by d (days), m (months), or y (years). Examples: 7d, 3m, 1y`);
        }
        return { from: toLocalDateString(fromDate), to: toDate };
    }

    if (opts.monthly) {
        const fromDate = new Date(now);
        fromDate.setDate(fromDate.getDate() - 30);
        return { from: toLocalDateString(fromDate), to: toDate };
    }

    // Default to weekly.
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 7);
    return { from: toLocalDateString(fromDate), to: toDate };
}

export const statsCommand = new Command('stats')
    .description('View task stats by date range with time details')
    .option('--today', "Today's tasks")
    .option('-w, --weekly', 'Last 7 days (default)')
    .option('-m, --monthly', 'Last 30 days')
    .option('-l, --last <duration>', 'Relative range: e.g. 7d, 3m, 1y')
    .option('--from <date>', 'Start date (YYYY-MM-DD)')
    .option('--to <date>', 'End date (YYYY-MM-DD)')
    .option('-S, --status <key>', 'Filter by status key')
    .option('-P, --project <name>', 'Filter by project')
    .option('-t, --tag <tags...>', 'Filter by tag')
    .option('-s, --search <query>', 'Fuzzy search tasks')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ todo stats --last 7d
  $ todo stats --from 2026-06-01 --to 2026-06-14
  $ todo stats --monthly --project "My App"`)
    .action((opts) => {
        const ctx = getContext();
        const t = theme();

        let from: string, to: string;
        try {
            ({ from, to } = getDateRange(opts));
        } catch (e: unknown) {
            return fail(EXIT.USAGE, e instanceof Error ? e.message : String(e));
        }

        const statuses: string[] = [];
        if (opts.status) statuses.push(opts.status as string);

        const workedTaskIds = ctx.trackingRepo.getTaskIdsWorkedInRange(from, to);

        if (workedTaskIds.length === 0) {
            if (opts.json) {
                console.log(JSON.stringify({ from, to, summary: { total: 0 }, tasks: [] }, null, 2));
            } else {
                const rangeLabel = opts.today ? 'Today' : opts.from ? `${from} to ${to}` : opts.last ? formatLastLabel(opts.last) : opts.monthly ? 'Last 30 days' : 'Last 7 days';
                console.log(`\n  ${t.heading.chalk('Stats')} ${t.muted.chalk(`(${rangeLabel})`)}`);
                console.log(t.muted.chalk('  ─────────────────────────────────────────'));
                console.log(t.muted.chalk(`\n  ${emptyStateMessage('tasks')}\n`));
            }
            return;
        }

        const filters: TaskFilters = {
            ids: workedTaskIds,
            includeArchived: true,
        };
        if (statuses.length > 0) filters.status = statuses;
        if (opts.project) filters.projectName = opts.project;
        if (opts.tag) filters.tags = opts.tag;

        let tasks = ctx.taskRepo.list(filters);

        if (opts.search) {
            tasks = fuzzySearch(tasks, opts.search);
            if (tasks.length === 0) {
                console.log(t.muted.chalk(`  No results for "${opts.search}"`));
                return;
            }
        }

        tasks.sort((a, b) => {
            return (PRIORITY_ORDER[b.priority] || 0) - (PRIORITY_ORDER[a.priority] || 0);
        });

        const taskIds = tasks.map(tk => tk.id);
        const workedDatesMap = ctx.trackingRepo.getWorkedDates(taskIds, from, to);
        const timeInRangeMap = ctx.trackingRepo.getTimeSpentInRange(taskIds, from, to);

        const defs = ctx.statusRepo.list();
        const statusCounts: Record<string, number> = {};
        for (const tk of tasks) {
            statusCounts[tk.status] = (statusCounts[tk.status] || 0) + 1;
        }
        const summary = {
            total: tasks.length,
            ...statusCounts,
            totalTimeSpent: taskIds.reduce((sum, id) => sum + (timeInRangeMap.get(id) || 0), 0),
        };

        if (opts.json) {
            console.log(JSON.stringify({ from, to, summary, tasks }, null, 2));
            return;
        }

        const rangeLabel = opts.today ? 'Today' : opts.from ? `${from} to ${to}` : opts.last ? formatLastLabel(opts.last) : opts.monthly ? 'Last 30 days' : 'Last 7 days';
        console.log(`\n  ${t.heading.chalk('Stats')} ${t.muted.chalk(`(${rangeLabel})`)}`);
        console.log(t.muted.chalk('  ─────────────────────────────────────────'));

        if (tasks.length === 0) {
            console.log(t.muted.chalk(`\n  ${emptyStateMessage('tasks')}\n`));
            return;
        }

        const table = makeTable({
            head: ['ID', 'Ext ID', 'Title', 'Status', 'Priority', 'Project', 'Created', 'Worked On', 'Time Spent'],
            style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
            colWidths: [6, 14, 28, 14, 10, 13, 22, 22, 11],
            wordWrap: true,
        });

        for (const tk of tasks) {
            const statusColor = statusChalkFn(tk.status, defs);
            const priorityColor = priorityChalkFn(tk.priority);
            const createdDate = tk.createdAt ? formatDateDisplay(tk.createdAt) : '-';
            const workedDates = (workedDatesMap.get(tk.id) || []).map(d => formatDateDisplay(d));
            const workedOn = workedDates.length > 0 ? workedDates.join(', ') : t.muted.chalk('-');
            const statusLabel = defs.find(d => d.key === tk.status)?.label ?? tk.status;

            table.push([
                t.id.chalk(`#${tk.id}`),
                tk.jiraKey ? t.ref.chalk(tk.jiraKey) : tk.githubRef ? t.ref.chalk('#' + tk.githubRef.replace(/^.*#/, '')) : '',
                t.title.chalk(tk.title),
                statusColor(statusLabel),
                priorityColor(tk.priority),
                tk.projectName || t.muted.chalk('-'),
                t.muted.chalk(createdDate),
                workedOn,
                (timeInRangeMap.get(tk.id) || 0) > 0 ? formatDuration(timeInRangeMap.get(tk.id)!) : t.muted.chalk('-'),
            ]);
        }

        console.log(table.toString());

        console.log(`\n  ${t.heading.chalk('Summary')}`);
        console.log(t.muted.chalk('  ─────────────────────────────────────────'));
        console.log(`  ${t.subtitle.chalk('Total tasks:')}     ${summary.total}`);
        for (const def of defs) {
            const count = statusCounts[def.key] || 0;
            if (count > 0) {
                console.log(`  ${t.subtitle.chalk(def.label + ':')}`.padEnd(30) + statusChalkFn(def.key, defs)(String(count)));
            }
        }
        console.log(`  ${t.subtitle.chalk('Time spent:')}    ${summary.totalTimeSpent > 0 ? formatDuration(summary.totalTimeSpent) : t.muted.chalk('none')}`);
        console.log('');
    });
