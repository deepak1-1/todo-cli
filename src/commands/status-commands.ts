// Dynamic status verb commands: one `todo <verb> <id>` per status row.

import { Command } from 'commander';
import { parseId } from '../utils/format.js';
import { executeEdit } from './edit.js';
import type { StatusDef } from '../core/status.js';

/** Build one Command per status, skipping verbs already registered on program. */
export function buildStatusCommands(
    defs: StatusDef[],
    existingVerbs: Set<string>,
): Command[] {
    return defs
        .filter(d => !existingVerbs.has(d.verb))
        .map(d => {
            return new Command(d.verb)
                .description(`${d.label} — set task status to "${d.key}"`)
                .argument('<id>', 'Task ID')
                .option('--json', 'Output JSON instead of human-readable text')
                .action((rawId: string, opts) => {
                    executeEdit(parseId(rawId), { status: d.key }, { json: !!opts.json });
                });
        });
}
