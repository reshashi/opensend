/**
 * Email Routes
 * POST /v1/email/send - Send a single email
 * GET /v1/email/:id - Get email status
 * POST /v1/email/send/batch - Send multiple emails (batch)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { DatabaseClient } from '@opensend/shared';
import { createEmailService } from '../services/index.js';
import type { AuthContext, ApiError } from '../types/index.js';
import { getIdempotencyKey } from '../middleware/index.js';

/**
 * Email validation regex (RFC 5322 simplified)
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Max subject length per RFC 5322
 */
const MAX_SUBJECT_LENGTH = 998;

/**
 * Max metadata size (10KB)
 */
const MAX_METADATA_SIZE = 10 * 1024;

/**
 * Max batch size
 */
const MAX_BATCH_SIZE = 100;

/**
 * Base email fields schema (without refinement)
 */
const baseEmailSchema = z.object({
  to: z
    .string()
    .min(1, 'Recipient email is required')
    .regex(EMAIL_REGEX, 'Invalid email format'),
  subject: z
    .string()
    .min(1, 'Subject is required')
    .max(MAX_SUBJECT_LENGTH, `Subject must be ${MAX_SUBJECT_LENGTH} characters or less`),
  body: z.string().optional(),
  html: z.string().optional(),
  from: z
    .string()
    .regex(EMAIL_REGEX, 'Invalid sender email format')
    .optional(),
  reply_to: z
    .string()
    .regex(EMAIL_REGEX, 'Invalid reply-to email format')
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Body/html required refinement
 */
const requireBodyOrHtml = (data: { body?: string; html?: string }) =>
  data.body !== undefined || data.html !== undefined;

/**
 * Send email request schema
 */
const sendEmailSchema = baseEmailSchema.refine(requireBodyOrHtml, {
  message: 'Either body or html is required',
  path: ['body'],
});

/**
 * Batch email item schema (extends base with idempotency key)
 */
const batchEmailItemSchema = baseEmailSchema
  .extend({
    idempotency_key: z.string().optional(),
  })
  .refine(requireBodyOrHtml, {
    message: 'Either body or html is required',
    path: ['body'],
  });

/**
 * Batch email request schema
 */
const batchEmailSchema = z.object({
  messages: z
    .array(batchEmailItemSchema)
    .min(1, 'At least one message is required')
    .max(MAX_BATCH_SIZE, `Maximum ${MAX_BATCH_SIZE} messages per batch`),
});

/**
 * Create email routes
 */
export function createEmailRoutes(db: DatabaseClient): Hono<{ Variables: { auth: AuthContext } }> {
  const app = new Hono<{ Variables: { auth: AuthContext } }>();
  const emailService = createEmailService(db);

  /**
   * POST /send
   * Send a single email
   */
  app.post('/send', async (c) => {
    const auth = c.get('auth');
    const idempotencyKey = getIdempotencyKey(c);

    // Parse request body
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      const error: ApiError = {
        error: {
          code: 'INVALID_JSON',
          message: 'Invalid JSON in request body',
        },
      };
      return c.json(error, 400);
    }

    // Validate request
    const parseResult = sendEmailSchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0];
      const error: ApiError = {
        error: {
          code: 'VALIDATION_ERROR',
          message: firstError.message,
          field: firstError.path.join('.') || undefined,
        },
      };
      return c.json(error, 400);
    }

    const request = parseResult.data;

    // Check metadata size
    if (request.metadata) {
      const metadataSize = JSON.stringify(request.metadata).length;
      if (metadataSize > MAX_METADATA_SIZE) {
        const error: ApiError = {
          error: {
            code: 'VALIDATION_ERROR',
            message: `Metadata exceeds maximum size of ${MAX_METADATA_SIZE / 1024}KB`,
            field: 'metadata',
          },
        };
        return c.json(error, 400);
      }
    }

    // Send email
    const result = await emailService.sendEmail(
      auth.apiKey.id,
      {
        to: request.to,
        subject: request.subject,
        body: request.body,
        html: request.html,
        from: request.from,
        reply_to: request.reply_to,
        metadata: request.metadata,
      },
      idempotencyKey
    );

    if (!result.ok) {
      const error: ApiError = {
        error: {
          code: result.error.code,
          message: result.error.message,
          field: result.error.field,
        },
      };
      return c.json(error, result.error.statusCode as 400 | 403 | 422 | 500);
    }

    // Return token-efficient response
    return c.json(
      {
        id: result.value.id,
        status: result.value.status,
      },
      201
    );
  });

  /**
   * GET /:id
   * Get email status by message ID
   */
  app.get('/:id', async (c) => {
    const auth = c.get('auth');
    const messageId = c.req.param('id');

    // Validate message ID format (should be a valid ID)
    if (!messageId || messageId.length < 1) {
      const error: ApiError = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid message ID',
        },
      };
      return c.json(error, 400);
    }

    const result = await emailService.getEmailStatus(auth.apiKey.id, messageId);

    if (!result.ok) {
      const error: ApiError = {
        error: {
          code: result.error.code,
          message: result.error.message,
        },
      };
      return c.json(error, result.error.statusCode as 500);
    }

    if (!result.value) {
      const error: ApiError = {
        error: {
          code: 'NOT_FOUND',
          message: 'Message not found',
        },
      };
      return c.json(error, 404);
    }

    return c.json(result.value, 200);
  });

  /**
   * POST /send/batch
   * Send multiple emails in batch
   */
  app.post('/send/batch', async (c) => {
    const auth = c.get('auth');

    // Parse request body
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      const error: ApiError = {
        error: {
          code: 'INVALID_JSON',
          message: 'Invalid JSON in request body',
        },
      };
      return c.json(error, 400);
    }

    // Validate request
    const parseResult = batchEmailSchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0];
      const error: ApiError = {
        error: {
          code: 'VALIDATION_ERROR',
          message: firstError.message,
          field: firstError.path.join('.') || undefined,
        },
      };
      return c.json(error, 400);
    }

    const { messages } = parseResult.data;

    // Check total metadata size for all messages
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.metadata) {
        const metadataSize = JSON.stringify(msg.metadata).length;
        if (metadataSize > MAX_METADATA_SIZE) {
          const error: ApiError = {
            error: {
              code: 'VALIDATION_ERROR',
              message: `Message ${i}: metadata exceeds maximum size of ${MAX_METADATA_SIZE / 1024}KB`,
              field: `messages[${i}].metadata`,
            },
          };
          return c.json(error, 400);
        }
      }
    }

    // Send batch
    const results = await emailService.batchSend(
      auth.apiKey.id,
      messages.map((msg) => ({
        to: msg.to,
        subject: msg.subject,
        body: msg.body,
        html: msg.html,
        from: msg.from,
        reply_to: msg.reply_to,
        metadata: msg.metadata,
        idempotency_key: msg.idempotency_key,
      }))
    );

    return c.json({ results }, 200);
  });

  return app;
}
