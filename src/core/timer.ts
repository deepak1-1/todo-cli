// ============================================================
// Time formatting and parsing — pure, no I/O
// ============================================================

// Whole-string match: one or more <number><unit> components (h/m/s), e.g. "1h 30m", "1.5h"
const DURATION_COMPONENTS = /^\s*(?:\d+(?:\.\d+)?\s*[hms]\s*)+$/i;
// Extracts each <number><unit> component for summation
const DURATION_COMPONENT = /(\d+(?:\.\d+)?)\s*([hms])/gi;
// Whole-string bare number, e.g. "90", "1.5"
const DURATION_BARE_NUMBER = /^\s*\d+(?:\.\d+)?\s*$/;

/**
 * Parse a human-readable duration string into seconds.
 * Supports: 2h, 30m, 45s, 1h30m, 1.5h, 1h 30m, 90 (bare number = minutes).
 * Returns NaN for unrecognised input; callers must guard isNaN and <= 0.
 */
export function parseDuration(input: string): number {
    const trimmed = input.trim();

    if (DURATION_COMPONENTS.test(trimmed)) {
        let total = 0;
        for (const match of trimmed.matchAll(DURATION_COMPONENT)) {
            const value = parseFloat(match[1]);
            const unit = match[2].toLowerCase();
            if (unit === 'h') total += value * 3600;
            else if (unit === 'm') total += value * 60;
            else total += value;
        }
        return Math.round(total);
    }

    // Bare number → treat as minutes
    if (DURATION_BARE_NUMBER.test(trimmed)) {
        return Math.round(parseFloat(trimmed) * 60);
    }

    return NaN;
}

/** Format seconds into human-readable duration like "1h 25m" */
export function formatDuration(seconds: number, includeSeconds = false): string {
    if (seconds < 60) return `${seconds}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (includeSeconds) {
        if (hours > 0) return secs > 0 ? `${hours}h ${minutes}m ${secs}s` : `${hours}h ${minutes}m`;
        return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    }
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}
