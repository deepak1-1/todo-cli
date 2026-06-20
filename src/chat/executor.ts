// Intent executor — maps parsed intents to repo operations.
import type { AppContext } from '../commands/context.js';
import { getDb } from '../storage/database.js';
import type { Intent } from './intent.js';
import type { Task, TaskFilters, TaskStatus, TaskPriority } from '../core/types.js';
import { formatDuration } from '../core/timer.js';
import { parseDate } from '../utils/date.js';
import { formatTaskDetail, success, error } from '../utils/format.js';
import { theme } from '../utils/theme.js';
import { colorizeProject } from '../utils/project-color.js';
import { getHookManager } from '../plugins/hook-manager.js';
import { logWarn } from '../utils/logger.js';
import { applyAdd } from '../commands/add.js';
import { applyEdit } from '../commands/edit.js';
import { applyDelete } from '../commands/delete.js';

/** Format rows as plain aligned text — no borders, works at any terminal width */
function formatPlainTable(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '';
    const columns = Object.keys(rows[0]);
    const t = theme();

    const widths = columns.map(col => {
        const maxData = rows.reduce((max, row) => {
            const val = row[col] === null ? '-' : String(row[col]);
            return Math.max(max, val.length);
        }, 0);
        return Math.max(col.length, Math.min(maxData, 50));
    });

    const header = columns.map((col, i) => t.accent.chalk(col.padEnd(widths[i]))).join('  ');
    const sep = columns.map((_, i) => '─'.repeat(widths[i])).join('──');

    const lines = rows.map(row =>
        columns.map((col, i) => {
            const val = row[col] === null ? t.muted.chalk('-') : String(row[col]);
            return val.padEnd(widths[i]);
        }).join('  ')
    );

    return ['  ' + header, '  ' + sep, ...lines.map(l => '  ' + l)].join('\n');
}

/** Format task list as plain text (no box borders) */
function formatTaskList(tasks: { id: number; title: string; status: string; priority: string; projectName?: string | null; projectColor?: string | null }[]): string {
    const t = theme();
    const lines = tasks.map(tk => {
        const id = t.id.chalk(`#${tk.id}`);
        const priority = t[`priority${tk.priority.charAt(0).toUpperCase()}${tk.priority.slice(1)}` as keyof typeof t]?.chalk(tk.priority) ?? tk.priority;
        const status = t[`status${tk.status.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('')}` as keyof typeof t]?.chalk(tk.status) ?? tk.status;
        const project = tk.projectName ? colorizeProject(tk.projectName, tk.projectColor) : '';
        return `  ${id}  ${priority.padEnd(16)}  ${tk.title}  ${project}  ${status}`;
    });
    return lines.join('\n');
}

export interface ExecutionResult {
    message: string;
    taskOutput?: string;
}

export class IntentExecutor {
    pendingDelete: { taskId: number; title: string } | null = null;

    constructor(private ctx: AppContext) {}

    async execute(intent: Intent): Promise<ExecutionResult> {
        if (this.pendingDelete && intent.action === 'clarify') {
            return this.handleDeleteConfirmation(intent);
        }

        try {
            switch (intent.action) {
                case 'create_task': return this.createTask(intent);
                case 'update_task': return this.updateTask(intent);
                case 'delete_task': return this.deleteTask(intent);
                case 'update_status': return this.updateStatus(intent);
                case 'list': return this.listTasks(intent);
                case 'show_detail': return this.showDetail(intent);
                case 'show_stats': return this.showStats();
                case 'start_timer': return this.startTimer(intent);
                case 'stop_timer': return this.stopTimer(intent);
                case 'adjust_time': return this.adjustTime(intent);
                case 'jira_pull': return await this.jiraPull();
                case 'jira_push': return await this.jiraPush(intent);
                case 'github_pull': return await this.githubPull();
                case 'github_push': return await this.githubPush(intent);
                case 'query': return this.runQuery(intent);
                case 'help': return this.showHelp();
                case 'clarify': return { message: intent.message || 'Could you provide more details?' };
                default: return { message: `I don't understand "${intent.action}". Type "help" for examples.` };
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { message: error(`Something went wrong: ${msg}`) };
        }
    }

    private createTask(intent: Intent): ExecutionResult {
        if (!intent.title) {
            return { message: 'What should the task be called?' };
        }

        let projectId: number | null = null;
        if (intent.project) {
            projectId = this.ctx.projectRepo.getOrCreate(intent.project).id;
        }

        const dueDate = intent.due ? parseDate(intent.due) : null;

        let result: { task: Task };
        try {
            result = applyAdd(this.ctx, {
                title: intent.title,
                description: intent.description,
                priority: (intent.priority as TaskPriority) || 'medium',
                projectId,
                dueDate,
                tags: intent.tags,
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return { message: `${msg} Please provide valid details.` };
        }

        const { task } = result;
        const parts = [success(`Created task #${task.id}: ${task.title}`)];
        if (task.priority !== 'medium') parts.push(`[${task.priority}]`);
        if (dueDate) parts.push(`(due: ${dueDate})`);
        if (intent.project) parts.push(`in ${intent.project}`);
        return { message: parts.join(' ') };
    }

    private updateTask(intent: Intent): ExecutionResult {
        if (!intent.taskId) return { message: 'Which task? Provide a task number.' };

        const projectStr = typeof intent.project === 'string' ? intent.project : undefined;

        try {
            applyEdit(this.ctx, intent.taskId, {
                title: intent.title,
                priority: intent.priority,
                description: intent.description,
                due: intent.due,
                project: projectStr,
                tag: intent.tags,
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return { message: msg };
        }

        return { message: success(`Updated task #${intent.taskId}`) };
    }

    private deleteTask(intent: Intent): ExecutionResult {
        if (!intent.taskId) return { message: 'Which task? Provide a task number.' };

        const task = this.ctx.taskRepo.getById(intent.taskId);
        if (!task) return { message: error(`Task #${intent.taskId} not found.`) };

        this.pendingDelete = { taskId: intent.taskId, title: task.title };
        return { message: `Are you sure you want to delete task #${intent.taskId}: "${task.title}"? Type ${theme().heading.chalk('yes')} to confirm.` };
    }

    /** Handle user's confirmation (or rejection) for a pending delete */
    handleDeleteConfirmation(intent: Intent): ExecutionResult {
        const pending = this.pendingDelete;
        if (!pending) return { message: 'Nothing to confirm.' };

        const msg = (intent.message || '').toLowerCase().trim();
        if (msg === 'yes' || msg === 'confirm' || msg === 'y') {
            this.pendingDelete = null;

            try {
                applyDelete(this.ctx, pending.taskId);
            } catch (e: unknown) {
                const errMsg = e instanceof Error ? e.message : String(e);
                return { message: error(errMsg) };
            }

            return { message: success(`Archived task #${pending.taskId}: ${pending.title}`) };
        }

        this.pendingDelete = null;
        return { message: 'Delete cancelled.' };
    }

    private updateStatus(intent: Intent): ExecutionResult {
        if (!intent.taskId) return { message: 'Which task? Provide a task number.' };
        if (!intent.status) return { message: 'What status? (pending, in_progress, in_qa, done, archived)' };

        const task = this.ctx.taskRepo.getById(intent.taskId);
        if (!task) return { message: error(`Task #${intent.taskId} not found.`) };

        let recurring: { id: number; dueDate: string } | undefined;
        try {
            const result = applyEdit(this.ctx, intent.taskId, { status: intent.status });
            recurring = result.recurring;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return { message: msg };
        }

        const labels: Record<string, string> = {
            pending: 'reopened', in_progress: 'started', in_qa: 'moved to review',
            done: 'completed', archived: 'archived',
        };
        const statusLabel = intent.status as TaskStatus;
        const base = success(`Task #${intent.taskId} ${labels[statusLabel] || statusLabel}: ${task.title}`);
        if (recurring) {
            return { message: `${base}\n  Next occurrence: task #${recurring.id} due ${recurring.dueDate.slice(0, 10)}` };
        }
        return { message: base };
    }

    private listTasks(intent: Intent): ExecutionResult {
        const filters: TaskFilters = { includeArchived: false };

        if (intent.filters) {
            if (intent.filters.status) filters.status = intent.filters.status as TaskStatus;
            if (intent.filters.priority) filters.priority = intent.filters.priority as TaskPriority;
            if (intent.filters.project) filters.projectName = intent.filters.project;
            if (intent.filters.tag) filters.tags = [intent.filters.tag];
            if (intent.filters.due) filters.dueDate = intent.filters.due;
            if (intent.filters.search) filters.search = intent.filters.search;
        }

        const tasks = this.ctx.taskRepo.list(filters);
        if (tasks.length === 0) return { message: 'No tasks found.' };

        return {
            message: `Found ${tasks.length} task${tasks.length !== 1 ? 's' : ''}:`,
            taskOutput: formatTaskList(tasks),
        };
    }

    private showDetail(intent: Intent): ExecutionResult {
        if (!intent.taskId) return { message: 'Which task? Provide a task number.' };

        const task = this.ctx.taskRepo.getByIdWithRelations(intent.taskId);
        if (!task) return { message: error(`Task #${intent.taskId} not found.`) };

        return { message: '', taskOutput: formatTaskDetail(task) };
    }

    private showStats(): ExecutionResult {
        const counts = this.ctx.taskRepo.countByStatus();
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const overdue = this.ctx.taskRepo.list({ dueDate: 'overdue' }).length;

        const lines = [
            `Total: ${total} tasks`,
            `  Pending:     ${counts.pending || 0}`,
            `  In Progress: ${counts.in_progress || 0}`,
            `  In Review:   ${counts.in_qa || 0}`,
            `  Done:        ${counts.done || 0}`,
            `  Archived:    ${counts.archived || 0}`,
        ];
        if (overdue > 0) lines.push(`  Overdue:     ${overdue}`);

        return { message: lines.join('\n') };
    }

    private startTimer(intent: Intent): ExecutionResult {
        if (!intent.taskId) return { message: 'Which task? Provide a task number.' };

        const task = this.ctx.taskRepo.getById(intent.taskId);
        if (!task) return { message: error(`Task #${intent.taskId} not found.`) };

        this.ctx.trackingRepo.start(intent.taskId);
        return { message: success(`Timer started on task #${intent.taskId}: ${task.title}`) };
    }

    private stopTimer(intent: Intent): ExecutionResult {
        const stopped = this.ctx.trackingRepo.stop(intent.taskId);
        if (!stopped) return { message: 'No active timers.' };

        return { message: success(`Timer stopped.`) };
    }

    private adjustTime(intent: Intent): ExecutionResult {
        if (!intent.taskId) return { message: 'Which task? Provide a task number.' };
        if (intent.timeAdjustSeconds === undefined) return { message: 'How much time? e.g. "remove 2 hours from task 5"' };

        const task = this.ctx.taskRepo.getById(intent.taskId);
        if (!task) return { message: error(`Task #${intent.taskId} not found.`) };

        const oldTime = task.timeSpent;
        const newTime = Math.max(0, oldTime + intent.timeAdjustSeconds);
        const updated = this.ctx.taskRepo.update(intent.taskId, { timeSpent: newTime });
        if (updated) getHookManager().onTaskUpdate(updated, { timeSpent: newTime }).catch((e) => logWarn(`Hook error: ${e instanceof Error ? e.message : String(e)}`));

        const oldStr = formatDuration(oldTime, true);
        const newStr = formatDuration(newTime, true);
        return { message: success(`Task #${intent.taskId} time: ${oldStr} → ${newStr}`) };
    }

    private async jiraPull(): Promise<ExecutionResult> {
        try {
            const jiraProvider = (await import('../integrations/jira/index.js')).default;
            const { EncryptedCredentialStore } = await import('../plugins/index.js');
            const store = new EncryptedCredentialStore();
            const issues = await jiraProvider.pull(store, {});

            if (issues.length === 0) return { message: 'No Jira issues found.' };

            let imported = 0;
            for (const issue of issues) {
                const existing = this.ctx.taskRepo.findByJiraKey(issue.externalRef);
                if (existing) continue;

                const mapped = jiraProvider.mapToLocal(issue);
                const created = this.ctx.taskRepo.create({
                    title: mapped.title || issue.title,
                    description: mapped.description,
                    priority: mapped.priority || 'medium',
                    dueDate: mapped.dueDate,
                });
                getHookManager().onTaskCreate(created).catch((e) => logWarn(`Hook error: ${e instanceof Error ? e.message : String(e)}`));
                imported++;
            }

            return { message: success(`Pulled ${issues.length} issues from Jira, imported ${imported} new tasks.`) };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('credentials not found')) {
                return { message: error('Jira not configured. Run: todo jira auth') };
            }
            return { message: error(`Jira pull failed: ${msg}`) };
        }
    }

    private async jiraPush(intent: Intent): Promise<ExecutionResult> {
        if (!intent.taskId) return { message: 'Which task? Provide a task number.' };

        const task = this.ctx.taskRepo.getById(intent.taskId);
        if (!task) return { message: error(`Task #${intent.taskId} not found.`) };
        if (!task.jiraKey) return { message: error(`Task #${intent.taskId} is not linked to Jira. Use: todo jira link ${intent.taskId} <JIRA-KEY>`) };

        try {
            const jiraProvider = (await import('../integrations/jira/index.js')).default;
            const { EncryptedCredentialStore } = await import('../plugins/index.js');
            const result = await jiraProvider.push(new EncryptedCredentialStore(), task, task.jiraKey);
            return { message: result.success ? success(result.message) : error(result.message) };
        } catch (err: unknown) {
            return { message: error(`Jira push failed: ${err instanceof Error ? err.message : String(err)}`) };
        }
    }

    private async githubPull(): Promise<ExecutionResult> {
        try {
            const ghProvider = (await import('../integrations/github/index.js')).default;
            const { EncryptedCredentialStore } = await import('../plugins/index.js');
            const store = new EncryptedCredentialStore();
            const issues = await ghProvider.pull(store, {});

            if (issues.length === 0) return { message: 'No GitHub issues found.' };

            let imported = 0;
            for (const issue of issues) {
                const existing = this.ctx.taskRepo.findByGithubRef(issue.externalRef);
                if (existing) continue;

                const mapped = ghProvider.mapToLocal(issue);
                const created = this.ctx.taskRepo.create({
                    title: mapped.title || issue.title,
                    description: mapped.description,
                    priority: mapped.priority || 'medium',
                    dueDate: mapped.dueDate,
                    tags: mapped.tags,
                });
                getHookManager().onTaskCreate(created).catch((e) => logWarn(`Hook error: ${e instanceof Error ? e.message : String(e)}`));
                imported++;
            }

            return { message: success(`Pulled ${issues.length} issues from GitHub, imported ${imported} new tasks.`) };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('not authenticated') || msg.includes('not installed')) {
                return { message: error(`GitHub not configured. Run: todo gh auth`) };
            }
            return { message: error(`GitHub pull failed: ${msg}`) };
        }
    }

    private async githubPush(intent: Intent): Promise<ExecutionResult> {
        if (!intent.taskId) return { message: 'Which task? Provide a task number.' };

        const task = this.ctx.taskRepo.getById(intent.taskId);
        if (!task) return { message: error(`Task #${intent.taskId} not found.`) };
        if (!task.githubRef) return { message: error(`Task #${intent.taskId} is not linked to GitHub. Use: todo gh link ${intent.taskId} <owner/repo#num>`) };

        try {
            const ghProvider = (await import('../integrations/github/index.js')).default;
            const { EncryptedCredentialStore } = await import('../plugins/index.js');
            const result = await ghProvider.push(new EncryptedCredentialStore(), task, task.githubRef);
            return { message: result.success ? success(result.message) : error(result.message) };
        } catch (err: unknown) {
            return { message: error(`GitHub push failed: ${err instanceof Error ? err.message : String(err)}`) };
        }
    }

    private runQuery(intent: Intent): ExecutionResult {
        if (!intent.sql) return { message: 'What would you like to know? Ask about trends, summaries, or data.' };

        const trimmed = intent.sql.trim();
        if (!/^SELECT\b/i.test(trimmed)) {
            return { message: error('Only SELECT queries are allowed for safety.') };
        }

        const blocked = /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA)\b/i;
        if (blocked.test(trimmed)) {
            return { message: error('Query contains disallowed keywords.') };
        }

        try {
            const db = getDb();
            const rows = db.prepare(trimmed).all() as Record<string, unknown>[];

            if (rows.length === 0) return { message: 'No results.' };

            const output = formatPlainTable(rows.slice(0, 50));
            const suffix = rows.length > 50 ? `\n  ... and ${rows.length - 50} more rows` : '';
            return {
                message: `${rows.length} result${rows.length !== 1 ? 's' : ''}:`,
                taskOutput: output + suffix,
            };
        } catch (err: unknown) {
            return { message: error(`Query failed: ${err instanceof Error ? err.message : String(err)}`) };
        }
    }

    private showHelp(): ExecutionResult {
        return {
            message: [
                'Here\'s what you can say:',
                '',
                '  Task Management:',
                '    "add task buy groceries due tomorrow priority high"',
                '    "create a task to review PR in project backend"',
                '    "mark task 5 as done"',
                '    "start working on task 3"',
                '    "delete task 7"',
                '    "move task 2 to review"',
                '',
                '  Viewing Tasks:',
                '    "show all tasks"',
                '    "what\'s due today?"',
                '    "show overdue tasks"',
                '    "show task 4"',
                '    "show stats"',
                '',
                '  Integrations:',
                '    "pull from jira"',
                '    "pull github issues"',
                '    "push task 5 to jira"',
                '',
                '  Timer:',
                '    "start timer on task 3"',
                '    "stop timer"',
                '',
                '  Data Queries:',
                '    "how many tasks did I complete this week?"',
                '    "show me time spent by project"',
                '    "what\'s my busiest day?"',
                '    "average time to complete a task"',
                '',
                '  Type .exit or Ctrl+C twice to quit.',
            ].join('\n'),
        };
    }
}
