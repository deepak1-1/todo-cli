// Light theme — optimized for light/white terminal backgrounds.
import chalk from 'chalk';
import type { Palette, PaletteEntry } from '../theme.js';
import { registerTheme } from '../theme.js';

function e(chalkFn: (s: string) => string, ink: string): PaletteEntry {
    return { chalk: chalkFn as unknown as import('chalk').ChalkInstance, ink };
}

export const lightTheme = {
    name: 'light',
    description: 'Muted palette for light/white terminal backgrounds',
    build(): Palette {
        return {
            priorityUrgent: e(chalk.red.bold, 'red'),
            priorityHigh: e(chalk.hex('#875f00'), '#875f00'),
            priorityMedium: e(chalk.hex('#005faf'), '#005faf'),
            priorityLow: e(chalk.hex('#606060'), '#606060'),

            statusPending: e(chalk.hex('#303030'), '#303030'),
            statusInProgress: e(chalk.hex('#005f87'), '#005f87'),
            statusInQa: e(chalk.hex('#875f00'), '#875f00'),
            statusDone: e(chalk.hex('#005f00'), '#005f00'),
            statusArchived: e(chalk.hex('#606060'), '#606060'),

            id: e(chalk.hex('#606060'), '#606060'),
            ref: e(chalk.hex('#005faf'), '#005faf'),
            project: e(chalk.hex('#007855'), '#007855'),
            tag: e(chalk.hex('#005f87'), '#005f87'),

            dateOverdue: e(chalk.red.bold, 'red'),
            dateNormal: e(chalk.hex('#875f00'), '#875f00'),
            blocked: e(chalk.red, 'red'),

            info: e(chalk.hex('#005faf'), '#005faf'),
            success: e(chalk.hex('#005f00'), '#005f00'),
            warning: e(chalk.hex('#875f00'), '#875f00'),
            error: e(chalk.red, 'red'),
            debug: e(chalk.hex('#606060'), '#606060'),

            muted: e(chalk.hex('#606060'), '#606060'),
            accent: e(chalk.hex('#005f87'), '#005f87'),
            heading: e(chalk.hex('#303030').bold, '#303030'),
            tableBorder: e(chalk.hex('#9e9e9e'), '#9e9e9e'),
            tableHeader: e(chalk.hex('#005f87'), '#005f87'),
            prompt: e(chalk.hex('#005f87'), '#005f87'),
            cursor: e(chalk.hex('#606060'), '#606060'),

            title: e(chalk.hex('#005faf').bold, '#005faf'),
            subtitle: e(chalk.hex('#0087af'), '#0087af'),
            body: e(chalk.hex('#262626'), '#262626'),
            panelBorder: e(chalk.hex('#9e9e9e'), '#9e9e9e'),
        };
    },
};

registerTheme(lightTheme);
