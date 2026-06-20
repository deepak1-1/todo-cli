// Gruvbox Dark theme — retro groove color scheme.
import chalk from 'chalk';
import type { Palette, PaletteEntry } from '../theme.js';
import { registerTheme } from '../theme.js';

function e(chalkFn: (s: string) => string, ink: string): PaletteEntry {
    return { chalk: chalkFn as unknown as import('chalk').ChalkInstance, ink };
}

const GV_RED    = '#fb4934';
const GV_ORANGE = '#fe8019';
const GV_YELLOW = '#fabd2f';
const GV_GREEN  = '#b8bb26';
const GV_AQUA   = '#8ec07c';
const GV_BLUE   = '#83a598';
const GV_AQUA2  = '#689d6a';
const GV_FG     = '#ebdbb2';
const GV_MUTED  = '#928374';

export const gruvboxDarkTheme = {
    name: 'gruvbox-dark',
    description: 'Gruvbox Dark — retro groove with warm earthy tones',
    build(): Palette {
        return {
            priorityUrgent: e(chalk.hex(GV_RED).bold, GV_RED),
            priorityHigh: e(chalk.hex(GV_ORANGE), GV_ORANGE),
            priorityMedium: e(chalk.hex(GV_BLUE), GV_BLUE),
            priorityLow: e(chalk.hex(GV_MUTED), GV_MUTED),

            statusPending: e(chalk.hex(GV_FG), GV_FG),
            statusInProgress: e(chalk.hex(GV_AQUA), GV_AQUA),
            statusInQa: e(chalk.hex(GV_YELLOW), GV_YELLOW),
            statusDone: e(chalk.hex(GV_GREEN), GV_GREEN),
            statusArchived: e(chalk.hex(GV_MUTED), GV_MUTED),

            id: e(chalk.hex(GV_MUTED), GV_MUTED),
            ref: e(chalk.hex(GV_BLUE), GV_BLUE),
            project: e(chalk.hex(GV_AQUA2), GV_AQUA2),
            tag: e(chalk.hex(GV_AQUA), GV_AQUA),

            dateOverdue: e(chalk.hex(GV_RED).bold, GV_RED),
            dateNormal: e(chalk.hex(GV_YELLOW), GV_YELLOW),
            blocked: e(chalk.hex(GV_RED), GV_RED),

            info: e(chalk.hex(GV_BLUE), GV_BLUE),
            success: e(chalk.hex(GV_GREEN), GV_GREEN),
            warning: e(chalk.hex(GV_YELLOW), GV_YELLOW),
            error: e(chalk.hex(GV_RED), GV_RED),
            debug: e(chalk.hex(GV_MUTED), GV_MUTED),

            muted: e(chalk.hex(GV_MUTED), GV_MUTED),
            accent: e(chalk.hex(GV_YELLOW), GV_YELLOW),
            heading: e(chalk.hex(GV_FG).bold, GV_FG),
            tableBorder: e(chalk.hex(GV_MUTED), GV_MUTED),
            tableHeader: e(chalk.hex(GV_YELLOW), GV_YELLOW),
            prompt: e(chalk.hex(GV_AQUA), GV_AQUA),
            cursor: e(chalk.hex(GV_MUTED), GV_MUTED),

            title: e(chalk.hex(GV_YELLOW).bold, GV_YELLOW),
            subtitle: e(chalk.hex(GV_ORANGE), GV_ORANGE),
            body: e(chalk.hex(GV_FG), GV_FG),
            panelBorder: e(chalk.hex(GV_MUTED), GV_MUTED),
        };
    },
};

registerTheme(gruvboxDarkTheme);
