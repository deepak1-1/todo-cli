// Shared pipeline for importing remote issues (GitHub/Jira) into local tasks.
// Centralizes the iterate → dedupe → resolve-project → mapToLocal → create → count loop;
// each integration supplies the small bits that genuinely differ.

import type { CreateTaskInput, TaskStatus, Task, UpdateTaskFields } from '../../core/types.js';
import type { ExternalTask, RegisteredPlugin } from '../../plugins/index.js';
import type { TaskRepository } from '../../storage/repositories/task.repo.js';
import type { ProjectRepository } from '../../storage/repositories/project.repo.js';
import type { TagRepository } from '../../storage/repositories/tag.repo.js';
import type { ActionLogRepository } from '../../storage/repositories/action-log.repo.js';

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
        const project = opts.projectRepo.getOrCreate(name, description ? { description } : undefined);
        // Upsert marker only when description is absent — never overwrite user-written content.
        if (description && !project.description?.trim()) {
            opts.projectRepo.update(project.id, { description });
        }
        projectCache.set(name, project.id);
        return project.id;
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

// Content fields a re-pull may refresh from the remote. Never includes status — status is
// only ever touched by the opt-in --sync-status path, so local todo/in_progress is preserved.
/** Diff a mapped remote issue against the local task; return only the changed, remote-provided scalar fields. */
export function contentChanges(existing: Task, mapped: MappedTask): Partial<UpdateTaskFields> {
    const c: Partial<UpdateTaskFields> = {};
    // `!= null` guards omitted remote fields (GitHub has no native due date; priority may lack a label)
    // from wiping locally-set values.
    if (mapped.title != null && mapped.title !== existing.title) c.title = mapped.title;
    if (mapped.description != null && mapped.description !== existing.description) c.description = mapped.description;
    if (mapped.priority != null && mapped.priority !== existing.priority) c.priority = mapped.priority;
    if (mapped.dueDate != null && mapped.dueDate !== existing.dueDate) c.dueDate = mapped.dueDate;
    return c;
}

/** Repos an applyReconcile write needs; a structural subset of AppContext to avoid a commands→integrations dep. */
export interface ReconcileDeps {
    taskRepo: TaskRepository;
    tagRepo: TagRepository;
    actionLog: ActionLogRepository;
}

export interface ApplyReconcileOptions {
    /** Content diff from contentChanges (never carries status). */
    changes: Partial<UpdateTaskFields>;
    /** {status, ...transitionTimestamps} when --sync-status yields a real transition; undefined otherwise. */
    statusUpdate?: Partial<UpdateTaskFields> & { status?: TaskStatus };
    /** New tag set (already diffed by the caller) to replace local tags; undefined = no tag change. */
    tags?: string[];
    dryRun: boolean;
    /** Caller-supplied preview line, printed once in dryRun when a change would occur. */
    onDryRunLine?: () => void;
}

/**
 * Apply a re-pull reconcile to an already-imported task: merge content + optional status into one
 * taskRepo.update, replace tags if given, and log undoable action-log entries.
 * Returns true iff something changed (or, in dryRun, would change) — the pipeline counts it as `updated`.
 * lastSyncedAt is stamped only when a real change occurs, so an unchanged re-pull stays a no-op.
 */
export function applyReconcile(deps: ReconcileDeps, existing: Task, opts: ApplyReconcileOptions): boolean {
    const { changes, statusUpdate, tags, dryRun, onDryRunLine } = opts;
    const hasContent = Object.keys(changes).length > 0;
    const hasStatus = statusUpdate?.status != null && statusUpdate.status !== existing.status;
    const hasTags = tags !== undefined;
    if (!hasContent && !hasStatus && !hasTags) return false;
    if (dryRun) {
        onDryRunLine?.();
        return true;
    }

    const update: Partial<UpdateTaskFields> = { ...changes };
    if (hasStatus) Object.assign(update, statusUpdate);
    update.lastSyncedAt = new Date().toISOString();
    deps.taskRepo.update(existing.id, update);
    if (hasTags) deps.tagRepo.setTaskTags(existing.id, tags);

    // Mirror edit.ts conventions so `todo undo` can restore either kind of change.
    if (hasStatus) {
        deps.actionLog.log({
            taskId: existing.id,
            action: `status_${statusUpdate.status}`,
            entityType: 'task',
            prevState: JSON.stringify({ status: existing.status }),
            newState: JSON.stringify({ status: statusUpdate.status }),
        });
    }
    if (hasContent) {
        const prev: Partial<UpdateTaskFields> = {};
        if ('title' in changes) prev.title = existing.title;
        if ('description' in changes) prev.description = existing.description;
        if ('priority' in changes) prev.priority = existing.priority;
        if ('dueDate' in changes) prev.dueDate = existing.dueDate;
        deps.actionLog.log({
            taskId: existing.id,
            action: 'update',
            entityType: 'task',
            prevState: JSON.stringify(prev),
            newState: JSON.stringify(changes),
        });
    }
    return true;
}
