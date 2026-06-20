// todo config — Configuration management.

import { Command } from 'commander';
import { getConfig, setConfig, getAllConfig, resetConfig, getConfigPath, isValidConfigKey } from '../config/manager.js';
import { theme, listThemes, loadTheme } from '../utils/theme.js';
import { makeTable } from '../utils/table.js';
import type { AppConfig } from '../config/defaults.js';
import { success, formatStatus } from '../utils/format.js';
import { fail, EXIT } from '../utils/exit.js';

export const configCommand = new Command('config')
    .description('View and modify configuration')
    .action(() => {
        const t = theme();
        const config = getAllConfig();
        const table = makeTable({
            head: ['Key', 'Value'],
            style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
        });

        for (const [key, value] of Object.entries(config)) {
            table.push([key, String(value)]);
        }

        console.log(table.toString());
        console.log(t.muted.chalk(`  Config file: ${getConfigPath()}`));
    });

configCommand
    .command('get')
    .description('Get a config value')
    .argument('<key>', 'Config key')
    .action((key: string) => {
        if (!isValidConfigKey(key)) {
            return fail(EXIT.USAGE, `Unknown config key: ${key}`);
        }
        console.log(getConfig(key as keyof AppConfig));
    });

configCommand
    .command('set')
    .description('Set a config value')
    .argument('<key>', 'Config key')
    .argument('<value>', 'Config value')
    .action((key: string, value: string) => {
        if (!isValidConfigKey(key)) {
            return fail(EXIT.USAGE, `Unknown config key: ${key}`);
        }

        if (key === 'theme') {
            const valid = listThemes().map(t => t.name);
            if (!valid.includes(value)) {
                return fail(EXIT.USAGE, `Unknown theme "${value}". Valid themes: ${valid.join(', ')}`);
            }
        }

        let typedValue: unknown = value;
        if (value === 'true') typedValue = true;
        else if (value === 'false') typedValue = false;
        else if (!isNaN(Number(value))) typedValue = Number(value);

        setConfig(key as keyof AppConfig, typedValue as AppConfig[keyof AppConfig]);

        if (key === 'theme') {
            loadTheme(value);
        }

        console.log(success(`Set ${theme().heading.chalk(key)} = ${value}`));
    });

configCommand
    .command('reset')
    .description('Reset configuration to defaults')
    .action(() => {
        resetConfig();
        console.log(success('Configuration reset to defaults'));
    });

configCommand
    .command('themes')
    .description('List available themes with color swatches')
    .action(() => {
        const themes = listThemes();
        const currentTheme = getConfig('theme') as string;
        const t = theme();

        console.log('');
        console.log(t.heading.chalk('  Available Themes'));
        console.log(t.muted.chalk('  ─────────────────────────────────────────'));
        console.log('');

        for (const { name, description } of themes) {
            // Load the theme temporarily to render its swatch.
            const saved = getConfig('theme') as string;
            loadTheme(name);
            const tp = theme();

            const marker = name === currentTheme ? t.success.chalk(' ✓') : '  ';
            const swatch = [
                tp.priorityUrgent.chalk('urgent'),
                tp.priorityHigh.chalk('high'),
                tp.priorityMedium.chalk('medium'),
                tp.priorityLow.chalk('low'),
                formatStatus('done'),
            ].join('  ');

            console.log(`${marker} ${tp.heading.chalk(name.padEnd(12))} ${tp.muted.chalk(description)}`);
            console.log(`     ${swatch}`);
            console.log('');

            // Restore active theme.
            loadTheme(saved);
        }
    });
