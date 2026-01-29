/**
 * Suppression Service
 * Business logic for email suppression list management
 */

import type {
  DatabaseClient,
  Result,
  ApiKeyId,
  Suppression,
  SuppressionReason,
} from '@opensend/shared';
import { ok, err, RecordNotFoundError } from '@opensend/shared';

// ============================================================================
// Types
// ============================================================================

export interface SuppressionListFilters {
  reason?: SuppressionReason;
  limit?: number;
  offset?: number;
}

export interface SuppressionListResult {
  suppressions: SuppressionItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SuppressionItem {
  email: string;
  reason: SuppressionReason;
  created_at: string;
}

// ============================================================================
// Suppression Service
// ============================================================================

/**
 * Create suppression service with database client dependency
 */
export function createSuppressionService(db: DatabaseClient) {
  /**
   * List suppressions with pagination and filtering
   */
  async function list(
    apiKeyId: ApiKeyId,
    filters: SuppressionListFilters = {}
  ): Promise<Result<SuppressionListResult, Error>> {
    const { limit = 100, offset = 0 } = filters;

    // Get suppressions from database
    const result = await db.suppressions.list(apiKeyId, { limit, offset });
    if (!result.ok) {
      return err(result.error);
    }

    // Filter by reason if specified
    let suppressions = result.value;
    if (filters.reason) {
      suppressions = suppressions.filter((s) => s.reason === filters.reason);
    }

    // Map to response format
    const items: SuppressionItem[] = suppressions.map((s) => ({
      email: s.email,
      reason: s.reason,
      created_at: s.createdAt.toISOString(),
    }));

    return ok({
      suppressions: items,
      total: items.length, // Note: In production, use a separate count query
      limit,
      offset,
    });
  }

  /**
   * Add email to suppression list
   */
  async function add(
    apiKeyId: ApiKeyId,
    email: string,
    reason: SuppressionReason
  ): Promise<Result<Suppression, Error>> {
    const normalizedEmail = email.toLowerCase().trim();

    const result = await db.suppressions.create({
      api_key_id: apiKeyId,
      email: normalizedEmail,
      reason,
    });

    return result;
  }

  /**
   * Remove email from suppression list
   */
  async function remove(
    apiKeyId: ApiKeyId,
    email: string
  ): Promise<Result<boolean, Error>> {
    const normalizedEmail = email.toLowerCase().trim();

    // Check if suppression exists
    const existsResult = await db.suppressions.findByEmail(apiKeyId, normalizedEmail);
    if (!existsResult.ok) {
      return err(existsResult.error);
    }

    if (!existsResult.value) {
      return err(new RecordNotFoundError('Suppression', normalizedEmail));
    }

    // Delete suppression
    const deleteResult = await db.suppressions.delete(apiKeyId, normalizedEmail);
    return deleteResult;
  }

  /**
   * Check if email is suppressed
   */
  async function isSuppressed(
    apiKeyId: ApiKeyId,
    email: string
  ): Promise<Result<boolean, Error>> {
    const normalizedEmail = email.toLowerCase().trim();
    return db.suppressions.isEmailSuppressed(apiKeyId, normalizedEmail);
  }

  /**
   * Get suppression details for an email
   */
  async function get(
    apiKeyId: ApiKeyId,
    email: string
  ): Promise<Result<Suppression | null, Error>> {
    const normalizedEmail = email.toLowerCase().trim();
    return db.suppressions.findByEmail(apiKeyId, normalizedEmail);
  }

  return {
    list,
    add,
    remove,
    isSuppressed,
    get,
  };
}

export type SuppressionService = ReturnType<typeof createSuppressionService>;
