/**
 * Email Processor
 * Claims queued messages from the database and sends them via SMTP
 */

import type {
  DatabaseClient,
  Message,
  MessageId,
  ApiKeyId,
  WebhookEvent,
} from '@mailforge/shared';
import { MessageStatus, SuppressionReason } from '@mailforge/shared';
import type { SmtpClient, DkimConfig, SmtpError } from '../smtp/client.js';
import { isHardBounce } from '../smtp/client.js';
import type { WorkerConfig } from '../config.js';

// ============================================================================
// Types
// ============================================================================

export interface EmailProcessorDependencies {
  db: DatabaseClient;
  smtp: SmtpClient;
  config: WorkerConfig;
}

export interface ProcessResult {
  messageId: MessageId;
  success: boolean;
  status: 'sent' | 'failed' | 'queued' | 'rejected';
  error?: string;
  shouldRetry?: boolean;
}

export interface EmailProcessor {
  /** Process the next available message */
  processNext(): Promise<ProcessResult | null>;
  
  /** Process multiple messages concurrently */
  processBatch(count: number): Promise<ProcessResult[]>;
  
  /** Check if there might be more messages to process */
  hasMore(): boolean;
}

// ============================================================================
// Webhook Event Helpers
// ============================================================================

/**
 * Create a webhook event for message status changes
 */
async function triggerWebhookEvent(
  db: DatabaseClient,
  apiKeyId: ApiKeyId,
  messageId: MessageId,
  event: WebhookEvent,
  additionalPayload?: Record<string, unknown>,
  debug?: boolean
): Promise<void> {
  try {
    // Find active webhooks for this API key that subscribe to this event
    const webhooksResult = await db.webhooks.findActiveByApiKey(apiKeyId);
    if (!webhooksResult.ok || webhooksResult.value.length === 0) {
      return;
    }

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      messageId,
      ...additionalPayload,
    };

    // Create webhook deliveries for each matching webhook
    for (const webhook of webhooksResult.value) {
      if (webhook.events.includes(event)) {
        const result = await db.webhookDeliveries.create({
          webhook_id: webhook.id,
          message_id: messageId,
          event,
          payload,
          status: 'pending',
        });

        if (!result.ok && debug) {
          console.error('[EmailProcessor] Failed to create webhook delivery:', result.error);
        }
      }
    }
  } catch (e) {
    if (debug) {
      console.error('[EmailProcessor] Error triggering webhook event:', e);
    }
  }
}

// ============================================================================
// Email Processor Implementation
// ============================================================================

export function createEmailProcessor(deps: EmailProcessorDependencies): EmailProcessor {
  const { db, smtp, config } = deps;
  const debug = config.debug;

  // Track if we've recently found messages (for hasMore heuristic)
  let recentlyFoundMessages = true;

  /**
   * Log debug message
   */
  function log(message: string, data?: Record<string, unknown>): void {
    if (debug) {
      if (data) {
        console.log(`[EmailProcessor] ${message}`, data);
      } else {
        console.log(`[EmailProcessor] ${message}`);
      }
    }
  }

  /**
   * Calculate exponential backoff delay for retry
   */
  function calculateBackoff(attempts: number): number {
    // Exponential backoff: delay * 2^(attempts-1)
    // With jitter to prevent thundering herd
    const baseDelay = config.retryDelayMs;
    const exponentialDelay = baseDelay * Math.pow(2, attempts - 1);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.floor(exponentialDelay + jitter);
  }

  /**
   * Get DKIM configuration for a message's domain
   */
  async function getDkimConfig(message: Message): Promise<DkimConfig | undefined> {
    try {
      // Extract domain from sender address
      const fromDomain = message.fromAddress.split('@')[1];
      if (!fromDomain) {
        return undefined;
      }

      // Look up domain configuration
      const domainResult = await db.domains.findByDomain(message.apiKeyId, fromDomain);
      if (!domainResult.ok || !domainResult.value) {
        return undefined;
      }

      const domain = domainResult.value;
      if (!domain.verified || !domain.dkimPrivateKey) {
        return undefined;
      }

      return {
        domainName: domain.domain,
        selector: domain.dkimSelector,
        privateKey: domain.dkimPrivateKey,
      };
    } catch (e) {
      log('Failed to get DKIM config', { error: String(e) });
      return undefined;
    }
  }

  /**
   * Check if the recipient email is suppressed
   */
  async function checkSuppression(
    apiKeyId: ApiKeyId,
    email: string
  ): Promise<{ suppressed: boolean; reason?: string }> {
    const result = await db.suppressions.findByEmail(apiKeyId, email);
    if (!result.ok) {
      log('Failed to check suppression list', { error: result.error.message });
      return { suppressed: false };
    }

    if (result.value) {
      return {
        suppressed: true,
        reason: result.value.reason,
      };
    }

    return { suppressed: false };
  }

  /**
   * Add email to suppression list after hard bounce
   */
  async function addToSuppression(
    apiKeyId: ApiKeyId,
    email: string,
    reason: typeof SuppressionReason[keyof typeof SuppressionReason]
  ): Promise<void> {
    const result = await db.suppressions.create({
      api_key_id: apiKeyId,
      email,
      reason,
    });

    if (!result.ok) {
      log('Failed to add email to suppression list', {
        email,
        error: result.error.message,
      });
    } else {
      log('Added email to suppression list', { email, reason });
    }
  }

  /**
   * Process a single message
   */
  async function processMessage(message: Message): Promise<ProcessResult> {
    const messageId = message.id;
    log('Processing message', { id: messageId, to: message.toAddress });

    // Check suppression list before sending
    const suppression = await checkSuppression(message.apiKeyId, message.toAddress);
    if (suppression.suppressed) {
      log('Recipient is suppressed', {
        id: messageId,
        to: message.toAddress,
        reason: suppression.reason,
      });

      // Mark as rejected
      await db.messages.update(messageId, {
        status: MessageStatus.REJECTED,
        failed_at: new Date(),
        failure_reason: `Recipient suppressed: ${suppression.reason}`,
      });

      return {
        messageId,
        success: false,
        status: 'rejected',
        error: `Recipient suppressed: ${suppression.reason}`,
        shouldRetry: false,
      };
    }

    // Get DKIM configuration
    const dkimConfig = await getDkimConfig(message);

    // Send the email
    const sendResult = await smtp.send(
      {
        from: message.fromAddress,
        to: message.toAddress,
        subject: message.subject ?? '',
        text: message.body ?? undefined,
        html: message.htmlBody ?? undefined,
        messageId: `<${messageId}@mailforge>`,
      },
      dkimConfig
    );

    if (sendResult.success) {
      log('Email sent successfully', {
        id: messageId,
        smtpMessageId: sendResult.messageId,
      });

      // Update message status to sent
      await db.messages.update(messageId, {
        status: MessageStatus.SENT,
        sent_at: new Date(),
      });

      // Trigger webhook event
      await triggerWebhookEvent(
        db,
        message.apiKeyId,
        messageId,
        'message.sent',
        { smtpMessageId: sendResult.messageId },
        debug
      );

      return {
        messageId,
        success: true,
        status: 'sent',
      };
    }

    // Handle send failure
    const error = sendResult.error as SmtpError;
    const newAttempts = message.attempts + 1;
    const maxRetriesReached = newAttempts >= config.maxRetries;
    const shouldRetry = error.shouldRetry && !maxRetriesReached;

    log('Email send failed', {
      id: messageId,
      error: error.message,
      type: error.type,
      responseCode: error.responseCode,
      attempts: newAttempts,
      maxRetries: config.maxRetries,
      shouldRetry,
    });

    if (shouldRetry) {
      // Update for retry
      const backoffMs = calculateBackoff(newAttempts);
      log('Scheduling retry', { id: messageId, backoffMs, attempt: newAttempts });

      await db.messages.update(messageId, {
        status: MessageStatus.QUEUED,
        attempts: newAttempts,
        failure_reason: error.message,
      });

      return {
        messageId,
        success: false,
        status: 'queued',
        error: error.message,
        shouldRetry: true,
      };
    }

    // Permanent failure
    log('Email permanently failed', { id: messageId, error: error.message });

    // Update message status to failed
    await db.messages.update(messageId, {
      status: MessageStatus.FAILED,
      attempts: newAttempts,
      failed_at: new Date(),
      failure_reason: error.message,
    });

    // Check if this is a hard bounce and add to suppression
    if (isHardBounce(error)) {
      log('Hard bounce detected, adding to suppression', {
        id: messageId,
        to: message.toAddress,
        responseCode: error.responseCode,
      });

      await addToSuppression(
        message.apiKeyId,
        message.toAddress,
        SuppressionReason.HARD_BOUNCE
      );

      // Trigger bounced webhook
      await triggerWebhookEvent(
        db,
        message.apiKeyId,
        messageId,
        'message.bounced',
        {
          bounceType: 'hard',
          bounceCode: error.responseCode,
          bounceMessage: error.message,
        },
        debug
      );
    } else {
      // Trigger failed webhook
      await triggerWebhookEvent(
        db,
        message.apiKeyId,
        messageId,
        'message.failed',
        { failureReason: error.message },
        debug
      );
    }

    return {
      messageId,
      success: false,
      status: 'failed',
      error: error.message,
      shouldRetry: false,
    };
  }

  return {
    async processNext(): Promise<ProcessResult | null> {
      // Claim the next message atomically
      const claimResult = await db.messages.claimNext();
      
      if (!claimResult.ok) {
        log('Failed to claim message', { error: claimResult.error.message });
        return null;
      }

      const message = claimResult.value;
      if (!message) {
        log('No messages available to process');
        recentlyFoundMessages = false;
        return null;
      }

      recentlyFoundMessages = true;
      log('Claimed message', { id: message.id, status: message.status });

      try {
        return await processMessage(message);
      } catch (e) {
        const error = e as Error;
        log('Unexpected error processing message', {
          id: message.id,
          error: error.message,
        });

        // Try to update message with error
        try {
          await db.messages.update(message.id, {
            status: MessageStatus.QUEUED,
            attempts: message.attempts + 1,
            failure_reason: `Processing error: ${error.message}`,
          });
        } catch {
          log('Failed to update message after error', { id: message.id });
        }

        return {
          messageId: message.id,
          success: false,
          status: 'queued',
          error: error.message,
          shouldRetry: true,
        };
      }
    },

    async processBatch(count: number): Promise<ProcessResult[]> {
      const results: ProcessResult[] = [];
      const promises: Promise<ProcessResult | null>[] = [];

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
      return recentlyFoundMessages;
    },
  };
}

/**
 * Create an email processor from dependencies
 */
export function createEmailProcessorFromDeps(
  db: DatabaseClient,
  smtp: SmtpClient,
  config: WorkerConfig
): EmailProcessor {
  return createEmailProcessor({ db, smtp, config });
}
