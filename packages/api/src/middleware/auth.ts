/**
 * Authentication Middleware
 * Validates API keys and attaches user context to requests
 */

import type { Context, Next, MiddlewareHandler } from 'hono';
import type { DatabaseClient } from '@mailforge/shared';
import { hashApiKey, type Config } from '../config.js';
import type { ApiError, AuthContext } from '../types/index.js';

/**
 * Variables added to Hono context by auth middleware
 */
export interface AuthVariables {
  auth: AuthContext;
}

/**
 * Create authentication middleware
 * Extracts Bearer token, hashes it, and validates against database
 */
export function createAuthMiddleware(
  db: DatabaseClient,
  config: Config
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c: Context<{ Variables: AuthVariables }>, next: Next): Promise<Response | void> => {
    const authHeader = c.req.header('Authorization');

    // Check for Authorization header
    if (!authHeader) {
      const error: ApiError = {
        error: {
          code: 'MISSING_API_KEY',
          message: 'Authorization header required',
        },
      };
      return c.json(error, 401);
    }

    // Extract Bearer token
    if (!authHeader.startsWith('Bearer ')) {
      const error: ApiError = {
        error: {
          code: 'INVALID_AUTH_FORMAT',
          message: 'Authorization header must use Bearer scheme',
        },
      };
      return c.json(error, 401);
    }

    const token = authHeader.slice(7);
    if (!token) {
      const error: ApiError = {
        error: {
          code: 'MISSING_API_KEY',
          message: 'API key required',
        },
      };
      return c.json(error, 401);
    }

    // Hash the token
    const keyHash = hashApiKey(token, config.apiSecret);

    // Look up in database
    const result = await db.apiKeys.findByHash(keyHash);

    if (!result.ok) {
      const error: ApiError = {
        error: {
          code: 'AUTH_ERROR',
          message: 'Authentication failed',
        },
      };
      return c.json(error, 500);
    }

    if (!result.value) {
      const error: ApiError = {
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid API key',
        },
      };
      return c.json(error, 401);
    }

    // Attach API key to context
    c.set('auth', { apiKey: result.value });

    // Update last_used_at asynchronously (fire and forget)
    db.apiKeys.updateLastUsed(result.value.id).catch(() => {
      // Ignore errors - this is non-critical
    });

    await next();
  };
}
