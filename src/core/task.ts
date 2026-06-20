// ============================================================
// Task entity operations — pure logic, zero I/O
// ============================================================

import {
    type Task,
    type CreateTaskInput,
    type UpdateTaskInput,
    type TaskPriority,
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

/** Priority comparison (higher priority = higher number) */
export function comparePriority(a: TaskPriority, b: TaskPriority): number {
    const order: Record<TaskPriority, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
    return order[a] - order[b];
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
    });

    const tags = tagRepo.getTaskTags(task.id);
    if (tags.length > 0) {
        tagRepo.setTaskTags(newTask.id, tags);
    }

    return newTask;
}
