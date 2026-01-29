/**
 * SMTP Client Wrapper
 * Handles email sending with connection pooling, DKIM signing, and error categorization
 */

import nodemailer from 'nodemailer';
import type { Transporter, SendMailOptions } from 'nodemailer';
import type { WorkerConfig } from '../config.js';

// ============================================================================
// Types
// ============================================================================

export interface SmtpClientConfig {
  host: string;
  port: number;
  auth?: {
    user: string;
    pass: string;
  };
  secure?: boolean;
  pool?: boolean;
  maxConnections?: number;
  debug?: boolean;
}

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  messageId?: string;
  headers?: Record<string, string>;
}

export interface DkimConfig {
  domainName: string;
  selector: string;
  privateKey: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  response?: string;
  error?: SmtpError;
}

/**
 * Error classification for SMTP responses
 */
export type SmtpErrorType = 
  | 'permanent' // 5xx errors - don't retry
  | 'temporary' // 4xx errors - retry
  | 'connection' // Network/connection errors - retry
  | 'unknown';   // Unclassified errors

export class SmtpError extends Error {
  readonly type: SmtpErrorType;
  readonly code?: string;
  readonly responseCode?: number;
  readonly shouldRetry: boolean;

  constructor(
    message: string,
    type: SmtpErrorType,
    responseCode?: number,
    code?: string
  ) {
    super(message);
    this.name = 'SmtpError';
    this.type = type;
    this.responseCode = responseCode;
    this.code = code;
    this.shouldRetry = type === 'temporary' || type === 'connection';
  }
}

// ============================================================================
// Error Classification
// ============================================================================

/**
 * Hard bounce SMTP response codes (5xx - permanent failures)
 * These indicate the email should NOT be retried
 */
const HARD_BOUNCE_CODES = [
  550, // Mailbox unavailable, not found, rejected
  551, // User not local
  552, // Message size exceeded / storage exceeded
  553, // Mailbox name not allowed
  554, // Transaction failed / policy rejection
];

/**
 * Soft bounce SMTP response codes (4xx - temporary failures)
 * These indicate the email CAN be retried
 */
const SOFT_BOUNCE_CODES = [
  450, // Mailbox unavailable (temporary)
  451, // Local error, try again
  452, // Insufficient storage
];

/**
 * Connection error codes that indicate network issues
 */
const CONNECTION_ERROR_CODES = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ESOCKET',
  'ECONNECTION',
];

/**
 * Classify an error from nodemailer
 */
export function classifySmtpError(error: Error & { code?: string; responseCode?: number }): SmtpError {
  // Check for connection errors first
  if (error.code && CONNECTION_ERROR_CODES.includes(error.code)) {
    return new SmtpError(
      error.message,
      'connection',
      undefined,
      error.code
    );
  }

  // Check for SMTP response codes
  if (error.responseCode) {
    if (HARD_BOUNCE_CODES.includes(error.responseCode)) {
      return new SmtpError(
        error.message,
        'permanent',
        error.responseCode
      );
    }

    if (SOFT_BOUNCE_CODES.includes(error.responseCode)) {
      return new SmtpError(
        error.message,
        'temporary',
        error.responseCode
      );
    }

    // Classify based on response code range
    if (error.responseCode >= 500 && error.responseCode < 600) {
      return new SmtpError(
        error.message,
        'permanent',
        error.responseCode
      );
    }

    if (error.responseCode >= 400 && error.responseCode < 500) {
      return new SmtpError(
        error.message,
        'temporary',
        error.responseCode
      );
    }
  }

  // Default to unknown (which will not retry)
  return new SmtpError(error.message, 'unknown');
}

/**
 * Check if an SMTP error indicates a hard bounce
 * Used to determine if an email should be added to the suppression list
 */
export function isHardBounce(error: SmtpError): boolean {
  return error.type === 'permanent' && 
         error.responseCode !== undefined &&
         HARD_BOUNCE_CODES.includes(error.responseCode);
}

// ============================================================================
// SMTP Client
// ============================================================================

// Use a generic transporter type to support both pool and non-pool modes
type SmtpTransporter = Transporter<{ messageId: string; response: string }>;

export class SmtpClient {
  private transporter: SmtpTransporter;
  private readonly debug: boolean;

  constructor(config: SmtpClientConfig) {
    this.debug = config.debug ?? false;

    // Build transport options - use SMTPPool for connection pooling
    const usePool = config.pool ?? true;
    
    // Build transport options dynamically
    const transportOptions: Record<string, unknown> = {
      host: config.host,
      port: config.port,
      secure: config.secure ?? config.port === 465,
    };

    // Enable connection pooling if requested
    if (usePool) {
      transportOptions.pool = true;
      transportOptions.maxConnections = config.maxConnections ?? 5;
    }

    if (config.auth) {
      transportOptions.auth = {
        user: config.auth.user,
        pass: config.auth.pass,
      };
    }

    if (this.debug) {
      transportOptions.debug = true;
      transportOptions.logger = true;
    }

    this.transporter = nodemailer.createTransport(transportOptions) as SmtpTransporter;
  }

  /**
   * Create an SMTP client from worker configuration
   */
  static fromConfig(workerConfig: WorkerConfig): SmtpClient {
    const smtpConfig: SmtpClientConfig = {
      host: workerConfig.smtpHost,
      port: workerConfig.smtpPort,
      debug: workerConfig.debug,
    };

    if (workerConfig.smtpUser && workerConfig.smtpPass) {
      smtpConfig.auth = {
        user: workerConfig.smtpUser,
        pass: workerConfig.smtpPass,
      };
    }

    return new SmtpClient(smtpConfig);
  }

  /**
   * Send an email message
   */
  async send(message: EmailMessage, dkim?: DkimConfig): Promise<SendResult> {
    try {
      const mailOptions: SendMailOptions = {
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      };

      // Add custom message ID if provided
      if (message.messageId) {
        mailOptions.messageId = message.messageId;
      }

      // Configure DKIM if provided
      if (dkim) {
        mailOptions.dkim = {
          domainName: dkim.domainName,
          keySelector: dkim.selector,
          privateKey: dkim.privateKey,
        };
      }

      if (this.debug) {
        console.log('[SMTP] Sending email:', {
          from: message.from,
          to: message.to,
          subject: message.subject,
          hasDkim: !!dkim,
        });
      }

      const result = await this.transporter.sendMail(mailOptions);

      if (this.debug) {
        console.log('[SMTP] Email sent successfully:', {
          messageId: result.messageId,
          response: result.response,
        });
      }

      return {
        success: true,
        messageId: result.messageId,
        response: result.response,
      };
    } catch (e) {
      const error = e as Error & { code?: string; responseCode?: number };
      const smtpError = classifySmtpError(error);

      if (this.debug) {
        console.error('[SMTP] Email send failed:', {
          error: smtpError.message,
          type: smtpError.type,
          responseCode: smtpError.responseCode,
          shouldRetry: smtpError.shouldRetry,
        });
      }

      return {
        success: false,
        error: smtpError,
      };
    }
  }

  /**
   * Verify SMTP connection
   */
  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (e) {
      if (this.debug) {
        console.error('[SMTP] Connection verification failed:', e);
      }
      return false;
    }
  }

  /**
   * Close all pooled connections
   */
  close(): void {
    this.transporter.close();
  }
}

/**
 * Create an SMTP client from worker configuration
 */
export function createSmtpClient(config: WorkerConfig): SmtpClient {
  return SmtpClient.fromConfig(config);
}
