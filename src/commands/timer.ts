// todo timer — Stopwatch-style time tracking.

import { Command } from 'commander';
import { getContext } from './context.js';
import { makeTable } from '../utils/table.js';
import { theme } from '../utils/theme.js';
import { formatLocalDateTime, parseSqliteUtc } from '../utils/date.js';
import { formatDuration, DEFAULT_POMODORO } from '../core/timer.js';
import { parseId, parseIntOption } from '../utils/format.js';
import { fail, EXIT, requireEntity } from '../utils/exit.js';

function parseDuration(input: string): number {
    // Support formats: 2h, 30m, 1h30m, 1.5h, 90m, 90
    let total = 0;
    const hourMatch = input.match(/(\d+(?:\.\d+)?)\s*h/i);
    const minMatch = input.match(/(\d+)\s*m/i);
    const secMatch = input.match(/(\d+)\s*s/i);

    if (hourMatch) total += parseFloat(hourMatch[1]) * 3600;
    if (minMatch) total += parseInt(minMatch[1]) * 60;
    if (secMatch) total += parseInt(secMatch[1]);

    // If just a number, treat as minutes.
    if (!hourMatch && !minMatch && !secMatch) {
        const num = parseFloat(input);
        if (!isNaN(num)) total = num * 60;
    }

    return Math.round(total);
}

export const timerCommand = new Command('timer')
    .alias('track')
    .description('Timer for tracking time spent on tasks')
    .addCommand(
        new Command('start')
            .description('Start timer on a task')
            .argument('<id>', 'Task ID')
            .option('-n, --note <text>', 'Add a note to this session')
            .action((rawId: string, opts) => {
                const id = parseId(rawId);
                const ctx = getContext();
                const t = theme();

                const task = ctx.taskRepo.getById(id);
                if (!requireEntity(task, 'Task', `#${id}`)) return;

                try {
                    const session = ctx.trackingRepo.start(id, opts.note);
                    console.log(t.success.chalk(`✓ Started timer on #${id}: `) + t.title.chalk(task.title));
                    console.log(t.muted.chalk(`  Started at ${formatLocalDateTime(session.startedAt)}`));

                    const allActive = ctx.trackingRepo.getActiveSessions();
                    if (allActive.length > 1) {
                        const others = allActive
                            .filter(s => s.taskId !== id)
                            .map(s => `#${s.taskId}`)
                            .join(', ');
                        console.log(t.muted.chalk(`  Also running: ${others}`));
                        console.log(t.muted.chalk(`  Run "todo timer stop ${id}" when done`));
                    } else {
                        console.log(t.muted.chalk(`  Run "todo timer stop" when done`));
                    }

                    // Auto-advance status to the 'start' verb's target key
                    const startDef = ctx.statusRepo.list().find(d => d.verb === 'start');
                    const todoKey = ctx.statusRepo.list().find(d => d.verb === 'reopen')?.key ?? 'todo';
                    if (startDef && task.status === todoKey) {
                        ctx.taskRepo.update(id, { status: startDef.key });
                        console.log(t.statusInProgress.chalk(`  Task status → ${startDef.label}`));
                    }
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    return fail(EXIT.GENERIC, msg);
                }
            })
    )
    .addCommand(
        new Command('stop')
            .description('Stop a timer session')
            .argument('[id]', 'Task ID to stop (required if multiple active)')
            .option('-a, --all', 'Stop all active sessions')
            .action((rawId: string | undefined, opts) => {
                const id = rawId ? parseId(rawId) : undefined;
                const ctx = getContext();
                const t = theme();

                if (opts.all) {
                    const stopped = ctx.trackingRepo.stopAll();
                    if (stopped.length === 0) {
                        console.log(t.warning.chalk('No active timer sessions.'));
                        return;
                    }
                    for (const session of stopped) {
                        const task = ctx.taskRepo.getById(session.taskId);
                        console.log(t.success.chalk(`✓ Stopped #${session.taskId}: `) + t.title.chalk(task?.title || 'unknown') + t.success.chalk(` (${formatDuration(session.duration, true)})`));
                    }
                    console.log(t.muted.chalk(`  Stopped ${stopped.length} session${stopped.length !== 1 ? 's' : ''}`));
                    return;
                }

                try {
                    const session = ctx.trackingRepo.stop(id);

                    if (!session) {
                        const label = id ? `Task #${id} has no active timer.` : 'No active timer session.';
                        console.log(t.warning.chalk(label));
                        return;
                    }

                    const task = ctx.taskRepo.getById(session.taskId);
                    console.log(t.success.chalk(`✓ Stopped timer #${session.taskId}: `) + t.title.chalk(task?.title || 'unknown'));
                    console.log(`  Duration: ${t.heading.chalk(formatDuration(session.duration, true))}`);
                    console.log(`  ${formatLocalDateTime(session.startedAt)} → ${formatLocalDateTime(session.endedAt)}`);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    fail(EXIT.GENERIC, msg);

                    const active = ctx.trackingRepo.getActiveSessions();
                    for (const s of active) {
                        const task = ctx.taskRepo.getById(s.taskId);
                        console.log(t.muted.chalk(`  ⏱  #${s.taskId}: `) + t.title.chalk(task?.title || '') + t.muted.chalk(` (since ${formatLocalDateTime(s.startedAt)})`));
                    }
                }
            })
    )
    .addCommand(
        new Command('status')
            .description('Show active timer sessions')
            .action(() => {
                const ctx = getContext();
                const t = theme();
                const sessions = ctx.trackingRepo.getActiveSessions();

                if (sessions.length === 0) {
                    console.log(t.muted.chalk('No active timer right now.'));
                    return;
                }

                for (const active of sessions) {
                    const task = ctx.taskRepo.getById(active.taskId);
                    const startTime = parseSqliteUtc(active.startedAt).getTime();
                    const elapsed = Math.round((Date.now() - startTime) / 1000);

                    console.log(t.accent.chalk(`⏱  Timer: #${active.taskId} `) + t.title.chalk(task?.title || ''));
                    console.log(`  Started:  ${formatLocalDateTime(active.startedAt)}`);
                    console.log(`  Elapsed:  ${t.heading.chalk(formatDuration(elapsed, true))}`);
                    if (active.note) console.log(`  Note:     ${active.note}`);
                    console.log('');
                }

                if (sessions.length > 1) {
                    console.log(t.muted.chalk(`  ${sessions.length} active timers`));
                }
            })
    )
    .addCommand(
        new Command('log')
            .description('Log time manually (e.g., todo timer log 1 2h)')
            .argument('<id>', 'Task ID')
            .argument('<duration>', 'Duration (e.g., 2h, 30m, 1h30m)')
            .option('-n, --note <text>', 'Add a note')
            .addHelpText('after', `
Examples:
  $ todo timer log 5 2h
  $ todo timer log 5 30m --note "code review"
  $ todo timer log 5 1h30m`)
            .action((rawId: string, durationStr: string, opts) => {
                const id = parseId(rawId);
                const ctx = getContext();
                const t = theme();

                const task = ctx.taskRepo.getById(id);
                if (!requireEntity(task, 'Task', `#${id}`)) return;

                const seconds = parseDuration(durationStr);
                if (isNaN(seconds) || seconds <= 0) {
                    return fail(EXIT.GENERIC, `Invalid duration: ${durationStr}`);
                }

                ctx.trackingRepo.logManual(id, seconds, opts.note);
                console.log(t.success.chalk(`✓ Logged ${formatDuration(seconds, true)} on #${id}: `) + t.title.chalk(task.title));
            })
    )
    .addCommand(
        new Command('history')
            .description('Show timer history for a task')
            .argument('<id>', 'Task ID')
            .action((rawId: string) => {
                const id = parseId(rawId);
                const ctx = getContext();
                const t = theme();

                const task = ctx.taskRepo.getById(id);
                if (!requireEntity(task, 'Task', `#${id}`)) return;

                const sessions = ctx.trackingRepo.getByTaskId(id);
                const total = ctx.trackingRepo.getTotalForTask(id);

                console.log('');
                console.log(t.heading.chalk(`  #${id}: `) + t.title.chalk(task.title));
                console.log(t.muted.chalk(`  Total time: ${formatDuration(total, true)}`));
                console.log('');

                if (sessions.length === 0) {
                    console.log(t.muted.chalk('  No timer sessions.'));
                } else {
                    for (const s of sessions) {
                        const icon = s.endedAt ? '✓' : '⏱';
                        const dur = s.endedAt ? formatDuration(s.duration, true) : 'running...';
                        const note = s.note ? t.muted.chalk(` — ${s.note}`) : '';
                        const startStr = formatLocalDateTime(s.startedAt);
                        const endStr = s.endedAt ? formatLocalDateTime(s.endedAt) : 'now';
                        console.log(`  ${icon} ${startStr} → ${endStr}  (${dur})${note}`);
                    }
                }
                console.log('');
            })
    )
    .addCommand(
        new Command('pomodoro')
            .description('Start a pomodoro session for a task')
            .argument('<id>', 'Task ID')
            .option('--duration <minutes>', 'Duration in minutes (default: 25)')
            .addHelpText('after', `
Examples:
  $ todo timer pomodoro 5
  $ todo timer pomodoro 5 --duration 50`)
            .action((rawId: string, opts) => {
                const id = parseId(rawId);
                const ctx = getContext();
                const t = theme();
                const task = ctx.taskRepo.getById(id);
                if (!requireEntity(task, 'Task', `#${id}`)) return;

                const dur = opts.duration ? parseIntOption(opts.duration, 'duration') : undefined;
                const durationSec = dur ? dur * 60 : DEFAULT_POMODORO;
                const session = ctx.timerRepo.create(id, durationSec);

                ctx.timerRepo.complete(session.id);
                ctx.taskRepo.update(id, { timeSpent: task.timeSpent + durationSec });

                console.log(t.success.chalk(`✓ Recorded ${formatDuration(durationSec)} pomodoro for #${id}: `) + t.title.chalk(task.title));
                console.log(t.muted.chalk(`  Session ID: ${session.id}`));
            })
    )
    .addCommand(
        new Command('report')
            .description('Unified time report (stopwatch + pomodoro)')
            .option('--days <n>', 'Number of days to report')
            .action((opts) => {
                const ctx = getContext();
                const t = theme();
                const days = opts.days ? parseIntOption(opts.days, 'days') : 7;

                const stopwatchReport = ctx.trackingRepo.getTimeReport(days);
                const pomodoroReport = ctx.timerRepo.getTimeReport(days);

                const merged = new Map<number, {
                    taskId: number; taskTitle: string;
                    stopwatchTime: number; pomodoroTime: number;
                    stopwatchSessions: number; pomodoroSessions: number;
                }>();

                for (const r of stopwatchReport) {
                    merged.set(r.taskId, {
                        taskId: r.taskId,
                        taskTitle: r.taskTitle,
                        stopwatchTime: r.totalTime,
                        pomodoroTime: 0,
                        stopwatchSessions: r.sessions,
                        pomodoroSessions: 0,
                    });
                }

                for (const r of pomodoroReport) {
                    const existing = merged.get(r.taskId);
                    if (existing) {
                        existing.pomodoroTime = r.totalTime;
                        existing.pomodoroSessions = r.sessions;
                    } else {
                        merged.set(r.taskId, {
                            taskId: r.taskId,
                            taskTitle: r.taskTitle,
                            stopwatchTime: 0,
                            pomodoroTime: r.totalTime,
                            stopwatchSessions: 0,
                            pomodoroSessions: r.sessions,
                        });
                    }
                }

                if (merged.size === 0) {
                    console.log(t.muted.chalk(`  No time data for the last ${days} days`));
                    return;
                }

                const entries = Array.from(merged.values()).sort(
                    (a, b) => (b.stopwatchTime + b.pomodoroTime) - (a.stopwatchTime + a.pomodoroTime)
                );

                const table = makeTable({
                    head: ['Task', 'Stopwatch', 'Pomodoro', 'Total', 'Sessions'],
                    style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
                });

                let grandTotal = 0;
                let grandSessions = 0;

                for (const e of entries) {
                    const total = e.stopwatchTime + e.pomodoroTime;
                    const sessions = e.stopwatchSessions + e.pomodoroSessions;
                    grandTotal += total;
                    grandSessions += sessions;

                    table.push([
                        `#${e.taskId} ${e.taskTitle}`,
                        e.stopwatchTime > 0 ? formatDuration(e.stopwatchTime) : t.muted.chalk('-'),
                        e.pomodoroTime > 0 ? formatDuration(e.pomodoroTime) : t.muted.chalk('-'),
                        formatDuration(total),
                        sessions,
                    ]);
                }

                console.log(table.toString());
                console.log(t.muted.chalk(`  Total: ${formatDuration(grandTotal)} across ${grandSessions} sessions (last ${days} days)`));
            })
    )
    .addCommand(
        new Command('ls')
            .description('List all timer sessions for a task')
            .argument('<id>', 'Task ID')
            .action((rawId: string) => {
                const id = parseId(rawId);
                const ctx = getContext();
                const t = theme();

                const task = ctx.taskRepo.getById(id);
                if (!requireEntity(task, 'Task', `#${id}`)) return;

                const sessions = ctx.trackingRepo.getByTaskId(id);
                const total = ctx.trackingRepo.getTotalForTask(id);

                console.log('');
                console.log(t.heading.chalk(`  #${id}: `) + t.title.chalk(task.title));
                console.log(t.muted.chalk(`  Total time: ${formatDuration(total, true)}`));
                console.log('');

                if (sessions.length === 0) {
                    console.log(t.muted.chalk('  No timer sessions.'));
                } else {
                    const table = makeTable({
                        head: ['Session', 'Started', 'Ended', 'Duration', 'Note'],
                        style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
                        colWidths: [10, 28, 28, 12, 20],
                        wordWrap: true,
                    });

                    for (const s of sessions) {
                        const icon = s.endedAt ? '✓' : '⏱';
                        const dur = s.endedAt ? formatDuration(s.duration, true) : t.accent.chalk('running...');
                        table.push([
                            t.muted.chalk(`${icon} #${s.id}`),
                            formatLocalDateTime(s.startedAt),
                            s.endedAt ? formatLocalDateTime(s.endedAt) : t.accent.chalk('now'),
                            dur,
                            s.note || t.muted.chalk('-'),
                        ]);
                    }

                    console.log(table.toString());
                }
                console.log('');
                console.log(t.muted.chalk('  Use "todo timer reduce <sessionId> <duration>" to reduce time from a session'));
                console.log(t.muted.chalk('  Use "todo timer delete <sessionId>" to remove a session entirely'));
                console.log('');
            })
    )
    .addCommand(
        new Command('reduce')
            .description('Reduce time from a specific session (e.g., todo timer reduce 15 1h)')
            .argument('<sessionId>', 'Session ID (use "todo timer ls <taskId>" to find)')
            .argument('<duration>', 'Duration to subtract (e.g., 2h, 30m, 1h30m)')
            .action((rawSessionId: string, durationStr: string) => {
                const sessionId = parseId(rawSessionId);
                const ctx = getContext();
                const t = theme();

                const seconds = parseDuration(durationStr);
                if (isNaN(seconds) || seconds <= 0) {
                    return fail(EXIT.GENERIC, `Invalid duration: ${durationStr}`);
                }

                try {
                    const updated = ctx.trackingRepo.reduceSession(sessionId, seconds);
                    if (!requireEntity(updated, 'Session', `#${sessionId}`)) return;

                    const task = ctx.taskRepo.getById(updated.taskId);
                    console.log(t.success.chalk(`✓ Reduced session #${sessionId} by ${formatDuration(seconds, true)}`));
                    console.log(`  Task: ${t.heading.chalk(`#${updated.taskId}`)} ${t.title.chalk(task?.title || '')}`);
                    console.log(`  Session duration: ${formatDuration(updated.duration, true)}`);
                } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    return fail(EXIT.GENERIC, msg);
                }
            })
    )
    .addCommand(
        new Command('delete')
            .description('Delete a specific timer session entirely')
            .argument('<sessionId>', 'Session ID to delete (use "todo timer ls <taskId>" to find)')
            .action((rawSessionId: string) => {
                const sessionId = parseId(rawSessionId);
                const ctx = getContext();
                const t = theme();

                const session = ctx.trackingRepo.deleteSession(sessionId);
                if (!requireEntity(session, 'Session', `#${sessionId}`)) return;

                const task = ctx.taskRepo.getById(session.taskId);
                console.log(t.success.chalk(`✓ Deleted session #${sessionId} (${formatDuration(session.duration, true)}) from task #${session.taskId}: `) + t.title.chalk(task?.title || ''));
            })
    );
