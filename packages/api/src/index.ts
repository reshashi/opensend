/**
 * OpenSend API Server
 * Entry point for the Hono-based REST API
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createDatabaseClient, type DatabaseClient } from '@opensend/shared';
import { loadConfig, type Config } from './config.js';
import {
  createAuthMiddleware,
  createRateLimitMiddleware,
  createIdempotencyMiddleware,
  type AuthVariables,
} from './middleware/index.js';
import { createHealthRoutes } from './routes/health.js';
import { createEmailRoutes } from './routes/email.js';
import { createDomainRoutes } from './routes/domains.js';
import { createSuppressionRoutes } from './routes/suppressions.js';
import { createWebhookRoutes } from './routes/webhooks.js';
import type { ApiError, AuthContext } from './types/index.js';

// Extended variables for the full app context
interface AppVariables extends AuthVariables {
  idempotencyKey?: string;
}

/**
 * Create and configure the Hono application
 */
function createApp(db: DatabaseClient, config: Config): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();

  // Global error handler
  app.onError((err, c) => {
    console.error('[Error]', err.message);

    // Don't expose stack traces in production
    const error: ApiError = {
      error: {
        code: 'INTERNAL_ERROR',
        message: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
      },
    };

    return c.json(error, 500);
  });

  // Not found handler
  app.notFound((c) => {
    const error: ApiError = {
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    };
    return c.json(error, 404);
  });

  // Request logging (minimal for token efficiency)
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`);
  });

  // Mount health routes (no auth required)
  app.route('/health', createHealthRoutes(db));

  // Create middleware instances
  const authMiddleware = createAuthMiddleware(db, config);
  const rateLimitMiddleware = createRateLimitMiddleware();
  const idempotencyMiddleware = createIdempotencyMiddleware(db);

  // Apply auth middleware to /v1/* routes
  app.use('/v1/*', authMiddleware);

  // Apply rate limiting after auth
  app.use('/v1/*', rateLimitMiddleware);

  // Apply idempotency handling for mutating endpoints
  app.use('/v1/*', idempotencyMiddleware);

  // Mount email routes
  app.route('/v1/email', createEmailRoutes(db));

  // Mount domain routes
  app.route('/v1/domains', createDomainRoutes(db));

  // Mount suppression routes
  app.route('/v1/suppressions', createSuppressionRoutes(db));

  // Mount webhook routes
  app.route('/v1/webhooks', createWebhookRoutes(db));

  // Placeholder routes to verify mounting works
  app.get('/v1/status', (c) => {
    const auth = c.get('auth') as AuthContext;
    return c.json({
      authenticated: true,
      apiKeyId: auth.apiKey.id,
      apiKeyName: auth.apiKey.name,
    });
  });

  return app;
}

/**
 * Main server startup
 */
async function main(): Promise<void> {
  console.log('OpenSend API starting...');

  // Load configuration
  let config: Config;
  try {
    config = loadConfig();
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Port: ${config.port}`);
    console.log(`Rate limit default: ${config.rateLimitPerSecond}/s`);
  } catch (err) {
    console.error('Configuration error:', (err as Error).message);
    process.exit(1);
  }

  // Initialize database client
  let db: DatabaseClient;
  try {
    db = createDatabaseClient({
      connectionUrl: config.databaseUrl,
      debug: config.nodeEnv === 'development',
    });
    console.log('Database client initialized');
  } catch (err) {
    console.error('Database initialization error:', (err as Error).message);
    process.exit(1);
  }

  // Create Hono app
  const app = createApp(db, config);

  // Graceful shutdown handler
  let isShuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n${signal} received, shutting down...`);

    try {
      await db.close();
      console.log('Database connection closed');
    } catch (err) {
      console.error('Error closing database:', (err as Error).message);
    }

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start server
  serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    (info) => {
      console.log(`OpenSend API listening on http://localhost:${info.port}`);
    }
  );
}

// Start the server
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Export for testing
export { createApp };
