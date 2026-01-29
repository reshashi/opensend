/**
 * Services exports for MailForge API
 */

export {
  createDomainService,
  type DomainService,
  type DomainVerifyResult,
  type DomainCheckResult,
  type DkimKeyPair,
} from './domain.service.js';

export {
  createSuppressionService,
  type SuppressionService,
  type SuppressionListFilters,
  type SuppressionListResult,
  type SuppressionItem,
} from './suppression.service.js';

export {
  createWebhookService,
  type WebhookService,
  type WebhookCreateResult,
  type WebhookListItem,
} from './webhook.service.js';

export {
  createQueueService,
  type QueueService,
  type QueueError,
} from './queue.service.js';

export {
  createEmailService,
  type EmailService,
  type SendEmailRequest,
  type SendEmailResponse,
  type EmailStatusResponse,
  type EmailServiceError,
  type BatchEmailRequest,
  type BatchEmailResponseItem,
} from './email.service.js';
