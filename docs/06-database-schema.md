# 06 — Database Schema

SQLite database stored at `~/.todo-cli/todo.db`. Managed via versioned migrations.

## Entity Relationship Diagram

```
+----------------+     +----------------+     +----------------+
|   projects     |     |    tasks       |     |     tags       |
|----------------|     |----------------|     |----------------|
| id (PK)        |<----| project_id     |     | id (PK)        |
| name           |     | id (PK)        |---->| name           |
| description    |     | title          |     | color          |
| color          |     | description    |     +--------+-------+
| archived       |     | status         |              |
| created_at     |     | priority       |     +--------+-------+
| updated_at     |     | due_date       |     |  task_tags     |
+----------------+     | recurrence     |     |----------------|
                       | jira_key       |<----| task_id (FK)   |
                       | jira_id        |     | tag_id  (FK)   |
                       | github_ref     |     +----------------+
                       | sync_hash      |
                       | last_synced    |     +----------------+
                       | time_spent     |     | dependencies   |
                       | created_at     |     |----------------|
                       | updated_at     |     | task_id (FK)   |<--+
                       | completed_at   |     | depends_on     |---+
                       | archived_at    |     +----------------+
                       +--------+-------+
                                |
                       +--------+-------+     +----------------+
                       |   pomodoro     |     | action_log     |
                       |   sessions     |     |----------------|
                       |----------------|     | id (PK)        |
                       | id (PK)        |     | task_id        |
                       | task_id (FK)   |     | action         |
                       | started_at     |     | prev_state     |
                       | duration       |     | new_state      |
                       | completed      |     | timestamp      |
                       +----------------+     +----------------+
```

---

## Table Definitions

### tasks

```sql
CREATE TABLE tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    description   TEXT DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'done', 'archived')),
    priority      TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
    project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    due_date      TEXT,
    recurrence    TEXT,
    time_spent    INTEGER NOT NULL DEFAULT 0,
    jira_key      TEXT,
    jira_id       TEXT,
    github_ref    TEXT,
    gitlab_ref    TEXT,
    linear_ref    TEXT,
    sync_hash     TEXT,
    last_synced_at TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at  TEXT,
    archived_at   TEXT
);
```

### projects

```sql
CREATE TABLE projects (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    description   TEXT DEFAULT '',
    color         TEXT DEFAULT 'white',
    archived      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### tags

```sql
CREATE TABLE tags (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL UNIQUE,
    color         TEXT DEFAULT 'cyan'
);
```

### task_tags

```sql
CREATE TABLE task_tags (
    task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id        INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
);
```

### dependencies

```sql
CREATE TABLE dependencies (
    task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (task_id, depends_on_id),
    CHECK (task_id != depends_on_id)
);
```

### pomodoro_sessions

```sql
CREATE TABLE pomodoro_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    duration      INTEGER NOT NULL DEFAULT 1500,
    completed     INTEGER NOT NULL DEFAULT 0,
    notes         TEXT DEFAULT ''
);
```

### action_log

```sql
CREATE TABLE action_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       INTEGER,
    action        TEXT NOT NULL,
    entity_type   TEXT NOT NULL DEFAULT 'task',
    prev_state    TEXT,
    new_state     TEXT,
    timestamp     TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### integration_config

```sql
CREATE TABLE integration_config (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    provider      TEXT NOT NULL UNIQUE,
    config        TEXT NOT NULL DEFAULT '{}',
    enabled       INTEGER NOT NULL DEFAULT 1,
    last_sync_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## Indexes

```sql
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_status_priority ON tasks(status, priority);
CREATE INDEX idx_tasks_status_due ON tasks(status, due_date);
CREATE INDEX idx_tasks_jira_key ON tasks(jira_key) WHERE jira_key IS NOT NULL;
CREATE INDEX idx_tasks_github_ref ON tasks(github_ref) WHERE github_ref IS NOT NULL;
CREATE INDEX idx_task_tags_task ON task_tags(task_id);
CREATE INDEX idx_task_tags_tag ON task_tags(tag_id);
CREATE INDEX idx_pomodoro_task ON pomodoro_sessions(task_id);
CREATE INDEX idx_pomodoro_date ON pomodoro_sessions(started_at);
CREATE INDEX idx_action_log_task ON action_log(task_id);
CREATE INDEX idx_action_log_time ON action_log(timestamp);
CREATE INDEX idx_deps_depends_on ON dependencies(depends_on_id);
```

---

## Migration Strategy

Migrations live in `src/storage/migrations/` as numbered TypeScript files.

```typescript
// src/storage/migrations/001-initial.ts
import type { Database } from 'better-sqlite3';

export function up(db: Database): void {
    db.exec(`CREATE TABLE IF NOT EXISTS tasks (...);`);
    // ... all tables and indexes
}

export function down(db: Database): void {
    db.exec(`DROP TABLE IF EXISTS tasks;`);
    // ... drop all
}
```

Migration runner tracks applied migrations in a `_migrations` table:

```sql
CREATE TABLE _migrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

On startup, the runner checks for unapplied migrations and runs them in a transaction.

---

## Common Queries

### Dashboard: overdue + today

```sql
SELECT t.*, GROUP_CONCAT(tg.name) as tag_names
FROM tasks t
LEFT JOIN task_tags tt ON t.id = tt.task_id
LEFT JOIN tags tg ON tt.tag_id = tg.id
WHERE t.status IN ('pending', 'in_progress')
  AND (t.due_date <= date('now') OR t.due_date = date('now'))
GROUP BY t.id
ORDER BY
  CASE t.priority
    WHEN 'urgent' THEN 4 WHEN 'high' THEN 3
    WHEN 'medium' THEN 2 WHEN 'low' THEN 1
  END DESC,
  t.due_date ASC;
```

### Board: tasks with blocked status

```sql
SELECT t.*, p.name as project_name,
       GROUP_CONCAT(DISTINCT tg.name) as tag_names,
       EXISTS(
         SELECT 1 FROM dependencies d
         JOIN tasks blocker ON d.depends_on_id = blocker.id
         WHERE d.task_id = t.id AND blocker.status != 'done'
       ) as is_blocked
FROM tasks t
LEFT JOIN projects p ON t.project_id = p.id
LEFT JOIN task_tags tt ON t.id = tt.task_id
LEFT JOIN tags tg ON tt.tag_id = tg.id
WHERE t.status != 'archived'
GROUP BY t.id
ORDER BY
  CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3
    WHEN 'medium' THEN 2 WHEN 'low' THEN 1 END DESC,
  t.due_date ASC NULLS LAST;
```

### Weekly stats

```sql
SELECT date(completed_at) as day, COUNT(*) as completed_count,
       SUM(time_spent) as total_time
FROM tasks
WHERE completed_at >= date('now', '-7 days') AND status = 'done'
GROUP BY date(completed_at)
ORDER BY day;
```

---

## Backup and Portability

The entire database is a single file: `~/.todo-cli/todo.db`. Back up with a file copy:

```bash
cp ~/.todo-cli/todo.db ~/todo-backup.db
```
