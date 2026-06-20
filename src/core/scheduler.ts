// ============================================================
// Recurring task scheduler — pure logic
// ============================================================

import { addDays, addWeeks, addMonths, addYears } from 'date-fns';
import type { RecurrencePattern } from './types.js';

/** Calculate the next occurrence date based on a recurrence pattern */
export function getNextOccurrence(
    fromDate: Date,
    pattern: RecurrencePattern,
): Date {
    switch (pattern) {
        case 'daily':
            return addDays(fromDate, 1);
        case 'weekly':
            return addWeeks(fromDate, 1);
        case 'biweekly':
            return addWeeks(fromDate, 2);
        case 'monthly':
            return addMonths(fromDate, 1);
        case 'yearly':
            return addYears(fromDate, 1);
    }
}

/** Check if a task should generate a new recurrence */
export function shouldRecur(
    completedAt: string,
    recurrence: RecurrencePattern,
): { shouldCreate: boolean; nextDueDate: Date } {
    const completed = new Date(completedAt);
    const nextDue = getNextOccurrence(completed, recurrence);
    return {
        shouldCreate: true,
        nextDueDate: nextDue,
    };
}