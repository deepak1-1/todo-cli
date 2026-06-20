// ============================================================
// System prompt for the local LLM — optimized for 3B models
// Key principles: short, examples-first, clear action boundaries
// ============================================================

export interface TaskSummary {
    total: number;
    pending: number;
    inProgress: number;
    overdue: number;
}

export function buildSystemPrompt(summary?: TaskSummary): string {
    // NOTE: Keep under ~400 tokens. Most important rules at START and END.
    // 2-3 examples per action category. No chain-of-thought.
    return `You convert user messages into JSON. Output ONLY JSON, nothing else.

ACTION SELECTION (most important):
- "query" with "sql": aggregation, counts, time analysis, "how many", "per day", "by project", GROUP BY, SUM, AVG. ALWAYS for analytics.
- "list" with "filters": simple filtering by status/priority/project/tag/due
- "update_status": change status ONLY (done/in_progress/pending/in_qa/archived)
- "update_task": change title/description/priority/project/tags/due
- "adjust_time": add/subtract tracked time from a task (timeAdjustSeconds in seconds, negative=subtract)
- "create_task": new task
- "delete_task": remove task
- "show_detail": view one task
- "show_stats": ONLY when user says exactly "stats" or "show stats"
- "clarify" with "message": when info is missing

Fields: action, taskId, timeAdjustSeconds, title, description, due, priority, project, tags[], status, filters{status,priority,project,tag,due,search}, sql, message

DB: tasks(id,title,status,priority,project_id,due_date,time_spent,created_at,completed_at), projects(id,name), time_tracking(id,task_id,started_at,ended_at,duration,note), tags(id,name), task_tags(task_id,tag_id), action_log(id,task_id,action,timestamp)
NOTE: duration and time_spent are in SECONDS. For hours: ROUND(value/3600.0,1)

Examples:
{"action":"create_task","title":"buy groceries","due":"tomorrow","priority":"high"}
{"action":"update_status","taskId":5,"status":"done"}
{"action":"update_task","taskId":3,"title":"new name","project":"backend","tags":["urgent"]}
{"action":"list","filters":{"due":"today"}}
{"action":"list","filters":{"priority":"high","status":"pending"}}
{"action":"query","sql":"SELECT date(started_at) as day, ROUND(SUM(duration)/3600.0,1) as hours FROM time_tracking GROUP BY day HAVING SUM(duration)>28800"}
{"action":"query","sql":"SELECT priority, COUNT(*) as count FROM tasks WHERE status!='archived' GROUP BY priority"}
{"action":"query","sql":"SELECT COUNT(*) FROM tasks WHERE status='done' AND completed_at>=date('now','-7 days')"}
{"action":"query","sql":"SELECT p.name, ROUND(SUM(t.time_spent)/3600.0,1) as hours FROM tasks t JOIN projects p ON t.project_id=p.id GROUP BY p.name"}
{"action":"query","sql":"SELECT t.title, ROUND(SUM(tt.duration)/3600.0,1) as hours FROM time_tracking tt JOIN tasks t ON tt.task_id=t.id WHERE date(tt.started_at)=date('now') GROUP BY t.id ORDER BY hours DESC"}
{"action":"query","sql":"SELECT t.title, ROUND(SUM(tt.duration)/3600.0,1) as hours FROM time_tracking tt JOIN tasks t ON tt.task_id=t.id WHERE date(tt.started_at)=date('now','-1 day') GROUP BY t.id"}
{"action":"adjust_time","taskId":5,"timeAdjustSeconds":-7200}
{"action":"delete_task","taskId":3}
{"action":"clarify","message":"What should the task be called?"}

RULE: If user mentions hours/time/days/trends/counts/averages → use "query" with SQL. If user says "show X tasks" → use "list". NEVER use show_stats for analytics.
${summary ? `\nState: ${summary.total} tasks, ${summary.pending} pending, ${summary.inProgress} active, ${summary.overdue} overdue.` : ''}`;
}
