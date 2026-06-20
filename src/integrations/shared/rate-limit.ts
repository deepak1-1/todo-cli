// Shared token-bucket rate limiter for integration clients.

interface TokenBucket {
    tokens: number;
    lastRefill: number;
    capacity: number;
    refillRate: number; // tokens per millisecond
}

export interface RateLimiter {
    take(): Promise<void>;
}

export interface TokenBucketOptions {
    name: string;
    rps: number;   // requests per second (sustained rate)
    burst: number; // maximum burst capacity
}

/** Create a token-bucket rate limiter; `take()` waits until a token is available. */
export function createTokenBucket(opts: TokenBucketOptions): RateLimiter {
    const bucket: TokenBucket = {
        tokens: opts.burst,
        lastRefill: Date.now(),
        capacity: opts.burst,
        refillRate: opts.rps / 1000, // tokens per millisecond
    };

    return {
        async take(): Promise<void> {
            const now = Date.now();
            const elapsed = now - bucket.lastRefill;
            bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillRate);
            bucket.lastRefill = now;

            if (bucket.tokens < 1) {
                const waitMs = (1 - bucket.tokens) / bucket.refillRate;
                await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
                bucket.tokens = 1;
            }

            bucket.tokens -= 1;
        },
    };
}
