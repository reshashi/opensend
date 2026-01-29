/**
 * API Server Configuration
 * Loads and validates environment variables at startup
 */

import { createHash } from 'crypto';

export interface Config {
  /** Server port */
  port: number;
  /** Database connection URL */
  databaseUrl: string;
  /** Secret for hashing API keys */
  apiSecret: string;
  /** Default rate limit per second */
  rateLimitPerSecond: number;
  /** Environment (development/production) */
  nodeEnv: string;
}

/**
 * Load and validate configuration from environment
 * Fails fast on missing required variables
 */
export function loadConfig(): Config {
  const missing: string[] = [];

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    missing.push('DATABASE_URL');
  }

  const apiSecret = process.env.API_SECRET;
  if (!apiSecret) {
    missing.push('API_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    databaseUrl: databaseUrl!,
    apiSecret: apiSecret!,
    rateLimitPerSecond: parseInt(process.env.RATE_LIMIT_PER_SECOND ?? '100', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
}

/**
 * Hash an API key using SHA256
 */
export function hashApiKey(key: string, secret: string): string {
  return createHash('sha256')
    .update(key + secret)
    .digest('hex');
}
