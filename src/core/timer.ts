// ============================================================
// Pomodoro timer logic — pure, no I/O
// ============================================================

export const DEFAULT_POMODORO = 25 * 60; // 25 minutes in seconds
export const DEFAULT_SHORT_BREAK = 5 * 60;
export const DEFAULT_LONG_BREAK = 15 * 60;
export const SESSIONS_BEFORE_LONG_BREAK = 4;

/** Format seconds into MM:SS */
export function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

/** Calculate break duration based on session count */
export function getBreakDuration(completedSessions: number): number {
    return completedSessions % SESSIONS_BEFORE_LONG_BREAK === 0
        ? DEFAULT_LONG_BREAK
        : DEFAULT_SHORT_BREAK;
}