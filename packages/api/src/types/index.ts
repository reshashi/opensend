/**
 * API-specific types for OpenSend
 */

import type { ApiKey } from '@opensend/shared';

/**
 * API error response format
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    field?: string;
  };
}

/**
 * Extended request context with authenticated API key
 */
export interface AuthContext {
  apiKey: ApiKey;
}

/**
 * Rate limit bucket for token bucket algorithm
 */
export interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
  limit: number;
}

/**
 * Cached idempotency response
 */
export interface IdempotencyEntry {
  messageId: string;
  status: string;
  createdAt: number;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  database?: 'connected' | 'disconnected';
}
