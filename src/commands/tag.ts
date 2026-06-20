// ============================================================
// todo tag — Tag management commands
// ============================================================

import { Command } from 'commander';
import { getContext } from './context.js';
import { theme } from '../utils/theme.js';
import { makeTable } from '../utils/table.js';
import { success } from '../utils/format.js';
import { fail, EXIT, requireEntity } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';
import { emptyStateMessage } from '../utils/empty-state.js';

export const tagCommand = new Command('tag')
    .description('Manage tags');

tagCommand
    .command('ls')
    .description('List all tags with usage counts')
    .option('--json', 'Output as JSON')
    .action((opts) => {
        const ctx = getContext();
        const tags = ctx.tagRepo.listWithCounts();

        if (opts.json) {
            console.log(JSON.stringify(tags, null, 2));
            return;
        }

        if (tags.length === 0) {
            console.log(theme().muted.chalk(`  ${emptyStateMessage('tags')}`));
            return;
        }

        const t = theme();
        const table = makeTable({
            head: ['Name', 'Color', 'Tasks'],
            style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
        });

        for (const tag of tags) {
            table.push([tag.name, tag.color, tag.count]);
        }

        console.log(table.toString());
    });

tagCommand
    .command('rename')
    .description('Rename a tag')
    .argument('<old>', 'Current name')
    .argument('<new>', 'New name')
    .option('--json', 'Output as JSON')
    .action((oldName: string, newName: string, opts) => {
        const ctx = getContext();
        const tag = ctx.tagRepo.rename(oldName, newName);
        if (!requireEntity(tag, 'Tag', `"${oldName}"`, { json: opts.json, command: 'tag rename' })) return;
        if (opts.json) {
            emitJson({ ok: true, command: 'tag rename', data: tag });
            return;
        }
        console.log(success(`Renamed tag to "${theme().heading.chalk(newName)}"`));
    });

tagCommand
    .command('delete')
    .description('Delete a tag')
    .argument('<name>', 'Tag name')
    .option('--json', 'Output as JSON')
    .action((name: string, opts) => {
        const ctx = getContext();
        if (!ctx.tagRepo.delete(name)) {
            return fail(EXIT.NOT_FOUND, `Tag "${name}" not found`, { json: opts.json, command: 'tag delete' });
        }
        if (opts.json) {
            emitJson({ ok: true, command: 'tag delete', data: { action: 'deleted', name } });
            return;
        }
        console.log(success(`Deleted tag "${theme().heading.chalk(name)}"`));
    });

tagCommand
    .command('color')
    .description('Set tag color')
    .argument('<name>', 'Tag name')
    .argument('<color>', 'Color')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ todo tag color myTag blue --json | jq '.data'`)
    .action((name: string, color: string, opts) => {
        const ctx = getContext();
        const tag = ctx.tagRepo.setColor(name, color);
        if (!requireEntity(tag, 'Tag', `"${name}"`, { json: opts.json, command: 'tag color' })) return;
        if (opts.json) {
            emitJson({ ok: true, command: 'tag color', data: tag });
            return;
        }
        console.log(success(`Set color of "${theme().heading.chalk(name)}" to ${color}`));
    });
