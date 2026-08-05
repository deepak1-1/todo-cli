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

// Matches a genuine HTTP 5xx/429 status token as gh CLI renders it, e.g. "(HTTP 503)" or "(HTTP/2 503)".
const GH_HTTP_STATUS_RE = /\(\s*(?:HTTP\S*\s*)?(?:429|5\d{2})\s*\)/i;

/**
 * Retry predicate for gh CLI errors.
 * Auth failures (exit 4) must not be retried — they are permanent until re-auth.
 * Network-level errors and transient HTTP 5xx/429 status tokens in stderr may be retried.
 * Scans err.stderr (not err.message), since err.message embeds the full command line,
 * which can contain digits like an issue number that falsely look like a 5xx status.
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
        if (typeof stderr === 'string' && stderr.length > 0) {
            return GH_HTTP_STATUS_RE.test(stderr);
        }
    }
    // No stderr available (e.g. pure network rejection) — fall back to network-code detection only.
    // Do NOT scan err.message here: it embeds the full command line and would false-positive
    // on any 5xx-looking number in the args (issue #503, branch release-500, etc).
    const msg = err instanceof Error ? err.message : String(err);
    return /ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN/.test(msg);
}

export class GitHubClient {
    private logger: PluginLogger;

    constructor(logger: PluginLogger) {
        this.logger = logger;
    }

    /** Run a gh command and return parsed JSON output. Set opts.retry for idempotent reads only. */
    private async gh<T>(args: string[], opts?: { retry?: boolean }): Promise<T> {
        this.logger.debug(`gh ${args.join(' ')}`);
        const run = async (): Promise<T> => {
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
        };
        if (!opts?.retry) return run();
        return withRetry(run, { shouldRetry: shouldRetryGhError });
    }

    /** Run a gh command and return raw stdout. Set opts.retry for idempotent reads/edits only — never for creates. */
    private async ghRaw(args: string[], opts?: { retry?: boolean }): Promise<string> {
        this.logger.debug(`gh ${args.join(' ')}`);
        const run = async (): Promise<string> => {
            const { stdout } = await execFileAsync('gh', args, {
                timeout: 30_000,
                maxBuffer: 10 * 1024 * 1024,
            });
            return stdout.trim();
        };
        if (!opts?.retry) return run();
        return withRetry(run, { shouldRetry: shouldRetryGhError });
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
        return this.gh<GitHubUser>(['api', 'user'], { retry: true });
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
                '--json', 'number,title,body,state,labels,milestone,assignees,url',
            ];

            if (filters.labels && filters.labels.length > 0) {
                for (const label of filters.labels) {
                    args.push('--label', label);
                }
            }

            const issues = await this.gh<Array<{
                number: number;
                title: string;
                body: string;
                state: string;
                labels: Array<{ name: string }>;
                milestone?: { title: string } | null;
                assignees: Array<{ login: string }>;
                url: string;
            }>>(args, { retry: true });

            return issues.map(issue => {
                return {
                    id: issue.number,
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
        }>>(args, { retry: true });

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
            '--json', 'number,title,body,state,labels,milestone,assignees,url',
        ], { retry: true });

        return {
            id: result.number,
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
            // Close via separate command — closing an already-closed issue is a safe no-op, so retry is safe.
            await this.ghRaw([
                'issue', 'close', String(number),
                '--repo', `${owner}/${repo}`,
            ], { retry: true });
            return;
        }

        if (data.state === 'open') {
            // Reopening an already-open issue is a safe no-op, so retry is safe.
            await this.ghRaw([
                'issue', 'reopen', String(number),
                '--repo', `${owner}/${repo}`,
            ], { retry: true });
            return;
        }

        if (Array.isArray(data.labels)) {
            for (const label of data.labels as string[]) {
                args.push('--add-label', label);
            }
        }

        if (args.length > 4) {
            // Re-adding an already-present label is a safe no-op, so retry is safe.
            await this.ghRaw(args, { retry: true });
        }
    }

    /** Create an issue; throws (unlike createPullRequest) if URL parse fails — a 0 would corrupt githubRef */
    async createIssue(owner: string, repo: string, data: { title: string; body?: string }): Promise<{ number: number; html_url: string }> {
        const url = await this.ghRaw([
            'issue', 'create',
            '--repo', `${owner}/${repo}`,
            '--title', data.title,
            '--body', data.body ?? '',
        ]);
        const parsed = parsePrUrl(url);
        if (!parsed) {
            throw new Error(`gh issue create returned an unparseable URL: ${url}`);
        }
        return { number: parsed.number, html_url: url };
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
        ], { retry: true });
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
        return this.gh(args, { retry: true });
    }

    /** List orgs the user belongs to */
    async listOrgs(): Promise<string[]> {
        const output = await this.ghRaw(['org', 'list'], { retry: true });
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
