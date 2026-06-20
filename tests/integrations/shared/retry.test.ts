import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, defaultShouldRetry } from '../../../src/integrations/shared/retry.js';

// Replace setTimeout so tests run instantly.
vi.useFakeTimers();

beforeEach(() => {
    vi.clearAllTimers();
});

describe('defaultShouldRetry', () => {
    it('retries on ETIMEDOUT', () => {
        const err = Object.assign(new Error('connection timed out'), { code: 'ETIMEDOUT' });
        expect(defaultShouldRetry(err)).toBe(true);
    });

    it('retries on ECONNRESET', () => {
        const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        expect(defaultShouldRetry(err)).toBe(true);
    });

    it('retries on ENETUNREACH', () => {
        const err = Object.assign(new Error('network unreachable'), { code: 'ENETUNREACH' });
        expect(defaultShouldRetry(err)).toBe(true);
    });

    it('retries on EAI_AGAIN', () => {
        const err = Object.assign(new Error('dns error'), { code: 'EAI_AGAIN' });
        expect(defaultShouldRetry(err)).toBe(true);
    });

    it('retries on HTTP 429 encoded in message', () => {
        const err = new Error('Jira API error (429): rate limit exceeded');
        expect(defaultShouldRetry(err)).toBe(true);
    });

    it('retries on HTTP 503 encoded in message', () => {
        const err = new Error('upstream error (503): service unavailable');
        expect(defaultShouldRetry(err)).toBe(true);
    });

    it('does not retry on HTTP 401', () => {
        const err = new Error('API error (401): unauthorized');
        expect(defaultShouldRetry(err)).toBe(false);
    });

    it('does not retry on HTTP 404', () => {
        const err = new Error('API error (404): not found');
        expect(defaultShouldRetry(err)).toBe(false);
    });

    it('does not retry on generic non-network errors', () => {
        expect(defaultShouldRetry(new Error('something went wrong'))).toBe(false);
    });
});

describe('withRetry', () => {
    it('succeeds immediately when fn does not throw', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        const result = await withRetry(fn);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries ETIMEDOUT N times then succeeds, invokes fn exactly N+1 times', async () => {
        const etimedout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
        let calls = 0;
        const fn = vi.fn().mockImplementation(async () => {
            calls++;
            if (calls <= 2) throw etimedout;
            return 'recovered';
        });

        const promise = withRetry(fn, { maxAttempts: 5, baseMs: 10 });
        // Advance timers to drain backoff waits for each retry.
        await vi.runAllTimersAsync();
        const result = await promise;

        expect(result).toBe('recovered');
        expect(fn).toHaveBeenCalledTimes(3); // 2 failures + 1 success
    });

    it('throws immediately on a non-retryable 4xx error', async () => {
        const err = new Error('API error (403): forbidden');
        const fn = vi.fn().mockRejectedValue(err);

        await expect(withRetry(fn, { maxAttempts: 5, baseMs: 10 })).rejects.toThrow('(403)');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('exhausts maxAttempts and rethrows', async () => {
        const etimedout = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
        const fn = vi.fn().mockRejectedValue(etimedout);

        // Attach rejection handler immediately to avoid unhandled-rejection noise.
        const promise = withRetry(fn, { maxAttempts: 3, baseMs: 10 });
        const caught = promise.catch((e: unknown) => e);
        await vi.runAllTimersAsync();
        const err = await caught;
        expect(err instanceof Error && err.message).toBe('timeout');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('honors retryAfterMs on the thrown error', async () => {
        let calls = 0;
        const fn = vi.fn().mockImplementation(async () => {
            calls++;
            if (calls === 1) {
                const err = Object.assign(new Error('API error (429): rate limited'), {
                    retryAfterMs: 5000,
                });
                throw err;
            }
            return 'ok';
        });

        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const promise = withRetry(fn, { maxAttempts: 3, baseMs: 10 });
        await vi.runAllTimersAsync();
        await promise;

        // The backoff delay used should be >= 5000ms (from retryAfterMs).
        const delays = setTimeoutSpy.mock.calls.map((c) => c[1] as number);
        expect(delays.some((d) => d >= 5000)).toBe(true);
    });

    it('aborts immediately when signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const fn = vi.fn().mockResolvedValue('ok');

        await expect(withRetry(fn, { signal: controller.signal })).rejects.toThrow('Aborted');
        expect(fn).not.toHaveBeenCalled();
    });

    it('respects a custom shouldRetry predicate', async () => {
        const err = new Error('custom error');
        const fn = vi.fn().mockRejectedValue(err);
        // Never retry.
        const shouldRetry = vi.fn().mockReturnValue(false);

        await expect(withRetry(fn, { maxAttempts: 5, shouldRetry })).rejects.toThrow('custom error');
        expect(fn).toHaveBeenCalledTimes(1);
        expect(shouldRetry).toHaveBeenCalledTimes(1);
    });
});
