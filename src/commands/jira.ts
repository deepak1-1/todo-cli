// todo jira — Jira integration commands.

import { Command, Option } from 'commander';
import { openUrl } from '../utils/open-url.js';
import { makeTable } from '../utils/table.js';
import { EncryptedCredentialStore } from '../plugins/index.js';
import { getContext } from './context.js';
import { theme } from '../utils/theme.js';
import * as logger from '../utils/logger.js';
import { success, formatPriority, formatStatus, parseId, parseIntOption } from '../utils/format.js';
import { promptUser } from '../utils/prompt.js';
import { fail, EXIT } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';
import { runIntegrationCommand } from './_integration-runner.js';

export const jiraCommand = new Command('jira')
    .description('Jira Cloud integration');

// ---- auth ----
jiraCommand
    .command('auth')
    .description('Authenticate with Jira Cloud')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
        if (opts.json) {
            return fail(EXIT.USAGE, 'interactive auth cannot be combined with --json', { json: true, command: 'jira auth' });
        }
        return runIntegrationCommand('jira', { errorPrefix: 'Authentication failed' }, async ({ plugin, credStore }) => {
            const t = theme();
            logger.log(`Setting up ${t.heading.chalk(plugin.manifest.displayName)}...`);
            await plugin.provider.auth(credStore, promptUser);
            console.log(success(`Authenticated with ${plugin.manifest.displayName}`));
        })();
    });

// ---- pull ----
jiraCommand
    .command('pull')
    .description('Pull issues from Jira into local tasks')
    .option('--project <key>', 'Filter by Jira project key')
    .option('--sprint <sprint>', 'Filter by sprint (use "current" for open sprints)')
    .option('--status <status>', 'Filter by Jira status name')
    .option('--assignee <user>', 'Filter by assignee (default: currentUser)')
    .option('--max <count>', 'Maximum results', '50')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ todo jira pull --sprint current   # "current" pulls all open sprints
  $ todo jira pull --project MYAPP --status "In Progress" --max 100`)
    .action(async (opts) => {
        await runIntegrationCommand('jira', { errorPrefix: 'Pull failed' }, async ({ plugin, credStore, ctx }) => {
            const t = theme();
            const filters = {
                project: opts.project,
                sprint: opts.sprint === 'current' ? 'openSprints' : opts.sprint,
                status: opts.status,
                maxResults: parseIntOption(opts.max, 'max'),
            };

            if (!opts.json) logger.log('Pulling issues from Jira...');

            const issues = await plugin.provider.pull(credStore, filters);

            if (issues.length === 0) {
                if (opts.json) {
                    emitJson({ ok: true, command: 'jira pull', data: { pulled: 0, created: 0, skipped: 0 } });
                } else {
                    console.log(t.muted.chalk('  No issues found matching filters.'));
                }
                return;
            }

            let created = 0;
            let skipped = 0;

            const projectCache = new Map<string, number>();
            function resolveProjectId(projectKey: string | undefined): number | undefined {
                if (!projectKey) return undefined;
                if (projectCache.has(projectKey)) return projectCache.get(projectKey);
                const project = ctx.projectRepo.getOrCreate(projectKey, { description: `Jira project ${projectKey}` });
                projectCache.set(projectKey, project.id);
                return project.id;
            }

            for (const issue of issues) {
                const jiraKey = (issue.metadata?.jiraKey as string) || issue.externalRef;
                const jiraId = (issue.metadata?.jiraId as string) || issue.externalId;

                try {
                    const match = ctx.taskRepo.findByJiraKey(jiraKey);

                    if (match) {
                        skipped++;
                        continue;
                    }

                    const mapped = plugin.provider.mapToLocal(issue);
                    const pid = resolveProjectId(issue.project);

                    ctx.taskRepo.create({
                        title: mapped.title || issue.title,
                        description: mapped.description || issue.description || '',
                        priority: mapped.priority || 'medium',
                        status: mapped.status || 'pending',
                        jiraKey: jiraKey,
                        syncHash: (issue.metadata?.syncHash as string) || '',
                        lastSyncedAt: new Date().toISOString(),
                        projectId: pid ?? undefined,
                        dueDate: mapped.dueDate,
                        jiraId: jiraId || undefined,
                    });
                    created++;
                } catch (syncErr: unknown) {
                    logger.log(t.warning.chalk(`  Warning: failed to sync ${jiraKey}: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`));
                }
            }

            if (opts.json) {
                emitJson({ ok: true, command: 'jira pull', data: { pulled: issues.length, created, skipped } });
                return;
            }

            const table = makeTable({
                head: ['Key', 'Title', 'Status', 'Priority'],
                style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
                colWidths: [14, 44, 16, 10],
            });

            for (const issue of issues) {
                table.push([
                    t.heading.chalk((issue.metadata?.jiraKey as string) || issue.externalRef),
                    issue.title.length > 42 ? issue.title.substring(0, 39) + '...' : issue.title,
                    issue.status,
                    issue.priority || '-',
                ]);
            }

            console.log(table.toString());
            console.log(success(`Synced ${issues.length} issues (${created} new, ${skipped} already exist locally)`));
        })();
    });

// ---- list — show locally synced Jira tasks ----
jiraCommand
    .command('list')
    .alias('ls')
    .description('List locally synced Jira tasks')
    .option('-S, --status <status>', 'Filter by local status: pending, in_progress, done')
    .addOption(new Option('-s, --status-deprecated <status>', 'Deprecated alias for --status; use -S').hideHelp(true))
    .option('-p, --priority <level>', 'Filter by priority: urgent, high, medium, low')
    .option('--project <key>', 'Filter by Jira project key prefix')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ todo jira list -S in_progress    # canonical short flag
  $ todo jira list -s in_progress    # deprecated: use -S; -s will become --search in a future release
  $ todo jira list --status done     # long form always works`)
    .hook('preAction', (cmd) => {
        const opts = cmd.opts() as Record<string, unknown>;
        if (opts.statusDeprecated) {
            if (!opts.status) opts.status = opts.statusDeprecated;
            if (!opts.json) {
                process.stderr.write(
                    "warning: -s for --status is deprecated on 'todo jira list'; use -S. -s will become --search in a future release.\n",
                );
            }
        }
    })
    .action((opts) => {
        try {
            const ctx = getContext();
            const t = theme();

            const allTasks = ctx.taskRepo.list({
                status: opts.status ? opts.status : ['pending', 'in_progress', 'done'],
                priority: opts.priority || undefined,
            });

            let jiraTasks = allTasks.filter((tk) => tk.jiraKey);

            if (opts.project) {
                const prefix = opts.project.toUpperCase();
                jiraTasks = jiraTasks.filter((tk) => tk.jiraKey?.toUpperCase().startsWith(prefix));
            }

            if (jiraTasks.length === 0) {
                console.log(t.muted.chalk('  No Jira-linked tasks found. Run "todo jira pull" first.'));
                return;
            }

            if (opts.json) {
                emitJson({ ok: true, command: 'jira list', data: jiraTasks });
                return;
            }

            const table = makeTable({
                head: ['ID', 'Jira Key', 'Title', 'Desc', 'Priority', 'Status', 'Last Synced'],
                style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
                colWidths: [6, 14, 30, 22, 10, 14, 20],
            });

            for (const task of jiraTasks) {
                const syncedAt = task.lastSyncedAt
                    ? new Date(task.lastSyncedAt).toLocaleDateString()
                    : t.muted.chalk('never');
                const desc = task.description
                    ? task.description.length > 18 ? task.description.substring(0, 18) + '...' : task.description
                    : '';

                table.push([
                    `#${task.id}`,
                    t.heading.chalk(task.jiraKey || ''),
                    t.title.chalk(task.title.length > 28 ? task.title.substring(0, 25) + '...' : task.title),
                    t.muted.chalk(desc),
                    formatPriority(task.priority),
                    formatStatus(task.status),
                    syncedAt,
                ]);
            }

            console.log(table.toString());
            console.log(t.muted.chalk(`  ${jiraTasks.length} Jira-linked tasks`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `List failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

// ---- push ----
jiraCommand
    .command('push <taskId>')
    .description('Push local task status to Jira')
    .action(async (taskId: string) => {
        await runIntegrationCommand('jira', { errorPrefix: 'Push failed' }, async ({ plugin, credStore, ctx }) => {
            const t = theme();
            const id = parseId(taskId);
            const task = ctx.taskRepo.getById(id);

            if (!task) {
                return fail(EXIT.GENERIC, `Task #${taskId} not found`);
            }

            if (!task.jiraKey) {
                return fail(EXIT.GENERIC, `Task #${taskId} is not linked to a Jira issue. Use "todo jira link ${taskId} <JIRA-KEY>" first.`);
            }

            logger.log(`Pushing task #${taskId} → ${t.heading.chalk(task.jiraKey)}...`);

            const result = await plugin.provider.push(credStore, task, task.jiraKey);

            if (result.success) {
                ctx.taskRepo.update(id, {
                    lastSyncedAt: new Date().toISOString(),
                });
                console.log(success(`Pushed to ${task.jiraKey}: ${result.message}`));
                if (result.updatedFields.length > 0) {
                    console.log(t.muted.chalk(`  Updated: ${result.updatedFields.join(', ')}`));
                }
            } else {
                return fail(EXIT.GENERIC, `Push failed: ${result.message}`);
            }
        })();
    });

// ---- link ----
jiraCommand
    .command('link <taskId> <jiraKey>')
    .description('Link local task to a Jira issue')
    .action(async (taskId: string, jiraKey: string) => {
        try {
            const ctx = getContext();
            const id = parseId(taskId);
            const task = ctx.taskRepo.getById(id);

            if (!task) {
                return fail(EXIT.GENERIC, `Task #${taskId} not found`);
            }

            ctx.taskRepo.update(id, {
                jiraKey: jiraKey.toUpperCase(),
                lastSyncedAt: new Date().toISOString(),
            });

            console.log(success(`Linked task #${taskId} → ${jiraKey.toUpperCase()}`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Link failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

// ---- open ----
jiraCommand
    .command('open <taskId>')
    .description('Open linked Jira issue in browser')
    .action(async (taskId: string) => {
        try {
            const credStore = new EncryptedCredentialStore();
            const ctx = getContext();
            const t = theme();

            const id = parseId(taskId);
            const task = ctx.taskRepo.getById(id);

            if (!task) {
                return fail(EXIT.GENERIC, `Task #${taskId} not found`);
            }

            if (!task.jiraKey) {
                return fail(EXIT.GENERIC, `Task #${taskId} has no linked Jira issue`);
            }

            const domain = await credStore.get('jira:domain');
            if (!domain) {
                return fail(EXIT.GENERIC, 'Jira not configured. Run "todo jira auth" first.');
            }

            const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
            const url = `https://${cleanDomain}/browse/${task.jiraKey}`;

            logger.log(`Opening ${t.heading.chalk(url)}...`);
            openUrl(url);
            console.log(success(`Opened ${task.jiraKey} in browser`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Open failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

// ---- status ----
jiraCommand
    .command('status')
    .description('Show Jira connection health and sync status')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
        await runIntegrationCommand('jira', { errorPrefix: 'Status check failed' }, async ({ plugin, credStore, ctx }) => {
            const t = theme();
            const isHealthy = await plugin.provider.healthCheck(credStore);
            const domain = await credStore.get('jira:domain');

            const allTasks = ctx.taskRepo.list({ status: ['pending', 'in_progress', 'done', 'archived'] });
            const jiraTasks = allTasks.filter((tk) => tk.jiraKey);

            if (opts.json) {
                emitJson({ ok: true, command: 'jira status', data: { healthy: isHealthy, domain: domain || null, linkedTasks: jiraTasks.length } });
                return;
            }

            const statusIcon = isHealthy ? t.success.chalk('●') : t.error.chalk('●');
            const statusText = isHealthy ? t.success.chalk('connected') : t.error.chalk('disconnected');

            console.log(`\n  Jira Cloud: ${statusIcon} ${statusText}`);
            if (domain) console.log(`  Domain:     ${t.accent.chalk(domain)}`);
            console.log(`  Linked:     ${jiraTasks.length} tasks`);
            console.log('');
        })();
    });
