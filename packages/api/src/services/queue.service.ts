/**
 * Queue Service
 * Handles message queue operations for email/SMS delivery
 */

import type { DatabaseClient, Message, ApiKeyId, MessageId } from '@opensend/shared';
import type { Result } from '@opensend/shared';
import { ok, err } from '@opensend/shared';
import type { MessageInsert } from '@opensend/shared';

/**
 * Error returned by queue operations
 */
export interface QueueError {
  code: string;
  message: string;
  statusCode: number;
}

/**
 * Queue service for message operations
 */
export interface QueueService {
  /**
   * Enqueue a new message for delivery
   */
  enqueue(message: MessageInsert): Promise<Result<Message, QueueError>>;

  /**
   * Get message status by ID
   */
  getStatus(apiKeyId: ApiKeyId, messageId: MessageId): Promise<Result<Message | null, QueueError>>;

  /**
   * Check if an idempotency key has been used
   */
  checkIdempotency(apiKeyId: ApiKeyId, key: string): Promise<Result<Message | null, QueueError>>;
}

/**
 * Create a queue service instance
 */
export function createQueueService(db: DatabaseClient): QueueService {
  return {
    async enqueue(message: MessageInsert): Promise<Result<Message, QueueError>> {
      const result = await db.messages.create(message);

      if (!result.ok) {
        return err({
          code: result.error.code,
          message: result.error.message,
          statusCode: result.error.statusCode,
        });
      }

      return ok(result.value);
    },

    async getStatus(apiKeyId: ApiKeyId, messageId: MessageId): Promise<Result<Message | null, QueueError>> {
      const result = await db.messages.findById(messageId);

      if (!result.ok) {
        return err({
          code: result.error.code,
          message: result.error.message,
          statusCode: result.error.statusCode,
        });
      }

      // Verify the message belongs to this API key
      if (result.value && result.value.apiKeyId !== apiKeyId) {
        return ok(null);
      }

      return ok(result.value);
    },

    async checkIdempotency(apiKeyId: ApiKeyId, key: string): Promise<Result<Message | null, QueueError>> {
      const result = await db.messages.findByIdempotencyKey(apiKeyId, key);

      if (!result.ok) {
        return err({
          code: result.error.code,
          message: result.error.message,
          statusCode: result.error.statusCode,
        });
      }

      return ok(result.value);
    },
  };
}
