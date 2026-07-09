// Pure status domain logic — no I/O, no imports from storage or commands.

export interface StatusDef {
    key: string;
    label: string;
    icon: string;
    color: string;
    sortOrder: number;
    verb: string;
    completes: boolean;
    archives: boolean;
    isBuiltin: boolean;
}

/** True if a task with this status counts as complete. */
export function isComplete(defs: StatusDef[], key: string): boolean {
    return defs.find(d => d.key === key)?.completes ?? false;
}

/** True if a task with this status is archived (hidden by default). */
export function isArchived(defs: StatusDef[], key: string): boolean {
    return defs.find(d => d.key === key)?.archives ?? false;
}

/** Timestamp fields to set when transitioning to a given status. */
export function getTransitionTimestamps(
    defs: StatusDef[],
    key: string,
): { completedAt?: string | null; archivedAt?: string | null } {
    const now = new Date().toISOString();
    const def = defs.find(d => d.key === key);
    if (!def) return {};
    if (def.completes) return { completedAt: now };
    if (def.archives) return { archivedAt: now };
    return { completedAt: null, archivedAt: null };
}

/** Normalize a status input: lowercase and replace hyphens with underscores. */
export function normalizeStatusInput(s: string): string {
    return s.toLowerCase().replace(/-/g, '_');
}

/** Find a StatusDef by key or verb (hyphen/underscore/case-insensitive). Returns undefined if not found. */
export function findByKeyOrVerb(defs: StatusDef[], input: string): StatusDef | undefined {
    const norm = normalizeStatusInput(input);
    return defs.find(d => d.key === norm || d.verb === norm);
}

/** Returns a comma-separated list of valid status keys for error messages. */
export function validStatusKeys(defs: StatusDef[]): string {
    return defs.map(d => d.key).join(', ');
}

/** Resolve a status by key/verb or throw with a clear error listing valid keys. */
export function resolveStatusOrThrow(defs: StatusDef[], input: string): StatusDef {
    const def = findByKeyOrVerb(defs, input);
    if (!def) throw new Error(`Invalid status "${input}". Valid statuses: ${validStatusKeys(defs)}`);
    return def;
}

/** Remote-side status signal for a pulled issue. */
export interface RemoteStatus {
    /** Local status key the remote maps to when active (Jira). Omit when unknown (GitHub open). */
    activeTarget?: string;
    /** True if the remote considers the item done/closed. */
    isTerminal: boolean;
}

/**
 * Decide the new local status when a pulled remote item already exists locally.
 * v1 = Case A only: recover a mistaken local completion (remote active but local terminal).
 * Returns the target status key, or null to leave the local status unchanged.
 * reopenTarget is the caller-resolved active fallback (used when the remote has no concrete target).
 */
export function reconcilePulledStatus(
    defs: StatusDef[],
    localStatus: string,
    remote: RemoteStatus,
    reopenTarget: string,
): string | null {
    if (!remote.isTerminal && (isComplete(defs, localStatus) || isArchived(defs, localStatus))) {
        // Fall back to the (always-valid) reopen target if the remote's target isn't a known local status,
        // so the chosen key is registry-backed and getTransitionTimestamps clears completed_at correctly.
        if (remote.activeTarget && defs.some(d => d.key === remote.activeTarget)) {
            return remote.activeTarget;
        }
        return reopenTarget;
    }
    return null;
}
