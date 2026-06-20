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

/** Find a StatusDef by key or verb. Returns undefined if not found. */
export function findByKeyOrVerb(defs: StatusDef[], input: string): StatusDef | undefined {
    const lower = input.toLowerCase();
    return defs.find(d => d.key === lower || d.verb === lower);
}
