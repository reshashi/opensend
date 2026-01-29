/**
 * PostgreSQL database client for MailForge
 * Uses the 'postgres' npm package for type-safe, performant database access
 */

import postgres, { type Sql } from 'postgres';
import {
  type Result,
  ok,
  err,
  MailForgeError,
} from '../errors.js';
import type {
  ApiKeyRow,
  DomainRow,
  MessageRow,
  SuppressionRow,
  WebhookRow,
  WebhookDeliveryRow,
  ApiKeyInsert,
  DomainInsert,
  MessageInsert,
  SuppressionInsert,
  WebhookInsert,
  WebhookDeliveryInsert,
  ApiKeyUpdate,
  DomainUpdate,
  MessageUpdate,
  WebhookUpdate,
  WebhookDeliveryUpdate,
} from './schema.js';
import {
  Tables,
  Channels,
  toApiKey,
  toDomain,
  toMessage,
  toSuppression,
  toWebhook,
  toWebhookDelivery,
} from './schema.js';
import type {
  ApiKey,
  Domain,
  Message,
  Suppression,
  Webhook,
  WebhookDelivery,
  MessageStatus,
  ApiKeyId,
  MessageId,
  WebhookId,
} from '../types.js';

// ============================================================================
// Database Error Types
// ============================================================================

/**
 * Database error class for all database operations
 */
export class DbError extends MailForgeError {
  readonly code: string;
  readonly statusCode: number;
  readonly isMailForgeError = true as const;

  constructor(
    message: string,
    code: string = 'DATABASE_ERROR',
    statusCode: number = 500,
    public readonly cause?: Error
  ) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }

  static connection(message: string = 'Failed to connect to database'): DbError {
    return new DbError(message, 'CONNECTION_ERROR', 503);
  }

  static notFound(entity: string, id?: string): DbError {
    const msg = id ? `${entity} with id ${id} not found` : `${entity} not found`;
    return new DbError(msg, 'RECORD_NOT_FOUND', 404);
  }

  static duplicate(entity: string, field: string): DbError {
    return new DbError(
      `${entity} with this ${field} already exists`,
      'DUPLICATE_RECORD',
      409
    );
  }

  static constraint(message: string, constraint?: string): DbError {
    return new DbError(
      constraint ? `${message} (constraint: ${constraint})` : message,
      'CONSTRAINT_VIOLATION',
      400
    );
  }
}

// ============================================================================
// Database Client Configuration
// ============================================================================

export interface DatabaseConfig {
  /** PostgreSQL connection URL (e.g., postgres://user:pass@host:5432/db) */
  connectionUrl: string;
  /** Maximum number of connections in the pool (default: 10) */
  maxConnections?: number;
  /** Connection idle timeout in seconds (default: 30) */
  idleTimeout?: number;
  /** Connection timeout in seconds (default: 10) */
  connectTimeout?: number;
  /** Enable SSL (default: based on URL) */
  ssl?: boolean | 'require' | 'prefer';
  /** Debug mode - logs all queries (default: false) */
  debug?: boolean;
}

export interface DatabaseClient {
  /** Raw SQL client for advanced queries */
  sql: Sql;
  
  // API Key operations
  apiKeys: {
    findByHash(keyHash: string): Promise<Result<ApiKey | null, DbError>>;
    findById(id: ApiKeyId): Promise<Result<ApiKey | null, DbError>>;
    create(data: ApiKeyInsert): Promise<Result<ApiKey, DbError>>;
    update(id: ApiKeyId, data: ApiKeyUpdate): Promise<Result<ApiKey | null, DbError>>;
    updateLastUsed(id: ApiKeyId): Promise<Result<void, DbError>>;
    delete(id: ApiKeyId): Promise<Result<boolean, DbError>>;
    list(): Promise<Result<ApiKey[], DbError>>;
  };

  // Domain operations
  domains: {
    findById(id: string): Promise<Result<Domain | null, DbError>>;
    findByDomain(apiKeyId: ApiKeyId, domain: string): Promise<Result<Domain | null, DbError>>;
    findByApiKey(apiKeyId: ApiKeyId): Promise<Result<Domain[], DbError>>;
    create(data: DomainInsert): Promise<Result<Domain, DbError>>;
    update(id: string, data: DomainUpdate): Promise<Result<Domain | null, DbError>>;
    delete(id: string): Promise<Result<boolean, DbError>>;
  };

  // Message operations
  messages: {
    findById(id: MessageId): Promise<Result<Message | null, DbError>>;
    findByIdempotencyKey(apiKeyId: ApiKeyId, key: string): Promise<Result<Message | null, DbError>>;
    create(data: MessageInsert): Promise<Result<Message, DbError>>;
    update(id: MessageId, data: MessageUpdate): Promise<Result<Message | null, DbError>>;
    claimNext(): Promise<Result<Message | null, DbError>>;
    countByStatus(apiKeyId: ApiKeyId, status: MessageStatus): Promise<Result<number, DbError>>;
    list(apiKeyId: ApiKeyId, options?: ListOptions): Promise<Result<Message[], DbError>>;
  };

  // Suppression operations
  suppressions: {
    findByEmail(apiKeyId: ApiKeyId, email: string): Promise<Result<Suppression | null, DbError>>;
    isEmailSuppressed(apiKeyId: ApiKeyId, email: string): Promise<Result<boolean, DbError>>;
    create(data: SuppressionInsert): Promise<Result<Suppression, DbError>>;
    delete(apiKeyId: ApiKeyId, email: string): Promise<Result<boolean, DbError>>;
    list(apiKeyId: ApiKeyId, options?: ListOptions): Promise<Result<Suppression[], DbError>>;
  };

  // Webhook operations
  webhooks: {
    findById(id: WebhookId): Promise<Result<Webhook | null, DbError>>;
    findActiveByApiKey(apiKeyId: ApiKeyId): Promise<Result<Webhook[], DbError>>;
    create(data: WebhookInsert): Promise<Result<Webhook, DbError>>;
    update(id: WebhookId, data: WebhookUpdate): Promise<Result<Webhook | null, DbError>>;
    delete(id: WebhookId): Promise<Result<boolean, DbError>>;
  };

  // Webhook delivery operations
  webhookDeliveries: {
    create(data: WebhookDeliveryInsert): Promise<Result<WebhookDelivery, DbError>>;
    update(id: string, data: WebhookDeliveryUpdate): Promise<Result<WebhookDelivery | null, DbError>>;
    claimNext(): Promise<Result<WebhookDelivery | null, DbError>>;
  };

  // Notification channel listeners
  listen: {
    onMessageQueued(callback: (payload: MessageQueuedPayload) => void): Promise<void>;
    onWebhookPending(callback: (payload: WebhookPendingPayload) => void): Promise<void>;
  };

  // Connection management
  close(): Promise<void>;
  isConnected(): boolean;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
}

export interface MessageQueuedPayload {
  id: string;
  type: string;
  api_key_id: string;
}

export interface WebhookPendingPayload {
  id: string;
  webhook_id: string;
}

// ============================================================================
// Database Client Factory
// ============================================================================

/**
 * Create a new database client from a connection URL
 */
export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  const sql = postgres(config.connectionUrl, {
    max: config.maxConnections ?? 10,
    idle_timeout: config.idleTimeout ?? 30,
    connect_timeout: config.connectTimeout ?? 10,
    ssl: config.ssl,
    debug: config.debug ? (_connection, query, parameters) => {
      console.log('[DB Query]', query);
      if (parameters?.length) console.log('[DB Params]', parameters);
    } : undefined,
    transform: {
      undefined: null,
    },
  });

  let connected = true;

  // Helper to wrap database errors
  async function withErrorHandling<T>(
    operation: () => Promise<T>,
    context?: string
  ): Promise<Result<T, DbError>> {
    try {
      const result = await operation();
      return ok(result);
    } catch (e) {
      const error = e as Error & { code?: string; constraint?: string };
      
      // Handle specific PostgreSQL error codes
      if (error.code === '23505') {
        // Unique violation
        return err(DbError.duplicate(
          context ?? 'Record',
          error.constraint ?? 'unknown'
        ));
      }
      if (error.code === '23503') {
        // Foreign key violation
        return err(DbError.constraint(
          error.message,
          error.constraint
        ));
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        connected = false;
        return err(DbError.connection(error.message));
      }
      
      return err(new DbError(error.message, 'DATABASE_ERROR', 500, error));
    }
  }

  // ============================================================================
  // API Key Operations
  // ============================================================================
  
  const apiKeys = {
    async findByHash(keyHash: string): Promise<Result<ApiKey | null, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<ApiKeyRow[]>`
          SELECT * FROM ${sql(Tables.API_KEYS)}
          WHERE key_hash = ${keyHash}
          LIMIT 1
        `;
        return rows.length > 0 ? toApiKey(rows[0]) : null;
      }, 'ApiKey');
    },

    async findById(id: ApiKeyId): Promise<Result<ApiKey | null, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<ApiKeyRow[]>`
          SELECT * FROM ${sql(Tables.API_KEYS)}
          WHERE id = ${id}
          LIMIT 1
        `;
        return rows.length > 0 ? toApiKey(rows[0]) : null;
      }, 'ApiKey');
    },

    async create(data: ApiKeyInsert): Promise<Result<ApiKey, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<ApiKeyRow[]>`
          INSERT INTO ${sql(Tables.API_KEYS)} ${sql(data)}
          RETURNING *
        `;
        return toApiKey(rows[0]);
      }, 'ApiKey');
    },

    async update(id: ApiKeyId, data: ApiKeyUpdate): Promise<Result<ApiKey | null, DbError>> {
      return withErrorHandling(async () => {
        if (Object.keys(data).length === 0) {
          const findResult = await apiKeys.findById(id);
          return findResult.ok ? findResult.value : null;
        }
        const rows = await sql<ApiKeyRow[]>`
          UPDATE ${sql(Tables.API_KEYS)}
          SET ${sql(data)}
          WHERE id = ${id}
          RETURNING *
        `;
        return rows.length > 0 ? toApiKey(rows[0]) : null;
      }, 'ApiKey');
    },

    async updateLastUsed(id: ApiKeyId): Promise<Result<void, DbError>> {
      return withErrorHandling(async () => {
        await sql`
          UPDATE ${sql(Tables.API_KEYS)}
          SET last_used_at = NOW()
          WHERE id = ${id}
        `;
      }, 'ApiKey');
    },

    async delete(id: ApiKeyId): Promise<Result<boolean, DbError>> {
      return withErrorHandling(async () => {
        const result = await sql`
          DELETE FROM ${sql(Tables.API_KEYS)}
          WHERE id = ${id}
        `;
        return result.count > 0;
      }, 'ApiKey');
    },

    async list(): Promise<Result<ApiKey[], DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<ApiKeyRow[]>`
          SELECT * FROM ${sql(Tables.API_KEYS)}
          ORDER BY created_at DESC
        `;
        return rows.map(toApiKey);
      }, 'ApiKey');
    },
  };

  // ============================================================================
  // Domain Operations
  // ============================================================================

  const domains = {
    async findById(id: string): Promise<Result<Domain | null, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<DomainRow[]>`
          SELECT * FROM ${sql(Tables.DOMAINS)}
          WHERE id = ${id}
          LIMIT 1
        `;
        return rows.length > 0 ? toDomain(rows[0]) : null;
      }, 'Domain');
    },

    async findByDomain(apiKeyId: ApiKeyId, domain: string): Promise<Result<Domain | null, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<DomainRow[]>`
          SELECT * FROM ${sql(Tables.DOMAINS)}
          WHERE api_key_id = ${apiKeyId} AND domain = ${domain}
          LIMIT 1
        `;
        return rows.length > 0 ? toDomain(rows[0]) : null;
      }, 'Domain');
    },

    async findByApiKey(apiKeyId: ApiKeyId): Promise<Result<Domain[], DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<DomainRow[]>`
          SELECT * FROM ${sql(Tables.DOMAINS)}
          WHERE api_key_id = ${apiKeyId}
          ORDER BY created_at DESC
        `;
        return rows.map(toDomain);
      }, 'Domain');
    },

    async create(data: DomainInsert): Promise<Result<Domain, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<DomainRow[]>`
          INSERT INTO ${sql(Tables.DOMAINS)} ${sql(data)}
          RETURNING *
        `;
        return toDomain(rows[0]);
      }, 'Domain');
    },

    async update(id: string, data: DomainUpdate): Promise<Result<Domain | null, DbError>> {
      return withErrorHandling(async () => {
        if (Object.keys(data).length === 0) {
          const findResult = await domains.findById(id);
          return findResult.ok ? findResult.value : null;
        }
        const rows = await sql<DomainRow[]>`
          UPDATE ${sql(Tables.DOMAINS)}
          SET ${sql(data)}
          WHERE id = ${id}
          RETURNING *
        `;
        return rows.length > 0 ? toDomain(rows[0]) : null;
      }, 'Domain');
    },

    async delete(id: string): Promise<Result<boolean, DbError>> {
      return withErrorHandling(async () => {
        const result = await sql`
          DELETE FROM ${sql(Tables.DOMAINS)}
          WHERE id = ${id}
        `;
        return result.count > 0;
      }, 'Domain');
    },
  };

  // ============================================================================
  // Message Operations
  // ============================================================================

  const messages = {
    async findById(id: MessageId): Promise<Result<Message | null, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<MessageRow[]>`
          SELECT * FROM ${sql(Tables.MESSAGES)}
          WHERE id = ${id}
          LIMIT 1
        `;
        return rows.length > 0 ? toMessage(rows[0]) : null;
      }, 'Message');
    },

    async findByIdempotencyKey(apiKeyId: ApiKeyId, key: string): Promise<Result<Message | null, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<MessageRow[]>`
          SELECT * FROM ${sql(Tables.MESSAGES)}
          WHERE api_key_id = ${apiKeyId} AND idempotency_key = ${key}
          LIMIT 1
        `;
        return rows.length > 0 ? toMessage(rows[0]) : null;
      }, 'Message');
    },

    async create(data: MessageInsert): Promise<Result<Message, DbError>> {
      return withErrorHandling(async () => {
        // Convert to plain object for postgres insert
        const insertData = {
          api_key_id: data.api_key_id,
          type: data.type,
          from_address: data.from_address,
          to_address: data.to_address,
          ...(data.id && { id: data.id }),
          ...(data.idempotency_key && { idempotency_key: data.idempotency_key }),
          ...(data.status && { status: data.status }),
          ...(data.subject && { subject: data.subject }),
          ...(data.body && { body: data.body }),
          ...(data.html_body && { html_body: data.html_body }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(data.metadata && { metadata: sql.json(data.metadata as any) }),
          ...(data.attempts !== undefined && { attempts: data.attempts }),
        };
        const rows = await sql<MessageRow[]>`
          INSERT INTO ${sql(Tables.MESSAGES)} ${sql(insertData)}
          RETURNING *
        `;
        return toMessage(rows[0]);
      }, 'Message');
    },

    async update(id: MessageId, data: MessageUpdate): Promise<Result<Message | null, DbError>> {
      return withErrorHandling(async () => {
        if (Object.keys(data).length === 0) {
          const findResult = await messages.findById(id);
          return findResult.ok ? findResult.value : null;
        }
        const rows = await sql<MessageRow[]>`
          UPDATE ${sql(Tables.MESSAGES)}
          SET ${sql(data)}
          WHERE id = ${id}
          RETURNING *
        `;
        return rows.length > 0 ? toMessage(rows[0]) : null;
      }, 'Message');
    },

    async claimNext(): Promise<Result<Message | null, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<MessageRow[]>`
          SELECT * FROM claim_next_message('worker')
        `;
        return rows.length > 0 ? toMessage(rows[0]) : null;
      }, 'Message');
    },

    async countByStatus(apiKeyId: ApiKeyId, status: MessageStatus): Promise<Result<number, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<{ count: string }[]>`
          SELECT COUNT(*) as count FROM ${sql(Tables.MESSAGES)}
          WHERE api_key_id = ${apiKeyId} AND status = ${status}
        `;
        return parseInt(rows[0].count, 10);
      }, 'Message');
    },

    async list(apiKeyId: ApiKeyId, options: ListOptions = {}): Promise<Result<Message[], DbError>> {
      const { limit = 100, offset = 0 } = options;
      return withErrorHandling(async () => {
        const rows = await sql<MessageRow[]>`
          SELECT * FROM ${sql(Tables.MESSAGES)}
          WHERE api_key_id = ${apiKeyId}
          ORDER BY created_at DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `;
        return rows.map(toMessage);
      }, 'Message');
    },
  };

  // ============================================================================
  // Suppression Operations
  // ============================================================================

  const suppressions = {
    async findByEmail(apiKeyId: ApiKeyId, email: string): Promise<Result<Suppression | null, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<SuppressionRow[]>`
          SELECT * FROM ${sql(Tables.SUPPRESSIONS)}
          WHERE api_key_id = ${apiKeyId} AND email = ${email.toLowerCase()}
          LIMIT 1
        `;
        return rows.length > 0 ? toSuppression(rows[0]) : null;
      }, 'Suppression');
    },

    async isEmailSuppressed(apiKeyId: ApiKeyId, email: string): Promise<Result<boolean, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<{ exists: boolean }[]>`
          SELECT EXISTS(
            SELECT 1 FROM ${sql(Tables.SUPPRESSIONS)}
            WHERE api_key_id = ${apiKeyId} AND email = ${email.toLowerCase()}
          ) as exists
        `;
        return rows[0].exists;
      }, 'Suppression');
    },

    async create(data: SuppressionInsert): Promise<Result<Suppression, DbError>> {
      return withErrorHandling(async () => {
        const normalizedEmail = data.email.toLowerCase();
        const insertData = {
          api_key_id: data.api_key_id,
          email: normalizedEmail,
          reason: data.reason,
          ...(data.id && { id: data.id }),
        };
        const rows = await sql<SuppressionRow[]>`
          INSERT INTO ${sql(Tables.SUPPRESSIONS)} ${sql(insertData)}
          ON CONFLICT (api_key_id, email) DO NOTHING
          RETURNING *
        `;
        if (rows.length === 0) {
          // Already exists, fetch it
          const existing = await sql<SuppressionRow[]>`
            SELECT * FROM ${sql(Tables.SUPPRESSIONS)}
            WHERE api_key_id = ${data.api_key_id} AND email = ${normalizedEmail}
          `;
          return toSuppression(existing[0]);
        }
        return toSuppression(rows[0]);
      }, 'Suppression');
    },

    async delete(apiKeyId: ApiKeyId, email: string): Promise<Result<boolean, DbError>> {
      return withErrorHandling(async () => {
        const result = await sql`
          DELETE FROM ${sql(Tables.SUPPRESSIONS)}
          WHERE api_key_id = ${apiKeyId} AND email = ${email.toLowerCase()}
        `;
        return result.count > 0;
      }, 'Suppression');
    },

    async list(apiKeyId: ApiKeyId, options: ListOptions = {}): Promise<Result<Suppression[], DbError>> {
      const { limit = 100, offset = 0 } = options;
      return withErrorHandling(async () => {
        const rows = await sql<SuppressionRow[]>`
          SELECT * FROM ${sql(Tables.SUPPRESSIONS)}
          WHERE api_key_id = ${apiKeyId}
          ORDER BY created_at DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `;
        return rows.map(toSuppression);
      }, 'Suppression');
    },
  };

  // ============================================================================
  // Webhook Operations
  // ============================================================================

  const webhooks = {
    async findById(id: WebhookId): Promise<Result<Webhook | null, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<WebhookRow[]>`
          SELECT * FROM ${sql(Tables.WEBHOOKS)}
          WHERE id = ${id}
          LIMIT 1
        `;
        return rows.length > 0 ? toWebhook(rows[0]) : null;
      }, 'Webhook');
    },

    async findActiveByApiKey(apiKeyId: ApiKeyId): Promise<Result<Webhook[], DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<WebhookRow[]>`
          SELECT * FROM ${sql(Tables.WEBHOOKS)}
          WHERE api_key_id = ${apiKeyId} AND active = true
          ORDER BY created_at DESC
        `;
        return rows.map(toWebhook);
      }, 'Webhook');
    },

    async create(data: WebhookInsert): Promise<Result<Webhook, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<WebhookRow[]>`
          INSERT INTO ${sql(Tables.WEBHOOKS)} ${sql(data)}
          RETURNING *
        `;
        return toWebhook(rows[0]);
      }, 'Webhook');
    },

    async update(id: WebhookId, data: WebhookUpdate): Promise<Result<Webhook | null, DbError>> {
      return withErrorHandling(async () => {
        if (Object.keys(data).length === 0) {
          const findResult = await webhooks.findById(id);
          return findResult.ok ? findResult.value : null;
        }
        const rows = await sql<WebhookRow[]>`
          UPDATE ${sql(Tables.WEBHOOKS)}
          SET ${sql(data)}
          WHERE id = ${id}
          RETURNING *
        `;
        return rows.length > 0 ? toWebhook(rows[0]) : null;
      }, 'Webhook');
    },

    async delete(id: WebhookId): Promise<Result<boolean, DbError>> {
      return withErrorHandling(async () => {
        const result = await sql`
          DELETE FROM ${sql(Tables.WEBHOOKS)}
          WHERE id = ${id}
        `;
        return result.count > 0;
      }, 'Webhook');
    },
  };

  // ============================================================================
  // Webhook Delivery Operations
  // ============================================================================

  const webhookDeliveries = {
    async create(data: WebhookDeliveryInsert): Promise<Result<WebhookDelivery, DbError>> {
      return withErrorHandling(async () => {
        const insertData = {
          webhook_id: data.webhook_id,
          event: data.event,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          payload: sql.json(data.payload as any),
          ...(data.id && { id: data.id }),
          ...(data.message_id && { message_id: data.message_id }),
          ...(data.status && { status: data.status }),
          ...(data.attempts !== undefined && { attempts: data.attempts }),
        };
        const rows = await sql<WebhookDeliveryRow[]>`
          INSERT INTO ${sql(Tables.WEBHOOK_DELIVERIES)} ${sql(insertData)}
          RETURNING *
        `;
        return toWebhookDelivery(rows[0]);
      }, 'WebhookDelivery');
    },

    async update(id: string, data: WebhookDeliveryUpdate): Promise<Result<WebhookDelivery | null, DbError>> {
      return withErrorHandling(async () => {
        if (Object.keys(data).length === 0) {
          const rows = await sql<WebhookDeliveryRow[]>`
            SELECT * FROM ${sql(Tables.WEBHOOK_DELIVERIES)}
            WHERE id = ${id}
          `;
          return rows.length > 0 ? toWebhookDelivery(rows[0]) : null;
        }
        const rows = await sql<WebhookDeliveryRow[]>`
          UPDATE ${sql(Tables.WEBHOOK_DELIVERIES)}
          SET ${sql(data)}
          WHERE id = ${id}
          RETURNING *
        `;
        return rows.length > 0 ? toWebhookDelivery(rows[0]) : null;
      }, 'WebhookDelivery');
    },

    async claimNext(): Promise<Result<WebhookDelivery | null, DbError>> {
      return withErrorHandling(async () => {
        const rows = await sql<WebhookDeliveryRow[]>`
          SELECT * FROM claim_next_webhook_delivery()
        `;
        return rows.length > 0 ? toWebhookDelivery(rows[0]) : null;
      }, 'WebhookDelivery');
    },
  };

  // ============================================================================
  // Notification Listeners
  // ============================================================================

  const listen = {
    async onMessageQueued(callback: (payload: MessageQueuedPayload) => void): Promise<void> {
      await sql.listen(Channels.MESSAGE_QUEUED, (payload) => {
        try {
          const data = JSON.parse(payload) as MessageQueuedPayload;
          callback(data);
        } catch (e) {
          console.error('Failed to parse message_queued payload:', e);
        }
      });
    },

    async onWebhookPending(callback: (payload: WebhookPendingPayload) => void): Promise<void> {
      await sql.listen(Channels.WEBHOOK_PENDING, (payload) => {
        try {
          const data = JSON.parse(payload) as WebhookPendingPayload;
          callback(data);
        } catch (e) {
          console.error('Failed to parse webhook_pending payload:', e);
        }
      });
    },
  };

  // ============================================================================
  // Client Interface
  // ============================================================================

  return {
    sql,
    apiKeys,
    domains,
    messages,
    suppressions,
    webhooks,
    webhookDeliveries,
    listen,
    async close() {
      connected = false;
      await sql.end();
    },
    isConnected() {
      return connected;
    },
  };
}

/**
 * Create a database client from DATABASE_URL environment variable
 */
export function createDatabaseClientFromEnv(): DatabaseClient {
  const connectionUrl = process.env.DATABASE_URL;
  if (!connectionUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  return createDatabaseClient({
    connectionUrl,
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS ?? '10', 10),
    idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT ?? '30', 10),
    connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT ?? '10', 10),
    ssl: process.env.DB_SSL === 'true' ? 'require' : undefined,
    debug: process.env.DB_DEBUG === 'true',
  });
}
