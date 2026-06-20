// Standardized exit codes and fail helper for command actions
import { error } from './format.js';

export const EXIT = {
    OK: 0,
    GENERIC: 1,
    USAGE: 2,
    NOT_FOUND: 3,
    INVALID_TRANSITION: 4,
    CONFIG_ERROR: 5,
} as const;

export type ExitCode = typeof EXIT[keyof typeof EXIT];

export function fail(code: ExitCode, message: string, opts?: { json?: boolean; command?: string }): void {
    if (opts?.json) {
        // Emit JSON error to stdout (not stderr) so the caller can parse it
        process.stdout.write(JSON.stringify({ ok: false, command: opts.command ?? '', error: { code, message } }) + '\n');
    } else {
        console.error(error(message));
    }
    process.exitCode = code;
}

// Type guard: if entity is null/undefined, calls fail(NOT_FOUND) and returns false.
export function requireEntity<T>(
    entity: T | null | undefined,
    kind: string,
    ref: string | number,
    opts?: { json?: boolean; command?: string },
): entity is T {
    if (entity) return true;
    fail(EXIT.NOT_FOUND, `${kind} ${ref} not found`, opts);
    return false;
}
