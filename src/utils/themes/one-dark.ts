// One Dark theme — Atom's iconic dark color scheme.
import chalk from 'chalk';
import type { Palette, PaletteEntry } from '../theme.js';
import { registerTheme } from '../theme.js';

function e(chalkFn: (s: string) => string, ink: string): PaletteEntry {
    return { chalk: chalkFn as unknown as import('chalk').ChalkInstance, ink };
}

const OD_RED    = '#e06c75';
const OD_ORANGE = '#d19a66';
const OD_YELLOW = '#e5c07b';
const OD_GREEN  = '#98c379';
const OD_CYAN   = '#56b6c2';
const OD_BLUE   = '#61afef';
const OD_PURPLE = '#c678dd';
const OD_FG     = '#abb2bf';
const OD_MUTED  = '#5c6370';

export const oneDarkTheme = {
    name: 'one-dark',
    description: "One Dark — Atom's iconic dark theme",
    build(): Palette {
        return {
            priorityUrgent: e(chalk.hex(OD_RED).bold, OD_RED),
            priorityHigh: e(chalk.hex(OD_ORANGE), OD_ORANGE),
            priorityMedium: e(chalk.hex(OD_BLUE), OD_BLUE),
            priorityLow: e(chalk.hex(OD_MUTED), OD_MUTED),

            statusPending: e(chalk.hex(OD_FG), OD_FG),
            statusInProgress: e(chalk.hex(OD_CYAN), OD_CYAN),
            statusInQa: e(chalk.hex(OD_YELLOW), OD_YELLOW),
            statusDone: e(chalk.hex(OD_GREEN), OD_GREEN),
            statusArchived: e(chalk.hex(OD_MUTED), OD_MUTED),

            id: e(chalk.hex(OD_MUTED), OD_MUTED),
            ref: e(chalk.hex(OD_BLUE), OD_BLUE),
            project: e(chalk.hex(OD_PURPLE), OD_PURPLE),
            tag: e(chalk.hex(OD_CYAN), OD_CYAN),

            dateOverdue: e(chalk.hex(OD_RED).bold, OD_RED),
            dateNormal: e(chalk.hex(OD_YELLOW), OD_YELLOW),
            blocked: e(chalk.hex(OD_RED), OD_RED),

            info: e(chalk.hex(OD_BLUE), OD_BLUE),
            success: e(chalk.hex(OD_GREEN), OD_GREEN),
            warning: e(chalk.hex(OD_YELLOW), OD_YELLOW),
            error: e(chalk.hex(OD_RED), OD_RED),
            debug: e(chalk.hex(OD_MUTED), OD_MUTED),

            muted: e(chalk.hex(OD_MUTED), OD_MUTED),
            accent: e(chalk.hex(OD_PURPLE), OD_PURPLE),
            heading: e(chalk.hex(OD_FG).bold, OD_FG),
            tableBorder: e(chalk.hex(OD_MUTED), OD_MUTED),
            tableHeader: e(chalk.hex(OD_BLUE), OD_BLUE),
            prompt: e(chalk.hex(OD_CYAN), OD_CYAN),
            cursor: e(chalk.hex(OD_MUTED), OD_MUTED),

            title: e(chalk.hex(OD_PURPLE).bold, OD_PURPLE),
            subtitle: e(chalk.hex(OD_BLUE), OD_BLUE),
            body: e(chalk.hex(OD_FG), OD_FG),
            panelBorder: e(chalk.hex(OD_MUTED), OD_MUTED),
        };
    },
};

registerTheme(oneDarkTheme);
