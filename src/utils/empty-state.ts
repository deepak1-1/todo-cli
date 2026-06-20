// Canonical empty-state message — one phrasing for all list commands
export type EmptyStateEntity = 'tasks' | 'projects' | 'tags' | 'sessions' | 'history' | 'integrations' | 'plugins';

export function emptyStateMessage(entity: EmptyStateEntity, filters?: Record<string, unknown>): string {
    if (!filters || Object.keys(filters).length === 0) {
        return `No ${entity} found.`;
    }
    const parts = Object.entries(filters)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`);
    if (parts.length === 0) {
        return `No ${entity} found.`;
    }
    return `No ${entity} match the filters (${parts.join(', ')}).`;
}
