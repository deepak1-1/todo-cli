// ============================================================
// Intent types and JSON schema for grammar-constrained output
// ============================================================

import type { TaskPriority } from '../core/types.js';

export interface IntentFilters {
    status?: string;
    priority?: string;
    project?: string;
    tag?: string;
    due?: 'today' | 'overdue' | 'this-week';
    search?: string;
}

export interface Intent {
    action:
        | 'create_task' | 'update_task' | 'delete_task' | 'update_status'
        | 'list' | 'show_detail' | 'show_stats'
        | 'start_timer' | 'stop_timer'
        | 'adjust_time'
        | 'jira_pull' | 'jira_push' | 'github_pull' | 'github_push'
        | 'query'
        | 'help' | 'clarify';
    taskId?: number;
    timeAdjustSeconds?: number;
    title?: string;
    description?: string;
    due?: string;
    priority?: TaskPriority;
    project?: string;
    tags?: string[];
    status?: string;
    filters?: IntentFilters;
    sql?: string;
    message?: string;
}

/** Build the intent JSON schema, with status enum populated from live registry keys. */
export function buildIntentSchema(statusKeys: string[]) {
    // Validate keys are safe for GBNF — only ^[a-z0-9_]+$ allowed
    const safeKeys = statusKeys.filter(k => /^[a-z0-9_]+$/.test(k));
    return {
        type: 'object' as const,
        properties: {
            action: {
                type: 'string' as const,
                enum: [
                    'create_task', 'update_task', 'delete_task', 'update_status',
                    'list', 'show_detail', 'show_stats',
                    'start_timer', 'stop_timer', 'adjust_time',
                    'jira_pull', 'jira_push', 'github_pull', 'github_push',
                    'query', 'help', 'clarify',
                ],
            },
            taskId: { type: 'number' as const },
            timeAdjustSeconds: { type: 'number' as const },
            title: { type: 'string' as const },
            description: { type: 'string' as const },
            due: { type: 'string' as const },
            priority: { type: 'string' as const, enum: ['urgent', 'high', 'medium', 'low'] },
            project: { type: 'string' as const },
            tags: { type: 'array' as const, items: { type: 'string' as const } },
            status: { type: 'string' as const, enum: safeKeys.length > 0 ? safeKeys : ['todo', 'in_progress', 'in_review', 'blocked', 'done', 'archived'] },
            filters: {
                type: 'object' as const,
                properties: {
                    status: { type: 'string' as const },
                    priority: { type: 'string' as const },
                    project: { type: 'string' as const },
                    tag: { type: 'string' as const },
                    due: { type: 'string' as const, enum: ['today', 'overdue', 'this-week'] },
                    search: { type: 'string' as const },
                },
            },
            sql: { type: 'string' as const },
            message: { type: 'string' as const },
        },
        required: ['action'] as const,
    };
}

// Static schema used as fallback (e.g. tests without DB)
export const intentSchema = buildIntentSchema(['todo', 'in_progress', 'in_review', 'blocked', 'done', 'archived']);

// All valid action strings, mirroring the Intent union literal
const VALID_ACTIONS = new Set<Intent['action']>([
    'create_task', 'update_task', 'delete_task', 'update_status',
    'list', 'show_detail', 'show_stats',
    'start_timer', 'stop_timer', 'adjust_time',
    'jira_pull', 'jira_push', 'github_pull', 'github_push',
    'query', 'help', 'clarify',
]);

// Returns a typed Intent if value passes structural validation, null otherwise
export function validateIntent(value: unknown): Intent | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj['action'] !== 'string') return null;
    if (!VALID_ACTIONS.has(obj['action'] as Intent['action'])) return null;
    const action = obj['action'] as Intent['action'];
    if (['update_task', 'delete_task', 'update_status', 'show_detail',
        'start_timer', 'stop_timer', 'adjust_time'].includes(action)) {
        if (obj['taskId'] !== undefined && typeof obj['taskId'] !== 'number') return null;
    }
    if (action === 'create_task' && typeof obj['title'] !== 'string') return null;
    if (action === 'query' && typeof obj['sql'] !== 'string') return null;
    return obj as unknown as Intent;
}
