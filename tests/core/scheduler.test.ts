import { describe, it, expect } from 'vitest';
import { getNextOccurrence, shouldRecur } from '../../src/core/scheduler.js';

describe('getNextOccurrence', () => {
    const baseDate = new Date('2026-01-15T10:00:00.000Z');

    it('should add 1 day for daily recurrence', () => {
        const next = getNextOccurrence(baseDate, 'daily');
        expect(next.toISOString()).toBe('2026-01-16T10:00:00.000Z');
    });

    it('should add 1 week for weekly recurrence', () => {
        const next = getNextOccurrence(baseDate, 'weekly');
        expect(next.toISOString()).toBe('2026-01-22T10:00:00.000Z');
    });

    it('should add 2 weeks for biweekly recurrence', () => {
        const next = getNextOccurrence(baseDate, 'biweekly');
        expect(next.toISOString()).toBe('2026-01-29T10:00:00.000Z');
    });

    it('should add 1 month for monthly recurrence', () => {
        const next = getNextOccurrence(baseDate, 'monthly');
        expect(next.toISOString()).toBe('2026-02-15T10:00:00.000Z');
    });

    it('should add 1 year for yearly recurrence', () => {
        const next = getNextOccurrence(baseDate, 'yearly');
        expect(next.toISOString()).toBe('2027-01-15T10:00:00.000Z');
    });

    it('should handle month-end edge case for monthly recurrence', () => {
        const jan31 = new Date('2026-01-31T10:00:00.000Z');
        const next = getNextOccurrence(jan31, 'monthly');
        // date-fns clamps to end of February
        expect(next.getMonth()).toBe(1); // February
        expect(next.getDate()).toBe(28);
    });

    it('should handle year-end rollover for daily recurrence', () => {
        const dec31 = new Date('2026-12-31T10:00:00.000Z');
        const next = getNextOccurrence(dec31, 'daily');
        expect(next.toISOString()).toBe('2027-01-01T10:00:00.000Z');
    });

    it('should handle leap year for yearly recurrence from Feb 29', () => {
        // 2028 is a leap year
        const feb29 = new Date('2028-02-29T10:00:00.000Z');
        const next = getNextOccurrence(feb29, 'yearly');
        // 2029 is not a leap year, so date-fns clamps to Feb 28
        expect(next.getFullYear()).toBe(2029);
        expect(next.getMonth()).toBe(1); // February
        expect(next.getDate()).toBe(28);
    });
});

describe('shouldRecur', () => {
    it('should always return shouldCreate as true (current behavior)', () => {
        const result = shouldRecur('2026-01-15T10:00:00.000Z', 'daily');
        expect(result.shouldCreate).toBe(true);
    });

    it('should return the correct next due date for daily', () => {
        const result = shouldRecur('2026-01-15T10:00:00.000Z', 'daily');
        expect(result.nextDueDate.toISOString()).toBe('2026-01-16T10:00:00.000Z');
    });

    it('should return the correct next due date for weekly', () => {
        const result = shouldRecur('2026-03-01T12:00:00.000Z', 'weekly');
        expect(result.nextDueDate.toISOString()).toBe('2026-03-08T12:00:00.000Z');
    });

    it('should return the correct next due date for monthly', () => {
        const result = shouldRecur('2026-06-10T08:00:00.000Z', 'monthly');
        expect(result.nextDueDate.toISOString()).toBe('2026-07-10T08:00:00.000Z');
    });

    it('should return the correct next due date for yearly', () => {
        const result = shouldRecur('2026-04-29T00:00:00.000Z', 'yearly');
        expect(result.nextDueDate.toISOString()).toBe('2027-04-29T00:00:00.000Z');
    });

    it('should always return shouldCreate true regardless of pattern', () => {
        // Document that shouldRecur always returns true for all patterns
        const patterns = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'] as const;
        for (const pattern of patterns) {
            const result = shouldRecur('2026-01-01T00:00:00.000Z', pattern);
            expect(result.shouldCreate).toBe(true);
        }
    });
});
