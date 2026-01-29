/**
 * Worker Configuration
 * Environment variable validation and configuration management
 */

export interface WorkerConfig {
  /** PostgreSQL connection URL */
  databaseUrl: string;
  
  /** SMTP server hostname */
  smtpHost: string;
  
  /** SMTP server port */
  smtpPort: number;
  
  /** SMTP authentication username (optional) */
  smtpUser: string | undefined;
  
  /** SMTP authentication password (optional) */
  smtpPass: string | undefined;
  
  /** Default sender address when none specified */
  smtpFromDefault: string;
  
  /** Number of concurrent message processors */
  workerConcurrency: number;
  
  /** Maximum retry attempts for failed messages */
  maxRetries: number;
  
  /** Base delay between retries in milliseconds */
  retryDelayMs: number;
  
  /** Interval for polling stuck messages in milliseconds */
  pollIntervalMs: number;
  
  /** Maximum webhook retry attempts */
  maxWebhookRetries: number;
  
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): WorkerConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  return {
    databaseUrl,
    smtpHost: process.env.SMTP_HOST ?? 'localhost',
    smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    smtpFromDefault: process.env.SMTP_FROM_DEFAULT ?? 'noreply@localhost',
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '10', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES ?? '3', 10),
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS ?? '5000', 10),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? '5000', 10),
    maxWebhookRetries: parseInt(process.env.MAX_WEBHOOK_RETRIES ?? '5', 10),
    debug: process.env.DEBUG === 'true' || process.env.WORKER_DEBUG === 'true',
  };
}

/**
 * Validate configuration values
 */
export function validateConfig(config: WorkerConfig): string[] {
  const errors: string[] = [];

  if (config.smtpPort < 1 || config.smtpPort > 65535) {
    errors.push('SMTP_PORT must be between 1 and 65535');
  }

  if (config.workerConcurrency < 1 || config.workerConcurrency > 100) {
    errors.push('WORKER_CONCURRENCY must be between 1 and 100');
  }

  if (config.maxRetries < 0 || config.maxRetries > 10) {
    errors.push('MAX_RETRIES must be between 0 and 10');
  }

  if (config.retryDelayMs < 1000) {
    errors.push('RETRY_DELAY_MS must be at least 1000ms');
  }

  if (config.pollIntervalMs < 1000) {
    errors.push('POLL_INTERVAL_MS must be at least 1000ms');
  }

  return errors;
}
