// ============================================================
// Local keyword pre-parser — instant intent detection for
// common patterns before sending to the AI model
// ============================================================

import type { Intent } from './intent.js';

/**
 * Try to parse the user's message locally using keyword matching.
 * Returns an Intent if confidently matched, or null to defer to AI.
 */
export function preparse(input: string): Intent | null {
    const lower = input.toLowerCase().trim();

    // Help
    if (lower === 'help' || lower === '?') {
        return { action: 'help' };
    }

    // Stats (only exact "stats" or "show stats")
    if (lower === 'stats' || lower === 'show stats') {
        return { action: 'show_stats' };
    }

    // Jira / GitHub pull/push
    if (/\b(pull|sync|import)\b.*\bjira\b/.test(lower) || /\bjira\b.*\b(pull|sync|import)\b/.test(lower)) {
        return { action: 'jira_pull' };
    }
    if (/\b(pull|sync|import)\b.*\b(github|gh)\b/.test(lower) || /\b(github|gh)\b.*\b(pull|sync|import)\b/.test(lower)) {
        return { action: 'github_pull' };
    }
    if (/\bpush\b.*\bjira\b/.test(lower) || /\bjira\b.*\bpush\b/.test(lower)) {
        const id = extractTaskId(lower);
        return id ? { action: 'jira_push', taskId: id } : { action: 'clarify', message: 'Which task number should I push to Jira?' };
    }
    if (/\bpush\b.*\b(github|gh)\b/.test(lower) || /\b(github|gh)\b.*\bpush\b/.test(lower)) {
        const id = extractTaskId(lower);
        return id ? { action: 'github_push', taskId: id } : { action: 'clarify', message: 'Which task number should I push to GitHub?' };
    }

    // List with filters
    if (/\b(show|list|what'?s)\b.*\btoday\b/.test(lower) || lower === 'today') {
        return { action: 'list', filters: { due: 'today' } };
    }
    if (/\b(show|list)\b.*\boverdue\b/.test(lower) || lower === 'overdue') {
        return { action: 'list', filters: { due: 'overdue' } };
    }
    if (/\b(show|list)\b.*\b(all|everything|tasks)\b/.test(lower) || lower === 'list' || lower === 'ls') {
        return { action: 'list' };
    }

    // Time adjustment — must come before delete check since "remove" overlaps
    const timeAdjust = parseTimeAdjust(lower);
    if (timeAdjust) return timeAdjust;

    // Status updates with task ID
    const id = extractTaskId(lower);
    if (id) {
        if (/\b(done|complete|finish)\b/.test(lower)) return { action: 'update_status', taskId: id, status: 'done' };
        if (/\b(start|begin)\b/.test(lower)) return { action: 'update_status', taskId: id, status: 'in_progress' };
        if (/\breview\b/.test(lower) || /\bqa\b/.test(lower)) return { action: 'update_status', taskId: id, status: 'in_qa' };
        if (/\b(archive)\b/.test(lower)) return { action: 'update_status', taskId: id, status: 'archived' };
        if (/\b(reopen|re-open)\b/.test(lower)) return { action: 'update_status', taskId: id, status: 'pending' };
        if (/\b(delete|remove|rm)\b/.test(lower)) return { action: 'delete_task', taskId: id };
        if (/\b(show|detail|view|info)\b/.test(lower)) return { action: 'show_detail', taskId: id };
        if (/\bstart\s*timer\b/.test(lower) || /\btimer\s*start\b/.test(lower)) return { action: 'start_timer', taskId: id };
    }

    if (/\bstop\s*timer\b/.test(lower) || /\btimer\s*stop\b/.test(lower)) {
        return { action: 'stop_timer', taskId: extractTaskId(lower) || undefined };
    }

    // Query indicators — anything asking about trends, counts, time analysis
    // These MUST go to the AI for SQL generation, so return null to defer
    if (isQueryLikeInput(lower)) {
        return null; // explicitly defer to AI — these need SQL
    }

    // Simple "add/create" with inline title
    if (/^(add|create|new)\s+(.+)/i.test(input.trim())) {
        const match = input.trim().match(/^(?:add|create|new)\s+(?:task\s+)?(.+)/i);
        if (match) {
            const rest = match[1].trim();
            if (rest.length > 0 && rest.length < 200) {
                // Don't parse further — let AI extract due/priority/tags from the title
                return null;
            }
        }
    }

    return null; // defer to AI
}

/** Check if input looks like a question/analytics rather than an action */
export function isQueryLike(input: string): boolean {
    return isQueryLikeInput(input.toLowerCase());
}

function isQueryLikeInput(lower: string): boolean {
    const queryPatterns = [
        /\bhow many\b/,
        /\bhow much\b/,
        /\baverage\b/,
        /\btotal time\b/,
        /\btime spent\b/,
        /\btrend\b/,
        /\bsummar/,        // summary, summarize, summarise
        /\banalytics\b/,
        /\bbusiest\b/,
        /\bmost productive\b/,
        /\b(worked|tracked)\b/,  // "what I worked on", "tasks tracked"
        /\bmore than \d+\b/,
        /\bcompleted? (this|last)\b/,
        /\bper (day|week|month|project)\b/,
        /\bbreakdown\b/,
        /\bgroup by\b/,
        /\bcompare\b/,
        /\bproductiv/,     // productive, productivity
        /\bhours?\b/,
    ];
    return queryPatterns.some(p => p.test(lower));
}

/** Parse "remove 2 hours from task 5" style inputs into adjust_time intents */
function parseTimeAdjust(lower: string): Intent | null {
    if (!/\b(remove|subtract|reduce|deduct|add)\b/.test(lower)) return null;
    if (!/\b(\d+(?:\.\d+)?)\s*(h(?:ours?)?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)\b/.test(lower)) return null;

    const taskId = extractTaskId(lower);
    if (!taskId) return null;

    let total = 0;
    const hMatch = lower.match(/(\d+(?:\.\d+)?)\s*h/i);
    const mMatch = lower.match(/(\d+)\s*m/i);
    const sMatch = lower.match(/(\d+)\s*s/i);
    if (hMatch) total += parseFloat(hMatch[1]) * 3600;
    if (mMatch) total += parseInt(mMatch[1]) * 60;
    if (sMatch) total += parseInt(sMatch[1]);

    if (total <= 0) return null;

    const sign = /\badd\b/.test(lower) ? 1 : -1;
    return { action: 'adjust_time', taskId, timeAdjustSeconds: sign * Math.round(total) };
}

/** Extract a task ID number from text like "task 5", "#5", "task #5" */
function extractTaskId(text: string): number | null {
    // Match patterns: "#5", "task 5", "task #5", just "5" at end
    const patterns = [
        /#(\d+)/,
        /\btask\s+#?(\d+)/,
        /\b(\d+)\s*$/,
    ];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) {
            const n = parseInt(m[1], 10);
            if (n > 0) return n;
        }
    }
    return null;
}
