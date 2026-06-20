// todo integrate — Integration/plugin management commands.

import { Command } from 'commander';
import { getRegistry, loadAll, EncryptedCredentialStore } from '../plugins/index.js';
import { makeTable } from '../utils/table.js';
import { theme } from '../utils/theme.js';
import { success } from '../utils/format.js';
import * as logger from '../utils/logger.js';
import { promptUser } from '../utils/prompt.js';
import { fail, EXIT, requireEntity } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';

export const integrateCommand = new Command('integrate')
    .description('Manage integrations');

integrateCommand
    .command('ls')
    .description('List all integrations and their status')
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
                    version: p.manifest.version,
                    enabled: p.enabled,
                    builtIn: p.manifest.builtIn || false,
                }));
                console.log(JSON.stringify(data, null, 2));
                return;
            }

            const t = theme();

            if (plugins.length === 0) {
                console.log(t.muted.chalk('  No integrations found.'));
                return;
            }

            const table = makeTable({
                head: ['Name', 'Display Name', 'Version', 'Status', 'Type'],
                style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
            });

            for (const plugin of plugins) {
                table.push([
                    t.heading.chalk(plugin.manifest.name),
                    plugin.manifest.displayName,
                    plugin.manifest.version,
                    plugin.enabled ? t.success.chalk('enabled') : t.muted.chalk('disabled'),
                    plugin.manifest.builtIn ? 'built-in' : 'plugin',
                ]);
            }

            console.log(table.toString());
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Failed to load integrations: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

integrateCommand
    .command('setup <name>')
    .description('Run auth flow for an integration')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ todo integrate setup jira --json | jq '.data'`)
    .action(async (name: string, opts) => {
        if (opts.json) {
            return fail(EXIT.USAGE, 'interactive auth cannot be combined with --json', { json: true, command: 'integrate setup' });
        }
        try {
            await loadAll();
            const registry = getRegistry();
            const plugin = registry.get(name);
            if (!requireEntity(plugin, 'Integration', `"${name}"`)) return;

            const credStore = new EncryptedCredentialStore();
            const t = theme();

            logger.log(`Setting up ${t.heading.chalk(plugin.manifest.displayName)}...`);

            try {
                await plugin.provider.auth(credStore, promptUser);
                console.log(success(`Authenticated with ${plugin.manifest.displayName}`));
            } catch (err: unknown) {
                return fail(EXIT.GENERIC, `Authentication failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Setup failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

integrateCommand
    .command('status')
    .description('Show health check for all configured integrations')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
        try {
            await loadAll();
            const registry = getRegistry();
            const credStore = new EncryptedCredentialStore();
            const plugins = registry.getAll();

            const results = [];

            for (const plugin of plugins) {
                try {
                    const isHealthy = await plugin.provider.healthCheck(credStore);
                    results.push({
                        name: plugin.manifest.name,
                        status: isHealthy ? 'healthy' : 'unhealthy',
                    });
                } catch (err: unknown) {
                    results.push({
                        name: plugin.manifest.name,
                        status: 'error',
                        error: String(err),
                    });
                }
            }

            if (opts.json) {
                console.log(JSON.stringify(results, null, 2));
                return;
            }

            const t = theme();

            if (results.length === 0) {
                console.log(t.muted.chalk('  No integrations found.'));
                return;
            }

            const table = makeTable({
                head: ['Integration', 'Status'],
                style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
            });

            for (const result of results) {
                const statusColor = result.status === 'healthy'
                    ? t.success.chalk
                    : result.status === 'unhealthy'
                        ? t.warning.chalk
                        : t.error.chalk;
                table.push([result.name, statusColor(result.status)]);
            }

            console.log(table.toString());
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Status check failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

integrateCommand
    .command('disable <name>')
    .description('Disable an integration')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
        try {
            await loadAll();
            const registry = getRegistry();

            if (!registry.setEnabled(name, false)) {
                return fail(EXIT.NOT_FOUND, `Integration "${name}" not found`, { json: opts.json, command: 'integrate disable' });
            }

            if (opts.json) {
                emitJson({ ok: true, command: 'integrate disable', data: { action: 'disabled', name } });
                return;
            }
            console.log(success(`Disabled integration "${theme().heading.chalk(name)}"`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Failed to disable integration: ${err instanceof Error ? err.message : String(err)}`, { json: opts.json, command: 'integrate disable' });
        }
    });

integrateCommand
    .command('enable <name>')
    .description('Enable an integration')
    .option('--json', 'Output as JSON')
    .action(async (name: string, opts) => {
        try {
            await loadAll();
            const registry = getRegistry();

            if (!registry.setEnabled(name, true)) {
                return fail(EXIT.NOT_FOUND, `Integration "${name}" not found`, { json: opts.json, command: 'integrate enable' });
            }

            if (opts.json) {
                emitJson({ ok: true, command: 'integrate enable', data: { action: 'enabled', name } });
                return;
            }
            console.log(success(`Enabled integration "${theme().heading.chalk(name)}"`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Failed to enable integration: ${err instanceof Error ? err.message : String(err)}`, { json: opts.json, command: 'integrate enable' });
        }
    });
