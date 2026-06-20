// Nord theme — Arctic, north-bluish color palette.
import chalk from 'chalk';
import type { Palette, PaletteEntry } from '../theme.js';
import { registerTheme } from '../theme.js';

function e(chalkFn: (s: string) => string, ink: string): PaletteEntry {
    return { chalk: chalkFn as unknown as import('chalk').ChalkInstance, ink };
}

const N_RED      = '#bf616a';
const N_ORANGE   = '#d08770';
const N_YELLOW   = '#ebcb8b';
const N_GREEN    = '#a3be8c';
const N_CYAN     = '#88c0d0';
const N_BLUE     = '#81a1c1';
const N_MAGENTA  = '#b48ead';
const N_FG       = '#d8dee9';
const N_MUTED    = '#4c566a';

export const nordTheme = {
    name: 'nord',
    description: 'Nord — Arctic, north-bluish color palette',
    build(): Palette {
        return {
            priorityUrgent: e(chalk.hex(N_RED).bold, N_RED),
            priorityHigh: e(chalk.hex(N_ORANGE), N_ORANGE),
            priorityMedium: e(chalk.hex(N_BLUE), N_BLUE),
            priorityLow: e(chalk.hex(N_MUTED), N_MUTED),

            statusPending: e(chalk.hex(N_FG), N_FG),
            statusInProgress: e(chalk.hex(N_CYAN), N_CYAN),
            statusInQa: e(chalk.hex(N_YELLOW), N_YELLOW),
            statusDone: e(chalk.hex(N_GREEN), N_GREEN),
            statusArchived: e(chalk.hex(N_MUTED), N_MUTED),

            id: e(chalk.hex(N_MUTED), N_MUTED),
            ref: e(chalk.hex(N_BLUE), N_BLUE),
            project: e(chalk.hex(N_MAGENTA), N_MAGENTA),
            tag: e(chalk.hex(N_CYAN), N_CYAN),

            dateOverdue: e(chalk.hex(N_RED).bold, N_RED),
            dateNormal: e(chalk.hex(N_YELLOW), N_YELLOW),
            blocked: e(chalk.hex(N_RED), N_RED),

            info: e(chalk.hex(N_BLUE), N_BLUE),
            success: e(chalk.hex(N_GREEN), N_GREEN),
            warning: e(chalk.hex(N_YELLOW), N_YELLOW),
            error: e(chalk.hex(N_RED), N_RED),
            debug: e(chalk.hex(N_MUTED), N_MUTED),

            muted: e(chalk.hex(N_MUTED), N_MUTED),
            accent: e(chalk.hex(N_CYAN), N_CYAN),
            heading: e(chalk.hex(N_FG).bold, N_FG),
            tableBorder: e(chalk.hex(N_MUTED), N_MUTED),
            tableHeader: e(chalk.hex(N_CYAN), N_CYAN),
            prompt: e(chalk.hex(N_CYAN), N_CYAN),
            cursor: e(chalk.hex(N_MUTED), N_MUTED),

            title: e(chalk.hex(N_CYAN).bold, N_CYAN),
            subtitle: e(chalk.hex(N_BLUE), N_BLUE),
            body: e(chalk.hex(N_FG), N_FG),
            panelBorder: e(chalk.hex(N_MUTED), N_MUTED),
        };
    },
};

registerTheme(nordTheme);
