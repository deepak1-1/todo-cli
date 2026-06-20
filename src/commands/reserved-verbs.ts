// Verbs reserved by static CLI commands — status-generated verbs cannot use these.

export const RESERVED_VERBS = new Set([
    'add', 'list', 'ls', 'show', 'edit', 'rm', 'delete', 'bulk', 'project',
    'tag', 'stats', 'undo', 'history', 'config', 'timer', 'track',
    'integrate', 'jira', 'gh', 'mcp', 'status', 'context',
    'help', 'version',
]);
