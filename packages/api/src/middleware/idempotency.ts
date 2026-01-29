/**
 * Idempotency Middleware
 * Handles Idempotency-Key header for safe request retries
 */

import type { Context, Next, MiddlewareHandler } from 'hono';
import type { DatabaseClient } from '@mailforge/shared';
import type { AuthContext } from '../types/index.js';

/**
 * Create idempotency middleware
 * Checks for existing messages with the same idempotency key
 */
export function createIdempotencyMiddleware(
  db: DatabaseClient
): MiddlewareHandler<{ Variables: { auth: AuthContext } }> {
  return async (c: Context<{ Variables: { auth: AuthContext } }>, next: Next): Promise<Response | void> => {
    // Only check for POST/PUT requests
    const method = c.req.method;
    if (method !== 'POST' && method !== 'PUT') {
      await next();
      return;
    }

    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      // No idempotency key - proceed normally
      await next();
      return;
    }

    const auth = c.get('auth');
    if (!auth) {
      // No auth context - proceed normally
      await next();
      return;
    }

    // Check for existing message with this idempotency key
    const result = await db.messages.findByIdempotencyKey(
      auth.apiKey.id,
      idempotencyKey
    );

    if (!result.ok) {
      // Database error - continue without idempotency check
      console.error('Idempotency check failed:', result.error.message);
      await next();
      return;
    }

    if (result.value) {
      // Found existing message - return cached response
      const message = result.value;
      return c.json(
        {
          messageId: message.id,
          status: message.status,
          cached: true,
        },
        200
      );
    }

    // No existing message - proceed with request
    // Store the idempotency key in context for the handler to use
    c.set('idempotencyKey' as never, idempotencyKey as never);
    await next();
  };
}

/**
 * Get idempotency key from context
 */
export function getIdempotencyKey(c: Context): string | undefined {
  return c.get('idempotencyKey' as never) as string | undefined;
}
