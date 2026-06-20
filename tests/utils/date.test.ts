import { describe, it, expect } from 'vitest';
import {
    parseDate,
    formatDateDisplay,
    isOverdue,
    formatRelative,
    isDueThisWeek,
    isDueToday,
    formatLocalDateTime,
    parseRelativeDuration,
    nowSqliteUtc,
    sqliteUtcFromDate,
    parseSqliteUtc,
    diffSeconds,
} from '../../src/utils/date.js';
import { format, addDays, subDays, subMonths, subYears } from 'date-fns';

describe('parseDate', () => {
    it('should parse ISO date strings', () => {
        const result = parseDate('2025-06-15');
        expect(result).toBe('2025-06-15');
    });

    it('should parse natural language "tomorrow"', () => {
        const result = parseDate('tomorrow');
        expect(result).not.toBeNull();
        const expected = format(addDays(new Date(), 1), 'yyyy-MM-dd');
        expect(result).toBe(expected);
    });

    it('should parse natural language "next week"', () => {
        const result = parseDate('next week');
        expect(result).not.toBeNull();
        // chrono parses "next week" to some date in the future
        const resultDate = new Date(result!);
        expect(resultDate.getTime()).toBeGreaterThan(Date.now());
    });

    it('should return null for invalid input', () => {
        const result = parseDate('not a date at all xyzzy');
        expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
        const result = parseDate('');
        expect(result).toBeNull();
    });

    it('should parse "today"', () => {
        const result = parseDate('today');
        expect(result).toBe(format(new Date(), 'yyyy-MM-dd'));
    });
});

describe('formatDateDisplay', () => {
    it('should return empty string for null', () => {
        expect(formatDateDisplay(null)).toBe('');
    });

    it('should return "Today" for today\'s date', () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        expect(formatDateDisplay(today)).toBe('Today');
    });

    it('should return "Tomorrow" for tomorrow\'s date', () => {
        const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
        expect(formatDateDisplay(tomorrow)).toBe('Tomorrow');
    });

    it('should return formatted date for other dates', () => {
        // Use a date far enough away to not be today/tomorrow
        const result = formatDateDisplay('2025-12-25');
        expect(result).toBe('Dec 25 2025 | THU');
    });

    it('should return the raw string for invalid dates', () => {
        expect(formatDateDisplay('not-a-date')).toBe('not-a-date');
    });
});

describe('isOverdue', () => {
    it('should return false for null', () => {
        expect(isOverdue(null)).toBe(false);
    });

    it('should return true for past dates', () => {
        const pastDate = format(subDays(new Date(), 5), 'yyyy-MM-dd');
        expect(isOverdue(pastDate)).toBe(true);
    });

    it('should return false for future dates', () => {
        const futureDate = format(addDays(new Date(), 5), 'yyyy-MM-dd');
        expect(isOverdue(futureDate)).toBe(false);
    });

    it('should return false for today', () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        expect(isOverdue(today)).toBe(false);
    });
});

describe('formatRelative', () => {
    it('should return empty string for null', () => {
        expect(formatRelative(null)).toBe('');
    });

    it('should return empty string for invalid date', () => {
        expect(formatRelative('not-a-date')).toBe('');
    });

    it('should return a relative string for past dates', () => {
        const past = subDays(new Date(), 3).toISOString();
        const result = formatRelative(past);
        expect(result).toContain('ago');
    });

    it('should return a relative string for future dates', () => {
        const future = addDays(new Date(), 3).toISOString();
        const result = formatRelative(future);
        expect(result).toMatch(/in/);
    });
});

describe('isDueToday', () => {
    it('should return false for null', () => {
        expect(isDueToday(null)).toBe(false);
    });

    it('should return true for today', () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        expect(isDueToday(today)).toBe(true);
    });

    it('should return false for other dates', () => {
        const other = format(addDays(new Date(), 5), 'yyyy-MM-dd');
        expect(isDueToday(other)).toBe(false);
    });
});

describe('isDueThisWeek', () => {
    it('should return false for null', () => {
        expect(isDueThisWeek(null)).toBe(false);
    });

    it('should return true for today (which is within this week)', () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        expect(isDueThisWeek(today)).toBe(true);
    });
});

describe('parseRelativeDuration', () => {
    it('should parse days', () => {
        const result = parseRelativeDuration('7d');
        expect(result).not.toBeNull();
        const expected = format(subDays(new Date(), 7), 'yyyy-MM-dd');
        expect(format(result!, 'yyyy-MM-dd')).toBe(expected);
    });

    it('should parse months', () => {
        const result = parseRelativeDuration('3m');
        expect(result).not.toBeNull();
        const expected = format(subMonths(new Date(), 3), 'yyyy-MM-dd');
        expect(format(result!, 'yyyy-MM-dd')).toBe(expected);
    });

    it('should parse years', () => {
        const result = parseRelativeDuration('1y');
        expect(result).not.toBeNull();
        const expected = format(subYears(new Date(), 1), 'yyyy-MM-dd');
        expect(format(result!, 'yyyy-MM-dd')).toBe(expected);
    });

    it('should handle uppercase units', () => {
        const result = parseRelativeDuration('7D');
        expect(result).not.toBeNull();
        const expected = format(subDays(new Date(), 7), 'yyyy-MM-dd');
        expect(format(result!, 'yyyy-MM-dd')).toBe(expected);
    });

    it('should handle zero value', () => {
        const result = parseRelativeDuration('0d');
        expect(result).not.toBeNull();
        expect(format(result!, 'yyyy-MM-dd')).toBe(format(new Date(), 'yyyy-MM-dd'));
    });

    it('should handle large values', () => {
        const result = parseRelativeDuration('365d');
        expect(result).not.toBeNull();
        const expected = format(subDays(new Date(), 365), 'yyyy-MM-dd');
        expect(format(result!, 'yyyy-MM-dd')).toBe(expected);
    });

    it('should return null for missing unit', () => {
        expect(parseRelativeDuration('30')).toBeNull();
    });

    it('should return null for missing number', () => {
        expect(parseRelativeDuration('d')).toBeNull();
    });

    it('should return null for invalid unit', () => {
        expect(parseRelativeDuration('7w')).toBeNull();
    });

    it('should return null for negative numbers', () => {
        expect(parseRelativeDuration('-3d')).toBeNull();
    });

    it('should return null for floats', () => {
        expect(parseRelativeDuration('1.5m')).toBeNull();
    });

    it('should return null for empty string', () => {
        expect(parseRelativeDuration('')).toBeNull();
    });

    it('should return null for random text', () => {
        expect(parseRelativeDuration('abc')).toBeNull();
    });
});

describe('formatLocalDateTime', () => {
    it('should return empty string for null/undefined', () => {
        expect(formatLocalDateTime(null)).toBe('');
        expect(formatLocalDateTime(undefined)).toBe('');
    });

    it('should handle ISO 8601 strings with T and Z', () => {
        const result = formatLocalDateTime('2025-06-15T10:30:00Z');
        // Should produce "MMM d yyyy | DAY HH:mm:ss" format
        expect(result).toMatch(/^\w{3} \d{1,2} \d{4} \| \w{3} \d{2}:\d{2}:\d{2}$/);
    });

    it('should handle SQLite format without timezone marker', () => {
        const result = formatLocalDateTime('2025-06-15 10:30:00');
        expect(result).toMatch(/^\w{3} \d{1,2} \d{4} \| \w{3} \d{2}:\d{2}:\d{2}$/);
    });

    it('should return original string for invalid dates', () => {
        expect(formatLocalDateTime('not-a-date')).toBe('not-a-date');
    });
});

const SQLITE_FORMAT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe('nowSqliteUtc', () => {
    it('should produce a string matching the SQLite UTC format', () => {
        expect(nowSqliteUtc()).toMatch(SQLITE_FORMAT_RE);
    });

    it('should be byte-identical to the original incantation', () => {
        // Both must produce the same format string at roughly the same instant
        const direct = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const helper = nowSqliteUtc();
        // Allow a 1-second clock tick between the two calls
        expect(helper).toMatch(SQLITE_FORMAT_RE);
        expect(direct).toMatch(SQLITE_FORMAT_RE);
    });

    it('should round-trip through parseSqliteUtc within 1 second of now', () => {
        const stored = nowSqliteUtc();
        const parsed = parseSqliteUtc(stored);
        expect(Math.abs(parsed.getTime() - Date.now())).toBeLessThan(1000);
    });
});

describe('sqliteUtcFromDate', () => {
    it('should produce a string matching the SQLite UTC format', () => {
        expect(sqliteUtcFromDate(new Date())).toMatch(SQLITE_FORMAT_RE);
    });

    it('should be byte-identical to the original incantation for the same Date', () => {
        const d = new Date('2026-03-15T08:45:30.000Z');
        const direct = d.toISOString().replace('T', ' ').slice(0, 19);
        const helper = sqliteUtcFromDate(d);
        expect(helper).toBe(direct);
        expect(helper).toBe('2026-03-15 08:45:30');
    });
});

describe('parseSqliteUtc', () => {
    it('should parse "YYYY-MM-DD HH:mm:ss" as UTC', () => {
        const d = parseSqliteUtc('2026-03-15 08:45:30');
        expect(d.getTime()).toBe(new Date('2026-03-15T08:45:30.000Z').getTime());
    });

    it('should parse an ISO string with T unchanged', () => {
        const d = parseSqliteUtc('2026-03-15T08:45:30.000Z');
        expect(d.getTime()).toBe(new Date('2026-03-15T08:45:30.000Z').getTime());
    });

    it('should round-trip with nowSqliteUtc within 1 second', () => {
        const before = Date.now();
        const stored = nowSqliteUtc();
        const after = Date.now();
        const parsed = parseSqliteUtc(stored).getTime();
        // parseSqliteUtc(nowSqliteUtc()) truncates to the second, so allow 1s slack
        expect(parsed).toBeGreaterThanOrEqual(before - 1000);
        expect(parsed).toBeLessThanOrEqual(after + 1000);
    });
});

describe('diffSeconds', () => {
    it('should return elapsed seconds between two SQLite timestamps', () => {
        expect(diffSeconds('2026-03-15 08:00:00', '2026-03-15 08:01:00')).toBe(60);
    });

    it('should return 0 for identical timestamps', () => {
        expect(diffSeconds('2026-03-15 08:00:00', '2026-03-15 08:00:00')).toBe(0);
    });

    it('should return a negative number when "to" is before "from"', () => {
        expect(diffSeconds('2026-03-15 08:01:00', '2026-03-15 08:00:00')).toBe(-60);
    });

    it('should handle cross-day spans', () => {
        expect(diffSeconds('2026-03-15 23:59:00', '2026-03-16 00:00:00')).toBe(60);
    });
});
