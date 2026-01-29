/**
 * Suppression Routes
 * REST endpoints for email suppression list management
 */

import { Hono } from 'hono';
import type { DatabaseClient, SuppressionReason } from '@opensend/shared';
import { createSuppressionService } from '../services/suppression.service.js';
import type { AuthContext, ApiError } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

interface SuppressionVariables {
  auth: AuthContext;
}

// ============================================================================
// Constants
// ============================================================================

const VALID_REASONS: SuppressionReason[] = [
  'hard_bounce',
  'soft_bounce',
  'complaint',
  'unsubscribe',
  'manual',
];

// ============================================================================
// Routes
// ============================================================================

/**
 * Create suppression routes
 */
export function createSuppressionRoutes(db: DatabaseClient): Hono<{ Variables: SuppressionVariables }> {
  const app = new Hono<{ Variables: SuppressionVariables }>();
  const suppressionService = createSuppressionService(db);

  /**
   * GET /v1/suppressions
   * List suppression entries with filtering
   */
  app.get('/', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    // Parse query parameters
    const reason = c.req.query('reason') as SuppressionReason | undefined;
    const limitStr = c.req.query('limit');
    const offsetStr = c.req.query('offset');

    const limit = limitStr ? parseInt(limitStr, 10) : 100;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

    // Validate reason if provided
    if (reason && !VALID_REASONS.includes(reason)) {
      const error: ApiError = {
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid reason. Valid values: ${VALID_REASONS.join(', ')}`,
          field: 'reason',
        },
      };
      return c.json(error, 400);
    }

    // Validate pagination
    if (isNaN(limit) || limit < 1 || limit > 1000) {
      const error: ApiError = {
        error: { code: 'VALIDATION_ERROR', message: 'Limit must be between 1 and 1000', field: 'limit' },
      };
      return c.json(error, 400);
    }

    if (isNaN(offset) || offset < 0) {
      const error: ApiError = {
        error: { code: 'VALIDATION_ERROR', message: 'Offset must be >= 0', field: 'offset' },
      };
      return c.json(error, 400);
    }

    // Get suppressions
    const result = await suppressionService.list(auth.apiKey.id, { reason, limit, offset });

    if (!result.ok) {
      const error: ApiError = {
        error: { code: 'DATABASE_ERROR', message: result.error.message },
      };
      return c.json(error, 500);
    }

    return c.json(result.value, 200);
  });

  /**
   * GET /v1/suppressions/:email
   * Get suppression details for a specific email
   */
  app.get('/:email', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    const email = c.req.param('email');

    const result = await suppressionService.get(auth.apiKey.id, email);

    if (!result.ok) {
      const error: ApiError = {
        error: { code: 'DATABASE_ERROR', message: result.error.message },
      };
      return c.json(error, 500);
    }

    if (!result.value) {
      const error: ApiError = {
        error: { code: 'NOT_FOUND', message: `Email ${email} not found in suppression list` },
      };
      return c.json(error, 404);
    }

    return c.json({
      email: result.value.email,
      reason: result.value.reason,
      created_at: result.value.createdAt.toISOString(),
    }, 200);
  });

  /**
   * POST /v1/suppressions
   * Add email to suppression list
   */
  app.post('/', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    // Parse request body
    let body: { email?: string; reason?: string };
    try {
      body = await c.req.json();
    } catch {
      const error: ApiError = {
        error: { code: 'INVALID_JSON', message: 'Invalid JSON body' },
      };
      return c.json(error, 400);
    }

    // Validate email
    if (!body.email || typeof body.email !== 'string') {
      const error: ApiError = {
        error: { code: 'VALIDATION_ERROR', message: 'Email is required', field: 'email' },
      };
      return c.json(error, 400);
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      const error: ApiError = {
        error: { code: 'VALIDATION_ERROR', message: 'Invalid email format', field: 'email' },
      };
      return c.json(error, 400);
    }

    // Validate reason (default to 'manual')
    const reason = (body.reason || 'manual') as SuppressionReason;
    if (!VALID_REASONS.includes(reason)) {
      const error: ApiError = {
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid reason. Valid values: ${VALID_REASONS.join(', ')}`,
          field: 'reason',
        },
      };
      return c.json(error, 400);
    }

    // Add suppression
    const result = await suppressionService.add(auth.apiKey.id, body.email, reason);

    if (!result.ok) {
      const error: ApiError = {
        error: { code: 'DATABASE_ERROR', message: result.error.message },
      };
      return c.json(error, 500);
    }

    return c.json({
      email: result.value.email,
      reason: result.value.reason,
      created_at: result.value.createdAt.toISOString(),
    }, 201);
  });

  /**
   * DELETE /v1/suppressions/:email
   * Remove email from suppression list
   */
  app.delete('/:email', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    const email = c.req.param('email');

    const result = await suppressionService.remove(auth.apiKey.id, email);

    if (!result.ok) {
      const statusCode = result.error.message.includes('not found') ? 404 : 500;
      const error: ApiError = {
        error: { code: 'DELETE_ERROR', message: result.error.message },
      };
      return c.json(error, statusCode);
    }

    return c.body(null, 204);
  });

  return app;
}
