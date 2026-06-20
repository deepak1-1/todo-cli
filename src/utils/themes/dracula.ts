// Dracula theme — based on the Dracula color scheme.
import chalk from 'chalk';
import type { Palette, PaletteEntry } from '../theme.js';
import { registerTheme } from '../theme.js';

function e(chalkFn: (s: string) => string, ink: string): PaletteEntry {
    return { chalk: chalkFn as unknown as import('chalk').ChalkInstance, ink };
}

const DR_RED    = '#ff5555';
const DR_ORANGE = '#ffb86c';
const DR_YELLOW = '#f1fa8c';
const DR_GREEN  = '#50fa7b';
const DR_CYAN   = '#8be9fd';
const DR_CORAL  = '#ff8c5a';
const DR_TEAL   = '#5af7c3';
const DR_SLATE  = '#5b6172';
const DR_FG     = '#f8f8f2';

export const draculaTheme = {
    name: 'dracula',
    description: 'Dracula color scheme — vibrant teals and corals',
    build(): Palette {
        return {
            priorityUrgent: e(chalk.hex(DR_RED).bold, DR_RED),
            priorityHigh: e(chalk.hex(DR_ORANGE), DR_ORANGE),
            priorityMedium: e(chalk.hex(DR_CYAN), DR_CYAN),
            priorityLow: e(chalk.hex(DR_SLATE), DR_SLATE),

            statusPending: e(chalk.hex(DR_FG), DR_FG),
            statusInProgress: e(chalk.hex(DR_CYAN), DR_CYAN),
            statusInQa: e(chalk.hex(DR_YELLOW), DR_YELLOW),
            statusDone: e(chalk.hex(DR_GREEN), DR_GREEN),
            statusArchived: e(chalk.hex(DR_SLATE), DR_SLATE),

            id: e(chalk.hex(DR_SLATE), DR_SLATE),
            ref: e(chalk.hex(DR_CYAN), DR_CYAN),
            project: e(chalk.hex(DR_CORAL), DR_CORAL),
            tag: e(chalk.hex(DR_TEAL), DR_TEAL),

            dateOverdue: e(chalk.hex(DR_RED).bold, DR_RED),
            dateNormal: e(chalk.hex(DR_YELLOW), DR_YELLOW),
            blocked: e(chalk.hex(DR_RED), DR_RED),

            info: e(chalk.hex(DR_CYAN), DR_CYAN),
            success: e(chalk.hex(DR_GREEN), DR_GREEN),
            warning: e(chalk.hex(DR_ORANGE), DR_ORANGE),
            error: e(chalk.hex(DR_RED), DR_RED),
            debug: e(chalk.hex(DR_SLATE), DR_SLATE),

            muted: e(chalk.hex(DR_SLATE), DR_SLATE),
            accent: e(chalk.hex(DR_TEAL), DR_TEAL),
            heading: e(chalk.hex(DR_FG).bold, DR_FG),
            tableBorder: e(chalk.hex(DR_SLATE), DR_SLATE),
            tableHeader: e(chalk.hex(DR_CYAN), DR_CYAN),
            prompt: e(chalk.hex(DR_CORAL), DR_CORAL),
            cursor: e(chalk.hex(DR_SLATE), DR_SLATE),

            title: e(chalk.hex(DR_TEAL).bold, DR_TEAL),
            subtitle: e(chalk.hex(DR_CYAN), DR_CYAN),
            body: e(chalk.hex(DR_FG), DR_FG),
            panelBorder: e(chalk.hex(DR_SLATE), DR_SLATE),
        };
    },
};

registerTheme(draculaTheme);
