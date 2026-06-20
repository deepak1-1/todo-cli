// ============================================================
// Date parsing — natural language via chrono-node
// ============================================================

import * as chrono from 'chrono-node';
import { format, formatDistanceToNow, isToday, isTomorrow, isPast, isThisWeek, subDays, subMonths, subYears } from 'date-fns';

/** Parse a natural language date string into an ISO date string (YYYY-MM-DD) */
export function parseDate(input: string): string | null {
    if (!input) return null;

    // Try chrono-node for natural language
    const parsed = chrono.parseDate(input);
    if (parsed) {
        return format(parsed, 'yyyy-MM-dd');
    }

    // Try as direct ISO date
    const directDate = new Date(input);
    if (!isNaN(directDate.getTime())) {
        return format(directDate, 'yyyy-MM-dd');
    }

    return null;
}

/** Format a date string for display — e.g. "May 26 2026 | TUE" */
export function formatDateDisplay(dateStr: string | null): string {
    if (!dateStr) return '';

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    if (isToday(date)) return 'Today';
    if (isTomorrow(date)) return 'Tomorrow';

    return format(date, 'MMM d yyyy') + ' | ' + format(date, 'EEE').toUpperCase();
}

/**
 * Format a stored UTC timestamp in the user's local timezone.
 * Tracking and task tables store either ISO 8601 strings (with Z) or
 * SQLite's "YYYY-MM-DD HH:mm:ss" format (UTC, no timezone marker).
 * Both are normalized to UTC and then rendered as local "YYYY-MM-DD HH:mm:ss".
 */
/**
 * Format a stored UTC timestamp in the user's local timezone.
 * Output: "May 26 2026 | TUE 14:30:05"
 */
export function formatLocalDateTime(stored: string | null | undefined): string {
    if (!stored) return '';
    const iso = stored.includes('T') ? stored : stored.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return stored;
    const pad = (n: number) => String(n).padStart(2, '0');
    const datePart = format(d, 'MMM d yyyy') + ' | ' + format(d, 'EEE').toUpperCase();
    const timePart = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return `${datePart} ${timePart}`;
}

/** Get a relative description like "3 days from now" or "2 days ago" */
export function formatRelative(dateStr: string | null): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    return formatDistanceToNow(date, { addSuffix: true });
}

/** Check if a date string is overdue (before today and not null) */
export function isOverdue(dateStr: string | null): boolean {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    return isPast(date) && !isToday(date);
}

/** Check if a date string is due this week */
export function isDueThisWeek(dateStr: string | null): boolean {
    if (!dateStr) return false;
    return isThisWeek(new Date(dateStr));
}

/** Check if a date string is due today */
export function isDueToday(dateStr: string | null): boolean {
    if (!dateStr) return false;
    return isToday(new Date(dateStr));
}

// ============================================================
// Local-day helpers — produce YYYY-MM-DD in the process's local timezone
// ============================================================

/** Return today's date as YYYY-MM-DD in the local timezone. */
export function todayLocal(): string {
    return format(new Date(), 'yyyy-MM-dd');
}

/** Format any Date to YYYY-MM-DD in the local timezone. */
export function toLocalDateString(d: Date): string {
    return format(d, 'yyyy-MM-dd');
}

/** Return the date N days before `from` (defaults to now) as YYYY-MM-DD in local timezone. */
export function daysAgoLocal(n: number, from?: Date): string {
    return format(subDays(from ?? new Date(), n), 'yyyy-MM-dd');
}

// ============================================================
// SQLite timestamp helpers — format: "YYYY-MM-DD HH:mm:ss" (UTC, no T, no Z)
// ============================================================

/** Return the current UTC time in SQLite storage format. */
export function nowSqliteUtc(): string {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** Convert a Date to SQLite storage format (UTC). */
export function sqliteUtcFromDate(d: Date): string {
    return d.toISOString().replace('T', ' ').slice(0, 19);
}

/** Parse a SQLite UTC timestamp ("YYYY-MM-DD HH:mm:ss") or an ISO string into a Date. */
export function parseSqliteUtc(stored: string): Date {
    if (stored.includes('T')) return new Date(stored);
    return new Date(stored.replace(' ', 'T') + '.000Z');
}

/** Compute elapsed seconds between two SQLite UTC timestamps. */
export function diffSeconds(from: string, to: string): number {
    return Math.floor((parseSqliteUtc(to).getTime() - parseSqliteUtc(from).getTime()) / 1000);
}

/**
 * Parse a relative duration string like "7d", "3m", "1y" and return
 * the resulting Date by subtracting that duration from the given reference date (defaults to now).
 * Returns null if the format is invalid.
 */
export function parseRelativeDuration(input: string, relativeTo?: Date): Date | null {
    const match = input.match(/^(\d+)(d|m|y)$/i);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    const base = relativeTo ?? new Date();
    switch (unit) {
        case 'd': return subDays(base, value);
        case 'm': return subMonths(base, value);
        case 'y': return subYears(base, value);
        default: return null;
    }
}
