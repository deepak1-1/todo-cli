// ============================================================
// Core type definitions for Todo CLI
// ============================================================

export type TaskStatus = string;
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type RecurrencePattern = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export const TASK_PRIORITIES: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];
export const VALID_RECURRENCES: RecurrencePattern[] = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'];

export const PRIORITY_ERROR = `Invalid priority. Use one of: ${TASK_PRIORITIES.join(', ')}`;

export function normalizePriority(input: string | undefined): TaskPriority | null {
    if (!input) return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase() as TaskPriority;
    if (TASK_PRIORITIES.includes(lower)) return lower;
    return null;
}

export const PRIORITY_ORDER: Record<TaskPriority, number> = {
    urgent: 4,
    high: 3,
    medium: 2,
    low: 1,
};

// ---- Entities ----

export interface Task {
    id: number;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    projectId: number | null;
    dueDate: string | null;
    recurrence: RecurrencePattern | null;
    timeSpent: number; // seconds
    jiraKey: string | null;
    jiraId: string | null;
    githubRef: string | null;
    gitlabRef: string | null;
    linearRef: string | null;
    syncHash: string | null;
    lastSyncedAt: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    archivedAt: string | null;
}

export interface Project {
    id: number;
    name: string;
    description: string;
    color: string;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface Tag {
    id: number;
    name: string;
    color: string;
}

export interface TaskTag {
    taskId: number;
    tagId: number;
}

export interface Dependency {
    taskId: number;
    dependsOnId: number;
    createdAt: string;
}

export interface PomodoroSession {
    id: number;
    taskId: number;
    startedAt: string;
    duration: number; // seconds
    completed: boolean;
    notes: string;
}

export interface ActionLogEntry {
    id: number;
    taskId: number | null;
    action: string;
    entityType: string;
    prevState: string | null;
    newState: string | null;
    timestamp: string;
}

export interface IntegrationConfig {
    id: number;
    provider: string;
    config: Record<string, unknown>;
    enabled: boolean;
    lastSyncAt: string | null;
    createdAt: string;
    updatedAt: string;
}

// ---- Input types ----

export interface CreateTaskInput {
    title: string;
    description?: string;
    priority?: TaskPriority;
    projectId?: number | null;
    projectName?: string;
    dueDate?: string | null;
    recurrence?: RecurrencePattern | null;
    tags?: string[];
    dependsOn?: number[];
}

export interface UpdateTaskInput {
    title?: string;
    description?: string;
    priority?: TaskPriority;
    projectId?: number | null;
    projectName?: string;
    dueDate?: string | null;
    recurrence?: RecurrencePattern | null;
    addTags?: string[];
    removeTags?: string[];
    replaceTags?: string[];
}

export interface CreateProjectInput {
    name: string;
    description?: string;
    color?: string;
}

export interface UpdateProjectInput {
    name?: string;
    description?: string;
    color?: string;
}

export interface TaskFilters {
    ids?: number[];
    status?: TaskStatus | TaskStatus[];
    priority?: TaskPriority | TaskPriority[];
    projectId?: number;
    projectName?: string;
    tags?: string[];
    dueBefore?: string;
    dueAfter?: string;
    dueDate?: string; // 'today', 'overdue', 'this-week', or ISO date
    createdDate?: string; // 'today', 'yesterday', 'this-week', or ISO date
    createdAfter?: string; // ISO date — created_at >= this
    createdBefore?: string; // ISO date — created_at <= this
    completedAfter?: string; // ISO date — completed_at >= this
    completedBefore?: string; // ISO date — completed_at <= this
    search?: string;
    includeArchived?: boolean;
}

export interface TaskSort {
    field: 'id' | 'title' | 'priority' | 'due_date' | 'status' | 'created_at' | 'updated_at';
    direction: 'asc' | 'desc';
}

// ---- Extended types with joins ----

export interface TaskWithRelations extends Task {
    projectName?: string | null;
    projectColor?: string | null;
    tagNames?: string[];
    isBlocked?: boolean;
    blockedBy?: number[];
    blocking?: number[];
}

// ---- Search result type ----

export interface SearchResult extends TaskWithRelations {
    _matchedIn?: string[];
}

// ---- Edit options ----

export interface EditOptions {
    title?: string;
    priority?: string;
    tag?: string[];
    project?: string | false;
    due?: string | false;
    description?: string;
    recur?: string;
    status?: string;
    depends?: string[];
    blocks?: string[];
}

// ---- Repository update fields ----

export interface UpdateTaskFields {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    projectId?: number | null;
    dueDate?: string | null;
    recurrence?: string | null;
    timeSpent?: number;
    completedAt?: string | null;
    archivedAt?: string | null;
    jiraKey?: string | null;
    jiraId?: string | null;
    githubRef?: string | null;
    syncHash?: string | null;
    lastSyncedAt?: string | null;
}

// ---- Output format ----

export type OutputFormat = 'table' | 'json' | 'minimal';
