/**
 * OpenSend Haraka Plugin
 *
 * This plugin interfaces Haraka SMTP server with the OpenSend API for:
 * - Domain verification and DKIM key retrieval
 * - Message signing with domain-specific DKIM keys
 * - Delivery status reporting back to the database
 * - Rate limiting per API key
 * - Suppression list checks
 *
 * Configuration:
 *   Environment variables:
 *   - MAILFORGE_API_URL: URL to OpenSend API (default: http://localhost:3000)
 *   - DATABASE_URL: PostgreSQL connection string for direct DB access
 *
 * @module plugins/opensend
 */

'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

// Plugin configuration
let apiUrl = process.env.MAILFORGE_API_URL || 'http://api:3000';
let databaseUrl = process.env.DATABASE_URL;

// Cache for domain configurations (TTL: 5 minutes)
const domainCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Plugin registration
 */
exports.register = function () {
  const plugin = this;

  plugin.loginfo('OpenSend plugin initializing...');
  plugin.loginfo(`API URL: ${apiUrl}`);

  // Load configuration from haraka config if available
  const cfg = plugin.config.get('opensend.ini', 'ini');
  if (cfg.main) {
    if (cfg.main.api_url) apiUrl = cfg.main.api_url;
  }

  // Register hooks
  plugin.register_hook('mail', 'check_sender');
  plugin.register_hook('rcpt', 'check_recipient');
  plugin.register_hook('queue', 'queue_message');
  plugin.register_hook('delivered', 'handle_delivered');
  plugin.register_hook('deferred', 'handle_deferred');
  plugin.register_hook('bounce', 'handle_bounce');

  plugin.loginfo('OpenSend plugin registered');
};

/**
 * Check sender domain and load DKIM configuration
 */
exports.check_sender = function (next, connection, params) {
  const plugin = this;
  const mail_from = params[0];

  if (!mail_from || !mail_from.host) {
    plugin.logdebug('No sender domain found');
    return next();
  }

  const domain = mail_from.host.toLowerCase();
  plugin.loginfo(`Checking sender domain: ${domain}`);

  // Check cache first
  const cached = getCachedDomain(domain);
  if (cached) {
    connection.transaction.notes.opensend_domain = cached;
    return next();
  }

  // Fetch domain config from API
  fetchDomainConfig(plugin, domain)
    .then((domainConfig) => {
      if (domainConfig) {
        connection.transaction.notes.opensend_domain = domainConfig;
        cacheDomain(domain, domainConfig);
        plugin.loginfo(`Domain verified: ${domain}, DKIM selector: ${domainConfig.dkim_selector}`);
      } else {
        plugin.logwarn(`Domain not verified: ${domain}`);
      }
      next();
    })
    .catch((err) => {
      plugin.logerror(`Error fetching domain config: ${err.message}`);
      // Continue anyway - don't block mail for API errors
      next();
    });
};

/**
 * Check recipient against suppression list
 */
exports.check_recipient = function (next, connection, params) {
  const plugin = this;
  const rcpt_to = params[0];

  if (!rcpt_to || !rcpt_to.address()) {
    return next();
  }

  const recipient = rcpt_to.address().toLowerCase();
  plugin.logdebug(`Checking recipient: ${recipient}`);

  // Check suppression list via API
  checkSuppression(plugin, recipient)
    .then((suppressed) => {
      if (suppressed) {
        plugin.logwarn(`Recipient suppressed: ${recipient}, reason: ${suppressed.reason}`);
        return next(DENY, `Recipient ${recipient} is on the suppression list`);
      }
      next();
    })
    .catch((err) => {
      plugin.logerror(`Error checking suppression: ${err.message}`);
      // Continue anyway - don't block mail for API errors
      next();
    });
};

/**
 * Sign and queue message for delivery
 */
exports.queue_message = function (next, connection) {
  const plugin = this;
  const transaction = connection.transaction;

  // Get message metadata
  const messageId = transaction.header.get('X-OpenSend-Message-ID');
  const apiKeyId = transaction.header.get('X-OpenSend-API-Key-ID');
  const domainConfig = transaction.notes.opensend_domain;

  plugin.loginfo(`Queueing message: ${messageId || 'unknown'}`);

  // Sign with DKIM if we have domain config
  if (domainConfig && domainConfig.dkim_private_key) {
    try {
      signWithDKIM(plugin, transaction, domainConfig);
      plugin.loginfo(`Message signed with DKIM for domain: ${domainConfig.domain}`);
    } catch (err) {
      plugin.logerror(`DKIM signing failed: ${err.message}`);
      // Continue without signing
    }
  }

  // Remove internal headers before sending
  transaction.remove_header('X-OpenSend-Message-ID');
  transaction.remove_header('X-OpenSend-API-Key-ID');

  // Store message ID for status tracking
  if (messageId) {
    transaction.notes.opensend_message_id = messageId;
  }

  // Queue for outbound delivery
  next(OK);
};

/**
 * Handle successful delivery
 */
exports.handle_delivered = function (next, hmail, params) {
  const plugin = this;
  const messageId = hmail.todo?.notes?.opensend_message_id;

  if (messageId) {
    plugin.loginfo(`Message delivered: ${messageId}`);
    updateMessageStatus(plugin, messageId, 'delivered')
      .catch((err) => plugin.logerror(`Failed to update status: ${err.message}`));
  }

  next();
};

/**
 * Handle deferred delivery (temporary failure)
 */
exports.handle_deferred = function (next, hmail, params) {
  const plugin = this;
  const messageId = hmail.todo?.notes?.opensend_message_id;
  const delay = params[0];
  const error = params[1];

  if (messageId) {
    plugin.logwarn(`Message deferred: ${messageId}, delay: ${delay}s, error: ${error}`);
    // Don't update status for temporary failures - let it retry
  }

  next();
};

/**
 * Handle bounced message (permanent failure)
 */
exports.handle_bounce = function (next, hmail, error) {
  const plugin = this;
  const messageId = hmail.todo?.notes?.opensend_message_id;

  if (messageId) {
    plugin.logerror(`Message bounced: ${messageId}, error: ${error}`);
    updateMessageStatus(plugin, messageId, 'bounced', error)
      .catch((err) => plugin.logerror(`Failed to update status: ${err.message}`));
  }

  next();
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Fetch domain configuration from OpenSend API
 */
async function fetchDomainConfig(plugin, domain) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/internal/domains/${encodeURIComponent(domain)}`, apiUrl);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.get(url.toString(), { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${e.message}`));
          }
        } else if (res.statusCode === 404) {
          resolve(null); // Domain not found
        } else {
          reject(new Error(`API returned ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Check if recipient is on suppression list
 */
async function checkSuppression(plugin, email) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/internal/suppressions/check`, apiUrl);
    const client = url.protocol === 'https:' ? https : http;

    const postData = JSON.stringify({ email });
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 5000,
    };

    const req = client.request(url.toString(), options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(data);
            resolve(result.suppressed ? result : null);
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${e.message}`));
          }
        } else {
          resolve(null); // Assume not suppressed on error
        }
      });
    });

    req.on('error', () => resolve(null)); // Don't block on errors
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Update message status in database via API
 */
async function updateMessageStatus(plugin, messageId, status, failureReason = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/internal/messages/${messageId}/status`, apiUrl);
    const client = url.protocol === 'https:' ? https : http;

    const postData = JSON.stringify({
      status,
      failure_reason: failureReason,
      timestamp: new Date().toISOString(),
    });

    const options = {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 5000,
    };

    const req = client.request(url.toString(), options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`API returned ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Sign message with DKIM
 */
function signWithDKIM(plugin, transaction, domainConfig) {
  const dkim = require('haraka-dsn/dkim_sign');

  // Build DKIM signature
  const options = {
    domain: domainConfig.domain,
    selector: domainConfig.dkim_selector,
    privateKey: domainConfig.dkim_private_key,
    headers: [
      'from',
      'to',
      'subject',
      'date',
      'message-id',
      'mime-version',
      'content-type',
      'content-transfer-encoding',
    ],
  };

  // Sign the message
  const signature = createDKIMSignature(transaction, options);
  if (signature) {
    transaction.add_header('DKIM-Signature', signature);
  }
}

/**
 * Create DKIM signature for message
 */
function createDKIMSignature(transaction, options) {
  const { domain, selector, privateKey, headers } = options;

  // Get headers to sign
  const headersToSign = headers
    .map((h) => {
      const value = transaction.header.get(h);
      return value ? `${h}:${value.trim()}` : null;
    })
    .filter(Boolean);

  // Get message body
  const body = transaction.message_stream ? '' : transaction.body?.toString() || '';

  // Create body hash
  const bodyHash = crypto.createHash('sha256').update(canonicalizeBody(body)).digest('base64');

  // Create signature header (without b= value)
  const signatureHeader = [
    `v=1`,
    `a=rsa-sha256`,
    `c=relaxed/relaxed`,
    `d=${domain}`,
    `s=${selector}`,
    `h=${headers.join(':')}`,
    `bh=${bodyHash}`,
    `b=`,
  ].join('; ');

  // Create data to sign
  const dataToSign =
    headersToSign.map(canonicalizeHeader).join('\r\n') +
    '\r\n' +
    `dkim-signature:${canonicalizeHeader(signatureHeader)}`;

  // Sign with private key
  try {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(dataToSign);
    const signature = sign.sign(privateKey, 'base64');

    return signatureHeader + signature;
  } catch (err) {
    throw new Error(`DKIM signing failed: ${err.message}`);
  }
}

/**
 * Canonicalize header (relaxed)
 */
function canonicalizeHeader(header) {
  return header
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*:\s*/g, ':')
    .toLowerCase()
    .trim();
}

/**
 * Canonicalize body (relaxed)
 */
function canonicalizeBody(body) {
  return body
    .replace(/\r?\n/g, '\r\n')
    .replace(/[ \t]+\r\n/g, '\r\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/(\r\n)+$/, '\r\n');
}

/**
 * Get cached domain configuration
 */
function getCachedDomain(domain) {
  const cached = domainCache.get(domain);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

/**
 * Cache domain configuration
 */
function cacheDomain(domain, data) {
  domainCache.set(domain, {
    data,
    timestamp: Date.now(),
  });
}

// Clean up expired cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [domain, cached] of domainCache.entries()) {
    if (now - cached.timestamp >= CACHE_TTL) {
      domainCache.delete(domain);
    }
  }
}, 60000); // Every minute
