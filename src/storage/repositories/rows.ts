// Typed DB row interfaces — snake_case column names as returned by SQLite; repos cast these to domain types.

// Corresponds to the `tasks` table (migrations 001, 004, 005, 006, 007, 008).
export interface TaskRow {
    id: number;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    project_id: number | null;
    due_date: string | null;
    recurrence: string | null;
    time_spent: number;
    jira_key: string | null;
    jira_id: string | null;
    github_ref: string | null;
    sync_hash: string | null;
    last_synced_at: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
    archived_at: string | null;
    parent_id: number | null;
}

// Extends TaskRow with JOIN columns produced by the WITH-RELATIONS queries in task.repo.ts.
export interface TaskRowWithRelations extends TaskRow {
    project_name: string | null;
    project_color: string | null;
    tag_names: string | null; // GROUP_CONCAT result; null when no tags
    is_blocked: number; // 0 or 1 from EXISTS subquery
}

// Corresponds to the `projects` table (migrations 001, 003).
export interface ProjectRow {
    id: number;
    name: string;
    description: string | null;
    color: string | null;
    archived: number; // 0 or 1
    created_at: string;
    updated_at: string;
}

// Corresponds to the `tags` table (migration 001).
export interface TagRow {
    id: number;
    name: string;
    color: string | null;
}

// Corresponds to the `time_tracking` table (migration 002).
export interface TrackingSessionRow {
    id: number;
    task_id: number;
    started_at: string;
    ended_at: string | null;
    duration: number; // seconds
    note: string | null;
}

// Corresponds to the `action_log` table (migration 001).
export interface ActionLogRow {
    id: number;
    task_id: number | null;
    action: string;
    entity_type: string;
    prev_state: string | null;
    new_state: string | null;
    timestamp: string;
}

// Corresponds to the `dependencies` table (migration 001).
export interface DependencyRow {
    task_id: number;
    depends_on_id: number;
    created_at: string;
}
