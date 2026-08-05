import { describe, it, expect } from 'vitest';
import { getDateRange, formatLastLabel } from '../../src/commands/stats.js';
import { todayLocal, daysAgoLocal } from '../../src/utils/date.js';

describe('getDateRange', () => {
    it('should return today for both from and to when --today is set', () => {
        const range = getDateRange({ today: true });
        expect(range.from).toBe(todayLocal());
        expect(range.to).toBe(todayLocal());
    });

    it('should use --from verbatim and default --to to today', () => {
        const range = getDateRange({ from: '2026-01-01' });
        expect(range.from).toBe('2026-01-01');
        expect(range.to).toBe(todayLocal());
    });

    it('should compute --last N d relative to now when --to is not given', () => {
        const range = getDateRange({ last: '7d' });
        expect(range.from).toBe(daysAgoLocal(7));
        expect(range.to).toBe(todayLocal());
    });

    it('should compute --last N d relative to a date-only --to in local time, not UTC', () => {
        // Regression: --to is a date-only "YYYY-MM-DD" string. Anchoring --last off it
        // must not shift the range by a day west of UTC (bare `new Date(opts.to)` bug).
        const to = todayLocal();
        const range = getDateRange({ last: '7d', to });
        expect(range.to).toBe(to);
        expect(range.from).toBe(daysAgoLocal(7));
    });

    it('should default to a 7-day window when no options are given', () => {
        const range = getDateRange({});
        expect(range.from).toBe(daysAgoLocal(7));
        expect(range.to).toBe(todayLocal());
    });

    it('should default to a 30-day window with --monthly', () => {
        const range = getDateRange({ monthly: true });
        expect(range.from).toBe(daysAgoLocal(30));
        expect(range.to).toBe(todayLocal());
    });

    it('should throw for an invalid --last format', () => {
        expect(() => getDateRange({ last: 'garbage' })).toThrow(/Invalid --last format/);
    });
});

describe('formatLastLabel', () => {
    it('should pluralize units correctly', () => {
        expect(formatLastLabel('7d')).toBe('Last 7 days');
        expect(formatLastLabel('1d')).toBe('Last 1 day');
        expect(formatLastLabel('3m')).toBe('Last 3 months');
        expect(formatLastLabel('1y')).toBe('Last 1 year');
    });

    it('should fall back to raw label for an unrecognized format', () => {
        expect(formatLastLabel('bogus')).toBe('Last bogus');
    });
});
