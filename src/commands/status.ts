// todo status — Manage user-defined statuses.

import { Command } from 'commander';
import { getContext } from './context.js';
import { makeTable } from '../utils/table.js';
import { theme } from '../utils/theme.js';
import { success } from '../utils/format.js';
import { fail, EXIT } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';
import { RESERVED_VERBS } from './reserved-verbs.js';

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const VERB_RE = /^[a-z][a-z0-9_]*$/;

function validateKey(key: string): string | null {
    if (!KEY_RE.test(key)) return `Key "${key}" must match ^[a-z][a-z0-9_]*$`;
    return null;
}

function validateVerb(verb: string): string | null {
    if (!VERB_RE.test(verb)) return `Verb "${verb}" must match ^[a-z][a-z0-9_]*$`;
    if (RESERVED_VERBS.has(verb)) return `Verb "${verb}" is reserved by the CLI`;
    return null;
}

export const statusCommand = new Command('status')
    .description('Manage task statuses');

// ---- list ----
statusCommand
    .command('list')
    .alias('ls')
    .description('List all statuses')
    .option('--json', 'Output as JSON')
    .action((opts) => {
        const ctx = getContext();
        const t = theme();
        const defs = ctx.statusRepo.list();

        if (opts.json) {
            emitJson({ ok: true, command: 'status list', data: defs });
            return;
        }

        const table = makeTable({
            head: ['Key', 'Label', 'Icon', 'Verb', 'Completes', 'Archives', 'Builtin'],
            style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
        });
        for (const d of defs) {
            table.push([d.key, d.label, d.icon, d.verb, d.completes ? 'yes' : '-', d.archives ? 'yes' : '-', d.isBuiltin ? 'yes' : '-']);
        }
        console.log(table.toString());
    });

// ---- add ----
statusCommand
    .command('add <key>')
    .description('Add a new status')
    .requiredOption('--label <text>', 'Display label')
    .requiredOption('--verb <verb>', 'CLI verb that sets this status')
    .option('--icon <char>', 'Icon character')
    .option('--color <name>', 'Color name')
    .option('--completes', 'Tasks with this status count as complete')
    .option('--archives', 'Tasks with this status are archived (hidden by default)')
    .option('--order <n>', 'Sort order (integer)')
    .option('--json', 'Output as JSON')
    .action((key: string, opts) => {
        const keyErr = validateKey(key);
        if (keyErr) return fail(EXIT.USAGE, keyErr, { json: opts.json, command: 'status add' });

        const verbErr = validateVerb(opts.verb as string);
        if (verbErr) return fail(EXIT.USAGE, verbErr, { json: opts.json, command: 'status add' });

        const ctx = getContext();
        try {
            const def = ctx.statusRepo.create({
                key,
                label: opts.label as string,
                verb: opts.verb as string,
                icon: opts.icon as string | undefined,
                color: opts.color as string | undefined,
                completes: !!opts.completes,
                archives: !!opts.archives,
                sortOrder: opts.order ? parseInt(opts.order as string, 10) : undefined,
            });
            if (opts.json) {
                emitJson({ ok: true, command: 'status add', data: def });
            } else {
                console.log(success(`Created status "${key}" (verb: ${def.verb})`));
            }
        } catch (e: unknown) {
            fail(EXIT.GENERIC, e instanceof Error ? e.message : String(e), { json: opts.json, command: 'status add' });
        }
    });

// ---- edit ----
statusCommand
    .command('edit <key>')
    .description('Edit an existing status')
    .option('--label <text>', 'New display label')
    .option('--verb <verb>', 'New CLI verb')
    .option('--icon <char>', 'New icon')
    .option('--color <name>', 'New color name')
    .option('--rename <newKey>', 'Rename the key')
    .option('--completes', 'Mark as completing', undefined)
    .option('--no-completes', 'Unmark as completing')
    .option('--archives', 'Mark as archiving', undefined)
    .option('--no-archives', 'Unmark as archiving')
    .option('--order <n>', 'New sort order')
    .option('--json', 'Output as JSON')
    .action((key: string, opts) => {
        if (opts.rename) {
            const keyErr = validateKey(opts.rename as string);
            if (keyErr) return fail(EXIT.USAGE, keyErr, { json: opts.json, command: 'status edit' });
        }
        if (opts.verb) {
            const verbErr = validateVerb(opts.verb as string);
            if (verbErr) return fail(EXIT.USAGE, verbErr, { json: opts.json, command: 'status edit' });
        }

        const ctx = getContext();
        try {
            const changes: Record<string, unknown> = {};
            if (opts.label) changes.label = opts.label;
            if (opts.verb) changes.verb = opts.verb;
            if (opts.icon) changes.icon = opts.icon;
            if (opts.color) changes.color = opts.color;
            if (opts.rename) changes.newKey = opts.rename;
            if (opts.completes !== undefined) changes.completes = opts.completes;
            if (opts.archives !== undefined) changes.archives = opts.archives;
            if (opts.order) changes.sortOrder = parseInt(opts.order as string, 10);

            const def = ctx.statusRepo.update(key, changes as Parameters<typeof ctx.statusRepo.update>[1]);
            if (opts.json) {
                emitJson({ ok: true, command: 'status edit', data: def });
            } else {
                console.log(success(`Updated status "${opts.rename ?? key}"`));
            }
        } catch (e: unknown) {
            fail(EXIT.GENERIC, e instanceof Error ? e.message : String(e), { json: opts.json, command: 'status edit' });
        }
    });

// ---- remove ----
statusCommand
    .command('remove <key>')
    .description('Remove a custom status')
    .option('--remap <key>', 'Reassign tasks using this status to another key')
    .option('--force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action((key: string, opts) => {
        const ctx = getContext();
        try {
            ctx.statusRepo.delete(key, opts.remap as string | undefined);
            if (opts.json) {
                emitJson({ ok: true, command: 'status remove', data: { key, remappedTo: opts.remap ?? null } });
            } else {
                console.log(success(`Removed status "${key}"${opts.remap ? ` (tasks remapped to "${opts.remap}")` : ''}`));
            }
        } catch (e: unknown) {
            fail(EXIT.GENERIC, e instanceof Error ? e.message : String(e), { json: opts.json, command: 'status remove' });
        }
    });

// ---- reset ----
statusCommand
    .command('reset')
    .description('Reset to builtin statuses only (remaps custom-status tasks to "todo")')
    .option('--json', 'Output as JSON')
    .action((opts) => {
        const ctx = getContext();
        ctx.statusRepo.reset();
        if (opts.json) {
            emitJson({ ok: true, command: 'status reset', data: {} });
        } else {
            console.log(success('Statuses reset to defaults'));
        }
    });
