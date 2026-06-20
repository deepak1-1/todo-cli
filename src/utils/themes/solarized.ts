// Solarized theme — dark variant.
import chalk from 'chalk';
import type { Palette, PaletteEntry } from '../theme.js';
import { registerTheme } from '../theme.js';

function e(chalkFn: (s: string) => string, ink: string): PaletteEntry {
    return { chalk: chalkFn as unknown as import('chalk').ChalkInstance, ink };
}

const SOL_RED    = '#dc322f';
const SOL_ORANGE = '#cb4b16';
const SOL_YELLOW = '#b58900';
const SOL_GREEN  = '#859900';
const SOL_CYAN   = '#2aa198';
const SOL_BLUE   = '#268bd2';
const SOL_BASE0  = '#839496';
const SOL_BASE1  = '#93a1a1';
const SOL_BASE01 = '#586e75';

export const solarizedTheme = {
    name: 'solarized',
    description: 'Solarized dark — warm tones with precise color balance',
    build(): Palette {
        return {
            priorityUrgent: e(chalk.hex(SOL_RED).bold, SOL_RED),
            priorityHigh: e(chalk.hex(SOL_ORANGE), SOL_ORANGE),
            priorityMedium: e(chalk.hex(SOL_BLUE), SOL_BLUE),
            priorityLow: e(chalk.hex(SOL_BASE01), SOL_BASE01),

            statusPending: e(chalk.hex(SOL_BASE0), SOL_BASE0),
            statusInProgress: e(chalk.hex(SOL_CYAN), SOL_CYAN),
            statusInQa: e(chalk.hex(SOL_YELLOW), SOL_YELLOW),
            statusDone: e(chalk.hex(SOL_GREEN), SOL_GREEN),
            statusArchived: e(chalk.hex(SOL_BASE01), SOL_BASE01),

            id: e(chalk.hex(SOL_BASE01), SOL_BASE01),
            ref: e(chalk.hex(SOL_BLUE), SOL_BLUE),
            project: e(chalk.hex(SOL_GREEN), SOL_GREEN),
            tag: e(chalk.hex(SOL_CYAN), SOL_CYAN),

            dateOverdue: e(chalk.hex(SOL_RED).bold, SOL_RED),
            dateNormal: e(chalk.hex(SOL_YELLOW), SOL_YELLOW),
            blocked: e(chalk.hex(SOL_RED), SOL_RED),

            info: e(chalk.hex(SOL_BLUE), SOL_BLUE),
            success: e(chalk.hex(SOL_GREEN), SOL_GREEN),
            warning: e(chalk.hex(SOL_YELLOW), SOL_YELLOW),
            error: e(chalk.hex(SOL_RED), SOL_RED),
            debug: e(chalk.hex(SOL_BASE01), SOL_BASE01),

            muted: e(chalk.hex(SOL_BASE01), SOL_BASE01),
            accent: e(chalk.hex(SOL_CYAN), SOL_CYAN),
            heading: e(chalk.hex(SOL_BASE1).bold, SOL_BASE1),
            tableBorder: e(chalk.hex(SOL_BASE01), SOL_BASE01),
            tableHeader: e(chalk.hex(SOL_CYAN), SOL_CYAN),
            prompt: e(chalk.hex(SOL_CYAN), SOL_CYAN),
            cursor: e(chalk.hex(SOL_BASE01), SOL_BASE01),

            title: e(chalk.hex(SOL_BLUE).bold, SOL_BLUE),
            subtitle: e(chalk.hex(SOL_CYAN), SOL_CYAN),
            body: e(chalk.hex(SOL_BASE0), SOL_BASE0),
            panelBorder: e(chalk.hex(SOL_BASE01), SOL_BASE01),
        };
    },
};

registerTheme(solarizedTheme);
