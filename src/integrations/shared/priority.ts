// Validates an already-localized ExternalTask.priority against TaskPriority; used by mapToLocal.

import type { TaskPriority } from '../../core/types.js';
import { TASK_PRIORITIES } from '../../core/types.js';

export function toLocalPriority(priority: string | undefined): TaskPriority | undefined {
    return priority && TASK_PRIORITIES.includes(priority as TaskPriority)
        ? (priority as TaskPriority)
        : undefined;
}
