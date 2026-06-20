// todo plugin — Plugin management commands.

import { Command } from 'commander';
import { getRegistry, loadAll } from '../plugins/index.js';
import { makeTable } from '../utils/table.js';
import { theme } from '../utils/theme.js';
import { success } from '../utils/format.js';
import { fail, EXIT, requireEntity } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';

export const pluginCommand = new Command('plugin')
    .description('Manage plugins');

pluginCommand
    .command('ls')
    .description('List installed plugins')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
        try {
            await loadAll();
            const registry = getRegistry();
            const plugins = registry.getAll();

            if (opts.json) {
                const data = plugins.map((p) => ({
                    name: p.manifest.name,
                    displayName: p.manifest.displayName,
                    description: p.manifest.description,
                    version: p.manifest.version,
                    author: p.manifest.author,
                    enabled: p.enabled,
                    path: p.path,
                }));
                console.log(JSON.stringify(data, null, 2));
                return;
            }

            const t = theme();

            if (plugins.length === 0) {
                console.log(t.muted.chalk('  No plugins found.'));
                return;
            }

            const table = makeTable({
                head: ['Name', 'Version', 'Author', 'Status'],
                style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
                colWidths: [25, 10, 20, 12],
                wordWrap: true,
            });

            for (const plugin of plugins) {
                table.push([
                    t.heading.chalk(plugin.manifest.displayName),
                    plugin.manifest.version,
                    plugin.manifest.author || '',
                    plugin.enabled ? t.success.chalk('enabled') : t.muted.chalk('disabled'),
                ]);
            }

            console.log(table.toString());
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Failed to list plugins: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

pluginCommand
    .command('info <name>')
    .description('Show details about a plugin')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
        try {
            await loadAll();
            const registry = getRegistry();
            const plugin = registry.get(name);
            if (!requireEntity(plugin, 'Plugin', `"${name}"`)) return;

            const manifest = plugin.manifest;

            if (opts.json) {
                console.log(JSON.stringify({
                    name: manifest.name,
                    displayName: manifest.displayName,
                    description: manifest.description,
                    version: manifest.version,
                    author: manifest.author,
                    homepage: manifest.homepage,
                    minCoreVersion: manifest.minCoreVersion,
                    enabled: plugin.enabled,
                    path: plugin.path,
                }, null, 2));
                return;
            }

            const t = theme();

            console.log('');
            console.log(t.heading.chalk(`  ${manifest.displayName}`));
            console.log(t.muted.chalk('  ' + '─'.repeat(50)));
            console.log('');
            console.log(`  ${t.muted.chalk('Name:')}           ${manifest.name}`);
            console.log(`  ${t.muted.chalk('Version:')}        ${manifest.version}`);
            console.log(`  ${t.muted.chalk('Status:')}         ${plugin.enabled ? t.success.chalk('enabled') : t.muted.chalk('disabled')}`);

            if (manifest.author) {
                console.log(`  ${t.muted.chalk('Author:')}         ${manifest.author}`);
            }

            if (manifest.homepage) {
                console.log(`  ${t.muted.chalk('Homepage:')}       ${manifest.homepage}`);
            }

            if (manifest.minCoreVersion) {
                console.log(`  ${t.muted.chalk('Min Core Version:')} ${manifest.minCoreVersion}`);
            }

            console.log('');
            console.log(t.muted.chalk('  Description'));
            console.log(`  ${manifest.description}`);

            if (plugin.path) {
                console.log('');
                console.log(t.muted.chalk('  Path'));
                console.log(`  ${plugin.path}`);
            }

            console.log('');
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Failed to show plugin info: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

pluginCommand
    .command('enable <name>')
    .description('Enable a plugin')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
        try {
            await loadAll();
            const registry = getRegistry();

            if (!registry.setEnabled(name, true)) {
                return fail(EXIT.NOT_FOUND, `Plugin "${name}" not found`, { json: opts.json, command: 'plugin enable' });
            }

            if (opts.json) {
                emitJson({ ok: true, command: 'plugin enable', data: { action: 'enabled', name } });
                return;
            }
            console.log(success(`Enabled plugin "${theme().heading.chalk(name)}"`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Failed to enable plugin: ${err instanceof Error ? err.message : String(err)}`, { json: opts.json, command: 'plugin enable' });
        }
    });

pluginCommand
    .command('disable <name>')
    .description('Disable a plugin')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
        try {
            await loadAll();
            const registry = getRegistry();

            if (!registry.setEnabled(name, false)) {
                return fail(EXIT.NOT_FOUND, `Plugin "${name}" not found`, { json: opts.json, command: 'plugin disable' });
            }

            if (opts.json) {
                emitJson({ ok: true, command: 'plugin disable', data: { action: 'disabled', name } });
                return;
            }
            console.log(success(`Disabled plugin "${theme().heading.chalk(name)}"`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Failed to disable plugin: ${err instanceof Error ? err.message : String(err)}`, { json: opts.json, command: 'plugin disable' });
        }
    });
