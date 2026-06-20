// Typed helpers for parsing GitHub issue refs and PR URLs.

/** Parsed components of a GitHub issue/PR reference. */
export interface GitHubRefParts {
    owner: string;
    repo: string;
    number: number;
}

// Anchored regex: owner/repo#number — no slashes in owner or repo, no trailing junk.
const GITHUB_REF_RE = /^([^/\s]+)\/([^/#\s]+)#(\d+)$/;

// Anchored regex: full GitHub PR or issue URL.
const GITHUB_PR_URL_RE = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:pull|issues)\/(\d+)\/?$/;

/**
 * Parse an `owner/repo#number` style GitHub ref.
 * Returns null for any malformed input — never throws.
 */
export function parseGitHubRef(ref: string): GitHubRefParts | null {
    const m = GITHUB_REF_RE.exec(ref);
    if (!m) return null;
    const n = Number.parseInt(m[3], 10);
    if (!Number.isInteger(n) || n <= 0) return null;
    return { owner: m[1], repo: m[2], number: n };
}

/**
 * Parse a GitHub PR or issue URL (`https://github.com/owner/repo/pull/123`).
 * Returns null for any malformed input — never throws.
 */
export function parsePrUrl(url: string): GitHubRefParts | null {
    const m = GITHUB_PR_URL_RE.exec(url);
    if (!m) return null;
    const n = Number.parseInt(m[3], 10);
    if (!Number.isInteger(n) || n <= 0) return null;
    return { owner: m[1], repo: m[2], number: n };
}
