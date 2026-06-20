// Default theme — mirrors the exact chalk choices used before theme support.
import chalk from 'chalk';
import type { Palette, PaletteEntry } from '../theme.js';
import { registerTheme } from '../theme.js';

function e(chalkFn: (s: string) => string, ink: string): PaletteEntry {
    return { chalk: chalkFn as unknown as import('chalk').ChalkInstance, ink };
}

export const defaultTheme = {
    name: 'default',
    description: 'Original todo-cli color scheme',
    build(): Palette {
        return {
            priorityUrgent: e(chalk.red.bold, 'redBright'),
            priorityHigh: e(chalk.yellow, 'yellow'),
            priorityMedium: e(chalk.blue, 'blue'),
            priorityLow: e(chalk.gray, 'gray'),

            statusPending: e(chalk.white, 'white'),
            statusInProgress: e(chalk.cyan, 'cyan'),
            statusInQa: e(chalk.yellow, 'yellow'),
            statusDone: e(chalk.green, 'green'),
            statusArchived: e(chalk.gray, 'gray'),

            id: e(chalk.gray, 'gray'),
            ref: e(chalk.blue, 'blue'),
            project: e(chalk.magenta, 'magenta'),
            tag: e(chalk.cyan, 'cyan'),

            dateOverdue: e(chalk.red.bold, 'redBright'),
            dateNormal: e(chalk.yellow, 'yellow'),
            blocked: e(chalk.red, 'red'),

            info: e(chalk.blue, 'blue'),
            success: e(chalk.green, 'green'),
            warning: e(chalk.yellow, 'yellow'),
            error: e(chalk.red, 'red'),
            debug: e(chalk.gray, 'gray'),

            muted: e(chalk.gray, 'gray'),
            accent: e(chalk.cyan, 'cyan'),
            heading: e(chalk.bold.white, 'white'),
            tableBorder: e(chalk.gray, 'gray'),
            tableHeader: e(chalk.cyan, 'cyan'),
            prompt: e(chalk.cyan, 'cyan'),
            cursor: e(chalk.gray, 'gray'),

            title: e(chalk.cyan.bold, 'cyan'),
            subtitle: e(chalk.blue, 'blue'),
            body: e(chalk.white, 'white'),
            panelBorder: e(chalk.gray, 'gray'),
        };
    },
};

registerTheme(defaultTheme);
