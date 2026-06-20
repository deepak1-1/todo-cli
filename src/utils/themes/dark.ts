// Dark theme — high-contrast colors optimized for dark terminals.
import chalk from 'chalk';
import type { Palette, PaletteEntry } from '../theme.js';
import { registerTheme } from '../theme.js';

function e(chalkFn: (s: string) => string, ink: string): PaletteEntry {
    return { chalk: chalkFn as unknown as import('chalk').ChalkInstance, ink };
}

export const darkTheme = {
    name: 'dark',
    description: 'High-contrast colors for dark terminals',
    build(): Palette {
        return {
            priorityUrgent: e(chalk.hex('#ff5f5f').bold, '#ff5f5f'),
            priorityHigh: e(chalk.hex('#ffaf00'), '#ffaf00'),
            priorityMedium: e(chalk.hex('#5fafff'), '#5fafff'),
            priorityLow: e(chalk.hex('#808080'), '#808080'),

            statusPending: e(chalk.hex('#d0d0d0'), '#d0d0d0'),
            statusInProgress: e(chalk.hex('#00d7ff'), '#00d7ff'),
            statusInQa: e(chalk.hex('#ffaf00'), '#ffaf00'),
            statusDone: e(chalk.hex('#5fff5f'), '#5fff5f'),
            statusArchived: e(chalk.hex('#585858'), '#585858'),

            id: e(chalk.hex('#808080'), '#808080'),
            ref: e(chalk.hex('#5fafff'), '#5fafff'),
            project: e(chalk.hex('#5fd7af'), '#5fd7af'),
            tag: e(chalk.hex('#00d7ff'), '#00d7ff'),

            dateOverdue: e(chalk.hex('#ff5f5f').bold, '#ff5f5f'),
            dateNormal: e(chalk.hex('#ffaf00'), '#ffaf00'),
            blocked: e(chalk.hex('#ff5f5f'), '#ff5f5f'),

            info: e(chalk.hex('#5fafff'), '#5fafff'),
            success: e(chalk.hex('#5fff5f'), '#5fff5f'),
            warning: e(chalk.hex('#ffaf00'), '#ffaf00'),
            error: e(chalk.hex('#ff5f5f'), '#ff5f5f'),
            debug: e(chalk.hex('#808080'), '#808080'),

            muted: e(chalk.hex('#585858'), '#585858'),
            accent: e(chalk.hex('#00d7ff'), '#00d7ff'),
            heading: e(chalk.hex('#d0d0d0').bold, '#d0d0d0'),
            tableBorder: e(chalk.hex('#585858'), '#585858'),
            tableHeader: e(chalk.hex('#00d7ff'), '#00d7ff'),
            prompt: e(chalk.hex('#00d7ff'), '#00d7ff'),
            cursor: e(chalk.hex('#808080'), '#808080'),

            title: e(chalk.hex('#5fafff').bold, '#5fafff'),
            subtitle: e(chalk.hex('#87afd7'), '#87afd7'),
            body: e(chalk.hex('#d0d0d0'), '#d0d0d0'),
            panelBorder: e(chalk.hex('#5f5f5f'), '#5f5f5f'),
        };
    },
};

registerTheme(darkTheme);
