// ============================================================
// Status transition shortcuts: start, done, archive, reopen
// Thin aliases for: edit <id> --status <state>
// ============================================================

import { Command } from 'commander';
import { parseId } from '../utils/format.js';
import { executeEdit } from './edit.js';

export const startCommand = new Command('start')
    .description('Start working on a task (pending → in_progress)')
    .argument('<id>', 'Task ID')
    .option('--json', 'Output JSON instead of human-readable text')
    .action((rawId: string, opts) => {
        executeEdit(parseId(rawId), { status: 'in_progress' }, { json: !!opts.json });
    });

export const doneCommand = new Command('done')
    .description('Mark a task as done')
    .argument('<id>', 'Task ID')
    .option('--json', 'Output JSON instead of human-readable text')
    .action((rawId: string, opts) => {
        executeEdit(parseId(rawId), { status: 'done' }, { json: !!opts.json });
    });

export const archiveCommand = new Command('archive')
    .description('Archive a completed task (done → archived)')
    .argument('<id>', 'Task ID')
    .option('--json', 'Output JSON instead of human-readable text')
    .action((rawId: string, opts) => {
        executeEdit(parseId(rawId), { status: 'archived' }, { json: !!opts.json });
    });

export const qaCommand = new Command('qa')
    .description('Move a task to QA (in_progress → in_qa)')
    .argument('<id>', 'Task ID')
    .option('--json', 'Output JSON instead of human-readable text')
    .action((rawId: string, opts) => {
        executeEdit(parseId(rawId), { status: 'in_qa' }, { json: !!opts.json });
    });

export const reopenCommand = new Command('reopen')
    .description('Reopen a done/archived task')
    .argument('<id>', 'Task ID')
    .option('--json', 'Output JSON instead of human-readable text')
    .action((rawId: string, opts) => {
        executeEdit(parseId(rawId), { status: 'pending' }, { json: !!opts.json });
    });
