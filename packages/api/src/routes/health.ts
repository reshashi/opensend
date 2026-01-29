/**
 * Health Check Route
 * Provides system health status for monitoring and load balancers
 */

import { Hono } from 'hono';
import type { DatabaseClient } from '@opensend/shared';
import type { HealthResponse } from '../types/index.js';

/**
 * Create health check routes
 */
export function createHealthRoutes(db: DatabaseClient): Hono {
  const app = new Hono();

  /**
   * GET /health
   * Returns system health status
   */
  app.get('/', async (c) => {
    const timestamp = new Date().toISOString();

    // Check database connectivity
    let dbStatus: 'connected' | 'disconnected' = 'disconnected';
    try {
      // Simple query to verify connection
      await db.sql`SELECT 1`;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }

    const status = dbStatus === 'connected' ? 'ok' : 'degraded';

    const response: HealthResponse = {
      status,
      timestamp,
      database: dbStatus,
    };

    const statusCode = status === 'ok' ? 200 : 503;
    return c.json(response, statusCode);
  });

  /**
   * GET /health/live
   * Liveness probe - always returns 200 if server is running
   */
  app.get('/live', (c) => {
    return c.json({ status: 'ok' }, 200);
  });

  /**
   * GET /health/ready
   * Readiness probe - returns 200 only if all dependencies are healthy
   */
  app.get('/ready', async (c) => {
    try {
      await db.sql`SELECT 1`;
      return c.json({ status: 'ready' }, 200);
    } catch {
      return c.json({ status: 'not_ready' }, 503);
    }
  });

  return app;
}
