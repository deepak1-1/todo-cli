// ============================================================
// todo project — Project management commands
// ============================================================

import { Command } from 'commander';
import { getContext } from './context.js';
import { theme } from '../utils/theme.js';
import { makeTable } from '../utils/table.js';
import { validateCreateProjectInput } from '../core/project.js';
import { success, formatPriorityBracket } from '../utils/format.js';
import { colorizeProject, resolveProjectColor, PROJECT_PALETTE } from '../utils/project-color.js';
import { fail, EXIT, requireEntity } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';
import { emptyStateMessage } from '../utils/empty-state.js';

export const projectCommand = new Command('project')
    .description('Manage projects');

projectCommand
    .command('create')
    .description('Create a new project')
    .argument('<name>', 'Project name')
    .option('-D, --description <text>', 'Description')
    .option('-c, --color <color>', 'Palette color name or hex (e.g. teal, #14b8a6)')
    .action((name: string, opts) => {
        const ctx = getContext();

        const existing = ctx.projectRepo.getByName(name);
        if (existing) {
            return fail(EXIT.INVALID_TRANSITION, `Project "${existing.name}" already exists (names are case-insensitive)`);
        }

        // Validate --color if provided; skip standard project.ts color list — use project-color palette.
        let color: string | undefined;
        if (opts.color) {
            const resolved = resolveProjectColor(opts.color);
            if (!resolved) {
                return fail(EXIT.USAGE, `Unknown color: ${opts.color}. Valid: ${PROJECT_PALETTE.map(p => p.name).join(', ')}`);
            }
            color = resolved;
        }

        const input = validateCreateProjectInput({ name, description: opts.description, color });
        const project = ctx.projectRepo.create(input);
        console.log(success(`Created project "${colorizeProject(project.name, project.color)}"`));
    });

projectCommand
    .command('ls')
    .description('List projects')
    .option('-a, --all', 'Include archived projects')
    .option('--json', 'Output as JSON')
    .action((opts) => {
        const ctx = getContext();
        const projects = ctx.projectRepo.list(opts.all);
        const counts = ctx.projectRepo.getTaskCounts();

        if (opts.json) {
            console.log(JSON.stringify(projects, null, 2));
            return;
        }

        if (projects.length === 0) {
            console.log(theme().muted.chalk(`  ${emptyStateMessage('projects')}`));
            return;
        }

        const t = theme();
        const table = makeTable({
            head: ['Name', 'Description', 'Tasks', 'Urgent', 'Color'],
            style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
        });

        for (const project of projects) {
            const count = counts.find((c) => c.projectId === project.id);
            table.push([
                colorizeProject(project.name, project.color),
                project.description || '',
                count?.total || 0,
                count?.urgent || 0,
                project.color,
            ]);
        }

        console.log(table.toString());
    });

projectCommand
    .command('show')
    .description('Show project details')
    .argument('<name>', 'Project name')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ todo project show myproject --json | jq '.data.tasks'`)
    .action((name: string, opts) => {
        const ctx = getContext();
        const project = ctx.projectRepo.getByName(name);
        if (!requireEntity(project, 'Project', `"${name}"`, { json: opts.json, command: 'project show' })) return;

        const tasks = ctx.taskRepo.list({ projectName: name });

        if (opts.json) {
            emitJson({ ok: true, command: 'project show', data: { ...project, tasks } });
            return;
        }

        console.log(`\n  ${colorizeProject(project.name, project.color)}`);
        console.log(theme().muted.chalk(`  ${project.description || '(no description)'}`));
        console.log(`  ${tasks.length} task${tasks.length !== 1 ? 's' : ''}\n`);

        for (const task of tasks) {
            console.log(`    ${formatPriorityBracket(task.priority)} #${task.id}  ${theme().title.chalk(task.title)}`);
        }
        console.log('');
    });

projectCommand
    .command('rename')
    .description('Rename a project')
    .argument('<old>', 'Current name')
    .argument('<new>', 'New name')
    .option('--json', 'Output as JSON')
    .action((oldName: string, newName: string, opts) => {
        const ctx = getContext();
        const project = ctx.projectRepo.rename(oldName, newName);
        if (!requireEntity(project, 'Project', `"${oldName}"`, { json: opts.json, command: 'project rename' })) return;
        if (opts.json) {
            emitJson({ ok: true, command: 'project rename', data: project });
            return;
        }
        console.log(success(`Renamed project to "${colorizeProject(newName, project?.color)}"`));
    });

projectCommand
    .command('archive')
    .description('Archive a project')
    .argument('<name>', 'Project name')
    .option('--json', 'Output as JSON')
    .action((name: string, opts) => {
        const ctx = getContext();
        const project = ctx.projectRepo.getByName(name);
        if (!requireEntity(project, 'Project', `"${name}"`, { json: opts.json, command: 'project archive' })) return;
        ctx.projectRepo.archive(project.id);
        if (opts.json) {
            emitJson({ ok: true, command: 'project archive', data: { action: 'archived', name } });
            return;
        }
        console.log(success(`Archived project "${colorizeProject(name, project.color)}"`));
    });

projectCommand
    .command('delete')
    .description('Delete a project')
    .argument('<name>', 'Project name')
    .option('--json', 'Output as JSON')
    .action((name: string, opts) => {
        const ctx = getContext();
        const project = ctx.projectRepo.getByName(name);
        if (!requireEntity(project, 'Project', `"${name}"`, { json: opts.json, command: 'project delete' })) return;
        ctx.projectRepo.delete(project.id);
        if (opts.json) {
            emitJson({ ok: true, command: 'project delete', data: { action: 'deleted', name } });
            return;
        }
        console.log(success(`Deleted project "${colorizeProject(name, project.color)}"`));
    });

projectCommand
    .command('color')
    .description("Set a project's color (palette name or #hex)")
    .argument('<project>', 'Project name or ID')
    .argument('<color>', 'Palette color name or hex (e.g. teal, #14b8a6)')
    .action((projectArg: string, colorArg: string) => {
        const hex = resolveProjectColor(colorArg);
        if (!hex) {
            return fail(EXIT.USAGE, `Unknown color: ${colorArg}. Valid: ${PROJECT_PALETTE.map(p => p.name).join(', ')}`);
        }

        const ctx = getContext();
        const byId = /^\d+$/.test(projectArg) ? ctx.projectRepo.getById(Number(projectArg)) : null;
        const project = byId ?? ctx.projectRepo.getByName(projectArg);
        if (!requireEntity(project, 'Project', `"${projectArg}"`, { command: 'project color' })) return;

        ctx.projectRepo.update(project.id, { color: hex });
        console.log(success(`Set color of "${colorizeProject(project.name, hex)}" to ${hex}`));
    });
