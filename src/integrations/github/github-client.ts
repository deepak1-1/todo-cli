// ============================================================
// GitHub client — wraps the `gh` CLI
// ============================================================

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PluginLogger } from '../../plugins/types.js';
import { parsePrUrl } from './ref.js';
import { withRetry } from '../shared/retry.js';

const execFileAsync = promisify(execFile);

export interface GitHubIssue {
    id: number;
    number: number;
    title: string;
    body?: string | null;
    state: string;
    labels: Array<{ name: string }>;
    milestone?: { title: string } | null;
    assignee?: { login: string } | null;
    due_on?: string | null;
    html_url: string;
}

export interface GitHubUser {
    login: string;
    id: number;
    name: string | null;
    email: string | null;
}

export interface GitHubCommitStatus {
    state: 'pending' | 'success' | 'failure' | 'error';
    description?: string;
}

// gh CLI exits with code 4 for auth/token failures — never retry those.
const GH_AUTH_EXIT_CODES = new Set([4]);

/**
 * Retry predicate for gh CLI errors.
 * Auth failures (exit 4) must not be retried — they are permanent until re-auth.
 * Network-level errors and transient 5xx-style messages may be retried.
 */
function shouldRetryGhError(err: unknown): boolean {
    if (err instanceof Error) {
        // Extract exit code from child-process errors.
        const exitCode = (err as NodeJS.ErrnoException & { code?: unknown }).code;
        if (typeof exitCode === 'number' && GH_AUTH_EXIT_CODES.has(exitCode)) return false;
        // execFile encodes exit code in the "status" property (via promisify).
        const status = (err as unknown as Record<string, unknown>).status;
        if (typeof status === 'number' && GH_AUTH_EXIT_CODES.has(status)) return false;
        // Also check stderr text for auth-failure signals (belt-and-suspenders).
        const stderr = (err as unknown as Record<string, unknown>).stderr;
        if (typeof stderr === 'string' && /not logged into|authentication required|token invalid/i.test(stderr)) {
            return false;
        }
    }
    // Fall back to the shared default: retry on network errors and HTTP 5xx/429 hints.
    const msg = err instanceof Error ? err.message : String(err);
    const isNetworkErr = /ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN/.test(msg);
    const is5xxErr = /\b5\d{2}\b/.test(msg);
    return isNetworkErr || is5xxErr;
}

export class GitHubClient {
    private logger: PluginLogger;

    constructor(logger: PluginLogger) {
        this.logger = logger;
    }

    /** Run a gh command and return parsed JSON output */
    private async gh<T>(args: string[]): Promise<T> {
        this.logger.debug(`gh ${args.join(' ')}`);
        return withRetry(
            async () => {
                try {
                    const { stdout } = await execFileAsync('gh', args, {
                        timeout: 30_000,
                        maxBuffer: 10 * 1024 * 1024,
                    });
                    return JSON.parse(stdout) as T;
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.logger.error(`gh command failed: ${msg}`);
                    // Rethrow original so shouldRetryGhError can inspect .status/.stderr.
                    throw err;
                }
            },
            { shouldRetry: shouldRetryGhError },
        );
    }

    /** Run a gh command and return raw stdout */
    private async ghRaw(args: string[]): Promise<string> {
        this.logger.debug(`gh ${args.join(' ')}`);
        return withRetry(
            async () => {
                const { stdout } = await execFileAsync('gh', args, {
                    timeout: 30_000,
                    maxBuffer: 10 * 1024 * 1024,
                });
                return stdout.trim();
            },
            { shouldRetry: shouldRetryGhError },
        );
    }

    /** Check if gh CLI is authenticated (at least one active account) */
    async isAuthenticated(): Promise<boolean> {
        try {
            // gh auth status may exit non-zero if any account is unhealthy,
            // so check if we can actually call the API instead
            await this.getUser();
            return true;
        } catch {
            return false;
        }
    }

    /** Get the authenticated user */
    async getUser(): Promise<GitHubUser> {
        return this.gh<GitHubUser>(['api', 'user']);
    }

    /** Fetch issues assigned to the current user */
    async getAssignedIssues(filters?: { repo?: string; labels?: string[] }): Promise<GitHubIssue[]> {
        if (filters?.repo) {
            // Use gh issue list for a specific repo
            const args = [
                'issue', 'list',
                '--repo', filters.repo,
                '--assignee', '@me',
                '--state', 'open',
                '--limit', '100',
                '--json', 'id,number,title,body,state,labels,milestone,assignees,url',
            ];

            if (filters.labels && filters.labels.length > 0) {
                for (const label of filters.labels) {
                    args.push('--label', label);
                }
            }

            const issues = await this.gh<Array<{
                id: string;
                number: number;
                title: string;
                body: string;
                state: string;
                labels: Array<{ name: string }>;
                milestone?: { title: string } | null;
                assignees: Array<{ login: string }>;
                url: string;
            }>>(args);

            return issues.map(issue => {
                const parsedId = Number.parseInt(issue.id, 10);
                if (!Number.isInteger(parsedId) || parsedId <= 0) {
                    throw new Error(`Invalid GitHub issue id: ${issue.id}`);
                }
                return {
                    id: parsedId,
                    number: issue.number,
                    title: issue.title,
                    body: issue.body || null,
                    state: issue.state.toLowerCase(),
                    labels: issue.labels,
                    milestone: issue.milestone,
                    assignee: issue.assignees?.[0] ? { login: issue.assignees[0].login } : null,
                    due_on: null,
                    html_url: issue.url,
                };
            });
        }

        // Without repo filter, use search to find all assigned issues across repos
        const args = [
            'search', 'issues',
            '--assignee', '@me',
            '--state', 'open',
            '--limit', '100',
            '--json', 'number,title,body,state,labels,repository,assignees,url',
        ];

        if (filters?.labels && filters.labels.length > 0) {
            for (const label of filters.labels) {
                args.push('--label', label);
            }
        }

        const results = await this.gh<Array<{
            number: number;
            title: string;
            body: string;
            state: string;
            labels: Array<{ name: string }>;
            repository: { name: string; nameWithOwner: string };
            assignees: Array<{ login: string }>;
            url: string;
        }>>(args);

        return results.map(issue => ({
            id: issue.number,
            number: issue.number,
            title: issue.title,
            body: issue.body || null,
            state: issue.state.toLowerCase(),
            labels: issue.labels,
            milestone: null,
            assignee: issue.assignees?.[0] ? { login: issue.assignees[0].login } : null,
            due_on: null,
            html_url: issue.url,
        }));
    }

    /** Get a single issue */
    async getIssue(owner: string, repo: string, number: number): Promise<GitHubIssue> {
        const result = await this.gh<{
            id: string;
            number: number;
            title: string;
            body: string;
            state: string;
            labels: Array<{ name: string }>;
            milestone?: { title: string } | null;
            assignees: Array<{ login: string }>;
            url: string;
        }>([
            'issue', 'view', String(number),
            '--repo', `${owner}/${repo}`,
            '--json', 'id,number,title,body,state,labels,milestone,assignees,url',
        ]);

        const parsedId = Number.parseInt(result.id, 10);
        if (!Number.isInteger(parsedId) || parsedId <= 0) {
            throw new Error(`Invalid GitHub issue id: ${result.id}`);
        }
        return {
            id: parsedId,
            number: result.number,
            title: result.title,
            body: result.body || null,
            state: result.state.toLowerCase(),
            labels: result.labels,
            milestone: result.milestone,
            assignee: result.assignees?.[0] ? { login: result.assignees[0].login } : null,
            due_on: null,
            html_url: result.url,
        };
    }

    /** Update an issue's state or labels */
    async updateIssue(
        owner: string,
        repo: string,
        number: number,
        data: Record<string, unknown>,
    ): Promise<void> {
        const args = [
            'issue', 'edit', String(number),
            '--repo', `${owner}/${repo}`,
        ];

        if (data.state === 'closed') {
            // Close via separate command
            await this.ghRaw([
                'issue', 'close', String(number),
                '--repo', `${owner}/${repo}`,
            ]);
            return;
        }

        if (data.state === 'open') {
            await this.ghRaw([
                'issue', 'reopen', String(number),
                '--repo', `${owner}/${repo}`,
            ]);
            return;
        }

        if (Array.isArray(data.labels)) {
            for (const label of data.labels as string[]) {
                args.push('--add-label', label);
            }
        }

        if (args.length > 4) {
            await this.ghRaw(args);
        }
    }

    /** Create a pull request */
    async createPullRequest(
        owner: string,
        repo: string,
        data: {
            title: string;
            body?: string;
            head: string;
            base: string;
            draft?: boolean;
        },
    ): Promise<{ number: number; html_url: string }> {
        const args = [
            'pr', 'create',
            '--repo', `${owner}/${repo}`,
            '--title', data.title,
            '--base', data.base,
            '--head', data.head,
        ];

        if (data.body) {
            args.push('--body', data.body);
        }

        if (data.draft) {
            args.push('--draft');
        }

        const url = await this.ghRaw(args);

        // gh pr create prints the PR URL; parsePrUrl extracts the number.
        const parsed = parsePrUrl(url);
        return {
            number: parsed ? parsed.number : 0,
            html_url: url,
        };
    }

    /** Get commit status */
    async getCommitStatus(owner: string, repo: string, ref: string): Promise<GitHubCommitStatus> {
        return this.gh<GitHubCommitStatus>([
            'api', `repos/${owner}/${repo}/commits/${ref}/status`,
        ]);
    }

    /** List repos accessible to the user (personal + org) */
    async listRepos(owner?: string): Promise<Array<{
        nameWithOwner: string;
        description: string;
        isPrivate: boolean;
    }>> {
        const args = ['repo', 'list'];
        if (owner) {
            args.push(owner);
        }
        args.push('--limit', '100', '--json', 'nameWithOwner,description,isPrivate');
        return this.gh(args);
    }

    /** List orgs the user belongs to */
    async listOrgs(): Promise<string[]> {
        const output = await this.ghRaw(['org', 'list']);
        if (!output) return [];
        return output.split('\n').filter(Boolean);
    }

    /** Open an issue in the browser */
    async openInBrowser(owner: string, repo: string, number: number): Promise<void> {
        await this.ghRaw([
            'issue', 'view', String(number),
            '--repo', `${owner}/${repo}`,
            '--web',
        ]);
    }
}
