// ============================================================
// Task entity operations — pure logic, zero I/O
// ============================================================

import {
    type Task,
    type CreateTaskInput,
    type UpdateTaskInput,
    TASK_PRIORITIES,
} from './types.js';
import { getNextOccurrence } from './scheduler.js';
import { format } from 'date-fns';

export class TaskValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TaskValidationError';
    }
}

/** Validate a CreateTaskInput and return normalized values */
export function validateCreateInput(input: CreateTaskInput): CreateTaskInput {
    if (!input.title || input.title.trim().length === 0) {
        throw new TaskValidationError('Task title cannot be empty');
    }

    const normalized: CreateTaskInput = {
        ...input,
        title: input.title.trim(),
        description: input.description?.trim(),
    };

    if (normalized.priority && !TASK_PRIORITIES.includes(normalized.priority)) {
        throw new TaskValidationError(
            `Invalid priority "${normalized.priority}". Must be one of: ${TASK_PRIORITIES.join(', ')}`,
        );
    }

    return normalized;
}

/** Validate an UpdateTaskInput */
export function validateUpdateInput(input: UpdateTaskInput): UpdateTaskInput {
    if (input.title !== undefined && input.title.trim().length === 0) {
        throw new TaskValidationError('Task title cannot be empty');
    }

    const normalized: UpdateTaskInput = { ...input };
    if (normalized.title) normalized.title = normalized.title.trim();
    if (normalized.description) normalized.description = normalized.description.trim();

    if (normalized.priority && !TASK_PRIORITIES.includes(normalized.priority)) {
        throw new TaskValidationError(
            `Invalid priority "${normalized.priority}". Must be one of: ${TASK_PRIORITIES.join(', ')}`,
        );
    }

    return normalized;
}

/**
 * Handle recurring task creation when a recurring task is completed.
 * Returns the new task if one was created, or null.
 */
export function handleRecurringCompletion(
    task: Task,
    taskRepo: { create: (input: CreateTaskInput) => Task },
    tagRepo: { getTaskTags: (id: number) => string[]; setTaskTags: (id: number, tags: string[]) => void },
): Task | null {
    if (!task.recurrence) return null;

    const completedDate = new Date();
    const nextDue = getNextOccurrence(completedDate, task.recurrence);
    const newTask = taskRepo.create({
        title: task.title,
        description: task.description,
        priority: task.priority,
        projectId: task.projectId,
        dueDate: format(nextDue, 'yyyy-MM-dd'),
        recurrence: task.recurrence,
        parentId: task.parentId,
    });

    const tags = tagRepo.getTaskTags(task.id);
    if (tags.length > 0) {
        tagRepo.setTaskTags(newTask.id, tags);
    }

    return newTask;
}

/**
 * Returns true if making `proposedParentId` the parent of `childId` would create a cycle
 * (i.e. the proposed parent is the child itself or one of its descendants). Walks the parent
 * chain upward via the injected `getParent` lookup; pure, no I/O.
 */
export function wouldCreateParentCycle(
    childId: number,
    proposedParentId: number,
    getParent: (id: number) => number | null,
): boolean {
    if (childId === proposedParentId) return true;
    const seen = new Set<number>();
    let current: number | null = proposedParentId;
    while (current !== null) {
        if (current === childId) return true;
        if (seen.has(current)) break; // guard against a pre-existing corrupt cycle
        seen.add(current);
        current = getParent(current);
    }
    return false;
}

/** Format a subtask progress rollup, e.g. "1/3 done". Empty string when there are no children. */
export function rollupProgress(done: number, total: number): string {
    return total === 0 ? '' : `${done}/${total} done`;
}

/**
 * Re-order a flat task list into depth-first parent→child order with a per-id depth map for
 * indented tree rendering. A task whose parent is absent from the set (e.g. filtered out) is
 * treated as a root so partial subtrees still render. Pure; preserves input sibling order.
 */
export function orderAsTree<T extends { id: number; parentId: number | null }>(
    tasks: T[],
): { ordered: T[]; depths: Map<number, number> } {
    const byId = new Set(tasks.map((t) => t.id));
    const childrenOf = new Map<number | null, T[]>();
    for (const task of tasks) {
        const key = task.parentId !== null && byId.has(task.parentId) ? task.parentId : null;
        const bucket = childrenOf.get(key);
        if (bucket) bucket.push(task);
        else childrenOf.set(key, [task]);
    }

    const ordered: T[] = [];
    const depths = new Map<number, number>();
    const visit = (parentKey: number | null, depth: number): void => {
        for (const task of childrenOf.get(parentKey) ?? []) {
            ordered.push(task);
            depths.set(task.id, depth);
            visit(task.id, depth + 1);
        }
    };
    visit(null, 0);
    return { ordered, depths };
}
