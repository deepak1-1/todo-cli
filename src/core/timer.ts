// ============================================================
// Time formatting — pure, no I/O
// ============================================================

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
