// ============================================================
// GitHub integration provider (uses gh CLI)
// ============================================================

import { Task, CreateTaskInput, TaskPriority, TASK_PRIORITIES } from '../../core/types.js';
import { isComplete, isArchived } from '../../core/status.js';
import type { StatusDef } from '../../core/status.js';
import {
    IntegrationProvider,
    CredentialStore,
    PromptFn,
    ExternalTask,
    PullFilters,
    PushResult,
    PluginCommand,
    PluginHooks,
} from '../../plugins/types.js';
import { createPluginLogger } from '../../plugins/plugin-logger.js';
import { GitHubClient } from './github-client.js';
import { parseGitHubRef } from './ref.js';

const logger = createPluginLogger('github');

function mapGitHubLabel(labels: string[]): TaskPriority | undefined {
    const labelMap: Record<string, TaskPriority> = {
        'priority: critical': 'urgent',
        'priority: high': 'high',
        'priority: medium': 'medium',
        'priority: low': 'low',
    };

    for (const label of labels) {
        const mapped = labelMap[label.toLowerCase()];
        if (mapped) return mapped;
    }

    return undefined;
}

function mapLocalPriorityToLabel(priority: TaskPriority): string {
    const labelMap: Record<TaskPriority, string> = {
        urgent: 'priority: critical',
        high: 'priority: high',
        medium: 'priority: medium',
        low: 'priority: low',
    };

    return labelMap[priority];
}

const githubProvider: IntegrationProvider = {
    name: 'github',
    displayName: 'GitHub',
    description: 'Sync tasks with GitHub issues',
    version: '0.6.0',

    async auth(_store: CredentialStore, _prompt: PromptFn): Promise<void> {
        // Check if gh CLI is installed
        const { execFileSync } = await import('node:child_process');
        try {
            execFileSync('gh', ['--version'], { stdio: 'ignore' });
        } catch {
            throw new Error(
                'GitHub CLI (gh) is not installed.\n'
                + '  Install it from: https://cli.github.com\n'
                + '  macOS:   brew install gh\n'
                + '  Linux:   See https://github.com/cli/cli/blob/trunk/docs/install_linux.md\n'
                + '  Windows: winget install --id GitHub.cli',
            );
        }

        const client = new GitHubClient(logger);
        const isAuth = await client.isAuthenticated();

        if (!isAuth) {
            throw new Error(
                'gh CLI is not authenticated. Run "gh auth login" in your terminal first.',
            );
        }

        const user = await client.getUser();
        logger.info(`Authenticated via gh CLI as ${user.login}`);
    },

    async healthCheck(_store: CredentialStore): Promise<boolean> {
        try {
            const client = new GitHubClient(logger);
            return await client.isAuthenticated();
        } catch {
            return false;
        }
    },

    async pull(_store: CredentialStore, filters: PullFilters): Promise<ExternalTask[]> {
        const client = new GitHubClient(logger);

        const filterOptions: { repo?: string; labels?: string[] } = {};

        if (filters.project) {
            filterOptions.repo = filters.project;
        }

        if (filters.label) {
            filterOptions.labels = [filters.label];
        }

        const issues = await client.getAssignedIssues(filterOptions);

        const tasks: ExternalTask[] = issues.map((issue) => {
            const labels = issue.labels.map((l) => l.name);
            const priority = mapGitHubLabel(labels);

            // Parse owner/repo from URL
            const urlParts = issue.html_url.split('/');
            const owner = urlParts[3];
            const repo = urlParts[4];

            return {
                externalId: issue.id.toString(),
                externalRef: `${owner}/${repo}#${issue.number}`,
                externalUrl: issue.html_url,
                title: issue.title,
                description: issue.body || undefined,
                status: issue.state,
                priority,
                labels,
                project: repo,
                assignee: issue.assignee?.login,
                dueDate: issue.due_on || undefined,
                metadata: {
                    owner,
                    repo,
                    number: issue.number,
                },
            };
        });

        logger.info(`Pulled ${tasks.length} issues from GitHub`);

        return tasks;
    },

    async push(_store: CredentialStore, task: Task, externalRef: string, statusDefs?: StatusDef[]): Promise<PushResult> {
        const client = new GitHubClient(logger);

        try {
            const parsed = parseGitHubRef(externalRef);
            if (!parsed) {
                throw new Error(`Invalid GitHub reference format: ${externalRef}`);
            }

            const { owner, repo, number } = parsed;

            const updatedFields: string[] = [];

            // Use registry defs if provided, else fall back to key checks
            const isTerminal = statusDefs
                ? (isComplete(statusDefs, task.status) || isArchived(statusDefs, task.status))
                : (task.status === 'done' || task.status === 'archived');

            if (isTerminal) {
                await client.updateIssue(owner, repo, number, { state: 'closed' });
                updatedFields.push('state');
            } else {
                await client.updateIssue(owner, repo, number, { state: 'open' });
                updatedFields.push('state');
            }

            if (task.priority) {
                const priorityLabel = mapLocalPriorityToLabel(task.priority);
                await client.updateIssue(owner, repo, number, { labels: [priorityLabel] });
                updatedFields.push('labels');
            }

            return {
                success: true,
                externalRef,
                message: `Updated ${externalRef}`,
                updatedFields,
            };
        } catch (err: unknown) {
            logger.error(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
            return {
                success: false,
                externalRef,
                message: `Push failed: ${err instanceof Error ? err.message : String(err)}`,
                updatedFields: [],
            };
        }
    },

    mapToLocal(external: ExternalTask): Partial<CreateTaskInput> {
        return {
            title: external.title,
            description: external.description,
            priority: external.priority && TASK_PRIORITIES.includes(external.priority as TaskPriority)
                ? (external.priority as TaskPriority)
                : undefined,
            dueDate: external.dueDate,
            tags: external.labels,
        };
    },

    mapToRemote(task: Task): Record<string, unknown> {
        return {
            title: task.title,
            body: task.description,
            labels: task.priority ? [mapLocalPriorityToLabel(task.priority)] : [],
        };
    },

    commands(): PluginCommand[] {
        return [];
    },

    hooks: {
        onTaskComplete: async (task: Task): Promise<void> => {
            if (!task.githubRef) {
                return;
            }

            logger.debug(`Task completed: ${task.id} (${task.githubRef})`);
        },
    } as PluginHooks,
};

export const manifest = {
    name: 'github',
    displayName: 'GitHub',
    description: 'Sync tasks with GitHub issues',
    version: '0.6.0',
    author: 'todo-cli',
    builtIn: true,
};

export default githubProvider;
