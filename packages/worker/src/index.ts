/**
 * OpenSend Background Worker
 * 
 * Processes the email queue and sends emails via SMTP (Haraka).
 * Also handles webhook deliveries for status notifications.
 * 
 * Features:
 * - PostgreSQL LISTEN/NOTIFY for real-time message processing
 * - Periodic polling for stuck messages
 * - Configurable concurrency
 * - Graceful shutdown with in-flight message completion
 * - Automatic retry with exponential backoff
 * - Hard bounce detection and suppression list management
 * - DKIM signing support
 */

import { createDatabaseClient, type DatabaseClient } from '@opensend/shared';
import { loadConfig, validateConfig, type WorkerConfig } from './config.js';
import { createSmtpClient, type SmtpClient } from './smtp/client.js';
import { createQueueListenerFromConfig, type QueueListener } from './queue/listener.js';
import { createEmailProcessorFromDeps, type EmailProcessor } from './processors/email.processor.js';
import { createWebhookProcessorFromDeps, type WebhookProcessor } from './processors/webhook.processor.js';

// ============================================================================
// Types
// ============================================================================

export interface Worker {
  /** Start the worker */
  start(): Promise<void>;
  
  /** Stop the worker gracefully */
  stop(): Promise<void>;
  
  /** Check if the worker is running */
  isRunning(): boolean;
  
  /** Get worker statistics */
  getStats(): WorkerStats;
}

export interface WorkerStats {
  messagesProcessed: number;
  messagesSent: number;
  messagesFailed: number;
  webhooksDelivered: number;
  webhooksFailed: number;
  startedAt: Date | null;
  uptime: number;
}

// ============================================================================
// Worker Implementation
// ============================================================================

function createWorker(
  config: WorkerConfig,
  db: DatabaseClient,
  smtp: SmtpClient
): Worker {
  let running = false;
  let startedAt: Date | null = null;
  let queueListener: QueueListener | null = null;
  let emailProcessor: EmailProcessor | null = null;
  let webhookProcessor: WebhookProcessor | null = null;
  
  // Processing state
  let emailProcessingInProgress = false;
  let webhookProcessingInProgress = false;
  let shutdownRequested = false;
  let inFlightCount = 0;

  // Statistics
  const stats = {
    messagesProcessed: 0,
    messagesSent: 0,
    messagesFailed: 0,
    webhooksDelivered: 0,
    webhooksFailed: 0,
  };

  const debug = config.debug;

  /**
   * Log message
   */
  function log(message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    if (data) {
      console.log(`[${timestamp}] [Worker] ${message}`, data);
    } else {
      console.log(`[${timestamp}] [Worker] ${message}`);
    }
  }

  /**
   * Log debug message
   */
  function logDebug(message: string, data?: Record<string, unknown>): void {
    if (debug) {
      log(message, data);
    }
  }

  /**
   * Process email queue
   */
  async function processEmailQueue(): Promise<void> {
    if (emailProcessingInProgress || shutdownRequested || !emailProcessor) {
      return;
    }

    emailProcessingInProgress = true;
    logDebug('Starting email queue processing');

    try {
      // Process in batches until no more messages or shutdown requested
      while (!shutdownRequested && emailProcessor.hasMore()) {
        inFlightCount++;
        
        try {
          const results = await emailProcessor.processBatch(config.workerConcurrency);
          
          for (const result of results) {
            stats.messagesProcessed++;
            if (result.success) {
              stats.messagesSent++;
            } else if (result.status === 'failed') {
              stats.messagesFailed++;
            }
          }

          // If no results, take a short break before trying again
          if (results.length === 0) {
            break;
          }

          logDebug('Processed batch', {
            count: results.length,
            sent: results.filter(r => r.success).length,
          });
        } finally {
          inFlightCount--;
        }
      }
    } catch (e) {
      const error = e as Error;
      console.error('[Worker] Error processing email queue:', error.message);
    } finally {
      emailProcessingInProgress = false;
      logDebug('Email queue processing complete');
    }
  }

  /**
   * Process webhook queue
   */
  async function processWebhookQueue(): Promise<void> {
    if (webhookProcessingInProgress || shutdownRequested || !webhookProcessor) {
      return;
    }

    webhookProcessingInProgress = true;
    logDebug('Starting webhook queue processing');

    try {
      // Process in batches until no more deliveries or shutdown requested
      while (!shutdownRequested && webhookProcessor.hasMore()) {
        inFlightCount++;
        
        try {
          const results = await webhookProcessor.processBatch(config.workerConcurrency);
          
          for (const result of results) {
            if (result.success) {
              stats.webhooksDelivered++;
            } else if (result.status === 'failed') {
              stats.webhooksFailed++;
            }
          }

          // If no results, take a short break before trying again
          if (results.length === 0) {
            break;
          }

          logDebug('Processed webhook batch', {
            count: results.length,
            delivered: results.filter(r => r.success).length,
          });
        } finally {
          inFlightCount--;
        }
      }
    } catch (e) {
      const error = e as Error;
      console.error('[Worker] Error processing webhook queue:', error.message);
    } finally {
      webhookProcessingInProgress = false;
      logDebug('Webhook queue processing complete');
    }
  }

  /**
   * Wait for in-flight messages to complete
   */
  async function waitForInFlight(timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now();
    
    while (inFlightCount > 0) {
      if (Date.now() - startTime > timeoutMs) {
        log('Timeout waiting for in-flight messages', { remaining: inFlightCount });
        break;
      }
      
      logDebug('Waiting for in-flight messages', { count: inFlightCount });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return {
    async start(): Promise<void> {
      if (running) {
        log('Worker already running');
        return;
      }

      log('Starting worker', {
        concurrency: config.workerConcurrency,
        smtpHost: config.smtpHost,
        smtpPort: config.smtpPort,
      });

      // Initialize processors
      emailProcessor = createEmailProcessorFromDeps(db, smtp, config);
      webhookProcessor = createWebhookProcessorFromDeps(db, config);

      // Initialize and start queue listener
      queueListener = createQueueListenerFromConfig(db, config, {
        onMessageQueued: () => {
          // Don't await - let it run in background
          processEmailQueue().catch(e => {
            console.error('[Worker] Email processing error:', e);
          });
        },
        onWebhookPending: () => {
          // Don't await - let it run in background
          processWebhookQueue().catch(e => {
            console.error('[Worker] Webhook processing error:', e);
          });
        },
      });

      await queueListener.start();

      running = true;
      startedAt = new Date();
      shutdownRequested = false;

      log('Worker started successfully');
    },

    async stop(): Promise<void> {
      if (!running) {
        log('Worker not running');
        return;
      }

      log('Stopping worker...');
      shutdownRequested = true;

      // Stop accepting new work
      if (queueListener) {
        queueListener.stop();
        queueListener = null;
      }

      // Wait for in-flight work to complete
      log('Waiting for in-flight messages to complete...');
      await waitForInFlight();

      // Close connections
      smtp.close();
      await db.close();

      running = false;
      log('Worker stopped', {
        messagesProcessed: stats.messagesProcessed,
        messagesSent: stats.messagesSent,
        messagesFailed: stats.messagesFailed,
        webhooksDelivered: stats.webhooksDelivered,
        webhooksFailed: stats.webhooksFailed,
      });
    },

    isRunning(): boolean {
      return running;
    },

    getStats(): WorkerStats {
      return {
        ...stats,
        startedAt,
        uptime: startedAt ? Date.now() - startedAt.getTime() : 0,
      };
    },
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('OpenSend Worker');
  console.log('='.repeat(60));
  console.log();

  // Load and validate configuration
  const config = loadConfig();
  const configErrors = validateConfig(config);
  
  if (configErrors.length > 0) {
    console.error('Configuration errors:');
    for (const error of configErrors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log('Configuration loaded:');
  console.log(`  SMTP: ${config.smtpHost}:${config.smtpPort}`);
  console.log(`  Concurrency: ${config.workerConcurrency}`);
  console.log(`  Max Retries: ${config.maxRetries}`);
  console.log(`  Poll Interval: ${config.pollIntervalMs}ms`);
  console.log();

  // Create database client
  console.log('Connecting to database...');
  const db = createDatabaseClient({
    connectionUrl: config.databaseUrl,
    debug: config.debug,
  });

  // Create SMTP client
  console.log('Initializing SMTP client...');
  const smtp = createSmtpClient(config);

  // Verify SMTP connection
  const smtpConnected = await smtp.verify();
  if (!smtpConnected) {
    console.warn('Warning: Could not verify SMTP connection. Will retry on message send.');
  } else {
    console.log('SMTP connection verified');
  }
  console.log();

  // Create worker
  const worker = createWorker(config, db, smtp);

  // Setup signal handlers for graceful shutdown
  let shutdownInProgress = false;

  async function handleShutdown(signal: string): Promise<void> {
    if (shutdownInProgress) {
      console.log('Shutdown already in progress...');
      return;
    }
    
    shutdownInProgress = true;
    console.log();
    console.log(`Received ${signal}, initiating graceful shutdown...`);
    
    try {
      await worker.stop();
      console.log('Shutdown complete');
      process.exit(0);
    } catch (e) {
      console.error('Error during shutdown:', e);
      process.exit(1);
    }
  }

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    handleShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    handleShutdown('unhandledRejection');
  });

  // Start the worker
  try {
    await worker.start();
    console.log('Worker is running. Press Ctrl+C to stop.');
    console.log();

    // Keep the process alive
    // The worker will process messages via event handlers
    while (worker.isRunning()) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Periodically log stats in debug mode
      if (config.debug) {
        const stats = worker.getStats();
        if (stats.messagesProcessed > 0 || stats.webhooksDelivered > 0) {
          console.log('[Stats]', {
            processed: stats.messagesProcessed,
            sent: stats.messagesSent,
            failed: stats.messagesFailed,
            webhooks: stats.webhooksDelivered,
            uptime: Math.floor(stats.uptime / 1000) + 's',
          });
        }
      }
    }
  } catch (e) {
    console.error('Failed to start worker:', e);
    process.exit(1);
  }
}

// Export for module usage
export { createWorker, type WorkerConfig };
export { createSmtpClient, SmtpClient, SmtpError, type SmtpClientConfig } from './smtp/client.js';
export { createQueueListener, type QueueListener, type QueueListenerOptions } from './queue/listener.js';
export { createEmailProcessor, type EmailProcessor, type ProcessResult } from './processors/email.processor.js';
export { createWebhookProcessor, type WebhookProcessor, type WebhookProcessResult } from './processors/webhook.processor.js';
export { loadConfig, validateConfig } from './config.js';

// Run if executed directly
main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
