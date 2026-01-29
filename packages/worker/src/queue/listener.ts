/**
 * PostgreSQL LISTEN/NOTIFY Queue Listener
 * Handles message queue subscriptions and polling for stuck messages
 */

import type { DatabaseClient } from '@mailforge/shared';
import type { WorkerConfig } from '../config.js';

// ============================================================================
// Types
// ============================================================================

export interface QueueListenerOptions {
  /** Callback when a new message is queued */
  onMessageQueued: () => void;
  
  /** Callback when a new webhook delivery is pending */
  onWebhookPending: () => void;
  
  /** Polling interval in milliseconds */
  pollIntervalMs: number;
  
  /** Enable debug logging */
  debug?: boolean;
}

export interface QueueListener {
  /** Start listening for notifications and polling */
  start(): Promise<void>;
  
  /** Stop listening and polling */
  stop(): void;
  
  /** Check if the listener is running */
  isRunning(): boolean;
}

// ============================================================================
// Queue Listener Implementation
// ============================================================================

export function createQueueListener(
  db: DatabaseClient,
  options: QueueListenerOptions
): QueueListener {
  let running = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const debug = options.debug ?? false;

  /**
   * Log debug message
   */
  function log(message: string, data?: Record<string, unknown>): void {
    if (debug) {
      if (data) {
        console.log(`[QueueListener] ${message}`, data);
      } else {
        console.log(`[QueueListener] ${message}`);
      }
    }
  }

  /**
   * Set up PostgreSQL LISTEN subscriptions
   */
  async function setupListeners(): Promise<void> {
    log('Setting up PostgreSQL LISTEN subscriptions');

    // Listen for new messages
    await db.listen.onMessageQueued((payload) => {
      log('Received message_queued notification', payload as unknown as Record<string, unknown>);
      options.onMessageQueued();
    });

    // Listen for new webhook deliveries
    await db.listen.onWebhookPending((payload) => {
      log('Received webhook_pending notification', payload as unknown as Record<string, unknown>);
      options.onWebhookPending();
    });

    log('LISTEN subscriptions active');
  }

  /**
   * Start periodic polling for stuck messages
   * This handles cases where NOTIFY might have been missed
   */
  function startPolling(): void {
    log('Starting periodic polling', { intervalMs: options.pollIntervalMs });

    pollTimer = setInterval(() => {
      log('Polling for stuck messages');
      options.onMessageQueued();
      options.onWebhookPending();
    }, options.pollIntervalMs);
  }

  /**
   * Stop polling
   */
  function stopPolling(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      log('Polling stopped');
    }
  }

  return {
    async start(): Promise<void> {
      if (running) {
        log('Already running, ignoring start request');
        return;
      }

      log('Starting queue listener');
      running = true;

      // Set up PostgreSQL LISTEN
      await setupListeners();

      // Start polling for stuck messages
      startPolling();

      // Trigger initial processing of any pending messages
      log('Triggering initial queue processing');
      options.onMessageQueued();
      options.onWebhookPending();

      log('Queue listener started successfully');
    },

    stop(): void {
      if (!running) {
        log('Not running, ignoring stop request');
        return;
      }

      log('Stopping queue listener');
      running = false;
      stopPolling();
      log('Queue listener stopped');
    },

    isRunning(): boolean {
      return running;
    },
  };
}

/**
 * Create a queue listener from worker configuration
 */
export function createQueueListenerFromConfig(
  db: DatabaseClient,
  config: WorkerConfig,
  callbacks: Pick<QueueListenerOptions, 'onMessageQueued' | 'onWebhookPending'>
): QueueListener {
  return createQueueListener(db, {
    ...callbacks,
    pollIntervalMs: config.pollIntervalMs,
    debug: config.debug,
  });
}
