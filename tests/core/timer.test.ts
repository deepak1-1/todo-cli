import { describe, it, expect } from 'vitest';
import { formatDuration, parseDuration } from '../../src/core/timer.js';

describe('formatDuration', () => {
    it('should format seconds', () => {
        expect(formatDuration(30)).toBe('30s');
    });

    it('should format minutes', () => {
        expect(formatDuration(300)).toBe('5m');
    });

    it('should format hours and minutes', () => {
        expect(formatDuration(5400)).toBe('1h 30m');
    });

    it('should format exact hours', () => {
        expect(formatDuration(3600)).toBe('1h');
    });

    // ---- includeSeconds parameter tests ----

    it('should include seconds when includeSeconds is true (65s)', () => {
        expect(formatDuration(65, true)).toBe('1m 5s');
    });

    it('should show h, m, s for large values with includeSeconds', () => {
        expect(formatDuration(3661, true)).toBe('1h 1m 1s');
    });

    it('should show just seconds for sub-minute with includeSeconds', () => {
        // Under 60 seconds always shows seconds regardless of flag
        expect(formatDuration(30, true)).toBe('30s');
    });

    it('should handle zero with includeSeconds', () => {
        expect(formatDuration(0, true)).toBe('0s');
    });

    it('should omit seconds when they are zero with includeSeconds', () => {
        expect(formatDuration(60, true)).toBe('1m');
        expect(formatDuration(120, true)).toBe('2m');
        expect(formatDuration(300, true)).toBe('5m');
        expect(formatDuration(3600, true)).toBe('1h 0m');
        expect(formatDuration(7200, true)).toBe('2h 0m');
    });

    it('should show hours and minutes without seconds when includeSeconds is false', () => {
        expect(formatDuration(3661)).toBe('1h 1m');
        expect(formatDuration(3661, false)).toBe('1h 1m');
    });

    it('should handle negative input gracefully', () => {
        // Negative values: function uses Math.floor so behavior is implementation-dependent
        // Just verify it does not throw
        expect(() => formatDuration(-1)).not.toThrow();
        expect(() => formatDuration(-1, true)).not.toThrow();
    });
});

describe('parseDuration', () => {
    it('parses hours only: "2h" → 7200', () => {
        expect(parseDuration('2h')).toBe(7200);
    });

    it('parses minutes only: "30m" → 1800', () => {
        expect(parseDuration('30m')).toBe(1800);
    });

    it('parses combined h+m: "1h30m" → 5400', () => {
        expect(parseDuration('1h30m')).toBe(5400);
    });

    it('parses fractional hours: "1.5h" → 5400', () => {
        expect(parseDuration('1.5h')).toBe(5400);
    });

    it('parses bare number as minutes: "90" → 5400', () => {
        expect(parseDuration('90')).toBe(5400);
    });

    it('parses seconds: "45s" → 45', () => {
        expect(parseDuration('45s')).toBe(45);
    });

    it('returns NaN for unrecognised input: "abc"', () => {
        expect(Number.isNaN(parseDuration('abc'))).toBe(true);
    });

    it('returns 0 for "0m"', () => {
        expect(parseDuration('0m')).toBe(0);
    });

    // ---- decimal minutes/seconds regression (bug fix) ----

    it('parses fractional minutes: "1.5m" → 90', () => {
        expect(parseDuration('1.5m')).toBe(90);
    });

    it('parses fractional seconds, rounded: "1.5s" → 2', () => {
        expect(parseDuration('1.5s')).toBe(2);
    });

    it('parses fractional minutes: "0.5m" → 30', () => {
        expect(parseDuration('0.5m')).toBe(30);
    });

    it('parses fractional bare number as minutes: "90.5" → 5430', () => {
        expect(parseDuration('90.5')).toBe(5430);
    });

    // ---- explicit rejection of unsupported/malformed input ----

    it('rejects day suffix: "1d" → NaN', () => {
        expect(Number.isNaN(parseDuration('1d'))).toBe(true);
    });

    it('rejects week suffix: "1w" → NaN', () => {
        expect(Number.isNaN(parseDuration('1w'))).toBe(true);
    });

    it('rejects unknown unit: "5x" → NaN', () => {
        expect(Number.isNaN(parseDuration('5x'))).toBe(true);
    });

    it('rejects trailing unit-less number: "1h30" → NaN', () => {
        expect(Number.isNaN(parseDuration('1h30'))).toBe(true);
    });

    it('rejects empty string → NaN', () => {
        expect(Number.isNaN(parseDuration(''))).toBe(true);
    });

    it('rejects whitespace-only string → NaN', () => {
        expect(Number.isNaN(parseDuration('   '))).toBe(true);
    });

    it('rejects negative sign: "-5m" → NaN', () => {
        expect(Number.isNaN(parseDuration('-5m'))).toBe(true);
    });

    // ---- whitespace and case tolerance ----

    it('tolerates space between components: "1h 30m" → 5400', () => {
        expect(parseDuration('1h 30m')).toBe(5400);
    });

    it('is case-insensitive: "1H30M" → 5400', () => {
        expect(parseDuration('1H30M')).toBe(5400);
    });

    it('trims leading/trailing whitespace: " 2h " → 7200', () => {
        expect(parseDuration(' 2h ')).toBe(7200);
    });

    it('sums repeated units: "30m30m" → 3600', () => {
        expect(parseDuration('30m30m')).toBe(3600);
    });
});
