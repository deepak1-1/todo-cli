// Exponential-backoff retry wrapper for integration call sites.

export interface RetryOptions {
    maxAttempts?: number;
    baseMs?: number;
    signal?: AbortSignal;
    shouldRetry?: (err: unknown, attempt: number) => boolean;
}

// Network-level error codes that warrant a retry.
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN']);

/** Return true if err is a node system error with a retryable code. */
function isRetryableNetworkError(err: unknown): boolean {
    if (err instanceof Error) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code && RETRYABLE_CODES.has(code)) return true;
    }
    return false;
}

/** Return true if err carries an HTTP status that warrants a retry (429 or 5xx). */
function isRetryableHttpStatus(err: unknown): boolean {
    if (err instanceof Error) {
        // Callers encode HTTP status in message: "... (429): ..." or "... (503): ..."
        const m = /\((\d{3})\)/.exec(err.message);
        if (m) {
            const status = Number.parseInt(m[1], 10);
            return status === 429 || status >= 500;
        }
    }
    return false;
}

/** Default predicate: retry on network errors, 429, or 5xx. Never retry on 4xx (except 429). */
export function defaultShouldRetry(err: unknown): boolean {
    return isRetryableNetworkError(err) || isRetryableHttpStatus(err);
}

/** Read retryAfterMs attached by callers that parse a Retry-After header. */
function getRetryAfterMs(err: unknown): number | undefined {
    if (err && typeof err === 'object' && 'retryAfterMs' in err) {
        const v = (err as Record<string, unknown>).retryAfterMs;
        if (typeof v === 'number' && v > 0) return v;
    }
    return undefined;
}

/**
 * Retry `fn` with exponential backoff and jitter.
 * Backoff = baseMs × 2^(attempt-1) × (0.75 + Math.random() × 0.5).
 * Honors `err.retryAfterMs` set by the caller (e.g. from a Retry-After header).
 * Aborts immediately if `signal` is aborted.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
    const maxAttempts = opts?.maxAttempts ?? 5;
    const baseMs = opts?.baseMs ?? 200;
    const signal = opts?.signal;
    const shouldRetry = opts?.shouldRetry ?? defaultShouldRetry;

    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (signal?.aborted) throw new Error('Aborted');

        try {
            return await fn();
        } catch (err: unknown) {
            lastErr = err;

            if (attempt === maxAttempts || !shouldRetry(err, attempt)) throw err;

            const retryAfterMs = getRetryAfterMs(err);
            const backoffMs = retryAfterMs ?? baseMs * Math.pow(2, attempt - 1) * (0.75 + Math.random() * 0.5);

            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(resolve, backoffMs);
                if (signal) {
                    // Cancel the wait if the signal fires during backoff.
                    const onAbort = (): void => {
                        clearTimeout(timer);
                        reject(new Error('Aborted'));
                    };
                    signal.addEventListener('abort', onAbort, { once: true });
                }
            });
        }
    }

    throw lastErr;
}
