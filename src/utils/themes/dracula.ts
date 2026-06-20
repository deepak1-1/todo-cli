// Dracula theme — based on the Dracula color scheme.
import chalk from 'chalk';
import type { Palette, PaletteEntry } from '../theme.js';
import { registerTheme } from '../theme.js';

function e(chalkFn: (s: string) => string, ink: string): PaletteEntry {
    return { chalk: chalkFn as unknown as import('chalk').ChalkInstance, ink };
}

const DR_RED = '#ff5555';
const DR_ORANGE = '#ffb86c';
const DR_YELLOW = '#f1fa8c';
const DR_GREEN = '#50fa7b';
const DR_CYAN = '#8be9fd';
const DR_PINK = '#ff79c6';
const DR_PURPLE = '#bd93f9';
const DR_COMMENT = '#6272a4';
const DR_FG = '#f8f8f2';

export const draculaTheme = {
    name: 'dracula',
    description: 'Dracula color scheme — vibrant purples and pinks',
    build(): Palette {
        return {
            priorityUrgent: e(chalk.hex(DR_RED).bold, DR_RED),
            priorityHigh: e(chalk.hex(DR_ORANGE), DR_ORANGE),
            priorityMedium: e(chalk.hex(DR_CYAN), DR_CYAN),
            priorityLow: e(chalk.hex(DR_COMMENT), DR_COMMENT),

            statusPending: e(chalk.hex(DR_FG), DR_FG),
            statusInProgress: e(chalk.hex(DR_CYAN), DR_CYAN),
            statusInQa: e(chalk.hex(DR_YELLOW), DR_YELLOW),
            statusDone: e(chalk.hex(DR_GREEN), DR_GREEN),
            statusArchived: e(chalk.hex(DR_COMMENT), DR_COMMENT),

            id: e(chalk.hex(DR_COMMENT), DR_COMMENT),
            ref: e(chalk.hex(DR_CYAN), DR_CYAN),
            project: e(chalk.hex(DR_PINK), DR_PINK),
            tag: e(chalk.hex(DR_PURPLE), DR_PURPLE),

            dateOverdue: e(chalk.hex(DR_RED).bold, DR_RED),
            dateNormal: e(chalk.hex(DR_YELLOW), DR_YELLOW),
            blocked: e(chalk.hex(DR_RED), DR_RED),

            info: e(chalk.hex(DR_CYAN), DR_CYAN),
            success: e(chalk.hex(DR_GREEN), DR_GREEN),
            warning: e(chalk.hex(DR_ORANGE), DR_ORANGE),
            error: e(chalk.hex(DR_RED), DR_RED),
            debug: e(chalk.hex(DR_COMMENT), DR_COMMENT),

            muted: e(chalk.hex(DR_COMMENT), DR_COMMENT),
            accent: e(chalk.hex(DR_PURPLE), DR_PURPLE),
            heading: e(chalk.hex(DR_FG).bold, DR_FG),
            tableBorder: e(chalk.hex(DR_COMMENT), DR_COMMENT),
            tableHeader: e(chalk.hex(DR_CYAN), DR_CYAN),
            prompt: e(chalk.hex(DR_PINK), DR_PINK),
            cursor: e(chalk.hex(DR_COMMENT), DR_COMMENT),

            title: e(chalk.hex(DR_PURPLE).bold, DR_PURPLE),
            subtitle: e(chalk.hex(DR_CYAN), DR_CYAN),
            body: e(chalk.hex(DR_FG), DR_FG),
            panelBorder: e(chalk.hex(DR_COMMENT), DR_COMMENT),
        };
    },
};

registerTheme(draculaTheme);
