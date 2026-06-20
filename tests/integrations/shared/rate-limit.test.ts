import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTokenBucket } from '../../../src/integrations/shared/rate-limit.js';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('createTokenBucket', () => {
    it('allows burst takes without waiting when tokens are available', async () => {
        // burst=3 means the first 3 takes should resolve immediately.
        const limiter = createTokenBucket({ name: 'test', rps: 1, burst: 3 });

        const results: string[] = [];
        const take = async (label: string): Promise<void> => {
            await limiter.take();
            results.push(label);
        };

        // All three should complete without needing timer advancement.
        await Promise.all([take('a'), take('b'), take('c')]);
        expect(results).toHaveLength(3);
    });

    it('delays the 4th take when burst is 3', async () => {
        // rps=10 so refill is fast but burst=3 means 4th is initially blocked.
        const limiter = createTokenBucket({ name: 'test', rps: 10, burst: 3 });

        let fourthResolved = false;

        // Drain burst.
        await limiter.take();
        await limiter.take();
        await limiter.take();

        // 4th take should block because tokens < 1.
        const fourthPromise = limiter.take().then(() => {
            fourthResolved = true;
        });

        // Not resolved yet (tokens depleted, timer not advanced).
        expect(fourthResolved).toBe(false);

        // Advance time to allow refill (100ms is more than 1/10s = 1 token at rps=10).
        await vi.advanceTimersByTimeAsync(200);
        await fourthPromise;

        expect(fourthResolved).toBe(true);
    });

    it('refills tokens over time', async () => {
        // 1 rps, burst=1 — exhausted immediately.
        const limiter = createTokenBucket({ name: 'test', rps: 1, burst: 1 });

        await limiter.take(); // drains the single token

        let resolved = false;
        const p = limiter.take().then(() => {
            resolved = false; // reuse same var just for the assert shape
            resolved = true;
        });

        expect(resolved).toBe(false);

        // Advance 1100ms — enough to refill 1 token at 1 rps.
        await vi.advanceTimersByTimeAsync(1100);
        await p;

        expect(resolved).toBe(true);
    });

    it('caps tokens at burst capacity', async () => {
        // After a long idle, tokens should not exceed burst.
        const limiter = createTokenBucket({ name: 'test', rps: 1, burst: 2 });

        // Advance 10 seconds — without the cap, tokens would be 10.
        await vi.advanceTimersByTimeAsync(10_000);

        // Only 2 takes should be immediate (burst=2), 3rd should block.
        let thirdResolved = false;
        await limiter.take();
        await limiter.take();
        const p = limiter.take().then(() => { thirdResolved = true; });

        expect(thirdResolved).toBe(false);

        await vi.advanceTimersByTimeAsync(2000);
        await p;
        expect(thirdResolved).toBe(true);
    });
});
