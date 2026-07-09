// MCP tool handlers — 8 time-tracking tools mirroring `todo timer` semantics.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getContext } from '../../commands/context.js';
import { applyTimerStart } from '../../commands/timer.js';
import { parseDuration } from '../../core/timer.js';
import { elapsedSecondsSince } from '../../utils/date.js';
import { ok, err } from './shared.js';

export function registerTrackingTools(server: McpServer, opts: { allowDelete: boolean }): void {
    // ── todo_start_timer ───────────────────────────────────────────────
    server.registerTool(
        'todo_start_timer',
        {
            title: 'Start Timer',
            description: 'Start a timer on a task. Auto-advances status from todo → in_progress when applicable. Returns the new session, the task title, whether status was advanced, and IDs of any other currently active timers.',
            inputSchema: {
                id: z.number().int().positive().describe('Task ID'),
                note: z.string().optional().describe('Optional session note'),
            },
        },
        (args) => {
            try {
                const ctx = getContext();
                const task = ctx.taskRepo.getById(args.id);
                if (!task) return err(`Task #${args.id} not found.`);

                const { session, advancedTo } = applyTimerStart(ctx, task, args.note);

                const allActive = ctx.trackingRepo.getActiveSessions();
                const otherActiveTaskIds = allActive
                    .filter(s => s.taskId !== args.id)
                    .map(s => s.taskId);

                return ok(
                    {
                        session,
                        taskId: task.id,
                        taskTitle: task.title,
                        statusAdvancedTo: advancedTo?.key ?? null,
                        otherActiveTaskIds,
                    },
                    `Started timer on #${task.id}: ${task.title}`,
                );
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_stop_timer ────────────────────────────────────────────────
    server.registerTool(
        'todo_stop_timer',
        {
            title: 'Stop Timer',
            description: 'Stop a timer session. Pass "all":true to stop all active timers (wins over "id"). When multiple timers are active and no id or all is given, returns an error listing the active task IDs.',
            inputSchema: {
                id: z.number().int().positive().optional().describe('Task ID to stop'),
                all: z.boolean().optional().describe('Stop all active timers — takes precedence over id'),
            },
        },
        (args) => {
            try {
                const ctx = getContext();

                if (args.all) {
                    const stopped = ctx.trackingRepo.stopAll();
                    return ok(
                        { stopped, count: stopped.length },
                        stopped.length === 0
                            ? 'No active timer sessions.'
                            : `Stopped ${stopped.length} session(s).`,
                    );
                }

                // Pre-check: multiple active + no id → MCP-phrased error (no CLI hint leak)
                if (args.id === undefined) {
                    const active = ctx.trackingRepo.getActiveSessions();
                    if (active.length === 0) return err('No active timer session.');
                    if (active.length > 1) {
                        const ids = active.map(s => s.taskId).join(', ');
                        return err(`Multiple active timers (task IDs: ${ids}). Pass "id" with one of those task IDs, or "all": true.`);
                    }
                }

                const session = ctx.trackingRepo.stop(args.id);
                if (!session) {
                    const label = args.id ? `Task #${args.id} has no active timer.` : 'No active timer session.';
                    return err(label);
                }

                return ok(
                    { session, taskId: session.taskId, durationSeconds: session.duration },
                    `Stopped timer on task #${session.taskId} — ${session.duration}s recorded.`,
                );
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_get_active_timers ─────────────────────────────────────────
    server.registerTool(
        'todo_get_active_timers',
        {
            title: 'Get Active Timers',
            description: 'List all currently running timer sessions with elapsed time and session notes. Returns an empty list when no timers are active.',
            inputSchema: {},
        },
        () => {
            try {
                const ctx = getContext();
                const sessions = ctx.trackingRepo.getActiveSessions();
                const items = sessions.map(s => {
                    const task = ctx.taskRepo.getById(s.taskId);
                    return {
                        ...s,
                        elapsedSeconds: elapsedSecondsSince(s.startedAt),
                        taskTitle: task?.title ?? '',
                    };
                });
                return ok(items, `${items.length} active timer(s).`);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_log_time ──────────────────────────────────────────────────
    server.registerTool(
        'todo_log_time',
        {
            title: 'Log Time',
            description: 'Manually log time spent on a task. Duration formats: "2h", "30m", "1h30m", "1.5h", "90" (bare number = minutes), "45s". Also increments the task\'s time_spent counter.',
            inputSchema: {
                id: z.number().int().positive().describe('Task ID'),
                duration: z.string().min(1).describe('Duration string, e.g. "2h", "30m", "1h30m", "90" (minutes)'),
                note: z.string().optional().describe('Optional note for this entry'),
            },
        },
        (args) => {
            try {
                const ctx = getContext();
                const task = ctx.taskRepo.getById(args.id);
                if (!task) return err(`Task #${args.id} not found.`);

                const seconds = parseDuration(args.duration);
                if (!Number.isFinite(seconds) || seconds <= 0) {
                    return err(`Invalid duration "${args.duration}". Use formats like "2h", "30m", "1h30m", "90" (minutes).`);
                }

                const session = ctx.trackingRepo.logManual(args.id, seconds, args.note);
                return ok(session, `Logged ${seconds}s on #${task.id}: ${task.title}.`);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_list_sessions ─────────────────────────────────────────────
    server.registerTool(
        'todo_list_sessions',
        {
            title: 'List Sessions',
            description: 'List all tracking sessions for a task (including any currently running session). "totalSeconds" counts only completed (ended) sessions.',
            inputSchema: {
                id: z.number().int().positive().describe('Task ID'),
            },
        },
        (args) => {
            try {
                const ctx = getContext();
                const task = ctx.taskRepo.getById(args.id);
                if (!task) return err(`Task #${args.id} not found.`);

                const items = ctx.trackingRepo.getByTaskId(args.id);
                const totalSeconds = ctx.trackingRepo.getTotalForTask(args.id);

                return ok(
                    { taskId: args.id, taskTitle: task.title, totalSeconds, items },
                    `${items.length} session(s) for #${args.id}, ${totalSeconds}s total (completed only).`,
                );
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_get_time_report ───────────────────────────────────────────
    server.registerTool(
        'todo_get_time_report',
        {
            title: 'Get Time Report',
            description: 'Get a time report grouped by task for the last N days (default 7). Only completed sessions are counted. Returns an empty list when no sessions exist in the window.',
            inputSchema: {
                days: z.number().int().positive().optional().describe('Number of days to include (default 7)'),
            },
        },
        (args) => {
            try {
                const ctx = getContext();
                const days = args.days ?? 7;
                const entries = ctx.trackingRepo.getTimeReport(days);
                return ok(entries, `Time report for last ${days} day(s): ${entries.length} task(s).`);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_reduce_session ────────────────────────────────────────────
    server.registerTool(
        'todo_reduce_session',
        {
            title: 'Reduce Session',
            description: 'Reduce the recorded duration of a completed session by the given amount. Cannot be applied to an active (running) session. Duration floors at 0. Cannot be undone.',
            inputSchema: {
                sessionId: z.number().int().positive().describe('Session ID (find via todo_list_sessions)'),
                duration: z.string().min(1).describe('Amount to subtract, e.g. "1h", "30m"'),
            },
        },
        (args) => {
            try {
                const ctx = getContext();
                const seconds = parseDuration(args.duration);
                if (!Number.isFinite(seconds) || seconds <= 0) {
                    return err(`Invalid duration "${args.duration}". Use formats like "1h", "30m".`);
                }

                const updated = ctx.trackingRepo.reduceSession(args.sessionId, seconds);
                if (!updated) return err(`Session #${args.sessionId} not found.`);

                return ok(updated, `Reduced session #${args.sessionId} by ${seconds}s. New duration: ${updated.duration}s.`);
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );

    // ── todo_delete_session ────────────────────────────────────────────
    server.registerTool(
        'todo_delete_session',
        {
            title: 'Delete Session',
            description: [
                'Permanently delete a tracking session and subtract its duration from the task. Cannot be undone.',
                opts.allowDelete
                    ? 'Session delete is enabled on this server.'
                    : 'Session delete is disabled on this server (start with --allow-delete to enable).',
            ].join(' '),
            inputSchema: {
                sessionId: z.number().int().positive().describe('Session ID to delete (find via todo_list_sessions)'),
            },
        },
        (args) => {
            try {
                if (!opts.allowDelete) {
                    return err('Session delete is disabled. Start the server with --allow-delete to enable it.');
                }

                const ctx = getContext();
                const session = ctx.trackingRepo.deleteSession(args.sessionId);
                if (!session) return err(`Session #${args.sessionId} not found.`);

                return ok(
                    { id: session.id, taskId: session.taskId, durationSeconds: session.duration },
                    `Deleted session #${session.id} from task #${session.taskId}.`,
                );
            } catch (e: unknown) {
                return err(e instanceof Error ? e.message : String(e));
            }
        },
    );
}
