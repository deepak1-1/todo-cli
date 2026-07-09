// ============================================================
// Time formatting and parsing — pure, no I/O
// ============================================================

/**
 * Parse a human-readable duration string into seconds.
 * Supports: 2h, 30m, 45s, 1h30m, 1.5h, 90 (bare number = minutes).
 * Returns 0 for unrecognised input — callers must guard `<= 0`.
 */
export function parseDuration(input: string): number {
    let total = 0;
    const hourMatch = input.match(/(\d+(?:\.\d+)?)\s*h/i);
    const minMatch = input.match(/(\d+)\s*m/i);
    const secMatch = input.match(/(\d+)\s*s/i);

    if (hourMatch) total += parseFloat(hourMatch[1]) * 3600;
    if (minMatch) total += parseInt(minMatch[1]) * 60;
    if (secMatch) total += parseInt(secMatch[1]);

    // Bare number → treat as minutes
    if (!hourMatch && !minMatch && !secMatch) {
        const num = parseFloat(input);
        if (!isNaN(num)) total = num * 60;
    }

    return Math.round(total);
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
