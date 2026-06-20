// Verifies that the consolidated color maps in format.ts produce correct output
// for the chat executor's formatTaskList function.
//
// Requires the default theme to be loaded so the chalk functions are populated.

import chalk from 'chalk';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import '../../src/utils/initThemes.js';
import { loadTheme } from '../../src/utils/theme.js';
import { priorityColors, statusColors } from '../../src/utils/format.js';
import type { TaskPriority, TaskStatus } from '../../src/core/types.js';

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

    it('medium → chalk.blue', () => {
        expect(priorityColors['medium']('medium')).toBe(chalk.blue('medium'));
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

describe('statusColors — canonical map produces expected ANSI output', () => {
    it('done → chalk.green', () => {
        expect(statusColors['done']('done')).toBe(chalk.green('done'));
    });

    it('in_progress → chalk.cyan', () => {
        expect(statusColors['in_progress']('in_progress')).toBe(chalk.cyan('in_progress'));
    });

    it('in_qa → chalk.yellow', () => {
        expect(statusColors['in_qa']('in_qa')).toBe(chalk.yellow('in_qa'));
    });

    it('pending → chalk.white', () => {
        expect(statusColors['pending']('pending')).toBe(chalk.white('pending'));
    });

    it('archived → chalk.gray (canonical; old executor used chalk.white as fallthrough)', () => {
        expect(statusColors['archived']('archived')).toBe(chalk.gray('archived'));
    });

    it('covers all TaskStatus values', () => {
        const statuses: TaskStatus[] = ['pending', 'in_progress', 'in_qa', 'done', 'archived'];
        for (const s of statuses) {
            expect(() => statusColors[s](s)).not.toThrow();
        }
    });
});
