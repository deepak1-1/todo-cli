// todo gh — GitHub integration commands (uses gh CLI).

import { Command } from 'commander';
import { getContext } from './context.js';
import type { AppContext } from './context.js';
import { reconcilePulledStatus, getTransitionTimestamps } from '../core/status.js';
import { makeTable } from '../utils/table.js';
import { theme } from '../utils/theme.js';
import type { ExternalTask, RegisteredPlugin } from '../plugins/index.js';
import { GitHubClient } from '../integrations/github/github-client.js';
import { parseGitHubRef } from '../integrations/github/ref.js';
import { importRemoteTasks } from '../integrations/shared/import-tasks.js';
import { createPluginLogger } from '../plugins/plugin-logger.js';
import * as logger from '../utils/logger.js';
import { success, parseId } from '../utils/format.js';
import { fail, EXIT } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';
import { runIntegrationCommand } from './_integration-runner.js';

const ghLogger = createPluginLogger('github');

interface GitHubPullOpts {
    syncStatus?: boolean;
    dryRun?: boolean;
    json?: boolean;
}

/** Import GitHub issues as local tasks. Skips existing ones unless syncStatus reconciles their status. */
function importGitHubIssues(
    issues: ExternalTask[],
    plugin: RegisteredPlugin,
    ctx: AppContext,
    pullOpts: GitHubPullOpts = {},
): { created: number; updated: number; skipped: number } {
    const t = theme();
    const defs = ctx.statusRepo.list();
    const reopenTarget = defs.find(d => d.verb === 'reopen')?.key ?? 'todo';
    return importRemoteTasks({
        issues,
        plugin,
        taskRepo: ctx.taskRepo,
        projectRepo: ctx.projectRepo,
        dryRun: pullOpts.dryRun ?? false,
        findExisting: (issue) => ctx.taskRepo.findByGithubRef(issue.externalRef),
        projectName: (issue) => issue.project,
        projectDescription: (issue) => `GitHub: ${issue.externalRef.split('#')[0]}`,
        buildInput: (issue, mapped, projectId) => ({
            title: mapped.title || issue.title,
            description: mapped.description,
            priority: mapped.priority,
            dueDate: mapped.dueDate,
            projectId: projectId ?? null,
            githubRef: issue.externalRef,
        }),
        onCreated: (taskId, _issue, mapped) => {
            if (mapped.tags && mapped.tags.length > 0) {
                ctx.tagRepo.addTaskTags(taskId, mapped.tags);
            }
        },
        onWouldCreate: pullOpts.json ? undefined : (issue) => {
            console.log(`  ${t.success.chalk('+')} ${issue.externalRef} — ${issue.title}`);
        },
        reconcileExisting: pullOpts.syncStatus
            ? (existing, issue, _mapped, dry) => {
                const target = reconcilePulledStatus(
                    defs, existing.status, { isTerminal: issue.status === 'closed' }, reopenTarget,
                );
                if (!target || target === existing.status) return false;
                if (dry) {
                    if (!pullOpts.json) {
                        console.log(`  ${t.warning.chalk('~')} #${existing.id} ${existing.status} → ${target}  ${issue.title.substring(0, 40)}`);
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
    });
}

/** Count existing local tasks whose status the remote would reconcile (for the --sync-status hint). */
function countReconcilableGitHub(ctx: AppContext, issues: ExternalTask[]): number {
    const defs = ctx.statusRepo.list();
    const reopenTarget = defs.find(d => d.verb === 'reopen')?.key ?? 'todo';
    let n = 0;
    for (const issue of issues) {
        const existing = ctx.taskRepo.findByGithubRef(issue.externalRef);
        if (existing && reconcilePulledStatus(defs, existing.status, { isTerminal: issue.status === 'closed' }, reopenTarget)) {
            n++;
        }
    }
    return n;
}

export const githubCommand = new Command('gh')
    .description('GitHub integration');

githubCommand
    .command('auth')
    .description('Check GitHub CLI authentication status')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
        const t = theme();
        try {
            const client = new GitHubClient(ghLogger);
            const isAuth = await client.isAuthenticated();

            if (!isAuth) {
                if (opts.json) {
                    return fail(EXIT.GENERIC, 'gh CLI is not authenticated. Run: gh auth login', { json: true, command: 'gh auth' });
                }
                fail(EXIT.GENERIC, 'gh CLI is not authenticated.');
                console.log(t.muted.chalk('Run: gh auth login'));
                return;
            }

            const user = await client.getUser();
            if (opts.json) {
                emitJson({ ok: true, command: 'gh auth', data: { authenticated: true, login: user.login } });
                return;
            }
            console.log(success(`Authenticated as ${t.heading.chalk(user.login)}`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Auth check failed: ${err instanceof Error ? err.message : String(err)}`, { json: opts.json, command: 'gh auth' });
        }
    });

githubCommand
    .command('pull')
    .description('Pull assigned GitHub issues as local tasks')
    .option('--repo <owner/repo>', 'Filter by repository')
    .option('--label <label>', 'Filter by label')
    .option('--sync-status', 'Reconcile status of already-imported tasks (reopen ones mistakenly marked done)')
    .option('--dry-run', 'Show what would be imported/updated without writing')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
        await runIntegrationCommand('github', { errorPrefix: 'Pull failed' }, async ({ plugin, credStore, ctx }) => {
            const t = theme();
            const filters = {
                project: opts.repo,
                label: opts.label,
            };

            if (!opts.json) logger.log('Pulling issues from GitHub...');

            const issues = await plugin.provider.pull(credStore, filters);

            if (issues.length === 0) {
                if (opts.json) {
                    emitJson({ ok: true, command: 'gh pull', data: { pulled: 0, created: 0, updated: 0, skipped: 0 } });
                } else {
                    console.log(t.muted.chalk('No issues found'));
                }
                return;
            }

            const syncStatus = !!opts.syncStatus;
            const dryRun = !!opts.dryRun;
            const { created, updated, skipped } = importGitHubIssues(
                issues, plugin, ctx, { syncStatus, dryRun, json: !!opts.json },
            );

            // Discoverability: when not syncing, tell the user how many stale tasks could be reconciled.
            if (!syncStatus && !opts.json) {
                const reconcilable = countReconcilableGitHub(ctx, issues);
                if (reconcilable > 0) {
                    console.log(t.warning.chalk(
                        `${reconcilable} of these are active on GitHub but completed locally — run with --sync-status to reconcile.`,
                    ));
                }
            }

            if (opts.json) {
                if (dryRun) {
                    emitJson({ ok: true, command: 'gh pull', data: { dryRun: true, wouldCreate: created, wouldUpdate: updated, wouldSkip: skipped } });
                } else {
                    emitJson({ ok: true, command: 'gh pull', data: { pulled: issues.length, created, updated, skipped } });
                }
                return;
            }

            if (dryRun) {
                console.log(t.muted.chalk(`\nDry run: ${created} would be imported, ${updated} would be updated, ${skipped} unchanged`));
                return;
            }

            const table = makeTable({
                head: ['Repo', 'Issue', 'Title', 'Status'],
                style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
            });

            for (const issue of issues) {
                table.push([
                    issue.project || 'unknown',
                    issue.externalRef,
                    t.title.chalk(issue.title.substring(0, 40)),
                    issue.status,
                ]);
            }

            console.log(table.toString());
            console.log(success(`Created ${created} tasks, updated ${updated}, skipped ${skipped} (already imported)`));
        })();
    });

githubCommand
    .command('pr <taskId>')
    .description('Create GitHub pull request from task')
    .option('--base <branch>', 'Base branch', 'main')
    .option('--draft', 'Create as draft PR')
    .action(async (taskId: string, opts) => {
        try {
            const { taskRepo } = getContext();
            const task = taskRepo.getById(parseId(taskId));

            if (!task) {
                return fail(EXIT.GENERIC, `Task ${taskId} not found`);
            }

            if (!task.githubRef) {
                return fail(EXIT.GENERIC, `Task ${taskId} is not linked to a GitHub issue`);
            }

            const parsed = parseGitHubRef(task.githubRef);
            if (!parsed) {
                return fail(EXIT.GENERIC, `Invalid GitHub ref: ${task.githubRef}`);
            }

            const { owner, repo } = parsed;
            const client = new GitHubClient(ghLogger);

            const { execFile } = await import('node:child_process');
            const { promisify } = await import('node:util');
            const exec = promisify(execFile);
            const { stdout: branch } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD']);

            const result = await client.createPullRequest(owner, repo, {
                title: task.title,
                body: `Closes ${task.githubRef}\n\n${task.description || ''}`.trim(),
                head: branch.trim(),
                base: opts.base,
                draft: opts.draft,
            });

            console.log(success(`PR created: ${result.html_url}`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `PR creation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

githubCommand
    .command('link <taskId> <ref>')
    .description('Link local task to GitHub issue (e.g. owner/repo#123)')
    .action(async (taskId: string, ref: string) => {
        const t = theme();
        try {
            const { taskRepo } = getContext();
            const id = parseId(taskId);
            const task = taskRepo.getById(id);

            if (!task) {
                return fail(EXIT.GENERIC, `Task ${taskId} not found`);
            }

            if (!parseGitHubRef(ref)) {
                return fail(EXIT.GENERIC, `Invalid ref format. Use owner/repo#number (e.g. myorg/myrepo#42)`);
            }

            taskRepo.update(id, { githubRef: ref });
            console.log(success(`Linked task ${taskId} to ${t.heading.chalk(ref)}`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Link failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

githubCommand
    .command('open <taskId>')
    .description('Open GitHub issue in browser')
    .action(async (taskId: string) => {
        try {
            const { taskRepo } = getContext();
            const task = taskRepo.getById(parseId(taskId));

            if (!task) {
                return fail(EXIT.GENERIC, `Task ${taskId} not found`);
            }

            if (!task.githubRef) {
                return fail(EXIT.GENERIC, `Task ${taskId} is not linked to a GitHub issue`);
            }

            const parsed = parseGitHubRef(task.githubRef);
            if (!parsed) {
                return fail(EXIT.GENERIC, `Invalid GitHub ref: ${task.githubRef}`);
            }

            const { owner, repo, number: issueNumber } = parsed;
            const client = new GitHubClient(ghLogger);
            await client.openInBrowser(owner, repo, issueNumber);
            console.log(success(`Opened ${task.githubRef} in browser`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Failed to open: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

githubCommand
    .command('status <taskId>')
    .description('Show CI status for task')
    .option('--json', 'Output as JSON')
    .action(async (taskId: string, opts) => {
        const t = theme();
        try {
            const { taskRepo } = getContext();
            const task = taskRepo.getById(parseId(taskId));

            if (!task) {
                return fail(EXIT.GENERIC, `Task ${taskId} not found`);
            }

            if (!task.githubRef) {
                return fail(EXIT.GENERIC, `Task ${taskId} is not linked to a GitHub issue`);
            }

            const parsed = parseGitHubRef(task.githubRef);
            if (!parsed) {
                return fail(EXIT.GENERIC, `Invalid GitHub ref: ${task.githubRef}`);
            }

            const { owner, repo } = parsed;
            const client = new GitHubClient(ghLogger);

            const { execFile } = await import('node:child_process');
            const { promisify } = await import('node:util');
            const exec = promisify(execFile);
            const { stdout: ref } = await exec('git', ['rev-parse', 'HEAD']);

            const status = await client.getCommitStatus(owner, repo, ref.trim());

            if (opts.json) {
                console.log(JSON.stringify(status, null, 2));
                return;
            }

            const stateColor = status.state === 'success' ? t.success.chalk
                : status.state === 'failure' ? t.error.chalk
                : t.warning.chalk;

            console.log(`CI status: ${stateColor(status.state)}`);
            if (status.description) {
                console.log(t.muted.chalk(status.description));
            }
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Status check failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

githubCommand
    .command('sync')
    .description('Bidirectional sync with GitHub')
    .action(runIntegrationCommand('github', { errorPrefix: 'Sync failed' }, async ({ plugin, credStore, ctx }) => {
        logger.log('Syncing with GitHub...');

        const issues = await plugin.provider.pull(credStore, {});
        const { created: pulled } = importGitHubIssues(issues, plugin, ctx);

        // Push tasks with non-archived statuses; pass defs so terminal check is registry-driven
        const statusDefs = ctx.statusRepo.list();
        const syncStatuses = statusDefs.filter(d => !d.archives).map(d => d.key);
        const allTasks = ctx.taskRepo.list({ status: syncStatuses });
        let pushed = 0;

        for (const task of allTasks) {
            if (!task.githubRef) continue;

            const result = await plugin.provider.push(credStore, task, task.githubRef, statusDefs);
            if (result.success && result.updatedFields.length > 0) {
                pushed++;
            }
        }

        console.log(success(`Sync complete: ${pulled} pulled, ${pushed} pushed`));
    }));

githubCommand
    .command('repos')
    .description('List GitHub repos you have access to')
    .option('--org <org>', 'Filter by organization')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
        const t = theme();
        try {
            const client = new GitHubClient(ghLogger);

            if (opts.org) {
                const repos = await client.listRepos(opts.org);

                if (opts.json) {
                    console.log(JSON.stringify(repos, null, 2));
                    return;
                }

                const table = makeTable({
                    head: ['Repository', 'Visibility', 'Description'],
                    style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
                    colWidths: [35, 12, 40],
                });

                for (const repo of repos) {
                    table.push([
                        t.heading.chalk(repo.nameWithOwner),
                        repo.isPrivate ? t.warning.chalk('private') : t.success.chalk('public'),
                        (repo.description || '').substring(0, 38),
                    ]);
                }

                console.log(table.toString());
                console.log(t.muted.chalk(`  ${repos.length} repos in ${opts.org}`));
                return;
            }

            const orgs = await client.listOrgs();
            const personalRepos = await client.listRepos();

            if (opts.json) {
                const allRepos: Record<string, unknown[]> = { personal: personalRepos };
                for (const org of orgs) {
                    allRepos[org] = await client.listRepos(org);
                }
                console.log(JSON.stringify(allRepos, null, 2));
                return;
            }

            if (personalRepos.length > 0) {
                console.log(t.heading.chalk('\nPersonal'));
                const table = makeTable({
                    head: ['Repository', 'Visibility', 'Description'],
                    style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
                    colWidths: [35, 12, 40],
                });

                for (const repo of personalRepos) {
                    table.push([
                        t.heading.chalk(repo.nameWithOwner),
                        repo.isPrivate ? t.warning.chalk('private') : t.success.chalk('public'),
                        (repo.description || '').substring(0, 38),
                    ]);
                }

                console.log(table.toString());
            }

            for (const org of orgs) {
                const repos = await client.listRepos(org);
                if (repos.length === 0) continue;

                console.log(t.heading.chalk(`\n${org}`));
                const table = makeTable({
                    head: ['Repository', 'Visibility', 'Description'],
                    style: { head: [t.tableHeader.ink], border: [t.tableBorder.ink] },
                    colWidths: [35, 12, 40],
                });

                for (const repo of repos) {
                    table.push([
                        t.heading.chalk(repo.nameWithOwner),
                        repo.isPrivate ? t.warning.chalk('private') : t.success.chalk('public'),
                        (repo.description || '').substring(0, 38),
                    ]);
                }

                console.log(table.toString());
            }

            const total = personalRepos.length;
            console.log(t.muted.chalk(`\n  ${total} personal repos, ${orgs.length} orgs: ${orgs.join(', ')}`));
            console.log(t.muted.chalk(`  Use "todo gh pull --repo <owner/repo>" to import issues from a specific repo`));
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Failed to list repos: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

githubCommand
    .command('health')
    .description('Check GitHub CLI health status')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
        const t = theme();
        try {
            const client = new GitHubClient(ghLogger);
            const isHealthy = await client.isAuthenticated();

            if (opts.json) {
                console.log(JSON.stringify({ status: isHealthy ? 'healthy' : 'unhealthy' }));
                return;
            }

            const statusColor = isHealthy ? t.success.chalk : t.error.chalk;
            console.log(`GitHub integration: ${statusColor(isHealthy ? 'healthy' : 'unhealthy')}`);

            if (!isHealthy) {
                console.log(t.muted.chalk('Run: gh auth login'));
            }
        } catch (err: unknown) {
            return fail(EXIT.GENERIC, `Health check failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
