// Shared pipeline for importing remote issues (GitHub/Jira) into local tasks.
// Centralizes the iterate → dedupe → resolve-project → mapToLocal → create → count loop;
// each integration supplies the small bits that genuinely differ.

import type { CreateTaskInput, TaskStatus, Task } from '../../core/types.js';
import type { ExternalTask, RegisteredPlugin } from '../../plugins/index.js';
import type { TaskRepository } from '../../storage/repositories/task.repo.js';
import type { ProjectRepository } from '../../storage/repositories/project.repo.js';

export type MappedTask = Partial<CreateTaskInput> & { status?: TaskStatus };

export interface ImportRemoteTasksOptions {
    issues: ExternalTask[];
    plugin: RegisteredPlugin;
    taskRepo: TaskRepository;
    projectRepo: ProjectRepository;
    /** Return an existing local task for this issue (dedupe), or null to import it. */
    findExisting: (issue: ExternalTask) => Task | null;
    /** Project name to attach the imported task to; auto-created if missing. Omit for no project. */
    projectName?: (issue: ExternalTask) => string | undefined;
    /** Description used when auto-creating the issue's project. */
    projectDescription?: (issue: ExternalTask) => string;
    /** Build the CreateTaskInput from the issue, its mapped fields, and the resolved project id. */
    buildInput: (issue: ExternalTask, mapped: MappedTask, projectId: number | undefined) => CreateTaskInput;
    /** Optional post-create side effect (e.g. apply tags). */
    onCreated?: (taskId: number, issue: ExternalTask, mapped: MappedTask) => void;
    /** Optional per-issue error handler; when set, a thrown error is caught and reported instead of aborting. */
    onError?: (issue: ExternalTask, err: unknown) => void;
    /**
     * Reconcile an already-existing local task against the pulled issue.
     * Return true iff a write occurred (or, in dryRun, would occur) — counted as `updated`; else `skipped`.
     * In dryRun it MUST NOT perform any DB write (evaluate only).
     */
    reconcileExisting?: (existing: Task, issue: ExternalTask, mapped: MappedTask, dryRun: boolean) => boolean;
    /** Optional preview hook for a would-be-created issue (dryRun only). */
    onWouldCreate?: (issue: ExternalTask) => void;
    /** When true, counts only — performs no DB writes (no project/task creation, no reconcile writes). Default false. */
    dryRun?: boolean;
}

export function importRemoteTasks(opts: ImportRemoteTasksOptions): { created: number; updated: number; skipped: number } {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const dryRun = opts.dryRun ?? false;
    const projectCache = new Map<string, number>();

    const resolveProjectId = (issue: ExternalTask): number | undefined => {
        const name = opts.projectName?.(issue);
        if (!name) return undefined;
        const cached = projectCache.get(name);
        if (cached !== undefined) return cached;
        const description = opts.projectDescription?.(issue);
        const id = opts.projectRepo.getOrCreate(name, description ? { description } : undefined).id;
        projectCache.set(name, id);
        return id;
    };

    const importOne = (issue: ExternalTask): void => {
        const existing = opts.findExisting(issue);
        if (existing) {
            if (opts.reconcileExisting) {
                const mapped = opts.plugin.provider.mapToLocal(issue);
                if (opts.reconcileExisting(existing, issue, mapped, dryRun)) updated++;
                else skipped++;
            } else {
                skipped++;
            }
            return;
        }
        // Would-create: short-circuit BEFORE resolveProjectId so dryRun never writes a project row.
        if (dryRun) {
            opts.onWouldCreate?.(issue);
            created++;
            return;
        }
        const projectId = resolveProjectId(issue);
        const mapped = opts.plugin.provider.mapToLocal(issue);
        const task = opts.taskRepo.create(opts.buildInput(issue, mapped, projectId));
        opts.onCreated?.(task.id, issue, mapped);
        created++;
    };

    for (const issue of opts.issues) {
        if (opts.onError) {
            try {
                importOne(issue);
            } catch (err: unknown) {
                opts.onError(issue, err);
            }
        } else {
            importOne(issue);
        }
    }

    return { created, updated, skipped };
}
