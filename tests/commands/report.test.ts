import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { format, subDays, subMonths, subYears } from 'date-fns';
import { getDateRange, formatLastLabel } from '../../src/commands/stats.js';
import { toLocalDateString } from '../../src/utils/date.js';

// Frozen to 2026-06-15T00:30 IST (= 2026-06-14T19:00Z) — the critical rollover window
const FROZEN_UTC = '2026-06-14T19:00:00Z';

describe('getDateRange', () => {
    it('should default to last 7 days when no options provided', () => {
        beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(FROZEN_UTC)); });
        afterEach(() => vi.useRealTimers());
        const result = getDateRange({});
        const today = format(new Date(), 'yyyy-MM-dd');
        const weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd');
        expect(result.to).toBe(today);
        expect(result.from).toBe(weekAgo);
    });

    it('should use --from and --to when provided', () => {
        const result = getDateRange({ from: '2025-01-01', to: '2025-01-31' });
        expect(result.from).toBe('2025-01-01');
        expect(result.to).toBe('2025-01-31');
    });

    it('should handle --last with days', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ last: '30d' });
            const today = format(new Date(), 'yyyy-MM-dd');
            const expected = format(subDays(new Date(), 30), 'yyyy-MM-dd');
            expect(result.from).toBe(expected);
            expect(result.to).toBe(today);
        } finally { vi.useRealTimers(); }
    });

    it('should handle --last with months', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ last: '3m' });
            const today = format(new Date(), 'yyyy-MM-dd');
            const expected = format(subMonths(new Date(), 3), 'yyyy-MM-dd');
            expect(result.from).toBe(expected);
            expect(result.to).toBe(today);
        } finally { vi.useRealTimers(); }
    });

    it('should handle --last with years', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ last: '1y' });
            const today = format(new Date(), 'yyyy-MM-dd');
            const expected = format(subYears(new Date(), 1), 'yyyy-MM-dd');
            expect(result.from).toBe(expected);
            expect(result.to).toBe(today);
        } finally { vi.useRealTimers(); }
    });

    it('should throw for invalid --last format', () => {
        expect(() => getDateRange({ last: 'invalid' })).toThrow('Invalid --last format');
        expect(() => getDateRange({ last: '7w' })).toThrow('Invalid --last format');
    });

    it('should prioritize --from over --last', () => {
        const result = getDateRange({ from: '2025-01-01', last: '7d' });
        expect(result.from).toBe('2025-01-01');
    });

    it('should prioritize --last over --monthly', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ last: '14d', monthly: true });
            const expected = format(subDays(new Date(), 14), 'yyyy-MM-dd');
            expect(result.from).toBe(expected);
        } finally { vi.useRealTimers(); }
    });

    it('should compute --last relative to --to date', () => {
        const result = getDateRange({ last: '30d', to: '2025-12-31' });
        expect(result.to).toBe('2025-12-31');
        const expected = format(subDays(new Date('2025-12-31'), 30), 'yyyy-MM-dd');
        expect(result.from).toBe(expected);
    });

    it('should default --to to today when only --from is provided', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ from: '2025-01-01' });
            const today = format(new Date(), 'yyyy-MM-dd');
            expect(result.from).toBe('2025-01-01');
            expect(result.to).toBe(today);
        } finally { vi.useRealTimers(); }
    });

    it('should handle --monthly', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ monthly: true });
            const today = format(new Date(), 'yyyy-MM-dd');
            expect(result.to).toBe(today);
            // monthly subtracts 30 days — use local helper, not UTC toISOString
            const fromDate = new Date();
            fromDate.setDate(fromDate.getDate() - 30);
            expect(result.from).toBe(toLocalDateString(fromDate));
        } finally { vi.useRealTimers(); }
    });

    it('--today returns local date, not UTC date, during IST midnight rollover', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(FROZEN_UTC));
        try {
            const result = getDateRange({ today: true });
            // IST: 2026-06-15 00:30; UTC: 2026-06-14 19:00
            expect(result.from).toBe('2026-06-15');
            expect(result.to).toBe('2026-06-15');
            expect(result.from).not.toBe('2026-06-14');
        } finally { vi.useRealTimers(); }
    });
});

describe('formatLastLabel', () => {
    it('should format singular day', () => {
        expect(formatLastLabel('1d')).toBe('Last 1 day');
    });

    it('should format plural days', () => {
        expect(formatLastLabel('30d')).toBe('Last 30 days');
    });

    it('should format singular month', () => {
        expect(formatLastLabel('1m')).toBe('Last 1 month');
    });

    it('should format plural months', () => {
        expect(formatLastLabel('3m')).toBe('Last 3 months');
    });

    it('should format singular year', () => {
        expect(formatLastLabel('1y')).toBe('Last 1 year');
    });

    it('should format plural years', () => {
        expect(formatLastLabel('2y')).toBe('Last 2 years');
    });

    it('should handle uppercase units', () => {
        expect(formatLastLabel('7D')).toBe('Last 7 days');
    });

    it('should fallback for invalid format', () => {
        expect(formatLastLabel('invalid')).toBe('Last invalid');
    });
});
