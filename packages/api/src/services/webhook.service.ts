/**
 * Webhook Service
 * Business logic for webhook management
 */

import { randomBytes } from 'crypto';
import type {
  DatabaseClient,
  Result,
  ApiKeyId,
  Webhook,
  WebhookEvent,
} from '@opensend/shared';
import { ok, err, ValidationError, RecordNotFoundError, toWebhookId } from '@opensend/shared';

// ============================================================================
// Types
// ============================================================================

export interface WebhookCreateResult {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
}

export interface WebhookListItem {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  created_at: string;
}

// ============================================================================
// Constants
// ============================================================================

const VALID_EVENTS: WebhookEvent[] = [
  'message.queued',
  'message.sent',
  'message.delivered',
  'message.bounced',
  'message.failed',
  'message.opened',
  'message.clicked',
  'complaint.received',
];

// ============================================================================
// Webhook Service
// ============================================================================

/**
 * Create webhook service with database client dependency
 */
export function createWebhookService(db: DatabaseClient) {
  /**
   * Generate webhook signing secret
   */
  function generateSecret(): string {
    // Generate 32-byte random secret with whsec_ prefix
    return `whsec_${randomBytes(24).toString('base64url')}`;
  }

  /**
   * Generate webhook ID with prefix
   */
  function generateWebhookId(): string {
    return `whk_${randomBytes(12).toString('base64url')}`;
  }

  /**
   * Validate webhook URL
   */
  function validateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      // Only allow HTTPS in production
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  /**
   * Validate event types
   */
  function validateEvents(events: string[]): events is WebhookEvent[] {
    return events.every((e) => VALID_EVENTS.includes(e as WebhookEvent));
  }

  /**
   * Create a new webhook
   */
  async function create(
    apiKeyId: ApiKeyId,
    url: string,
    events: string[]
  ): Promise<Result<WebhookCreateResult, Error>> {
    // Validate URL
    if (!validateUrl(url)) {
      return err(new ValidationError('Invalid webhook URL', 'url'));
    }

    // Validate events
    if (!events || events.length === 0) {
      return err(new ValidationError('At least one event is required', 'events'));
    }

    if (!validateEvents(events)) {
      return err(
        new ValidationError(
          `Invalid event type. Valid events: ${VALID_EVENTS.join(', ')}`,
          'events'
        )
      );
    }

    // Generate ID and secret
    const id = generateWebhookId();
    const secret = generateSecret();

    // Create webhook
    const result = await db.webhooks.create({
      id,
      api_key_id: apiKeyId,
      url,
      events: events as WebhookEvent[],
      secret,
      active: true,
    });

    if (!result.ok) {
      return err(result.error);
    }

    return ok({
      id: result.value.id,
      url: result.value.url,
      events: result.value.events,
      secret: result.value.secret,
    });
  }

  /**
   * List all webhooks for an API key
   */
  async function list(apiKeyId: ApiKeyId): Promise<Result<WebhookListItem[], Error>> {
    const result = await db.webhooks.findActiveByApiKey(apiKeyId);
    if (!result.ok) {
      return err(result.error);
    }

    const items: WebhookListItem[] = result.value.map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events,
      active: w.active,
      created_at: w.createdAt.toISOString(),
    }));

    return ok(items);
  }

  /**
   * Get a specific webhook
   */
  async function get(
    apiKeyId: ApiKeyId,
    webhookId: string
  ): Promise<Result<Webhook, Error>> {
    const result = await db.webhooks.findById(toWebhookId(webhookId));
    if (!result.ok) {
      return err(result.error);
    }

    if (!result.value) {
      return err(new RecordNotFoundError('Webhook', webhookId));
    }

    // Verify ownership
    if (result.value.apiKeyId !== apiKeyId) {
      return err(new RecordNotFoundError('Webhook', webhookId));
    }

    return ok(result.value);
  }

  /**
   * Delete a webhook
   */
  async function remove(
    apiKeyId: ApiKeyId,
    webhookId: string
  ): Promise<Result<boolean, Error>> {
    // Verify ownership first
    const getResult = await get(apiKeyId, webhookId);
    if (!getResult.ok) {
      return err(getResult.error);
    }

    // Delete webhook
    const deleteResult = await db.webhooks.delete(toWebhookId(webhookId));
    return deleteResult;
  }

  /**
   * Update webhook (enable/disable, change events, etc.)
   */
  async function update(
    apiKeyId: ApiKeyId,
    webhookId: string,
    data: { url?: string; events?: string[]; active?: boolean }
  ): Promise<Result<Webhook, Error>> {
    // Verify ownership first
    const getResult = await get(apiKeyId, webhookId);
    if (!getResult.ok) {
      return err(getResult.error);
    }

    // Validate updates
    if (data.url && !validateUrl(data.url)) {
      return err(new ValidationError('Invalid webhook URL', 'url'));
    }

    if (data.events) {
      if (data.events.length === 0) {
        return err(new ValidationError('At least one event is required', 'events'));
      }
      if (!validateEvents(data.events)) {
        return err(
          new ValidationError(
            `Invalid event type. Valid events: ${VALID_EVENTS.join(', ')}`,
            'events'
          )
        );
      }
    }

    // Build update object
    const updateData: { url?: string; events?: WebhookEvent[]; active?: boolean } = {};
    if (data.url) updateData.url = data.url;
    if (data.events) updateData.events = data.events as WebhookEvent[];
    if (data.active !== undefined) updateData.active = data.active;

    // Update webhook
    const updateResult = await db.webhooks.update(toWebhookId(webhookId), updateData);
    if (!updateResult.ok) {
      return err(updateResult.error);
    }

    if (!updateResult.value) {
      return err(new RecordNotFoundError('Webhook', webhookId));
    }

    return ok(updateResult.value);
  }

  return {
    create,
    list,
    get,
    remove,
    update,
    generateSecret,
  };
}

export type WebhookService = ReturnType<typeof createWebhookService>;
