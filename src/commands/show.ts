// ============================================================
// todo show <id> — Show full task details
// ============================================================

import { Command } from 'commander';
import { getContext } from './context.js';
import { theme } from '../utils/theme.js';
import { formatTaskDetail, parseId } from '../utils/format.js';
import { formatDuration } from '../core/timer.js';
import { formatLocalDateTime } from '../utils/date.js';
import { requireEntity } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';
import { isComplete } from '../core/status.js';

export const showCommand = new Command('show')
    .description('Show full details of a task')
    .argument('<id>', 'Task ID')
    .option('--json', 'Output as JSON')
    .action((rawId: string, opts) => {
        const id = parseId(rawId);
        const ctx = getContext();

        const task = ctx.taskRepo.getByIdWithRelations(id);
        if (!requireEntity(task, 'Task', `#${id}`, { json: opts.json, command: 'show' })) return;

        // Enrich with dependency info
        const deps = ctx.depRepo.getDependencies(id);
        const dependents = ctx.depRepo.getDependents(id);
        const pomodoroSessions = ctx.timerRepo.getByTaskId(id);
        const trackingSessions = ctx.trackingRepo.getByTaskId(id);
        const totalTracked = ctx.trackingRepo.getTotalForTask(id);

        if (opts.json) {
            emitJson({ ok: true, command: 'show', data: { ...task, dependencies: deps, dependents, pomodoroSessions, trackingSessions, totalTracked } });
            return;
        }

        console.log(formatTaskDetail(task, ctx.statusRepo.list()));

        const t = theme();
        // Show dependencies
        if (deps.length > 0) {
            const defs = ctx.statusRepo.list();
            console.log(t.panelBorder.chalk('  ── Dependencies ─────────────────────────'));
            for (const depId of deps) {
                const dep = ctx.taskRepo.getById(depId);
                if (dep) {
                    const statusIcon = isComplete(defs, dep.status) ? '✓' : '○';
                    console.log(t.body.chalk(`    ${statusIcon} #${dep.id} ${dep.title} (${dep.status})`));
                }
            }
            console.log('');
        }

        if (dependents.length > 0) {
            console.log(t.panelBorder.chalk('  ── Blocking ─────────────────────────────'));
            for (const depId of dependents) {
                const dep = ctx.taskRepo.getById(depId);
                if (dep) console.log(t.body.chalk(`    → #${dep.id} ${dep.title}`));
            }
            console.log('');
        }

        // Show timer sessions
        if (trackingSessions.length > 0 || totalTracked > 0) {
            console.log(t.panelBorder.chalk('  ── Timer ────────────────────────────────'));
            console.log(theme().heading.chalk(`    Total: ${formatDuration(totalTracked)}`));
            console.log('');
            for (const s of trackingSessions.slice(0, 10)) {
                const icon = s.endedAt ? '✓' : theme().accent.chalk('⏱');
                const dur = s.endedAt ? formatDuration(s.duration) : 'running...';
                const note = s.note ? theme().muted.chalk(` — ${s.note}`) : '';
                console.log(`    ${icon} ${formatLocalDateTime(s.startedAt)} → ${s.endedAt ? formatLocalDateTime(s.endedAt) : 'now'}  (${dur})${note}`);
            }
            if (trackingSessions.length > 10) {
                console.log(theme().muted.chalk(`    ... and ${trackingSessions.length - 10} more sessions`));
            }
            console.log('');
        }

        // Show pomodoro history (legacy, if any exist)
        if (pomodoroSessions.length > 0 && trackingSessions.length === 0) {
            console.log(t.panelBorder.chalk('  ── Pomodoro History ─────────────────────'));
            for (const session of pomodoroSessions.slice(0, 10)) {
                const status = session.completed ? '✓' : '○';
                const mins = Math.round(session.duration / 60);
                console.log(`    ${status} ${formatLocalDateTime(session.startedAt)} (${mins}min)`);
            }
            console.log('');
        }
    });
