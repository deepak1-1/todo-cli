import chalk from 'chalk';
import { loadTheme, disableColors } from './theme.js';
import { getConfig } from '../config/manager.js';

// Disable chalk output when --no-color or NO_COLOR env is set; never raise the level.
export function configureColor(opts: { color: boolean }): void {
    if (!opts.color || process.env['NO_COLOR']) {
        chalk.level = 0;
    }
    loadTheme(getConfig('theme'));
    if (chalk.level === 0) disableColors();
}
