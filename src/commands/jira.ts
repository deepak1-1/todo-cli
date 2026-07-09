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
import { importRemoteTasks } from '../integrations/shared/import-tasks.js';
import { findByKeyOrVerb, validStatusKeys, isComplete, reconcilePulledStatus, getTransitionTimestamps } from '../core/status.js';

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
    .option('--sync-status', 'Reconcile status of already-imported tasks (reopen ones mistakenly marked done)')
    .option('--dry-run', 'Show what would be imported/updated without writing')
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
                    emitJson({ ok: true, command: 'jira pull', data: { pulled: 0, created: 0, updated: 0, skipped: 0 } });
                } else {
                    console.log(t.muted.chalk('  No issues found matching filters.'));
                }
                return;
            }

            const syncStatus = !!opts.syncStatus;
            const dryRun = !!opts.dryRun;
            const defs = ctx.statusRepo.list();
            const reopenTarget = defs.find(d => d.verb === 'reopen')?.key ?? 'todo';
            const jiraKeyOf = (issue: typeof issues[number]) => (issue.metadata?.jiraKey as string) || issue.externalRef;

            const { created, updated, skipped } = importRemoteTasks({
                issues,
                plugin,
                taskRepo: ctx.taskRepo,
                projectRepo: ctx.projectRepo,
                dryRun,
                findExisting: (issue) => ctx.taskRepo.findByJiraKey(jiraKeyOf(issue)),
                projectName: (issue) => issue.project,
                projectDescription: (issue) => `Jira project ${issue.project}`,
                buildInput: (issue, mapped, projectId) => ({
                    title: mapped.title || issue.title,
                    description: mapped.description || issue.description || '',
                    priority: mapped.priority || 'medium',
                    status: mapped.status || 'todo',
                    jiraKey: jiraKeyOf(issue),
                    syncHash: (issue.metadata?.syncHash as string) || '',
                    lastSyncedAt: new Date().toISOString(),
                    projectId: projectId ?? undefined,
                    dueDate: mapped.dueDate,
                    jiraId: ((issue.metadata?.jiraId as string) || issue.externalId) || undefined,
                }),
                onWouldCreate: opts.json ? undefined : (issue) => {
                    console.log(`  ${t.success.chalk('+')} ${jiraKeyOf(issue)} — ${issue.title}`);
                },
                reconcileExisting: syncStatus
                    ? (existing, issue, mapped, dry) => {
                        const remote = { activeTarget: mapped.status, isTerminal: isComplete(defs, mapped.status ?? 'todo') };
                        const target = reconcilePulledStatus(defs, existing.status, remote, reopenTarget);
                        if (!target || target === existing.status) return false;
                        if (dry) {
                            if (!opts.json) {
                                console.log(`  ${t.warning.chalk('~')} ${jiraKeyOf(issue)} ${existing.status} → ${target}`);
                            }
                            return true;
                        }
                        ctx.taskRepo.update(existing.id, { status: target, ...getTransitionTimestamps(defs, target) });
                        ctx.actionLog.log({
                            taskId: existing.id,
                            action: `status_${target}`,
                            entityType: 'task',
                            prevState: JSON.stringify({ status: existing.status }),
                            newState: JSON.stringify({ status: target }),
                        });
                        return true;
                    }
                    : undefined,
                onError: (issue, err) => {
                    logger.log(t.warning.chalk(`  Warning: failed to sync ${jiraKeyOf(issue)}: ${err instanceof Error ? err.message : String(err)}`));
                },
            });

            // Discoverability: when not syncing, tell the user how many stale tasks could be reconciled.
            if (!syncStatus && !opts.json) {
                let reconcilable = 0;
                for (const issue of issues) {
                    const existing = ctx.taskRepo.findByJiraKey(jiraKeyOf(issue));
                    if (!existing) continue;
                    const mapped = plugin.provider.mapToLocal(issue);
                    const remote = { activeTarget: mapped.status, isTerminal: isComplete(defs, mapped.status ?? 'todo') };
                    if (reconcilePulledStatus(defs, existing.status, remote, reopenTarget)) reconcilable++;
                }
                if (reconcilable > 0) {
                    console.log(t.warning.chalk(
                        `${reconcilable} of these are active on Jira but completed locally — run with --sync-status to reconcile.`,
                    ));
                }
            }

            if (opts.json) {
                if (dryRun) {
                    emitJson({ ok: true, command: 'jira pull', data: { dryRun: true, wouldCreate: created, wouldUpdate: updated, wouldSkip: skipped } });
                } else {
                    emitJson({ ok: true, command: 'jira pull', data: { pulled: issues.length, created, updated, skipped } });
                }
                return;
            }

            if (dryRun) {
                console.log(t.muted.chalk(`\nDry run: ${created} would be imported, ${updated} would be updated, ${skipped} unchanged`));
                return;
            }

            const table = makeTable({
                head: ['Key', 'Title', 'Status', 'Priority'],
                style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
                colWidths: [14, 44, 16, 10],
            });

            for (const issue of issues) {
                table.push([
                    t.heading.chalk(jiraKeyOf(issue)),
                    issue.title.length > 42 ? issue.title.substring(0, 39) + '...' : issue.title,
                    issue.status,
                    issue.priority || '-',
                ]);
            }

            console.log(table.toString());
            console.log(success(`Synced ${issues.length} issues (${created} new, ${updated} updated, ${skipped} already exist locally)`));
        })();
    });

// ---- list — show locally synced Jira tasks ----
jiraCommand
    .command('list')
    .alias('ls')
    .description('List locally synced Jira tasks')
    .option('-S, --status <status>', 'Filter by local status: todo, in_progress, done')
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

            // Fetch defs once for status rendering and filtering
            const statusDefs = ctx.statusRepo.list();
            const defaultStatuses = statusDefs.filter(d => !d.archives).map(d => d.key);
            let resolvedStatus: string | string[] = defaultStatuses;
            if (opts.status) {
                const def = findByKeyOrVerb(statusDefs, opts.status);
                if (!def) {
                    return fail(EXIT.USAGE, `Invalid status "${opts.status}". Valid statuses: ${validStatusKeys(statusDefs)}`, { json: opts.json as boolean, command: 'jira list' });
                }
                resolvedStatus = def.key;
            }
            const allTasks = ctx.taskRepo.list({
                status: resolvedStatus,
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
                    formatStatus(task.status, statusDefs),
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

            const allTasks = ctx.taskRepo.list({ includeArchived: true });
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
