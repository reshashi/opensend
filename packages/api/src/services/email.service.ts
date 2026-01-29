/**
 * Email Service
 * Business logic for email sending and status retrieval
 */

import type {
  DatabaseClient,
  MessageStatus,
  ApiKeyId,
  MessageType,
} from '@opensend/shared';
import type { Result } from '@opensend/shared';
import { ok, err, toMessageId } from '@opensend/shared';
import { createQueueService } from './queue.service.js';

/**
 * Email send request
 */
export interface SendEmailRequest {
  to: string;
  subject: string;
  body?: string;
  html?: string;
  from?: string;
  reply_to?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Email send response (token-efficient)
 */
export interface SendEmailResponse {
  id: string;
  status: MessageStatus;
}

/**
 * Email status response
 */
export interface EmailStatusResponse {
  id: string;
  status: MessageStatus;
  to: string;
  subject: string | null;
  created_at: string;
  sent_at: string | null;
}

/**
 * Service error
 */
export interface EmailServiceError {
  code: string;
  message: string;
  field?: string;
  statusCode: number;
}

/**
 * Batch send request item
 */
export interface BatchEmailRequest extends SendEmailRequest {
  idempotency_key?: string;
}

/**
 * Batch send response item
 */
export interface BatchEmailResponseItem {
  id?: string;
  status?: MessageStatus;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Email service interface
 */
export interface EmailService {
  /**
   * Send a single email
   */
  sendEmail(
    apiKeyId: ApiKeyId,
    request: SendEmailRequest,
    idempotencyKey?: string
  ): Promise<Result<SendEmailResponse, EmailServiceError>>;

  /**
   * Get email status by message ID
   */
  getEmailStatus(
    apiKeyId: ApiKeyId,
    messageId: string
  ): Promise<Result<EmailStatusResponse | null, EmailServiceError>>;

  /**
   * Send multiple emails in batch
   */
  batchSend(
    apiKeyId: ApiKeyId,
    requests: BatchEmailRequest[]
  ): Promise<BatchEmailResponseItem[]>;
}

/**
 * Default sender domain (used when from is not specified)
 */
const DEFAULT_FROM_DOMAIN = 'opensend.dev';

/**
 * Create an email service instance
 */
export function createEmailService(db: DatabaseClient): EmailService {
  const queueService = createQueueService(db);

  /**
   * Extract domain from email address
   */
  function extractDomain(email: string): string {
    const parts = email.split('@');
    return parts.length === 2 ? parts[1].toLowerCase() : '';
  }

  /**
   * Generate default from address
   */
  function getDefaultFromAddress(_apiKeyId: ApiKeyId): string {
    // Use a generic sender for now
    return `noreply@${DEFAULT_FROM_DOMAIN}`;
  }

  return {
    async sendEmail(
      apiKeyId: ApiKeyId,
      request: SendEmailRequest,
      idempotencyKey?: string
    ): Promise<Result<SendEmailResponse, EmailServiceError>> {
      // Check idempotency key first
      if (idempotencyKey) {
        const existingResult = await queueService.checkIdempotency(apiKeyId, idempotencyKey);
        if (!existingResult.ok) {
          return err({
            code: existingResult.error.code,
            message: existingResult.error.message,
            statusCode: existingResult.error.statusCode,
          });
        }
        if (existingResult.value) {
          // Return cached response
          return ok({
            id: existingResult.value.id,
            status: existingResult.value.status,
          });
        }
      }

      // Determine from address
      const fromAddress = request.from ?? getDefaultFromAddress(apiKeyId);

      // If custom from address provided, verify the domain
      if (request.from) {
        const domain = extractDomain(request.from);
        if (domain && domain !== DEFAULT_FROM_DOMAIN) {
          const domainResult = await db.domains.findByDomain(apiKeyId, domain);
          if (!domainResult.ok) {
            return err({
              code: 'DATABASE_ERROR',
              message: 'Failed to verify sender domain',
              statusCode: 500,
            });
          }
          if (!domainResult.value || !domainResult.value.verified) {
            return err({
              code: 'DOMAIN_NOT_VERIFIED',
              message: `Domain ${domain} is not verified`,
              field: 'from',
              statusCode: 403,
            });
          }
        }
      }

      // Check if recipient is suppressed
      const suppressionResult = await db.suppressions.isEmailSuppressed(
        apiKeyId,
        request.to.toLowerCase()
      );
      if (!suppressionResult.ok) {
        return err({
          code: 'DATABASE_ERROR',
          message: 'Failed to check suppression list',
          statusCode: 500,
        });
      }
      if (suppressionResult.value) {
        return err({
          code: 'EMAIL_SUPPRESSED',
          message: `Recipient ${request.to} is on the suppression list`,
          field: 'to',
          statusCode: 422,
        });
      }

      // Create message in queue
      const enqueueResult = await queueService.enqueue({
        api_key_id: apiKeyId,
        type: 'email' as MessageType,
        status: 'queued' as MessageStatus,
        from_address: fromAddress,
        to_address: request.to.toLowerCase(),
        subject: request.subject,
        body: request.body ?? null,
        html_body: request.html ?? null,
        metadata: request.metadata ?? null,
        idempotency_key: idempotencyKey ?? null,
      });

      if (!enqueueResult.ok) {
        return err({
          code: enqueueResult.error.code,
          message: enqueueResult.error.message,
          statusCode: enqueueResult.error.statusCode,
        });
      }

      return ok({
        id: enqueueResult.value.id,
        status: enqueueResult.value.status,
      });
    },

    async getEmailStatus(
      apiKeyId: ApiKeyId,
      messageId: string
    ): Promise<Result<EmailStatusResponse | null, EmailServiceError>> {
      const result = await queueService.getStatus(apiKeyId, toMessageId(messageId));

      if (!result.ok) {
        return err({
          code: result.error.code,
          message: result.error.message,
          statusCode: result.error.statusCode,
        });
      }

      if (!result.value) {
        return ok(null);
      }

      const message = result.value;
      return ok({
        id: message.id,
        status: message.status,
        to: message.toAddress,
        subject: message.subject,
        created_at: message.createdAt.toISOString(),
        sent_at: message.sentAt?.toISOString() ?? null,
      });
    },

    async batchSend(
      apiKeyId: ApiKeyId,
      requests: BatchEmailRequest[]
    ): Promise<BatchEmailResponseItem[]> {
      const results: BatchEmailResponseItem[] = [];

      // Process each request sequentially to maintain order
      // Could be parallelized for performance if needed
      for (const request of requests) {
        const result = await this.sendEmail(
          apiKeyId,
          request,
          request.idempotency_key
        );

        if (result.ok) {
          results.push({
            id: result.value.id,
            status: result.value.status,
          });
        } else {
          results.push({
            error: {
              code: result.error.code,
              message: result.error.message,
            },
          });
        }
      }

      return results;
    },
  };
}
