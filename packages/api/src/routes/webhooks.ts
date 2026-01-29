/**
 * Webhook Routes
 * REST endpoints for webhook management
 */

import { Hono } from 'hono';
import type { DatabaseClient } from '@opensend/shared';
import { createWebhookService } from '../services/webhook.service.js';
import type { AuthContext, ApiError } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

interface WebhookVariables {
  auth: AuthContext;
}

interface CreateWebhookBody {
  url: string;
  events: string[];
}

// ============================================================================
// Routes
// ============================================================================

/**
 * Create webhook routes
 */
export function createWebhookRoutes(db: DatabaseClient): Hono<{ Variables: WebhookVariables }> {
  const app = new Hono<{ Variables: WebhookVariables }>();
  const webhookService = createWebhookService(db);

  /**
   * POST /v1/webhooks
   * Create a new webhook
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
    let body: CreateWebhookBody;
    try {
      body = await c.req.json();
    } catch {
      const error: ApiError = {
        error: { code: 'INVALID_JSON', message: 'Invalid JSON body' },
      };
      return c.json(error, 400);
    }

    // Validate url
    if (!body.url || typeof body.url !== 'string') {
      const error: ApiError = {
        error: { code: 'VALIDATION_ERROR', message: 'URL is required', field: 'url' },
      };
      return c.json(error, 400);
    }

    // Validate events
    if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
      const error: ApiError = {
        error: { code: 'VALIDATION_ERROR', message: 'Events array is required and must not be empty', field: 'events' },
      };
      return c.json(error, 400);
    }

    // Create webhook
    const result = await webhookService.create(auth.apiKey.id, body.url, body.events);

    if (!result.ok) {
      const error: ApiError = {
        error: { code: 'WEBHOOK_ERROR', message: result.error.message },
      };
      return c.json(error, 400);
    }

    return c.json(result.value, 201);
  });

  /**
   * GET /v1/webhooks
   * List all webhooks for the API key
   */
  app.get('/', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    const result = await webhookService.list(auth.apiKey.id);

    if (!result.ok) {
      const error: ApiError = {
        error: { code: 'DATABASE_ERROR', message: result.error.message },
      };
      return c.json(error, 500);
    }

    return c.json({ webhooks: result.value }, 200);
  });

  /**
   * GET /v1/webhooks/:id
   * Get a specific webhook
   */
  app.get('/:id', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    const webhookId = c.req.param('id');

    const result = await webhookService.get(auth.apiKey.id, webhookId);

    if (!result.ok) {
      const statusCode = result.error.message.includes('not found') ? 404 : 400;
      const error: ApiError = {
        error: { code: 'WEBHOOK_ERROR', message: result.error.message },
      };
      return c.json(error, statusCode);
    }

    return c.json({
      id: result.value.id,
      url: result.value.url,
      events: result.value.events,
      active: result.value.active,
      created_at: result.value.createdAt.toISOString(),
    }, 200);
  });

  /**
   * PATCH /v1/webhooks/:id
   * Update a webhook
   */
  app.patch('/:id', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    const webhookId = c.req.param('id');

    // Parse request body
    let body: { url?: string; events?: string[]; active?: boolean };
    try {
      body = await c.req.json();
    } catch {
      const error: ApiError = {
        error: { code: 'INVALID_JSON', message: 'Invalid JSON body' },
      };
      return c.json(error, 400);
    }

    // Update webhook
    const result = await webhookService.update(auth.apiKey.id, webhookId, body);

    if (!result.ok) {
      const statusCode = result.error.message.includes('not found') ? 404 : 400;
      const error: ApiError = {
        error: { code: 'WEBHOOK_ERROR', message: result.error.message },
      };
      return c.json(error, statusCode);
    }

    return c.json({
      id: result.value.id,
      url: result.value.url,
      events: result.value.events,
      active: result.value.active,
      created_at: result.value.createdAt.toISOString(),
    }, 200);
  });

  /**
   * DELETE /v1/webhooks/:id
   * Delete a webhook
   */
  app.delete('/:id', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    const webhookId = c.req.param('id');

    const result = await webhookService.remove(auth.apiKey.id, webhookId);

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
