/**
 * Error handling utilities for OpenSend
 * Uses a simple Result<T, E> pattern for explicit error handling
 */

// ============================================================================
// Result Type - Functional Error Handling
// ============================================================================

/**
 * Represents either a successful result (Ok) or a failure (Err)
 * This pattern forces explicit error handling at compile time
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/**
 * Create a successful result
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/**
 * Create a failure result
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/**
 * Check if a result is Ok
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok === true;
}

/**
 * Check if a result is Err
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return result.ok === false;
}

/**
 * Unwrap a result, throwing if it's an error
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isOk(result)) {
    return result.value;
  }
  throw result.error;
}

/**
 * Unwrap a result with a default value if it's an error
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (isOk(result)) {
    return result.value;
  }
  return defaultValue;
}

/**
 * Map over a successful result
 */
export function map<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  if (isOk(result)) {
    return ok(fn(result.value));
  }
  return result;
}

/**
 * Map over a failed result
 */
export function mapErr<T, E, F>(
  result: Result<T, E>,
  fn: (error: E) => F
): Result<T, F> {
  if (isErr(result)) {
    return err(fn(result.error));
  }
  return result;
}

/**
 * Chain operations that return Results
 */
export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (isOk(result)) {
    return fn(result.value);
  }
  return result;
}

/**
 * Try to execute a function and wrap the result
 */
export function tryCatch<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Try to execute an async function and wrap the result
 */
export async function tryCatchAsync<T>(
  fn: () => Promise<T>
): Promise<Result<T, Error>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

// ============================================================================
// Domain Errors
// ============================================================================

/**
 * Base class for all OpenSend errors
 */
export abstract class OpenSendError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  readonly isOpenSendError = true as const;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      name: this.name,
    };
  }
}

// Database Errors
export class DatabaseError extends OpenSendError {
  readonly code = 'DATABASE_ERROR';
  readonly statusCode = 500;

  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
  }
}

export class ConnectionError extends OpenSendError {
  readonly code = 'CONNECTION_ERROR';
  readonly statusCode = 503;

  constructor(message: string = 'Failed to connect to database') {
    super(message);
  }
}

export class RecordNotFoundError extends OpenSendError {
  readonly code = 'RECORD_NOT_FOUND';
  readonly statusCode = 404;

  constructor(
    public readonly entity: string,
    public readonly id?: string
  ) {
    super(id ? `${entity} with id ${id} not found` : `${entity} not found`);
  }
}

export class DuplicateRecordError extends OpenSendError {
  readonly code = 'DUPLICATE_RECORD';
  readonly statusCode = 409;

  constructor(
    public readonly entity: string,
    public readonly field: string
  ) {
    super(`${entity} with this ${field} already exists`);
  }
}

export class ConstraintViolationError extends OpenSendError {
  readonly code = 'CONSTRAINT_VIOLATION';
  readonly statusCode = 400;

  constructor(
    message: string,
    public readonly constraint?: string
  ) {
    super(message);
  }
}

// API Errors
export class ValidationError extends OpenSendError {
  readonly code = 'VALIDATION_ERROR';
  readonly statusCode = 400;

  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message);
  }
}

export class AuthenticationError extends OpenSendError {
  readonly code = 'AUTHENTICATION_ERROR';
  readonly statusCode = 401;

  constructor(message: string = 'Invalid or missing API key') {
    super(message);
  }
}

export class RateLimitError extends OpenSendError {
  readonly code = 'RATE_LIMIT_EXCEEDED';
  readonly statusCode = 429;

  constructor(public readonly retryAfterSeconds: number) {
    super(`Rate limit exceeded. Retry after ${retryAfterSeconds} seconds`);
  }
}

export class DomainNotVerifiedError extends OpenSendError {
  readonly code = 'DOMAIN_NOT_VERIFIED';
  readonly statusCode = 403;

  constructor(public readonly domain: string) {
    super(`Domain ${domain} is not verified`);
  }
}

export class SuppressionError extends OpenSendError {
  readonly code = 'EMAIL_SUPPRESSED';
  readonly statusCode = 400;

  constructor(
    public readonly email: string,
    public readonly reason: string
  ) {
    super(`Email ${email} is suppressed: ${reason}`);
  }
}

export class IdempotencyConflictError extends OpenSendError {
  readonly code = 'IDEMPOTENCY_CONFLICT';
  readonly statusCode = 409;

  constructor(
    public readonly idempotencyKey: string,
    public readonly existingMessageId: string
  ) {
    super(
      `Request with idempotency key ${idempotencyKey} already processed. Existing message: ${existingMessageId}`
    );
  }
}

// Worker Errors
export class DeliveryError extends OpenSendError {
  readonly code = 'DELIVERY_ERROR';
  readonly statusCode = 500;

  constructor(
    message: string,
    public readonly messageId: string,
    public readonly permanent: boolean = false
  ) {
    super(message);
  }
}

export class WebhookDeliveryError extends OpenSendError {
  readonly code = 'WEBHOOK_DELIVERY_ERROR';
  readonly statusCode = 502;

  constructor(
    public readonly webhookUrl: string,
    public readonly httpStatus?: number
  ) {
    super(
      httpStatus
        ? `Webhook delivery to ${webhookUrl} failed with status ${httpStatus}`
        : `Webhook delivery to ${webhookUrl} failed`
    );
  }
}
