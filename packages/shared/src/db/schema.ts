/**
 * Database schema type definitions for MailForge
 * These types match the PostgreSQL schema exactly for type-safe database operations
 */

import type {
  MessageType,
  MessageStatus,
  SuppressionReason,
  WebhookEvent,
  WebhookDeliveryStatus,
} from '../types.js';

// ============================================================================
// Database Row Types (snake_case to match PostgreSQL)
// ============================================================================

/**
 * api_keys table row
 */
export interface ApiKeyRow {
  id: string;
  key_hash: string;
  name: string;
  rate_limit_per_second: number;
  created_at: Date;
  last_used_at: Date | null;
}

/**
 * domains table row
 */
export interface DomainRow {
  id: string;
  api_key_id: string;
  domain: string;
  verified: boolean;
  dkim_selector: string;
  dkim_private_key: string | null;
  created_at: Date;
  verified_at: Date | null;
}

/**
 * messages table row
 */
export interface MessageRow {
  id: string;
  api_key_id: string;
  idempotency_key: string | null;
  type: string;
  status: string;
  from_address: string;
  to_address: string;
  subject: string | null;
  body: string | null;
  html_body: string | null;
  metadata: Record<string, unknown> | null;
  attempts: number;
  created_at: Date;
  sent_at: Date | null;
  delivered_at: Date | null;
  failed_at: Date | null;
  failure_reason: string | null;
}

/**
 * suppressions table row
 */
export interface SuppressionRow {
  id: string;
  api_key_id: string;
  email: string;
  reason: string;
  created_at: Date;
}

/**
 * webhooks table row
 */
export interface WebhookRow {
  id: string;
  api_key_id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  created_at: Date;
}

/**
 * webhook_deliveries table row
 */
export interface WebhookDeliveryRow {
  id: string;
  webhook_id: string;
  message_id: string | null;
  event: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  last_attempt_at: Date | null;
  created_at: Date;
}

// ============================================================================
// Insert Types (for creating new records)
// ============================================================================

export interface ApiKeyInsert {
  id?: string;
  key_hash: string;
  name: string;
  rate_limit_per_second?: number;
  created_at?: Date;
  last_used_at?: Date | null;
}

export interface DomainInsert {
  id?: string;
  api_key_id: string;
  domain: string;
  verified?: boolean;
  dkim_selector: string;
  dkim_private_key?: string | null;
  created_at?: Date;
  verified_at?: Date | null;
}

export interface MessageInsert {
  id?: string;
  api_key_id: string;
  idempotency_key?: string | null;
  type: MessageType;
  status?: MessageStatus;
  from_address: string;
  to_address: string;
  subject?: string | null;
  body?: string | null;
  html_body?: string | null;
  metadata?: Record<string, unknown> | null;
  attempts?: number;
  created_at?: Date;
  sent_at?: Date | null;
  delivered_at?: Date | null;
  failed_at?: Date | null;
  failure_reason?: string | null;
}

export interface SuppressionInsert {
  id?: string;
  api_key_id: string;
  email: string;
  reason: SuppressionReason;
  created_at?: Date;
}

export interface WebhookInsert {
  id?: string;
  api_key_id: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
  active?: boolean;
  created_at?: Date;
}

export interface WebhookDeliveryInsert {
  id?: string;
  webhook_id: string;
  message_id?: string | null;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  status?: WebhookDeliveryStatus;
  attempts?: number;
  last_attempt_at?: Date | null;
  created_at?: Date;
}

// ============================================================================
// Update Types (for partial updates)
// ============================================================================

export interface ApiKeyUpdate {
  name?: string;
  rate_limit_per_second?: number;
  last_used_at?: Date | null;
}

export interface DomainUpdate {
  verified?: boolean;
  dkim_private_key?: string | null;
  verified_at?: Date | null;
}

export interface MessageUpdate {
  status?: MessageStatus;
  attempts?: number;
  sent_at?: Date | null;
  delivered_at?: Date | null;
  failed_at?: Date | null;
  failure_reason?: string | null;
}

export interface SuppressionUpdate {
  reason?: SuppressionReason;
}

export interface WebhookUpdate {
  url?: string;
  events?: WebhookEvent[];
  active?: boolean;
}

export interface WebhookDeliveryUpdate {
  status?: WebhookDeliveryStatus;
  attempts?: number;
  last_attempt_at?: Date | null;
}

// ============================================================================
// Row to Entity Mappers
// ============================================================================

import {
  toApiKeyId,
  toDomainId,
  toMessageId,
  toSuppressionId,
  toWebhookId,
  toWebhookDeliveryId,
  type ApiKey,
  type Domain,
  type Message,
  type Suppression,
  type Webhook,
  type WebhookDelivery,
} from '../types.js';

/**
 * Convert database row to ApiKey entity
 */
export function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: toApiKeyId(row.id),
    keyHash: row.key_hash,
    name: row.name,
    rateLimitPerSecond: row.rate_limit_per_second,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/**
 * Convert database row to Domain entity
 */
export function toDomain(row: DomainRow): Domain {
  return {
    id: toDomainId(row.id),
    apiKeyId: toApiKeyId(row.api_key_id),
    domain: row.domain,
    verified: row.verified,
    dkimSelector: row.dkim_selector,
    dkimPrivateKey: row.dkim_private_key,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
  };
}

/**
 * Convert database row to Message entity
 */
export function toMessage(row: MessageRow): Message {
  return {
    id: toMessageId(row.id),
    apiKeyId: toApiKeyId(row.api_key_id),
    idempotencyKey: row.idempotency_key,
    type: row.type as MessageType,
    status: row.status as MessageStatus,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    subject: row.subject,
    body: row.body,
    htmlBody: row.html_body,
    metadata: row.metadata,
    attempts: row.attempts,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    failedAt: row.failed_at,
    failureReason: row.failure_reason,
  };
}

/**
 * Convert database row to Suppression entity
 */
export function toSuppression(row: SuppressionRow): Suppression {
  return {
    id: toSuppressionId(row.id),
    apiKeyId: toApiKeyId(row.api_key_id),
    email: row.email,
    reason: row.reason as SuppressionReason,
    createdAt: row.created_at,
  };
}

/**
 * Convert database row to Webhook entity
 */
export function toWebhook(row: WebhookRow): Webhook {
  return {
    id: toWebhookId(row.id),
    apiKeyId: toApiKeyId(row.api_key_id),
    url: row.url,
    events: row.events as WebhookEvent[],
    secret: row.secret,
    active: row.active,
    createdAt: row.created_at,
  };
}

/**
 * Convert database row to WebhookDelivery entity
 */
export function toWebhookDelivery(row: WebhookDeliveryRow): WebhookDelivery {
  return {
    id: toWebhookDeliveryId(row.id),
    webhookId: toWebhookId(row.webhook_id),
    messageId: row.message_id ? toMessageId(row.message_id) : null,
    event: row.event as WebhookEvent,
    payload: row.payload,
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts,
    lastAttemptAt: row.last_attempt_at,
    createdAt: row.created_at,
  };
}

// ============================================================================
// Table Names (for use in queries)
// ============================================================================

export const Tables = {
  API_KEYS: 'api_keys',
  DOMAINS: 'domains',
  MESSAGES: 'messages',
  SUPPRESSIONS: 'suppressions',
  WEBHOOKS: 'webhooks',
  WEBHOOK_DELIVERIES: 'webhook_deliveries',
} as const;

// ============================================================================
// Notification Channels (for LISTEN/NOTIFY)
// ============================================================================

export const Channels = {
  MESSAGE_QUEUED: 'message_queued',
  WEBHOOK_PENDING: 'webhook_pending',
} as const;
