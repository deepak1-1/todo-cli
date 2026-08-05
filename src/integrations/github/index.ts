// ============================================================
// GitHub integration provider (uses gh CLI)
// ============================================================

import { Task, CreateTaskInput, TaskPriority } from '../../core/types.js';
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
} from '../../plugins/types.js';
import { createPluginLogger } from '../../plugins/plugin-logger.js';
import { toLocalPriority } from '../shared/priority.js';
import { GitHubClient } from './github-client.js';
import { parseGitHubRef, REPO_FORMAT_RE } from './ref.js';

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

        const parsed = parseGitHubRef(externalRef);
        if (!parsed) {
            return { success: false, externalRef, message: `Invalid GitHub reference format: ${externalRef}`, updatedFields: [] };
        }

        const { owner, repo, number } = parsed;
        const updatedFields: string[] = [];

        // State change is fatal — a failed state push should surface as an error.
        try {
            const isTerminal = statusDefs
                ? (isComplete(statusDefs, task.status) || isArchived(statusDefs, task.status))
                : (task.status === 'done' || task.status === 'archived');
            await client.updateIssue(owner, repo, number, { state: isTerminal ? 'closed' : 'open' });
            updatedFields.push('state');
        } catch (err: unknown) {
            logger.error(`Push failed: ${err instanceof Error ? err.message : String(err)}`);
            return { success: false, externalRef, message: `Push failed: ${err instanceof Error ? err.message : String(err)}`, updatedFields: [] };
        }

        // Label application is best-effort — missing label must not fail the push.
        if (task.priority) {
            try {
                await client.updateIssue(owner, repo, number, { labels: [mapLocalPriorityToLabel(task.priority)] });
                updatedFields.push('labels');
            } catch (labelErr: unknown) {
                logger.warn(`Priority label failed for ${externalRef}: ${labelErr instanceof Error ? labelErr.message : String(labelErr)}`);
            }
        }

        return { success: true, externalRef, message: `Updated ${externalRef}`, updatedFields };
    },

    async createRemote(_store: CredentialStore, task: Task, target: { project: string }, statusDefs?: StatusDef[]): Promise<PushResult> {
        if (!REPO_FORMAT_RE.test(target.project)) {
            return { success: false, externalRef: '', message: `Invalid repo format "${target.project}". Expected owner/repo.`, updatedFields: [] };
        }

        // Skip terminal tasks — same guard as push()
        const isTerminal = statusDefs
            ? (isComplete(statusDefs, task.status) || isArchived(statusDefs, task.status))
            : (task.status === 'done' || task.status === 'archived');
        if (isTerminal) {
            return { success: false, externalRef: '', message: `Task #${task.id} is done/archived — skipped`, updatedFields: [] };
        }

        const [owner, repo] = target.project.split('/');
        const client = new GitHubClient(logger);
        try {
            const marker = `Created from todo-cli task #${task.id}`;
            const body = task.description?.trim()
                ? `${task.description}\n\n---\n${marker}`
                : marker;
            const { number, html_url } = await client.createIssue(owner, repo, { title: task.title, body });
            const externalRef = `${owner}/${repo}#${number}`;

            // Apply priority label best-effort — label missing must not fail the create
            if (task.priority) {
                try {
                    await client.updateIssue(owner, repo, number, { labels: [mapLocalPriorityToLabel(task.priority)] });
                } catch (labelErr: unknown) {
                    logger.warn(`Priority label failed for ${externalRef}: ${labelErr instanceof Error ? labelErr.message : String(labelErr)}`);
                }
            }

            logger.info(`Created ${externalRef} from task #${task.id}`);
            return { success: true, externalRef, message: `Created ${html_url}`, updatedFields: ['created'] };
        } catch (err: unknown) {
            logger.error(`createRemote failed: ${err instanceof Error ? err.message : String(err)}`);
            return { success: false, externalRef: '', message: `Create failed: ${err instanceof Error ? err.message : String(err)}`, updatedFields: [] };
        }
    },

    mapToLocal(external: ExternalTask): Partial<CreateTaskInput> {
        return {
            title: external.title,
            description: external.description,
            priority: toLocalPriority(external.priority),
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
