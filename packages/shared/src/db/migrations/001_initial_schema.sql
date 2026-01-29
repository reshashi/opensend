-- ============================================================================
-- MailForge Initial Database Schema
-- PostgreSQL 16+ required
-- ============================================================================

-- Enable UUID extension for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- API Keys Table
-- Stores hashed API keys for authentication
-- ============================================================================
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA256 hash of the API key
    name VARCHAR(255) NOT NULL,
    rate_limit_per_second INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- Index for key lookup during authentication
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);

COMMENT ON TABLE api_keys IS 'API keys for authenticating requests to MailForge';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA256 hash of the plaintext API key';
COMMENT ON COLUMN api_keys.rate_limit_per_second IS 'Maximum requests per second allowed for this key';

-- ============================================================================
-- Domains Table
-- Verified sending domains with DKIM configuration
-- ============================================================================
CREATE TABLE domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    dkim_selector VARCHAR(63) NOT NULL,
    dkim_private_key TEXT,  -- Encrypted at rest by application
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    
    UNIQUE(api_key_id, domain)
);

-- Index for domain lookups
CREATE INDEX idx_domains_api_key_id ON domains(api_key_id);
CREATE INDEX idx_domains_domain ON domains(domain);

COMMENT ON TABLE domains IS 'Verified sending domains for email authentication';
COMMENT ON COLUMN domains.dkim_selector IS 'DKIM selector (e.g., mailforge1 for mailforge1._domainkey.example.com)';
COMMENT ON COLUMN domains.dkim_private_key IS 'DKIM private key for signing emails (encrypted at rest)';

-- ============================================================================
-- Messages Table
-- Email and SMS queue with delivery tracking
-- ============================================================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(255),
    type VARCHAR(10) NOT NULL CHECK (type IN ('email', 'sms')),
    status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN (
        'queued', 'processing', 'sent', 'delivered', 'bounced', 'failed', 'rejected'
    )),
    from_address VARCHAR(255) NOT NULL,
    to_address VARCHAR(255) NOT NULL,
    subject VARCHAR(998),  -- RFC 5322 max subject length
    body TEXT,
    html_body TEXT,
    metadata JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    
    -- Idempotency constraint: same key + api_key should not be processed twice
    UNIQUE(api_key_id, idempotency_key)
);

-- Critical indexes for queue processing
CREATE INDEX idx_messages_status ON messages(status) WHERE status IN ('queued', 'processing');
CREATE INDEX idx_messages_api_key_id ON messages(api_key_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_to_address ON messages(to_address);

-- Composite index for common queries
CREATE INDEX idx_messages_api_key_status ON messages(api_key_id, status);
CREATE INDEX idx_messages_api_key_created ON messages(api_key_id, created_at DESC);

COMMENT ON TABLE messages IS 'Email and SMS message queue with delivery status tracking';
COMMENT ON COLUMN messages.idempotency_key IS 'Client-provided key to prevent duplicate sends';
COMMENT ON COLUMN messages.metadata IS 'Arbitrary JSON metadata attached by the client';
COMMENT ON COLUMN messages.attempts IS 'Number of delivery attempts made';

-- ============================================================================
-- Suppressions Table
-- Bounced/complained email addresses that should not be contacted
-- ============================================================================
CREATE TABLE suppressions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    reason VARCHAR(50) NOT NULL CHECK (reason IN (
        'hard_bounce', 'soft_bounce', 'complaint', 'unsubscribe', 'manual'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(api_key_id, email)
);

-- Index for suppression checks before sending
CREATE INDEX idx_suppressions_api_key_email ON suppressions(api_key_id, email);

COMMENT ON TABLE suppressions IS 'Suppressed email addresses that should not receive messages';
COMMENT ON COLUMN suppressions.reason IS 'Why this email was suppressed';

-- ============================================================================
-- Webhooks Table
-- Registered webhook endpoints for event notifications
-- ============================================================================
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    url VARCHAR(2048) NOT NULL,
    events TEXT[] NOT NULL,  -- Array of event types to subscribe to
    secret VARCHAR(64) NOT NULL,  -- Used to sign webhook payloads
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for webhook lookups
CREATE INDEX idx_webhooks_api_key_id ON webhooks(api_key_id);
CREATE INDEX idx_webhooks_active ON webhooks(api_key_id, active) WHERE active = TRUE;

COMMENT ON TABLE webhooks IS 'Webhook registrations for receiving event notifications';
COMMENT ON COLUMN webhooks.events IS 'Array of event types this webhook should receive';
COMMENT ON COLUMN webhooks.secret IS 'Secret used to sign webhook payloads (HMAC-SHA256)';

-- ============================================================================
-- Webhook Deliveries Table
-- Tracks webhook delivery attempts for reliability
-- ============================================================================
CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    event VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'delivered', 'failed'
    )),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for webhook delivery processing
CREATE INDEX idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status) WHERE status = 'pending';
CREATE INDEX idx_webhook_deliveries_message_id ON webhook_deliveries(message_id);

COMMENT ON TABLE webhook_deliveries IS 'Tracks individual webhook delivery attempts';
COMMENT ON COLUMN webhook_deliveries.payload IS 'The JSON payload sent to the webhook';
COMMENT ON COLUMN webhook_deliveries.attempts IS 'Number of delivery attempts made';

-- ============================================================================
-- Functions for Queue Processing (LISTEN/NOTIFY)
-- ============================================================================

-- Function to notify when a new message is queued
CREATE OR REPLACE FUNCTION notify_message_queued()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('message_queued', json_build_object(
        'id', NEW.id::text,
        'type', NEW.type,
        'api_key_id', NEW.api_key_id::text
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to fire notification on message insert
CREATE TRIGGER trigger_message_queued
    AFTER INSERT ON messages
    FOR EACH ROW
    WHEN (NEW.status = 'queued')
    EXECUTE FUNCTION notify_message_queued();

-- Function to notify when a webhook delivery is pending
CREATE OR REPLACE FUNCTION notify_webhook_pending()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('webhook_pending', json_build_object(
        'id', NEW.id::text,
        'webhook_id', NEW.webhook_id::text
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for webhook delivery notifications
CREATE TRIGGER trigger_webhook_pending
    AFTER INSERT ON webhook_deliveries
    FOR EACH ROW
    WHEN (NEW.status = 'pending')
    EXECUTE FUNCTION notify_webhook_pending();

-- ============================================================================
-- Helper function to claim a message for processing (atomic operation)
-- ============================================================================
CREATE OR REPLACE FUNCTION claim_next_message(worker_id TEXT)
RETURNS SETOF messages AS $$
    UPDATE messages
    SET status = 'processing'
    WHERE id = (
        SELECT id FROM messages
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
$$ LANGUAGE SQL;

COMMENT ON FUNCTION claim_next_message IS 'Atomically claim the next queued message for processing';

-- ============================================================================
-- Helper function to claim a webhook delivery for processing
-- ============================================================================
CREATE OR REPLACE FUNCTION claim_next_webhook_delivery()
RETURNS SETOF webhook_deliveries AS $$
    UPDATE webhook_deliveries
    SET status = 'pending', attempts = attempts + 1, last_attempt_at = NOW()
    WHERE id = (
        SELECT id FROM webhook_deliveries
        WHERE status = 'pending'
        AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL '30 seconds')
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
$$ LANGUAGE SQL;

COMMENT ON FUNCTION claim_next_webhook_delivery IS 'Atomically claim the next pending webhook delivery';

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Additional performance indexes based on expected query patterns
-- These can be fine-tuned based on actual usage patterns

-- For analytics queries
CREATE INDEX idx_messages_api_key_type_status ON messages(api_key_id, type, status);

-- For time-based queries (last 24h, last 7d, etc.)
CREATE INDEX idx_messages_created_at_status ON messages(created_at, status);

-- For delivery tracking
CREATE INDEX idx_messages_sent_at ON messages(sent_at) WHERE sent_at IS NOT NULL;
CREATE INDEX idx_messages_delivered_at ON messages(delivered_at) WHERE delivered_at IS NOT NULL;
CREATE INDEX idx_messages_failed_at ON messages(failed_at) WHERE failed_at IS NOT NULL;
