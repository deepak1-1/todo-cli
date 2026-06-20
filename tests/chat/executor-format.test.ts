// Verifies that the consolidated color maps in format.ts produce correct output
// for the chat executor's formatTaskList function.
//
// Requires the default theme to be loaded so the chalk functions are populated.

import chalk from 'chalk';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../src/utils/initThemes.js';
import { loadTheme } from '../../src/utils/theme.js';
import { priorityColors, statusChalkFn } from '../../src/utils/format.js';
import type { TaskPriority } from '../../src/core/types.js';

const originalLevel = chalk.level;
beforeAll(() => {
    chalk.level = 3;
    loadTheme('default');
});
afterAll(() => { chalk.level = originalLevel; });

describe('priorityColors — canonical map produces expected ANSI output', () => {
    it('urgent → chalk.red.bold', () => {
        expect(priorityColors['urgent']('urgent')).toBe(chalk.red.bold('urgent'));
    });

    it('high → chalk.yellow', () => {
        expect(priorityColors['high']('high')).toBe(chalk.yellow('high'));
    });

    it('medium → theme priorityMedium (#5fafff)', () => {
        expect(priorityColors['medium']('medium')).toBe(chalk.hex('#5fafff')('medium'));
    });

    it('low → chalk.gray', () => {
        expect(priorityColors['low']('low')).toBe(chalk.gray('low'));
    });

    it('covers all TaskPriority values', () => {
        const priorities: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];
        for (const p of priorities) {
            expect(() => priorityColors[p](p)).not.toThrow();
        }
    });
});

describe('statusChalkFn — produces styled output for dynamic status keys', () => {
    it('done → chalk.green equivalent', () => {
        expect(statusChalkFn('done')('done')).toBe(chalk.green('done'));
    });

    it('in_progress → chalk.cyan equivalent', () => {
        expect(statusChalkFn('in_progress')('in_progress')).toBe(chalk.cyan('in_progress'));
    });

    it('in_review → chalk.yellow equivalent', () => {
        expect(statusChalkFn('in_review')('in_review')).toBe(chalk.yellow('in_review'));
    });

    it('todo → chalk.white equivalent (same theme slot as old pending)', () => {
        expect(statusChalkFn('todo')('todo')).toBe(chalk.white('todo'));
    });

    it('archived → chalk.gray equivalent', () => {
        expect(statusChalkFn('archived')('archived')).toBe(chalk.gray('archived'));
    });

    it('covers all new builtin status keys without throwing', () => {
        const statuses = ['todo', 'in_progress', 'in_review', 'blocked', 'done', 'archived'];
        for (const s of statuses) {
            expect(() => statusChalkFn(s)(s)).not.toThrow();
        }
    });
});
