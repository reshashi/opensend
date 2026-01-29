/**
 * Domain Routes
 * REST endpoints for domain verification and management
 */

import { Hono } from 'hono';
import type { DatabaseClient } from '@opensend/shared';
import { createDomainService } from '../services/domain.service.js';
import type { AuthContext, ApiError } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

interface DomainVariables {
  auth: AuthContext;
}

interface VerifyDomainBody {
  domain: string;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * Create domain routes
 */
export function createDomainRoutes(db: DatabaseClient): Hono<{ Variables: DomainVariables }> {
  const app = new Hono<{ Variables: DomainVariables }>();
  const domainService = createDomainService(db);

  /**
   * POST /v1/domains/verify
   * Create or get domain with DNS records for verification
   */
  app.post('/verify', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    // Parse request body
    let body: VerifyDomainBody;
    try {
      body = await c.req.json();
    } catch {
      const error: ApiError = {
        error: { code: 'INVALID_JSON', message: 'Invalid JSON body' },
      };
      return c.json(error, 400);
    }

    // Validate domain field
    if (!body.domain || typeof body.domain !== 'string') {
      const error: ApiError = {
        error: { code: 'VALIDATION_ERROR', message: 'Domain is required', field: 'domain' },
      };
      return c.json(error, 400);
    }

    // Create or get domain
    const result = await domainService.createOrGetDomain(auth.apiKey.id, body.domain);

    if (!result.ok) {
      const error: ApiError = {
        error: { code: 'DOMAIN_ERROR', message: result.error.message },
      };
      return c.json(error, 400);
    }

    return c.json(result.value, 200);
  });

  /**
   * GET /v1/domains
   * List all domains for the API key
   */
  app.get('/', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    const result = await domainService.listDomains(auth.apiKey.id);

    if (!result.ok) {
      const error: ApiError = {
        error: { code: 'DATABASE_ERROR', message: result.error.message },
      };
      return c.json(error, 500);
    }

    // Map to response format
    const domains = result.value.map((d) => ({
      domain: d.domain,
      verified: d.verified,
      created_at: d.createdAt.toISOString(),
      verified_at: d.verifiedAt?.toISOString() ?? null,
    }));

    return c.json({ domains }, 200);
  });

  /**
   * GET /v1/domains/:domain
   * Get domain status and verification state
   */
  app.get('/:domain', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    const domainName = c.req.param('domain');

    const result = await domainService.getDomain(auth.apiKey.id, domainName);

    if (!result.ok) {
      const statusCode = result.error.message.includes('not found') ? 404 : 400;
      const error: ApiError = {
        error: { code: 'DOMAIN_ERROR', message: result.error.message },
      };
      return c.json(error, statusCode);
    }

    return c.json(result.value, 200);
  });

  /**
   * POST /v1/domains/:domain/check
   * Check DNS records and verify domain
   */
  app.post('/:domain/check', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    const domainName = c.req.param('domain');

    const result = await domainService.verifyDomain(auth.apiKey.id, domainName);

    if (!result.ok) {
      const statusCode = result.error.message.includes('not found') ? 404 : 400;
      const error: ApiError = {
        error: { code: 'VERIFICATION_ERROR', message: result.error.message },
      };
      return c.json(error, statusCode);
    }

    return c.json(result.value, 200);
  });

  /**
   * DELETE /v1/domains/:domain
   * Remove domain
   */
  app.delete('/:domain', async (c) => {
    const auth = c.get('auth');
    if (!auth) {
      const error: ApiError = {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      };
      return c.json(error, 401);
    }

    const domainName = c.req.param('domain');

    const result = await domainService.deleteDomain(auth.apiKey.id, domainName);

    if (!result.ok) {
      const statusCode = result.error.message.includes('not found') ? 404 : 400;
      const error: ApiError = {
        error: { code: 'DELETE_ERROR', message: result.error.message },
      };
      return c.json(error, statusCode);
    }

    return c.body(null, 204);
  });

  return app;
}
