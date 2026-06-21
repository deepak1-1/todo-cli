// ============================================================
// Jira Cloud integration provider
// ============================================================

import { Task, CreateTaskInput, TaskPriority } from '../../core/types.js';
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
import { JiraClient } from './jira-client.js';

const JIRA_DOMAIN_KEY = 'jira:domain';
const JIRA_EMAIL_KEY = 'jira:email';
const JIRA_TOKEN_KEY = 'jira:token';

const logger = createPluginLogger('jira');

function mapJiraPriority(jiraPriority: string | undefined): TaskPriority | undefined {
    if (!jiraPriority) return undefined;

    const priorityMap: Record<string, TaskPriority> = {
        Highest: 'urgent',
        High: 'high',
        Medium: 'medium',
        Low: 'low',
        Lowest: 'low',
    };

    return priorityMap[jiraPriority];
}

function mapJiraStatus(jiraStatus: string | undefined): string {
    if (!jiraStatus) return 'todo';
    const lower = jiraStatus.toLowerCase();
    if (lower === 'done' || lower === 'closed' || lower === 'resolved' || lower.startsWith('released')) return 'done';
    if (lower === 'in review' || lower === 'in qa' || lower === 'review') return 'in_review';
    if (lower === 'in progress' || lower === 'in development') return 'in_progress';
    return 'todo';
}

function mapLocalPriority(localPriority: TaskPriority): string {
    const priorityMap: Record<TaskPriority, string> = {
        urgent: 'Highest',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
    };

    return priorityMap[localPriority];
}

const jiraProvider: IntegrationProvider = {
    name: 'jira',
    displayName: 'Jira Cloud',
    description: 'Sync tasks with Jira Cloud issues',
    version: '0.5.0',

    async auth(store: CredentialStore, prompt: PromptFn): Promise<void> {
        logger.info('Starting Jira authentication...');

        const domain = await prompt('Enter Jira domain (e.g., company.atlassian.net):', {
            type: 'text',
        });

        if (!domain) {
            throw new Error('Jira domain is required');
        }

        const email = await prompt('Enter email address:', { type: 'text' });

        if (!email) {
            throw new Error('Email is required');
        }

        const token = await prompt(
            'Enter API token (generate at https://id.atlassian.com/manage-profile/security/api-tokens):',
            { type: 'password' },
        );

        if (!token) {
            throw new Error('API token is required');
        }

        // Verify credentials
        const client = new JiraClient(domain, email, token, logger);

        try {
            await client.getMyself();
            logger.info('Authentication successful');
        } catch (err: unknown) {
            throw new Error(`Failed to authenticate: ${err instanceof Error ? err.message : String(err)}`);
        }

        // Store credentials
        await store.set(JIRA_DOMAIN_KEY, domain);
        await store.set(JIRA_EMAIL_KEY, email);
        await store.set(JIRA_TOKEN_KEY, token);
    },

    async healthCheck(store: CredentialStore): Promise<boolean> {
        try {
            const domain = await store.get(JIRA_DOMAIN_KEY);
            const email = await store.get(JIRA_EMAIL_KEY);
            const token = await store.get(JIRA_TOKEN_KEY);

            if (!domain || !email || !token) {
                return false;
            }

            const client = new JiraClient(domain, email, token, logger);
            await client.getMyself();

            return true;
        } catch (err: unknown) {
            logger.debug(`Health check failed: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    },

    async pull(store: CredentialStore, filters: PullFilters): Promise<ExternalTask[]> {
        const domain = await store.get(JIRA_DOMAIN_KEY);
        const email = await store.get(JIRA_EMAIL_KEY);
        const token = await store.get(JIRA_TOKEN_KEY);

        if (!domain || !email || !token) {
            throw new Error('Jira credentials not found. Run "todo integrate setup jira" first');
        }

        const client = new JiraClient(domain, email, token, logger);

        // Build JQL
        const jqlParts: string[] = [];

        if (filters.project) {
            const sanitized = filters.project.replace(/['\"\\]/g, '');
            jqlParts.push(`project = "${sanitized}"`);
        }

        if (filters.status) {
            const sanitized = filters.status.replace(/['\"\\]/g, '');
            jqlParts.push(`status = "${sanitized}"`);
        }

        if (filters.sprint === 'openSprints') {
            jqlParts.push('sprint in openSprints()');
        }

        if (jqlParts.length === 0) {
            jqlParts.push('assignee = currentUser()');
        }

        const jql = jqlParts.join(' AND ');
        const maxResults = filters.maxResults || 50;

        logger.debug(`Searching with JQL: ${jql}`);

        const result = await client.search(
            jql,
            ['summary', 'description', 'status', 'priority', 'duedate', 'labels', 'assignee', 'project'],
            maxResults,
        );

        const tasks: ExternalTask[] = result.issues.map((issue) => {
            const priority = mapJiraPriority(issue.fields.priority?.name);

            // Jira v3 returns description as ADF object — extract plain text
            let description: string | undefined;
            if (typeof issue.fields.description === 'string') {
                description = issue.fields.description;
            } else if (issue.fields.description && typeof issue.fields.description === 'object') {
                description = client.extractAdfText(issue.fields.description);
            }

            return {
                externalId: issue.id,
                externalRef: issue.key,
                externalUrl: `https://${domain}/browse/${issue.key}`,
                title: issue.fields.summary,
                description: description || undefined,
                status: issue.fields.status?.name || 'To Do',
                priority,
                dueDate: issue.fields.duedate || undefined,
                labels: issue.fields.labels || undefined,
                project: issue.fields.project?.name || issue.fields.project?.key || undefined,
                assignee: issue.fields.assignee?.displayName || undefined,
                metadata: {
                    jiraKey: issue.key,
                    jiraId: issue.id,
                    syncHash: client.computeSyncHash(issue),
                },
            };
        });

        logger.info(`Pulled ${tasks.length} issues from Jira`);

        return tasks;
    },

    async push(store: CredentialStore, task: Task, externalRef: string, _statusDefs?: StatusDef[]): Promise<PushResult> {
        const domain = await store.get(JIRA_DOMAIN_KEY);
        const email = await store.get(JIRA_EMAIL_KEY);
        const token = await store.get(JIRA_TOKEN_KEY);

        if (!domain || !email || !token) {
            throw new Error('Jira credentials not found. Run "todo integrate setup jira" first');
        }

        const client = new JiraClient(domain, email, token, logger);

        try {
            await client.getIssue(externalRef);

            const transitions = await client.getTransitions(externalRef);

            // Map local status to Jira transition names
            const statusToJiraNames: Record<string, string[]> = {
                done: ['Done', 'Closed', 'Resolved'],
                in_progress: ['In Progress', 'In Development'],
                in_review: ['In Review', 'In QA', 'Review'],
                todo: ['To Do', 'Open', 'Backlog', 'New'],
                blocked: ['Blocked', 'On Hold'],
                archived: ['Done', 'Closed'],
            };

            let transitionId: string | undefined;
            const jiraNames = statusToJiraNames[task.status];
            if (jiraNames) {
                for (const name of jiraNames) {
                    transitionId = transitions.find((t) => t.to.name === name)?.id;
                    if (transitionId) break;
                }
            }

            if (transitionId) {
                await client.doTransition(externalRef, transitionId);
                logger.info(`Transitioned ${externalRef} to ${task.status}`);
            }

            const updatedFields: string[] = [];

            // Update other fields if needed
            if (task.priority) {
                const jiraPriority = mapLocalPriority(task.priority);
                await client.updateIssue(externalRef, {
                    priority: { name: jiraPriority },
                });
                updatedFields.push('priority');
            }

            if (task.dueDate) {
                await client.updateIssue(externalRef, {
                    duedate: task.dueDate,
                });
                updatedFields.push('dueDate');
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

    mapToLocal(external: ExternalTask): Partial<CreateTaskInput> & { status?: string } {
        return {
            title: external.title,
            description: external.description,
            priority: mapJiraPriority(external.priority),
            status: mapJiraStatus(external.status),
            dueDate: external.dueDate,
        };
    },

    mapToRemote(task: Task): Record<string, unknown> {
        return {
            summary: task.title,
            description: task.description,
            duedate: task.dueDate,
            priority: mapLocalPriority(task.priority),
        };
    },

    commands(): PluginCommand[] {
        return [];
    },
};

export const manifest = {
    name: 'jira',
    displayName: 'Jira Cloud',
    description: 'Sync tasks with Jira Cloud issues',
    version: '0.5.0',
    author: 'todo-cli',
    builtIn: true,
};

export default jiraProvider;
