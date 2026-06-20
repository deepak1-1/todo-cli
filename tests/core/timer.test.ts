import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../src/core/timer.js';

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
        expect(formatDuration(3600, true)).toBe('1h 0m');
        expect(formatDuration(300, true)).toBe('5m');
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

    it('should handle exact minute boundary with includeSeconds', () => {
        expect(formatDuration(60, true)).toBe('1m');
        expect(formatDuration(120, true)).toBe('2m');
    });

    it('should handle exact hour boundary with includeSeconds', () => {
        expect(formatDuration(7200, true)).toBe('2h 0m');
    });
});
