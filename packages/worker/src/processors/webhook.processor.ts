/**
 * Webhook Processor
 * Claims pending webhook deliveries and dispatches them to registered URLs
 */

import { createHmac } from 'crypto';
import type {
  DatabaseClient,
  WebhookDelivery,
  WebhookDeliveryId,
  Webhook,
} from '@opensend/shared';
import { WebhookDeliveryStatus } from '@opensend/shared';
import type { WorkerConfig } from '../config.js';

// ============================================================================
// Types
// ============================================================================

export interface WebhookProcessorDependencies {
  db: DatabaseClient;
  config: WorkerConfig;
}

export interface WebhookProcessResult {
  deliveryId: WebhookDeliveryId;
  success: boolean;
  status: 'delivered' | 'failed' | 'pending';
  httpStatus?: number;
  error?: string;
  shouldRetry?: boolean;
}

export interface WebhookProcessor {
  /** Process the next available webhook delivery */
  processNext(): Promise<WebhookProcessResult | null>;
  
  /** Process multiple webhook deliveries concurrently */
  processBatch(count: number): Promise<WebhookProcessResult[]>;
  
  /** Check if there might be more deliveries to process */
  hasMore(): boolean;
}

// ============================================================================
// Signature Generation
// ============================================================================

/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
function generateSignature(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return hmac.digest('hex');
}

/**
 * Generate webhook headers including signature
 */
function generateWebhookHeaders(
  payload: string,
  secret: string,
  event: string
): Record<string, string> {
  const timestamp = Date.now().toString();
  const signatureData = `${timestamp}.${payload}`;
  const signature = generateSignature(signatureData, secret);

  return {
    'Content-Type': 'application/json',
    'X-OpenSend-Event': event,
    'X-OpenSend-Timestamp': timestamp,
    'X-OpenSend-Signature': `v1=${signature}`,
  };
}

// ============================================================================
// Webhook Processor Implementation
// ============================================================================

export function createWebhookProcessor(deps: WebhookProcessorDependencies): WebhookProcessor {
  const { db, config } = deps;
  const debug = config.debug;
  const maxRetries = config.maxWebhookRetries;

  // Track if we've recently found deliveries (for hasMore heuristic)
  let recentlyFoundDeliveries = true;

  /**
   * Log debug message
   */
  function log(message: string, data?: Record<string, unknown>): void {
    if (debug) {
      if (data) {
        console.log(`[WebhookProcessor] ${message}`, data);
      } else {
        console.log(`[WebhookProcessor] ${message}`);
      }
    }
  }

  /**
   * Calculate exponential backoff delay for retry
   */
  function calculateBackoff(attempts: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const baseDelay = 1000;
    const exponentialDelay = baseDelay * Math.pow(2, attempts);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * Fetch webhook configuration by ID
   */
  async function getWebhook(webhookId: string): Promise<Webhook | null> {
    const result = await db.webhooks.findById(webhookId as import('@opensend/shared').WebhookId);
    if (!result.ok) {
      log('Failed to fetch webhook', { id: webhookId, error: result.error.message });
      return null;
    }
    return result.value;
  }

  /**
   * Dispatch a webhook delivery
   */
  async function dispatchWebhook(
    delivery: WebhookDelivery,
    webhook: Webhook
  ): Promise<{ success: boolean; status?: number; error?: string }> {
    const payloadStr = JSON.stringify(delivery.payload);
    const headers = generateWebhookHeaders(payloadStr, webhook.secret, delivery.event);

    log('Dispatching webhook', {
      deliveryId: delivery.id,
      url: webhook.url,
      event: delivery.event,
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      log('Webhook response received', {
        deliveryId: delivery.id,
        status: response.status,
      });

      // 2xx responses are considered successful
      if (response.status >= 200 && response.status < 300) {
        return { success: true, status: response.status };
      }

      // Other responses are failures
      return {
        success: false,
        status: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    } catch (e) {
      const error = e as Error;
      
      if (error.name === 'AbortError') {
        return {
          success: false,
          error: 'Request timed out after 30 seconds',
        };
      }

      return {
        success: false,
        error: `Request failed: ${error.message}`,
      };
    }
  }

  /**
   * Process a single webhook delivery
   */
  async function processDelivery(delivery: WebhookDelivery): Promise<WebhookProcessResult> {
    const deliveryId = delivery.id;
    log('Processing webhook delivery', {
      id: deliveryId,
      webhookId: delivery.webhookId,
      event: delivery.event,
    });

    // Fetch webhook configuration
    const webhook = await getWebhook(delivery.webhookId);
    if (!webhook) {
      log('Webhook not found, marking as failed', { deliveryId });

      await db.webhookDeliveries.update(deliveryId, {
        status: WebhookDeliveryStatus.FAILED,
        attempts: delivery.attempts + 1,
        last_attempt_at: new Date(),
      });

      return {
        deliveryId,
        success: false,
        status: 'failed',
        error: 'Webhook configuration not found',
        shouldRetry: false,
      };
    }

    // Check if webhook is still active
    if (!webhook.active) {
      log('Webhook is inactive, marking as failed', { deliveryId });

      await db.webhookDeliveries.update(deliveryId, {
        status: WebhookDeliveryStatus.FAILED,
        attempts: delivery.attempts + 1,
        last_attempt_at: new Date(),
      });

      return {
        deliveryId,
        success: false,
        status: 'failed',
        error: 'Webhook is inactive',
        shouldRetry: false,
      };
    }

    // Dispatch the webhook
    const result = await dispatchWebhook(delivery, webhook);
    const newAttempts = delivery.attempts + 1;

    if (result.success) {
      log('Webhook delivered successfully', {
        deliveryId,
        httpStatus: result.status,
      });

      await db.webhookDeliveries.update(deliveryId, {
        status: WebhookDeliveryStatus.DELIVERED,
        attempts: newAttempts,
        last_attempt_at: new Date(),
      });

      return {
        deliveryId,
        success: true,
        status: 'delivered',
        httpStatus: result.status,
      };
    }

    // Handle failure
    const maxRetriesReached = newAttempts >= maxRetries;
    const shouldRetry = !maxRetriesReached;

    log('Webhook delivery failed', {
      deliveryId,
      error: result.error,
      httpStatus: result.status,
      attempts: newAttempts,
      maxRetries,
      shouldRetry,
    });

    if (shouldRetry) {
      const backoffMs = calculateBackoff(newAttempts);
      log('Scheduling retry', { deliveryId, backoffMs, attempt: newAttempts });

      await db.webhookDeliveries.update(deliveryId, {
        status: WebhookDeliveryStatus.PENDING,
        attempts: newAttempts,
        last_attempt_at: new Date(),
      });

      return {
        deliveryId,
        success: false,
        status: 'pending',
        httpStatus: result.status,
        error: result.error,
        shouldRetry: true,
      };
    }

    // Max retries reached - mark as failed
    log('Max retries reached, marking as failed', { deliveryId });

    await db.webhookDeliveries.update(deliveryId, {
      status: WebhookDeliveryStatus.FAILED,
      attempts: newAttempts,
      last_attempt_at: new Date(),
    });

    return {
      deliveryId,
      success: false,
      status: 'failed',
      httpStatus: result.status,
      error: result.error,
      shouldRetry: false,
    };
  }

  return {
    async processNext(): Promise<WebhookProcessResult | null> {
      // Claim the next delivery atomically
      const claimResult = await db.webhookDeliveries.claimNext();

      if (!claimResult.ok) {
        log('Failed to claim delivery', { error: claimResult.error.message });
        return null;
      }

      const delivery = claimResult.value;
      if (!delivery) {
        log('No deliveries available to process');
        recentlyFoundDeliveries = false;
        return null;
      }

      recentlyFoundDeliveries = true;
      log('Claimed delivery', { id: delivery.id, event: delivery.event });

      try {
        return await processDelivery(delivery);
      } catch (e) {
        const error = e as Error;
        log('Unexpected error processing delivery', {
          id: delivery.id,
          error: error.message,
        });

        // Try to update delivery with error
        try {
          await db.webhookDeliveries.update(delivery.id, {
            status: WebhookDeliveryStatus.PENDING,
            attempts: delivery.attempts + 1,
            last_attempt_at: new Date(),
          });
        } catch {
          log('Failed to update delivery after error', { id: delivery.id });
        }

        return {
          deliveryId: delivery.id,
          success: false,
          status: 'pending',
          error: error.message,
          shouldRetry: true,
        };
      }
    },

    async processBatch(count: number): Promise<WebhookProcessResult[]> {
      const results: WebhookProcessResult[] = [];
      const promises: Promise<WebhookProcessResult | null>[] = [];

      // Start concurrent processing up to the specified count
      for (let i = 0; i < count; i++) {
        promises.push(this.processNext());
      }

      // Wait for all to complete
      const settled = await Promise.allSettled(promises);

      for (const result of settled) {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        }
      }

      return results;
    },

    hasMore(): boolean {
      return recentlyFoundDeliveries;
    },
  };
}

/**
 * Create a webhook processor from dependencies
 */
export function createWebhookProcessorFromDeps(
  db: DatabaseClient,
  config: WorkerConfig
): WebhookProcessor {
  return createWebhookProcessor({ db, config });
}
