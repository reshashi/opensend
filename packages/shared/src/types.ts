/**
 * Shared TypeScript types for OpenSend
 * Uses branded types for type-safe IDs
 */

// ============================================================================
// Branded Types for Type-Safe IDs
// ============================================================================

/**
 * Brand type for compile-time ID safety
 * Prevents mixing up different ID types (e.g., MessageId vs ApiKeyId)
 */
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type ApiKeyId = Brand<string, 'ApiKeyId'>;
export type DomainId = Brand<string, 'DomainId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type SuppressionId = Brand<string, 'SuppressionId'>;
export type WebhookId = Brand<string, 'WebhookId'>;
export type WebhookDeliveryId = Brand<string, 'WebhookDeliveryId'>;

/**
 * Helper to create branded IDs
 * Use this when you receive an ID from the database or external source
 */
export function toApiKeyId(id: string): ApiKeyId {
  return id as ApiKeyId;
}

export function toDomainId(id: string): DomainId {
  return id as DomainId;
}

export function toMessageId(id: string): MessageId {
  return id as MessageId;
}

export function toSuppressionId(id: string): SuppressionId {
  return id as SuppressionId;
}

export function toWebhookId(id: string): WebhookId {
  return id as WebhookId;
}

export function toWebhookDeliveryId(id: string): WebhookDeliveryId {
  return id as WebhookDeliveryId;
}

// ============================================================================
// Enums and Constants
// ============================================================================

/**
 * Message types supported by OpenSend
 */
export const MessageType = {
  EMAIL: 'email',
  SMS: 'sms',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

/**
 * Message status lifecycle
 */
export const MessageStatus = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  SENT: 'sent',
  DELIVERED: 'delivered',
  BOUNCED: 'bounced',
  FAILED: 'failed',
  REJECTED: 'rejected',
} as const;

export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

/**
 * Suppression reasons
 */
export const SuppressionReason = {
  HARD_BOUNCE: 'hard_bounce',
  SOFT_BOUNCE: 'soft_bounce',
  COMPLAINT: 'complaint',
  UNSUBSCRIBE: 'unsubscribe',
  MANUAL: 'manual',
} as const;

export type SuppressionReason =
  (typeof SuppressionReason)[keyof typeof SuppressionReason];

/**
 * Webhook event types
 */
export const WebhookEvent = {
  MESSAGE_QUEUED: 'message.queued',
  MESSAGE_SENT: 'message.sent',
  MESSAGE_DELIVERED: 'message.delivered',
  MESSAGE_BOUNCED: 'message.bounced',
  MESSAGE_FAILED: 'message.failed',
  MESSAGE_OPENED: 'message.opened',
  MESSAGE_CLICKED: 'message.clicked',
  COMPLAINT_RECEIVED: 'complaint.received',
} as const;

export type WebhookEvent = (typeof WebhookEvent)[keyof typeof WebhookEvent];

/**
 * Webhook delivery status
 */
export const WebhookDeliveryStatus = {
  PENDING: 'pending',
  DELIVERED: 'delivered',
  FAILED: 'failed',
} as const;

export type WebhookDeliveryStatus =
  (typeof WebhookDeliveryStatus)[keyof typeof WebhookDeliveryStatus];

// ============================================================================
// Database Entity Types
// ============================================================================

/**
 * API Key entity
 */
export interface ApiKey {
  id: ApiKeyId;
  keyHash: string;
  name: string;
  rateLimitPerSecond: number;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * Domain entity
 */
export interface Domain {
  id: DomainId;
  apiKeyId: ApiKeyId;
  domain: string;
  verified: boolean;
  dkimSelector: string;
  dkimPrivateKey: string | null;
  createdAt: Date;
  verifiedAt: Date | null;
}

/**
 * Message entity (email or SMS)
 */
export interface Message {
  id: MessageId;
  apiKeyId: ApiKeyId;
  idempotencyKey: string | null;
  type: MessageType;
  status: MessageStatus;
  fromAddress: string;
  toAddress: string;
  subject: string | null;
  body: string | null;
  htmlBody: string | null;
  metadata: Record<string, unknown> | null;
  attempts: number;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
}

/**
 * Suppression entry (bounced/complained emails)
 */
export interface Suppression {
  id: SuppressionId;
  apiKeyId: ApiKeyId;
  email: string;
  reason: SuppressionReason;
  createdAt: Date;
}

/**
 * Webhook registration
 */
export interface Webhook {
  id: WebhookId;
  apiKeyId: ApiKeyId;
  url: string;
  events: WebhookEvent[];
  secret: string;
  active: boolean;
  createdAt: Date;
}

/**
 * Webhook delivery attempt
 */
export interface WebhookDelivery {
  id: WebhookDeliveryId;
  webhookId: WebhookId;
  messageId: MessageId | null;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  createdAt: Date;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/**
 * Send email request
 */
export interface SendEmailRequest {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Send email response
 */
export interface SendEmailResponse {
  messageId: MessageId;
  status: MessageStatus;
}

/**
 * Send SMS request
 */
export interface SendSmsRequest {
  from: string;
  to: string;
  body: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Send SMS response
 */
export interface SendSmsResponse {
  messageId: MessageId;
  status: MessageStatus;
}

/**
 * Message status response
 */
export interface MessageStatusResponse {
  id: MessageId;
  status: MessageStatus;
  attempts: number;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
}

/**
 * Domain verification request
 */
export interface AddDomainRequest {
  domain: string;
}

/**
 * Domain verification response with DNS records
 */
export interface AddDomainResponse {
  id: DomainId;
  domain: string;
  verified: boolean;
  dnsRecords: DnsRecord[];
}

/**
 * DNS record for domain verification
 */
export interface DnsRecord {
  type: 'TXT' | 'CNAME' | 'MX';
  name: string;
  value: string;
  priority?: number;
}

/**
 * Webhook registration request
 */
export interface CreateWebhookRequest {
  url: string;
  events: WebhookEvent[];
}

/**
 * Webhook registration response
 */
export interface CreateWebhookResponse {
  id: WebhookId;
  url: string;
  events: WebhookEvent[];
  secret: string;
  active: boolean;
}

// ============================================================================
// Webhook Payload Types
// ============================================================================

/**
 * Base webhook payload
 */
export interface WebhookPayloadBase {
  event: WebhookEvent;
  timestamp: string;
  messageId: MessageId;
}

/**
 * Message status change payload
 */
export interface MessageStatusPayload extends WebhookPayloadBase {
  event:
    | typeof WebhookEvent.MESSAGE_QUEUED
    | typeof WebhookEvent.MESSAGE_SENT
    | typeof WebhookEvent.MESSAGE_DELIVERED
    | typeof WebhookEvent.MESSAGE_BOUNCED
    | typeof WebhookEvent.MESSAGE_FAILED;
  status: MessageStatus;
  failureReason?: string;
}

/**
 * Message engagement payload (open/click)
 */
export interface MessageEngagementPayload extends WebhookPayloadBase {
  event:
    | typeof WebhookEvent.MESSAGE_OPENED
    | typeof WebhookEvent.MESSAGE_CLICKED;
  userAgent?: string;
  ipAddress?: string;
  clickedUrl?: string;
}

/**
 * Complaint payload
 */
export interface ComplaintPayload extends WebhookPayloadBase {
  event: typeof WebhookEvent.COMPLAINT_RECEIVED;
  complaintType: string;
}

export type WebhookPayload =
  | MessageStatusPayload
  | MessageEngagementPayload
  | ComplaintPayload;

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Pagination parameters
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Date range filter
 */
export interface DateRange {
  from?: Date;
  to?: Date;
}

/**
 * Message filter for queries
 */
export interface MessageFilter extends PaginationParams, DateRange {
  status?: MessageStatus;
  type?: MessageType;
  toAddress?: string;
}
