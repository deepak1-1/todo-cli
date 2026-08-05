// ============================================================
// Jira REST API client
// ============================================================

import * as crypto from 'node:crypto';
import { PluginLogger } from '../../plugins/types.js';
import { createTokenBucket, RateLimiter } from '../shared/rate-limit.js';
import { withRetry } from '../shared/retry.js';

interface JiraIssue {
    key: string;
    id: string;
    fields: {
        summary: string;
        description?: unknown; // Jira v3 returns ADF object, not string
        priority?: { name: string } | null;
        status?: { name: string } | null;
        duedate?: string | null;
        assignee?: { displayName: string } | null;
        labels?: string[];
        project?: { key: string; name: string };
    };
}

/** Extract plain text from Jira ADF (Atlassian Document Format) object */
function extractTextFromAdf(node: unknown): string {
    if (!node || typeof node !== 'object') return '';
    const n = node as Record<string, unknown>;
    if (n.type === 'text' && typeof n.text === 'string') return n.text;
    if (Array.isArray(n.content)) {
        return (n.content as unknown[]).map(extractTextFromAdf).join('');
    }
    return '';
}

interface JiraTransition {
    id: string;
    name: string;
    to: { name: string };
}

/** Error subclass that carries a parsed Retry-After delay for withRetry. */
class JiraApiError extends Error {
    retryAfterMs?: number;
    constructor(message: string, retryAfterMs?: number) {
        super(message);
        this.retryAfterMs = retryAfterMs;
    }
}

export class JiraClient {
    private domain: string;
    private email: string;
    private token: string;
    private logger: PluginLogger;
    private limiter: RateLimiter;

    constructor(domain: string, email: string, token: string, logger: PluginLogger) {
        this.domain = domain;
        this.email = email;
        this.token = token;
        this.logger = logger;
        // 100 requests per minute, burst of 100
        this.limiter = createTokenBucket({ name: 'jira', rps: 100 / 60, burst: 100 });
    }

    /** Extract plain text from Jira ADF object */
    extractAdfText(node: unknown): string {
        return extractTextFromAdf(node);
    }

    private getBaseUrl(): string {
        const cleanDomain = this.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
        return `https://${cleanDomain}/rest/api/3`;
    }

    private getAuthHeader(): string {
        const credentials = `${this.email}:${this.token}`;
        return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }

    private async request<T>(
        method: string,
        endpoint: string,
        body?: Record<string, unknown>,
    ): Promise<T> {
        return withRetry(async () => {
            // Consume a rate-limit token on every attempt (including retries).
            await this.limiter.take();

            const url = `${this.getBaseUrl()}${endpoint}`;
            const options: RequestInit = {
                method,
                headers: {
                    Authorization: this.getAuthHeader(),
                    'Content-Type': 'application/json',
                },
            };

            if (body) {
                options.body = JSON.stringify(body);
            }

            const response = await fetch(url, options);

            if (!response.ok) {
                const errorText = await response.text();
                // Parse Retry-After header for 429 responses and pass it to withRetry.
                let retryAfterMs: number | undefined;
                if (response.status === 429) {
                    const retryAfter = response.headers.get('Retry-After');
                    if (retryAfter) {
                        const seconds = Number.parseInt(retryAfter, 10);
                        if (Number.isInteger(seconds) && seconds > 0) {
                            retryAfterMs = seconds * 1000;
                        }
                    }
                }
                const err = new JiraApiError(
                    `Jira API error (${response.status}): ${errorText}`,
                    retryAfterMs,
                );
                this.logger.error(`Request failed: ${err.message}`);
                throw err;
            }

            // Jira Cloud returns 204 (or an empty body) on successful mutations like PUT/POST transitions.
            if (response.status === 204) return undefined as T;
            const text = await response.text();
            if (text.length === 0) return undefined as T;
            return JSON.parse(text) as T;
        });
    }

    async getMyself(): Promise<{ accountId: string; emailAddress: string; displayName: string }> {
        return this.request('GET', '/myself');
    }

    async search(jql: string, fields?: string[], maxResults?: number, nextPageToken?: string) {
        const params = new URLSearchParams();
        params.append('jql', jql);
        if (fields && fields.length > 0) {
            params.append('fields', fields.join(','));
        }
        if (maxResults) {
            params.append('maxResults', maxResults.toString());
        }
        if (nextPageToken) {
            params.append('nextPageToken', nextPageToken);
        }

        // Uses the new /search/jql endpoint (replaces deprecated /search)
        return this.request<{
            issues: JiraIssue[];
            total: number;
            maxResults: number;
            nextPageToken?: string;
        }>('GET', `/search/jql?${params.toString()}`);
    }

    async searchAll(jql: string, fields?: string[], maxResults: number = 50): Promise<JiraIssue[]> {
        const allIssues: JiraIssue[] = [];
        let nextPageToken: string | undefined;

        do {
            const result = await this.search(jql, fields, maxResults, nextPageToken);
            allIssues.push(...result.issues);
            nextPageToken = result.nextPageToken;
        } while (nextPageToken);

        return allIssues;
    }

    async getIssue(key: string): Promise<JiraIssue> {
        return this.request('GET', `/issue/${key}`);
    }

    async updateIssue(key: string, fields: Record<string, unknown>): Promise<void> {
        return this.request('PUT', `/issue/${key}`, { fields });
    }

    async getTransitions(key: string): Promise<JiraTransition[]> {
        const response = await this.request<{ transitions: JiraTransition[] }>(
            'GET',
            `/issue/${key}/transitions`,
        );
        return response.transitions;
    }

    async doTransition(key: string, transitionId: string): Promise<void> {
        return this.request('POST', `/issue/${key}/transitions`, {
            transition: { id: transitionId },
        });
    }

    computeSyncHash(issue: JiraIssue): string {
        const data = JSON.stringify({
            summary: issue.fields.summary,
            status: issue.fields.status?.name,
            priority: issue.fields.priority?.name,
            duedate: issue.fields.duedate,
        });

        return crypto.createHash('sha256').update(data).digest('hex');
    }
}
