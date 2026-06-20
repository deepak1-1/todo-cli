// Output formatters — theme-aware styling, tables.

import type { TaskWithRelations, TaskPriority, TaskStatus, SearchResult } from '../core/types.js';
import { makeTable } from './table.js';
import { formatDateDisplay, isOverdue, formatLocalDateTime } from './date.js';
import { formatDuration } from '../core/timer.js';
import { theme } from './theme.js';
import { colorizeProject } from './project-color.js';

// ---- Priority formatting ----

/** Return the chalk function for a given priority (reads active theme). */
export function priorityChalkFn(priority: TaskPriority): (s: string) => string {
    const t = theme();
    const map: Record<TaskPriority, (s: string) => string> = {
        urgent: (s) => t.priorityUrgent.chalk(s),
        high: (s) => t.priorityHigh.chalk(s),
        medium: (s) => t.priorityMedium.chalk(s),
        low: (s) => t.priorityLow.chalk(s),
    };
    return map[priority] ?? ((s: string) => s);
}

/** Return the chalk function for a given status (reads active theme). */
export function statusChalkFn(status: TaskStatus): (s: string) => string {
    const t = theme();
    const map: Record<TaskStatus, (s: string) => string> = {
        pending: (s) => t.statusPending.chalk(s),
        in_progress: (s) => t.statusInProgress.chalk(s),
        in_qa: (s) => t.statusInQa.chalk(s),
        done: (s) => t.statusDone.chalk(s),
        archived: (s) => t.statusArchived.chalk(s),
    };
    return map[status] ?? ((s: string) => s);
}

// Backwards-compatible map-like accessors (read active theme at call time).
export const priorityColors: Record<TaskPriority, (s: string) => string> = {
    get urgent() { return priorityChalkFn('urgent'); },
    get high() { return priorityChalkFn('high'); },
    get medium() { return priorityChalkFn('medium'); },
    get low() { return priorityChalkFn('low'); },
};

export const statusColors: Record<TaskStatus, (s: string) => string> = {
    get pending() { return statusChalkFn('pending'); },
    get in_progress() { return statusChalkFn('in_progress'); },
    get in_qa() { return statusChalkFn('in_qa'); },
    get done() { return statusChalkFn('done'); },
    get archived() { return statusChalkFn('archived'); },
};

export function formatPriority(priority: TaskPriority): string {
    return priorityChalkFn(priority)(priority);
}

export function formatPriorityLabel(priority: TaskPriority): string {
    return priorityChalkFn(priority)(priority);
}

// Bracket marker used by `project show` — [!] urgent/high, [ ] medium, [.] low
export function formatPriorityBracket(priority: TaskPriority): string {
    const marker = priority === 'urgent' || priority === 'high' ? '[!]' :
                   priority === 'medium' ? '[ ]' : '[.]';
    return priorityChalkFn(priority)(marker);
}

// ---- Status formatting ----

const statusIcons: Record<TaskStatus, string> = {
    pending: '○',
    in_progress: '◐',
    in_qa: '◑',
    done: '●',
    archived: '◌',
};

export function formatStatus(status: TaskStatus): string {
    return statusChalkFn(status)(`${statusIcons[status]} ${status.replace('_', ' ')}`);
}

// ---- Task formatting ----

export function formatTaskOneLine(task: TaskWithRelations): string {
    const t = theme();
    const parts: string[] = [];

    parts.push(t.id.chalk(`#${task.id}`));
    if (task.jiraKey) {
        parts.push(t.ref.chalk(task.jiraKey));
    }
    parts.push(formatPriority(task.priority));
    parts.push(t.title.chalk(task.title));

    if (task.projectName) {
        parts.push(colorizeProject(task.projectName, task.projectColor));
    }

    if (task.dueDate) {
        const dateStr = formatDateDisplay(task.dueDate);
        parts.push(isOverdue(task.dueDate) ? t.dateOverdue.chalk(dateStr + '!') : t.dateNormal.chalk(dateStr));
    }

    if (task.tagNames && task.tagNames.length > 0) {
        parts.push(t.tag.chalk(task.tagNames.join(', ')));
    }

    if (task.isBlocked) {
        parts.push(t.blocked.chalk('BLOCKED'));
    }

    return parts.join('  ');
}

/** Format task list as a table */
export function formatTaskTable(tasks: (TaskWithRelations | SearchResult)[]): string {
    const t = theme();
    if (tasks.length === 0) return t.muted.chalk('  No tasks found.');

    const hasMatchInfo = tasks.some((tk) => '_matchedIn' in tk && tk._matchedIn);

    const head = ['ID', 'Ext ID', 'Priority', 'Title', 'Project', 'Tags', 'Status'];
    const colWidths = [6, 14, 10, 44, 18, 18, 16];
    if (hasMatchInfo) {
        head.push('Match');
        colWidths.push(12);
    }

    const table = makeTable({
        head,
        style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
        colWidths,
        wordWrap: true,
    });

    for (const task of tasks) {
        const row = [
            t.id.chalk(`#${task.id}`),
            task.jiraKey ? t.ref.chalk(task.jiraKey) : task.githubRef ? t.ref.chalk('#' + task.githubRef.replace(/^.*#/, '')) : '',
            formatPriority(task.priority),
            task.isBlocked ? t.blocked.chalk('⊘ ') + t.title.chalk(task.title) : t.title.chalk(task.title),
            task.projectName ? colorizeProject(task.projectName, task.projectColor) : '',
            (task.tagNames || []).join(', '),
            formatStatus(task.status),
        ];
        if (hasMatchInfo) {
            row.push(t.accent.chalk('_matchedIn' in task ? (task._matchedIn?.join(', ') || '') : ''));
        }

        table.push(row);
    }

    return table.toString();
}

/** Format task detail view */
export function formatTaskDetail(task: TaskWithRelations): string {
    const t = theme();
    const lines: string[] = [];

    lines.push('');
    lines.push(t.title.chalk(`  ${task.title}`));
    lines.push(t.panelBorder.chalk('  ' + '─'.repeat(50)));
    lines.push('');
    lines.push(`  ${t.subtitle.chalk('Status:')}     ${formatStatus(task.status)}`);
    lines.push(`  ${t.subtitle.chalk('Priority:')}   ${formatPriorityLabel(task.priority)}`);
    lines.push(`  ${t.subtitle.chalk('Project:')}    ${task.projectName ? colorizeProject(task.projectName, task.projectColor) : t.muted.chalk('(none)')}`);

    if (task.dueDate) {
        const dueStr = formatDateDisplay(task.dueDate);
        const due = isOverdue(task.dueDate) ? t.dateOverdue.chalk(dueStr + ' (overdue)') : dueStr;
        lines.push(`  ${t.subtitle.chalk('Due:')}        ${due}`);
    }

    if (task.tagNames && task.tagNames.length > 0) {
        lines.push(`  ${t.subtitle.chalk('Tags:')}       ${t.tag.chalk(task.tagNames.join('  '))}`);
    }

    if (task.timeSpent > 0) {
        lines.push(`  ${t.subtitle.chalk('Time:')}       ${formatDuration(task.timeSpent)}`);
    }

    lines.push(`  ${t.subtitle.chalk('Created:')}    ${formatLocalDateTime(task.createdAt)}`);
    if (task.completedAt) {
        lines.push(`  ${t.subtitle.chalk('Completed:')}  ${formatLocalDateTime(task.completedAt)}`);
    }

    if (task.description) {
        lines.push('');
        lines.push(t.panelBorder.chalk('  ── Description ──────────────────────────'));
        lines.push(t.body.chalk(`  ${task.description}`));
    }

    if (task.jiraKey) {
        lines.push('');
        lines.push(t.panelBorder.chalk('  ── Integrations ─────────────────────────'));
        lines.push(`  ${t.subtitle.chalk('Jira:')}  ${task.jiraKey}`);
    }

    if (task.githubRef) {
        lines.push(`  ${t.subtitle.chalk('GitHub:')} ${task.githubRef}`);
    }

    if (task.isBlocked) {
        lines.push('');
        lines.push(t.blocked.chalk('  ⊘ This task is BLOCKED by unfinished dependencies'));
    }

    lines.push('');
    return lines.join('\n');
}

/** Format a success message */
export function success(message: string): string {
    return theme().success.chalk('✓') + ' ' + message;
}

/** Format an error message */
export function error(message: string): string {
    return theme().error.chalk('✗') + ' ' + message;
}

/** Format a warning message */
export function warn(message: string): string {
    return theme().warning.chalk('⚠') + ' ' + message;
}

/** Format an info message */
export function info(message: string): string {
    return theme().info.chalk('ℹ') + ' ' + message;
}

/** Parse a task ID string, throwing if invalid */
export function parseId(value: string): number {
    const id = parseInt(value, 10);
    if (isNaN(id) || id <= 0) {
        throw new Error(`"${value}" is not a valid task ID. Please provide a positive number.`);
    }
    return id;
}

/** Parse a comma-separated list of IDs, throwing if none are valid */
export function parseIds(value: string): number[] {
    const ids = value
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(s => {
            const n = parseInt(s, 10);
            if (isNaN(n) || n <= 0) {
                return null;
            }
            return n;
        })
        .filter((n): n is number => n !== null);

    if (ids.length === 0) {
        throw new Error(
            'No valid task IDs provided. Please provide comma-separated positive numbers (e.g., 1,2,3).',
        );
    }
    return ids;
}

/** Parse an integer option value, throwing if invalid */
export function parseIntOption(value: string, optionName: string): number {
    const n = parseInt(value, 10);
    if (isNaN(n) || n <= 0) {
        throw new Error(
            `"${value}" is not a valid value for --${optionName}. Please provide a positive number.`,
        );
    }
    return n;
}
