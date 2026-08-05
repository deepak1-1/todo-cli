// Derive a GitHub owner/repo from sibling repos or project description marker.

import { GITHUB_MARKER_PREFIX } from './ref.js';

// Matches a bare owner/repo string (output of listGithubRepos, no #N suffix).
const REPO_PREFIX_RE = /^([^/\s]+\/[^/#\s]+)$/;

// Built from GITHUB_MARKER_PREFIX so the write and read sides stay in sync.
const DESCRIPTION_MARKER_RE = new RegExp(`^${GITHUB_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^/\\s]+\\/[^/#\\s]+)$`);

export type ResolveRepoResult =
    | { repo: string }
    | { error: 'none' | 'ambiguous'; candidates: string[] };

// Resolve a unique owner/repo for issue creation from sibling repos or project description.
// siblingRepos: already-stripped owner/repo strings from listGithubRepos().
// Returns { repo } on success, or { error, candidates } when ambiguous or not found.
export function resolveProjectRepo(
    siblingRepos: string[],
    projectDescription?: string,
): ResolveRepoResult {
    const prefixes = new Set<string>();
    for (const ref of siblingRepos) {
        const m = REPO_PREFIX_RE.exec(ref);
        if (m) prefixes.add(m[1]);
    }

    if (prefixes.size === 1) {
        return { repo: [...prefixes][0] };
    }

    if (prefixes.size > 1) {
        return { error: 'ambiguous', candidates: [...prefixes] };
    }

    // No sibling refs — try description marker
    const desc = projectDescription?.trim();
    if (desc) {
        const m = DESCRIPTION_MARKER_RE.exec(desc);
        if (m) return { repo: m[1] };
    }

    return { error: 'none', candidates: [] };
}
