/**
 * Rate Limiting Middleware
 * Token bucket algorithm for per-API-key rate limiting
 */

import type { Context, Next, MiddlewareHandler } from 'hono';
import type { RateLimitBucket, ApiError, AuthContext } from '../types/index.js';

/**
 * In-memory rate limit storage
 * Key: API key ID, Value: Token bucket state
 */
const buckets = new Map<string, RateLimitBucket>();

/**
 * Clean up expired buckets periodically
 * Buckets are considered stale after 1 hour of inactivity
 */
const BUCKET_TTL_MS = 60 * 60 * 1000; // 1 hour

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastRefill > BUCKET_TTL_MS) {
      buckets.delete(key);
    }
  }
}, 60 * 1000); // Clean every minute

/**
 * Create rate limiting middleware
 * Uses token bucket algorithm with per-second refill
 */
export function createRateLimitMiddleware(): MiddlewareHandler<{
  Variables: { auth: AuthContext };
}> {
  return async (c: Context<{ Variables: { auth: AuthContext } }>, next: Next): Promise<Response | void> => {
    const auth = c.get('auth');
    if (!auth) {
      // No auth context - skip rate limiting
      await next();
      return;
    }

    const apiKeyId = auth.apiKey.id;
    const limit = auth.apiKey.rateLimitPerSecond;
    const now = Date.now();

    // Get or create bucket
    let bucket = buckets.get(apiKeyId);
    if (!bucket) {
      bucket = {
        tokens: limit,
        lastRefill: now,
        limit,
      };
      buckets.set(apiKeyId, bucket);
    }

    // Refill tokens based on time elapsed
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(elapsed / 1000) * limit;
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(limit, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    // Check if we have tokens available
    if (bucket.tokens < 1) {
      const retryAfter = Math.ceil((1000 - (now - bucket.lastRefill)) / 1000);
      
      c.header('X-RateLimit-Limit', limit.toString());
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', Math.ceil((bucket.lastRefill + 1000) / 1000).toString());
      c.header('Retry-After', Math.max(1, retryAfter).toString());

      const error: ApiError = {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded',
        },
      };
      return c.json(error, 429);
    }

    // Consume a token
    bucket.tokens -= 1;

    // Set rate limit headers
    c.header('X-RateLimit-Limit', limit.toString());
    c.header('X-RateLimit-Remaining', Math.max(0, bucket.tokens).toString());
    c.header('X-RateLimit-Reset', Math.ceil((bucket.lastRefill + 1000) / 1000).toString());

    await next();
  };
}

/**
 * Get current rate limit status for an API key (for testing/debugging)
 */
export function getRateLimitStatus(apiKeyId: string): RateLimitBucket | undefined {
  return buckets.get(apiKeyId);
}

/**
 * Clear all rate limit buckets (for testing)
 */
export function clearRateLimits(): void {
  buckets.clear();
}
