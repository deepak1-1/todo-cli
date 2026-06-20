// Tokyo Night theme — a dark, vibrant theme inspired by Tokyo nights.
import chalk from 'chalk';
import type { Palette, PaletteEntry } from '../theme.js';
import { registerTheme } from '../theme.js';

function e(chalkFn: (s: string) => string, ink: string): PaletteEntry {
    return { chalk: chalkFn as unknown as import('chalk').ChalkInstance, ink };
}

const TN_RED    = '#f7768e';
const TN_ORANGE = '#ff9e64';
const TN_YELLOW = '#e0af68';
const TN_GREEN  = '#9ece6a';
const TN_CYAN   = '#7dcfff';
const TN_BLUE   = '#7aa2f7';
const TN_TEAL   = '#73daca';
const TN_FG     = '#a9b1d6';
const TN_MUTED  = '#565f89';

export const tokyoNightTheme = {
    name: 'tokyo-night',
    description: 'Tokyo Night — dark theme with vivid accent colors',
    build(): Palette {
        return {
            priorityUrgent: e(chalk.hex(TN_RED).bold, TN_RED),
            priorityHigh: e(chalk.hex(TN_ORANGE), TN_ORANGE),
            priorityMedium: e(chalk.hex(TN_BLUE), TN_BLUE),
            priorityLow: e(chalk.hex(TN_MUTED), TN_MUTED),

            statusPending: e(chalk.hex(TN_FG), TN_FG),
            statusInProgress: e(chalk.hex(TN_CYAN), TN_CYAN),
            statusInQa: e(chalk.hex(TN_YELLOW), TN_YELLOW),
            statusDone: e(chalk.hex(TN_GREEN), TN_GREEN),
            statusArchived: e(chalk.hex(TN_MUTED), TN_MUTED),

            id: e(chalk.hex(TN_MUTED), TN_MUTED),
            ref: e(chalk.hex(TN_BLUE), TN_BLUE),
            project: e(chalk.hex(TN_TEAL), TN_TEAL),
            tag: e(chalk.hex(TN_CYAN), TN_CYAN),

            dateOverdue: e(chalk.hex(TN_RED).bold, TN_RED),
            dateNormal: e(chalk.hex(TN_YELLOW), TN_YELLOW),
            blocked: e(chalk.hex(TN_RED), TN_RED),

            info: e(chalk.hex(TN_BLUE), TN_BLUE),
            success: e(chalk.hex(TN_GREEN), TN_GREEN),
            warning: e(chalk.hex(TN_YELLOW), TN_YELLOW),
            error: e(chalk.hex(TN_RED), TN_RED),
            debug: e(chalk.hex(TN_MUTED), TN_MUTED),

            muted: e(chalk.hex(TN_MUTED), TN_MUTED),
            accent: e(chalk.hex(TN_BLUE), TN_BLUE),
            heading: e(chalk.hex(TN_FG).bold, TN_FG),
            tableBorder: e(chalk.hex(TN_MUTED), TN_MUTED),
            tableHeader: e(chalk.hex(TN_BLUE), TN_BLUE),
            prompt: e(chalk.hex(TN_CYAN), TN_CYAN),
            cursor: e(chalk.hex(TN_MUTED), TN_MUTED),

            title: e(chalk.hex(TN_CYAN).bold, TN_CYAN),
            subtitle: e(chalk.hex(TN_BLUE), TN_BLUE),
            body: e(chalk.hex(TN_FG), TN_FG),
            panelBorder: e(chalk.hex(TN_MUTED), TN_MUTED),
        };
    },
};

registerTheme(tokyoNightTheme);
