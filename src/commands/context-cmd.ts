// ============================================================
// todo context <id> — AI-friendly context block
// ============================================================

import { Command } from 'commander';
import { getContext } from './context.js';
import { parseId } from '../utils/format.js';
import { requireEntity } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';

export const contextCommand = new Command('context')
    .description('Generate AI-friendly context block for a task')
    .argument('<id>', 'Task ID')
    .option('--json', 'Output as JSON')
    .option('--format <fmt>', 'Deprecated: use --json instead', 'text')
    .addHelpText('after', `
Examples:
  $ todo context 42 --json | jq '.data.task.title'`)
    .hook('preAction', (cmd) => {
        // Promote deprecated --format json to --json and warn on stderr
        const opts = cmd.opts() as Record<string, unknown>;
        if (opts.format === 'json' && !opts.json) {
            opts.json = true;
            process.stderr.write("warning: --format json is deprecated; use --json instead.\n");
        }
    })
    .action((rawId: string, opts) => {
        const id = parseId(rawId);
        const ctx = getContext();

        const task = ctx.taskRepo.getByIdWithRelations(id);
        if (!requireEntity(task, 'Task', `#${id}`, { json: opts.json, command: 'context' })) return;

        const deps = ctx.depRepo.getDependencies(id);
        const depTasks = deps.map((d) => ctx.taskRepo.getById(d)).filter(Boolean);

        if (opts.json) {
            emitJson({ ok: true, command: 'context', data: { task, dependencies: depTasks } });
            return;
        }

        // Generate a markdown-style context block
        const lines = [
            `## Task #${task.id}: ${task.title}`,
            '',
            `**Status:** ${task.status}`,
            `**Priority:** ${task.priority}`,
            task.projectName ? `**Project:** ${task.projectName}` : null,
            task.dueDate ? `**Due:** ${task.dueDate}` : null,
            task.tagNames?.length ? `**Tags:** ${task.tagNames.join(', ')}` : null,
            '',
        ].filter(Boolean);

        if (task.description) {
            lines.push('### Description', '', task.description, '');
        }

        if (depTasks.length > 0) {
            lines.push('### Dependencies', '');
            for (const dep of depTasks) {
                if (dep) {
                    lines.push(`- #${dep.id} ${dep.title} (${dep.status})`);
                }
            }
            lines.push('');
        }

        if (task.jiraKey) lines.push(`**Jira:** ${task.jiraKey}`);
        if (task.githubRef) lines.push(`**GitHub:** ${task.githubRef}`);

        const output = lines.join('\n');

        console.log(output);
    });
