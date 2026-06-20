// TZ is pinned to Asia/Kolkata (UTC+5:30) via tests/setup-tz.ts
import { describe, it, expect, vi } from 'vitest';
import { todayLocal, toLocalDateString, daysAgoLocal } from '../../src/utils/date.js';

// Helper: freeze the JS clock, run fn, restore.
function withFrozenClock(utcInstant: string, fn: () => void): void {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(utcInstant));
    try { fn(); } finally { vi.useRealTimers(); }
}

describe('todayLocal', () => {
    // IST = UTC+5:30; 2026-06-14T19:00Z → 2026-06-15 00:30 IST
    it('returns 2026-06-15 for UTC 19:00 on June 14 (IST midnight rollover)', () => {
        withFrozenClock('2026-06-14T19:00:00Z', () => {
            expect(todayLocal()).toBe('2026-06-15');
            // Mutation guard: UTC wall-clock date must NOT match
            expect(todayLocal()).not.toBe('2026-06-14');
        });
    });

    // 2026-06-14T23:30Z → 2026-06-15 05:00 IST
    it('returns 2026-06-15 for UTC 23:30 on June 14 (IST 05:00)', () => {
        withFrozenClock('2026-06-14T23:30:00Z', () => {
            expect(todayLocal()).toBe('2026-06-15');
            expect(todayLocal()).not.toBe('2026-06-14');
        });
    });

    // 2026-06-15T06:30Z → 2026-06-15 12:00 IST (noon, unambiguous)
    it('returns 2026-06-15 for UTC 06:30 on June 15 (IST noon)', () => {
        withFrozenClock('2026-06-15T06:30:00Z', () => {
            expect(todayLocal()).toBe('2026-06-15');
            expect(todayLocal()).not.toBe('2026-06-16');
        });
    });

    // PST/UTC cases: mid-process TZ switching via process.env.TZ is unreliable inside
    // a single suite that is already pinned to IST. Verified manually — see plan §boundary-smoke.
    it.todo('PST -7: 2026-06-16T06:30Z → 2026-06-15 23:30 PST — verified manually');
    it.todo('UTC: 2026-06-15T00:01Z → 2026-06-15 00:01 UTC — verified manually');
});

describe('toLocalDateString', () => {
    it('converts a Date at IST midnight rollover to local date', () => {
        // 2026-06-14T19:00Z = 2026-06-15 00:30 IST
        const d = new Date('2026-06-14T19:00:00Z');
        withFrozenClock('2026-06-14T19:00:00Z', () => {
            expect(toLocalDateString(d)).toBe('2026-06-15');
            expect(toLocalDateString(d)).not.toBe('2026-06-14');
        });
    });

    it('converts a noon-IST Date correctly', () => {
        const d = new Date('2026-06-15T06:30:00Z');
        expect(toLocalDateString(d)).toBe('2026-06-15');
    });
});

describe('daysAgoLocal', () => {
    // 7 days before 2026-06-15 = 2026-06-08
    it('returns 2026-06-08 for 7 days ago at IST midnight rollover', () => {
        withFrozenClock('2026-06-14T19:00:00Z', () => {
            expect(daysAgoLocal(7)).toBe('2026-06-08');
            expect(daysAgoLocal(7)).not.toBe('2026-06-07');
        });
    });

    it('returns 2026-06-08 for 7 days ago at IST 05:00', () => {
        withFrozenClock('2026-06-14T23:30:00Z', () => {
            expect(daysAgoLocal(7)).toBe('2026-06-08');
            expect(daysAgoLocal(7)).not.toBe('2026-06-07');
        });
    });

    it('returns 2026-06-08 for 7 days ago at IST noon', () => {
        withFrozenClock('2026-06-15T06:30:00Z', () => {
            expect(daysAgoLocal(7)).toBe('2026-06-08');
        });
    });

    it('accepts an explicit from date', () => {
        const base = new Date('2026-06-15T06:30:00Z');
        expect(daysAgoLocal(7, base)).toBe('2026-06-08');
        expect(daysAgoLocal(7, base)).not.toBe('2026-06-07');
    });
});
