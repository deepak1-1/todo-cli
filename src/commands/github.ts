// todo gh — GitHub integration commands (uses gh CLI).

import { Command } from 'commander';
import { getContext } from './context.js';
import type { AppContext } from './context.js';
import { reconcilePulledStatus, getTransitionTimestamps, isComplete, isArchived, reopenTargetKey } from '../core/status.js';
import { makeTable } from '../utils/table.js';
import { theme } from '../utils/theme.js';
import type { ExternalTask, RegisteredPlugin } from '../plugins/index.js';
import { GitHubClient } from '../integrations/github/github-client.js';
import { parseGitHubRef, REPO_FORMAT_RE, GITHUB_MARKER_PREFIX } from '../integrations/github/ref.js';
import { resolveProjectRepo } from '../integrations/github/repo-resolution.js';
import { importRemoteTasks, contentChanges, applyReconcile } from '../integrations/shared/import-tasks.js';
import type { UpdateTaskFields } from '../core/types.js';
import { createPluginLogger } from '../plugins/plugin-logger.js';
import * as logger from '../utils/logger.js';
import { success, parseId } from '../utils/format.js';
import { fail, EXIT } from '../utils/exit.js';
import { emitJson } from '../utils/json-output.js';
import { runIntegrationCommand } from './_integration-runner.js';

const ghLogger = createPluginLogger('github');

/** Order-insensitive set comparison of two tag-name lists. */
function sameTagSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const set = new Set(a);
    return b.every((name) => set.has(name));
}

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
    const reopenTarget = reopenTargetKey(defs);
    return importRemoteTasks({
        issues,
        plugin,
        taskRepo: ctx.taskRepo,
        projectRepo: ctx.projectRepo,
        dryRun: pullOpts.dryRun ?? false,
        findExisting: (issue) => ctx.taskRepo.findByGithubRef(issue.externalRef),
        projectName: (issue) => issue.project,
        projectDescription: (issue) => `${GITHUB_MARKER_PREFIX}${issue.externalRef.split('#')[0]}`,
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
        // Always reconcile: refresh content (title/description/priority/due date) and replace tags
        // with the remote labels on every re-pull. Status is only touched under --sync-status.
        reconcileExisting: (existing, issue, mapped, dry) => {
            const changes = contentChanges(existing, mapped);
            let statusUpdate: (Partial<UpdateTaskFields> & { status?: typeof existing.status }) | undefined;
            if (pullOpts.syncStatus) {
                const target = reconcilePulledStatus(
                    defs, existing.status, { isTerminal: issue.status === 'closed' }, reopenTarget,
                );
                if (target && target !== existing.status) {
                    statusUpdate = { status: target, ...getTransitionTimestamps(defs, target) };
                }
            }
            // Tags aren't hydrated on the bare Task, so diff against the live tag set.
            let tags: string[] | undefined;
            if (mapped.tags) {
                const local = ctx.tagRepo.getTaskTags(existing.id);
                if (!sameTagSet(local, mapped.tags)) tags = mapped.tags;
            }
            return applyReconcile(ctx, existing, {
                changes,
                statusUpdate,
                tags,
                dryRun: dry,
                onDryRunLine: pullOpts.json ? undefined : () => {
                    console.log(`  ${t.warning.chalk('~')} ${existing.githubRef ?? issue.externalRef} — ${issue.title.substring(0, 40)}`);
                },
            });
        },
    });
}

/** Count existing local tasks whose status the remote would reconcile (for the --sync-status hint). */
function countReconcilableGitHub(ctx: AppContext, issues: ExternalTask[]): number {
    const defs = ctx.statusRepo.list();
    const reopenTarget = reopenTargetKey(defs);
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
    .addHelpText('after', `
Setup — the GitHub integration uses the official GitHub CLI (gh):
  1. Install gh:
       macOS:    brew install gh
       Linux:    https://github.com/cli/cli/blob/trunk/docs/install_linux.md
       Windows:  winget install --id GitHub.cli
  2. Log in (opens a browser flow):
       gh auth login
  3. Verify from todo:
       todo gh auth

No tokens are stored by todo — it delegates all GitHub calls to your authenticated gh CLI.`)
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
    .option('--repo <owner/repo>', 'Filter by repository (owner/repo)')
    .option('-P, --project <name>', 'Scope by local todo project (not the same as --repo; -P none is not valid here)')
    .option('--label <label>', 'Filter by label')
    .option('--sync-status', 'Reconcile status of already-imported tasks (reopen ones mistakenly marked done)')
    .option('--dry-run', 'Show what would be imported/updated without writing')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Re-pulling refreshes already-imported tasks: title, description, priority, due date and
labels (as tags) are updated from GitHub. Your local status is never changed (use --sync-status).`)
    .action(async (opts) => {
        await runIntegrationCommand('github', { errorPrefix: 'Pull failed' }, async ({ plugin, credStore, ctx }) => {
            const t = theme();

            if (opts.repo && opts.project) {
                return fail(EXIT.USAGE, 'Cannot use --repo and -P together. Use --repo for a remote repository filter, -P for a local project filter.');
            }
            if (opts.project === 'none') {
                return fail(EXIT.USAGE, '-P none is not valid for "gh pull". Use --repo to filter by remote repository.');
            }

            // Resolve repo from local project name when -P is given
            let resolvedRepo: string | undefined = opts.repo;
            if (opts.project) {
                const project = ctx.projectRepo.getByName(opts.project);
                if (!project) {
                    return fail(EXIT.NOT_FOUND, `Project "${opts.project}" not found. Use "todo projects" to list available projects.`);
                }
                const siblings = ctx.taskRepo.listGithubRepos(project.id);
                const resolved = resolveProjectRepo(siblings, project.description);
                if ('error' in resolved) {
                    const hint = resolved.error === 'ambiguous'
                        ? `multiple repos found (${resolved.candidates.join(', ')}) — pass --repo to disambiguate`
                        : `no linked siblings and no 'GitHub:' marker on project "${opts.project}" — pass --repo`;
                    return fail(EXIT.GENERIC, `Cannot resolve repository for project "${opts.project}": ${hint}`);
                }
                resolvedRepo = resolved.repo;
            }

            const filters = {
                project: resolvedRepo,
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
            console.log(success(`Created ${created} tasks, updated ${updated}, ${skipped} unchanged`));
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
        const { created: pulled, updated: refreshed } = importGitHubIssues(issues, plugin, ctx);

        // Push tasks with non-archived statuses; pass defs so terminal check is registry-driven
        const statusDefs = ctx.statusRepo.list();
        const syncStatuses = statusDefs.filter(d => !d.archives).map(d => d.key);
        const allTasks = ctx.taskRepo.list({ status: syncStatuses });
        let pushed = 0;
        let skippedUnlinked = 0;

        for (const task of allTasks) {
            if (!task.githubRef) { skippedUnlinked++; continue; }

            const result = await plugin.provider.push(credStore, task, task.githubRef, statusDefs);
            if (result.success && result.updatedFields.length > 0) {
                pushed++;
            }
        }

        if (skippedUnlinked > 0) {
            const t = theme();
            console.log(t.muted.chalk(
                `${skippedUnlinked} unlinked task(s) skipped — run "todo gh push -P <project>" to create issues for them.`,
            ));
        }

        console.log(success(`Sync complete: ${pulled} pulled, ${refreshed} updated, ${pushed} pushed`));
    }));

githubCommand
    .command('push')
    .description('Push local tasks to GitHub — update linked tasks, optionally create issues for unlinked ones')
    .option('-P, --project <name>', 'Scope to a local project ("none" for project-less tasks; creation requires --repo when using "none")')
    .option('--repo <owner/repo>', 'Override/specify repository for new issue creation')
    .option('--dry-run', 'Preview what would be created or updated without writing')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  todo gh push                          Push updates for all linked tasks
  todo gh push -P myrepo               Create issues + update linked tasks in project "myrepo"
  todo gh push -P none --repo o/r      Push project-less tasks, creating in o/r
  todo gh push -P myrepo --dry-run     Preview without writing

Note: Subtasks become independent issues (no parent linkage on GitHub).
Bare "todo gh push" (no -P and no --repo) only updates already-linked tasks.
`)
    .action(async (opts) => {
        await runIntegrationCommand('github', { errorPrefix: 'Push failed' }, async ({ plugin, credStore, ctx }) => {
            const t = theme();
            const statusDefs = ctx.statusRepo.list();
            const creationScoped = !!(opts.project || opts.repo);

            // Validate --repo format if given
            if (opts.repo && !REPO_FORMAT_RE.test(opts.repo)) {
                return fail(EXIT.USAGE, `Invalid --repo format "${opts.repo}". Expected owner/repo (e.g. acme/frontend).`);
            }

            // Resolve project row when -P is given (but not "none")
            let scopeProject: import('../core/types.js').Project | null = null;
            if (opts.project && opts.project !== 'none') {
                scopeProject = ctx.projectRepo.getByName(opts.project);
                if (!scopeProject) {
                    return fail(EXIT.NOT_FOUND, `Project "${opts.project}" not found. Use "todo projects" to list available projects.`);
                }
            }

            // Build task scope: non-archived statuses filtered by project
            const nonArchived = statusDefs.filter(d => !d.archives).map(d => d.key);
            const taskFilters: import('../core/types.js').TaskFilters = { status: nonArchived };
            if (opts.project === 'none') {
                taskFilters.projectName = null;
            } else if (scopeProject) {
                taskFilters.projectId = scopeProject.id;
            }

            const tasks = ctx.taskRepo.list(taskFilters);

            if (tasks.length === 0) {
                if (!opts.json) console.log(t.muted.chalk('No tasks in scope.'));
                if (opts.json) emitJson({ ok: true, command: 'gh push', data: { created: [], updated: [], skipped: [], failed: [] } });
                return;
            }

            // Per-projectId cache for repo resolution (sentinel key 'null' for project-less tasks)
            // Cache maps projectId key → resolved repo string or null (unresolvable).
            const repoCache = new Map<string, string | null>();
            // Cache maps projectId key → full resolution result for error-kind access.
            const resolveCache = new Map<string, import('../integrations/github/repo-resolution.js').ResolveRepoResult>();

            const getRepoForTask = (projectId: number | null): string | null => {
                if (opts.repo) return opts.repo;
                const key = projectId === null ? 'null' : String(projectId);
                if (repoCache.has(key)) return repoCache.get(key) ?? null;
                const project = projectId !== null ? ctx.projectRepo.getById(projectId) : null;
                const siblings = ctx.taskRepo.listGithubRepos(projectId);
                const resolved = resolveProjectRepo(siblings, project?.description);
                resolveCache.set(key, resolved);
                const repo = 'repo' in resolved ? resolved.repo : null;
                repoCache.set(key, repo);
                return repo;
            };

            const created: Array<{ taskId: number; ref: string }> = [];
            const updated: number[] = [];
            const skipped: number[] = [];
            const failed: Array<{ taskId: number; reason: string }> = [];
            let hintShown = false;

            for (const task of tasks) {
                if (task.githubRef) {
                    // Linked task — push update
                    if (opts.dryRun) {
                        if (!opts.json) console.log(`  ${t.muted.chalk('~')} #${task.id} — would update ${task.githubRef}`);
                        updated.push(task.id);
                        continue;
                    }
                    const result = await plugin.provider.push(credStore, task, task.githubRef, statusDefs);
                    if (result.success && result.updatedFields.length > 0) {
                        updated.push(task.id);
                    } else if (!result.success) {
                        failed.push({ taskId: task.id, reason: result.message });
                        logger.logError(`gh push #${task.id}: ${result.message}`);
                    } else {
                        skipped.push(task.id);
                    }
                    continue;
                }

                // Unlinked task
                if (!creationScoped) {
                    skipped.push(task.id);
                    if (!hintShown && !opts.json) {
                        console.log(t.muted.chalk('Unlinked tasks skipped — pass -P <project> or --repo to create issues.'));
                        hintShown = true;
                    }
                    continue;
                }

                // Skip done/archived
                if (isComplete(statusDefs, task.status) || isArchived(statusDefs, task.status)) {
                    skipped.push(task.id);
                    continue;
                }

                const repo = getRepoForTask(task.projectId ?? null);
                if (!repo) {
                    const projectId = task.projectId ?? null;
                    const projectName = projectId !== null
                        ? (ctx.projectRepo.getById(projectId)?.name ?? String(projectId))
                        : '(no project)';
                    const key = projectId === null ? 'null' : String(projectId);
                    const cached = resolveCache.get(key);
                    let reason: string;
                    if (cached && 'error' in cached && cached.error === 'ambiguous') {
                        reason = `ambiguous: multiple repos found (${cached.candidates.join(', ')}) — pass --repo`;
                    } else {
                        reason = `no linked siblings and no 'GitHub:' marker on project "${projectName}" — pass --repo`;
                    }
                    skipped.push(task.id);
                    if (!opts.json) logger.logWarn(`#${task.id} skipped: ${reason}`);
                    continue;
                }

                if (opts.dryRun) {
                    if (!opts.json) console.log(`  ${t.muted.chalk('+')} #${task.id} — would create issue in ${repo}`);
                    created.push({ taskId: task.id, ref: `${repo}#?` });
                    continue;
                }

                if (!plugin.provider.createRemote) {
                    failed.push({ taskId: task.id, reason: 'provider does not support createRemote' });
                    continue;
                }

                const result = await plugin.provider.createRemote(credStore, task, { project: repo }, statusDefs);
                if (result.success && result.externalRef) {
                    ctx.taskRepo.update(task.id, { githubRef: result.externalRef, lastSyncedAt: new Date().toISOString() });
                    created.push({ taskId: task.id, ref: result.externalRef });
                    if (!opts.json) console.log(`  ${t.success.chalk('+')} #${task.id} → ${result.externalRef}`);
                } else {
                    failed.push({ taskId: task.id, reason: result.message });
                    logger.logError(`gh push #${task.id}: ${result.message}`);
                }
            }

            if (opts.json) {
                if (opts.dryRun) {
                    emitJson({ ok: true, command: 'gh push', data: { dryRun: true, wouldCreate: created, wouldUpdate: updated, wouldSkip: skipped } });
                } else {
                    emitJson({ ok: true, command: 'gh push', data: { created, updated, skipped, failed } });
                    // Partial failure: still exit non-zero so scripts can detect it
                    if (failed.length > 0) process.exitCode = EXIT.GENERIC;
                }
                return;
            }

            if (opts.dryRun) {
                console.log(t.muted.chalk(`Would create ${created.length} issues, update ${updated.length}, skip ${skipped.length}`));
                return;
            }

            console.log(success(`Created ${created.length} issues, updated ${updated.length}, skipped ${skipped.length}`));
            if (failed.length > 0) {
                fail(EXIT.GENERIC, `${failed.length} error(s) — check stderr above for details.`);
            }
        })();
    });

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
