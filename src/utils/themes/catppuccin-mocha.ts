// Catppuccin Mocha theme — soothing pastel palette for dark backgrounds.
import chalk from 'chalk';
import type { Palette, PaletteEntry } from '../theme.js';
import { registerTheme } from '../theme.js';

function e(chalkFn: (s: string) => string, ink: string): PaletteEntry {
    return { chalk: chalkFn as unknown as import('chalk').ChalkInstance, ink };
}

const CM_RED       = '#f38ba8';
const CM_ORANGE    = '#fab387'; // peach
const CM_YELLOW    = '#f9e2af';
const CM_GREEN     = '#a6e3a1';
const CM_TEAL      = '#94e2d5';
const CM_BLUE      = '#89b4fa';
const CM_SAPPHIRE  = '#74c7ec';
const CM_FG        = '#cdd6f4';
const CM_MUTED     = '#6c7086';

export const catppuccinMochaTheme = {
    name: 'catppuccin-mocha',
    description: 'Catppuccin Mocha — soothing pastel palette for dark backgrounds',
    build(): Palette {
        return {
            priorityUrgent: e(chalk.hex(CM_RED).bold, CM_RED),
            priorityHigh: e(chalk.hex(CM_ORANGE), CM_ORANGE),
            priorityMedium: e(chalk.hex(CM_BLUE), CM_BLUE),
            priorityLow: e(chalk.hex(CM_MUTED), CM_MUTED),

            statusPending: e(chalk.hex(CM_FG), CM_FG),
            statusInProgress: e(chalk.hex(CM_TEAL), CM_TEAL),
            statusInQa: e(chalk.hex(CM_YELLOW), CM_YELLOW),
            statusDone: e(chalk.hex(CM_GREEN), CM_GREEN),
            statusArchived: e(chalk.hex(CM_MUTED), CM_MUTED),

            id: e(chalk.hex(CM_MUTED), CM_MUTED),
            ref: e(chalk.hex(CM_BLUE), CM_BLUE),
            project: e(chalk.hex(CM_SAPPHIRE), CM_SAPPHIRE),
            tag: e(chalk.hex(CM_TEAL), CM_TEAL),

            dateOverdue: e(chalk.hex(CM_RED).bold, CM_RED),
            dateNormal: e(chalk.hex(CM_YELLOW), CM_YELLOW),
            blocked: e(chalk.hex(CM_RED), CM_RED),

            info: e(chalk.hex(CM_BLUE), CM_BLUE),
            success: e(chalk.hex(CM_GREEN), CM_GREEN),
            warning: e(chalk.hex(CM_YELLOW), CM_YELLOW),
            error: e(chalk.hex(CM_RED), CM_RED),
            debug: e(chalk.hex(CM_MUTED), CM_MUTED),

            muted: e(chalk.hex(CM_MUTED), CM_MUTED),
            accent: e(chalk.hex(CM_SAPPHIRE), CM_SAPPHIRE),
            heading: e(chalk.hex(CM_FG).bold, CM_FG),
            tableBorder: e(chalk.hex(CM_MUTED), CM_MUTED),
            tableHeader: e(chalk.hex(CM_SAPPHIRE), CM_SAPPHIRE),
            prompt: e(chalk.hex(CM_TEAL), CM_TEAL),
            cursor: e(chalk.hex(CM_MUTED), CM_MUTED),

            title: e(chalk.hex(CM_SAPPHIRE).bold, CM_SAPPHIRE),
            subtitle: e(chalk.hex(CM_BLUE), CM_BLUE),
            body: e(chalk.hex(CM_FG), CM_FG),
            panelBorder: e(chalk.hex(CM_MUTED), CM_MUTED),
        };
    },
};

registerTheme(catppuccinMochaTheme);
