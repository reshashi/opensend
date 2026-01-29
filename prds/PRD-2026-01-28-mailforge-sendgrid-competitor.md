# PRD: MailForge - Open-Source Email & SMS Infrastructure for AI Agents

## 1. Executive Summary

MailForge is an open-source email and SMS delivery platform designed from first principles for AI agents and bots as the primary users (~99%). The platform competes with Twilio/SendGrid on the most valuable 80% of features while drastically reducing cost and developer friction. The hosted version charges a small markup on underlying infrastructure costs, while self-hosting remains free forever. The licensing model ensures the creator retains exclusive rights to host and sell services, while the software is freely available for self-hosted use.

**Core Philosophy:**
- Software costs compress to token costs + small margin
- AI agents are the primary users, not human developers
- MCP-native design for seamless agent integration
- 80/20 rule: focus on the most valuable features for startups and AI-native developers

---

## 2. Goals & Success Criteria

### Must Have (MVP)
- [ ] `POST /v1/email/send` works end-to-end with <100ms p99 latency
- [ ] Domain verification flow returns exact DNS records and confirms setup
- [ ] MCP server installable via `npm install -g mailforge-mcp`
- [ ] Claude Desktop integration documented and tested
- [ ] Docker Compose self-host deployment works with single `docker compose up`
- [ ] Token-efficient API responses (minimal JSON payloads)
- [ ] Idempotency support via `Idempotency-Key` header
- [ ] Basic webhook events: delivered, bounced, failed
- [ ] Suppression management (auto-suppress hard bounces, complaints)
- [ ] API key authentication with per-key rate limiting

### Should Have (Phase 2)
- [ ] `POST /v1/sms/send` works for US/Canada numbers via Telnyx
- [ ] Batch email sending (up to 100 per request)
- [ ] Railway/Fly.io one-click deploy for hosted version
- [ ] IP warmup scheduling logic
- [ ] Deliverability monitoring dashboard (CLI-based)

### Future (See FUTURE.md)
- [ ] AI-powered content policy checker (block spam/malicious emails)
- [ ] International SMS coverage
- [ ] Advanced analytics
- [ ] SDKs for Python, Node, Go
- [ ] Enterprise features (SSO, audit logs)

---

## 3. Technical Requirements

### Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| API Server | TypeScript/Bun | Fast iteration, MCP ecosystem alignment, Moltbot compatibility |
| Queue | PostgreSQL (LISTEN/NOTIFY) | Simplicity, durability, single database |
| SMTP | Haraka | Node.js plugins, 50k emails/min per instance |
| Database | PostgreSQL 16 | Everything in one place |
| Cache | None initially | Add Redis later if needed |
| Deployment | Docker Compose | Simple self-hosting |

### Files to Create

```
mailforge/
├── package.json                     # Root package with workspaces
├── docker-compose.yml               # Self-hosted deployment
├── docker-compose.dev.yml           # Development environment
├── LICENSE                          # Custom license (exclusive hosting rights)
├── README.md                        # Project documentation
├── FUTURE.md                        # Future improvements backlog
├── .env.example                     # Environment template
│
├── packages/
│   ├── api/                         # Core API server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts             # Entry point
│   │   │   ├── config.ts            # Environment config
│   │   │   ├── routes/
│   │   │   │   ├── email.ts         # POST /v1/email/send
│   │   │   │   ├── domains.ts       # Domain verification
│   │   │   │   ├── webhooks.ts      # Webhook management
│   │   │   │   ├── suppressions.ts  # Suppression list
│   │   │   │   └── health.ts        # Health checks
│   │   │   ├── services/
│   │   │   │   ├── email.service.ts
│   │   │   │   ├── domain.service.ts
│   │   │   │   ├── webhook.service.ts
│   │   │   │   └── queue.service.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts          # API key auth
│   │   │   │   ├── rate-limit.ts    # Token bucket rate limiting
│   │   │   │   └── idempotency.ts   # Idempotency handling
│   │   │   └── types/
│   │   │       └── index.ts         # Shared types
│   │   └── Dockerfile
│   │
│   ├── worker/                      # Background job processor
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── processors/
│   │   │   │   ├── email.processor.ts
│   │   │   │   └── webhook.processor.ts
│   │   │   └── smtp/
│   │   │       └── haraka.config.ts
│   │   └── Dockerfile
│   │
│   ├── mcp-server/                  # MCP server for AI agents
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts             # MCP entry point
│   │   │   ├── tools/
│   │   │   │   ├── send-email.ts
│   │   │   │   ├── check-status.ts
│   │   │   │   └── verify-domain.ts
│   │   │   └── transports/
│   │   │       ├── stdio.ts         # For Claude Desktop
│   │   │       └── http.ts          # For Moltbot/remote
│   │   └── bin/
│   │       └── mailforge-mcp        # CLI entry
│   │
│   └── shared/                      # Shared utilities
│       ├── package.json
│       └── src/
│           ├── db/
│           │   ├── client.ts
│           │   ├── schema.ts
│           │   └── migrations/
│           ├── types.ts
│           └── errors.ts
│
├── haraka/                          # SMTP server config
│   ├── config/
│   │   ├── smtp.ini
│   │   ├── dkim/
│   │   └── plugins
│   └── plugins/
│       └── mailforge.js
│
└── docs/
    ├── self-hosting.md
    ├── api-reference.md
    ├── mcp-integration.md
    └── claude-desktop.md
```

### Database Schema (PostgreSQL)

```sql
-- API Keys
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255),
    rate_limit_per_second INT DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

-- Domains
CREATE TABLE domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID REFERENCES api_keys(id),
    domain VARCHAR(255) NOT NULL,
    verified BOOLEAN DEFAULT FALSE,
    dkim_selector VARCHAR(63),
    dkim_private_key TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    verified_at TIMESTAMPTZ
);

-- Messages (email queue)
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID REFERENCES api_keys(id),
    idempotency_key VARCHAR(255),
    type VARCHAR(10) NOT NULL, -- 'email' or 'sms'
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    from_address VARCHAR(255),
    to_address VARCHAR(255) NOT NULL,
    subject VARCHAR(998),
    body TEXT,
    html_body TEXT,
    metadata JSONB DEFAULT '{}',
    attempts INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    UNIQUE(api_key_id, idempotency_key)
);

-- Suppressions (bounce/complaint list)
CREATE TABLE suppressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID REFERENCES api_keys(id),
    email VARCHAR(255) NOT NULL,
    reason VARCHAR(50) NOT NULL, -- 'hard_bounce', 'complaint', 'unsubscribe'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(api_key_id, email)
);

-- Webhooks
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID REFERENCES api_keys(id),
    url VARCHAR(2048) NOT NULL,
    events TEXT[] NOT NULL,
    secret VARCHAR(64),
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook deliveries (for retry logic)
CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID REFERENCES webhooks(id),
    message_id UUID REFERENCES messages(id),
    event VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    attempts INT DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_messages_status ON messages(status) WHERE status IN ('queued', 'sending');
CREATE INDEX idx_messages_api_key ON messages(api_key_id);
CREATE INDEX idx_suppressions_email ON suppressions(api_key_id, email);
CREATE INDEX idx_webhook_deliveries_pending ON webhook_deliveries(status) WHERE status = 'pending';
```

### Dependencies

**API Server (packages/api):**
- `hono` - Lightweight, fast HTTP framework
- `@hono/node-server` - Node.js adapter
- `postgres` - PostgreSQL client
- `zod` - Schema validation
- `nanoid` - ID generation

**Worker (packages/worker):**
- `postgres` - PostgreSQL client
- `nodemailer` - SMTP client
- `p-retry` - Retry logic

**MCP Server (packages/mcp-server):**
- `@modelcontextprotocol/sdk` - MCP SDK
- `zod` - Schema validation

---

## 4. Worker Task Breakdown

### Worker 1: db-schema
- **Task**: Create PostgreSQL schema, migrations, and database client
- **Owns**: `packages/shared/src/db/`, database migrations
- **Off-limits**: `packages/api/`, `packages/worker/`, `packages/mcp-server/`
- **Depends on**: none

### Worker 2: api-core
- **Task**: Set up Hono API server with health checks, auth middleware, rate limiting, and idempotency middleware
- **Owns**: `packages/api/src/index.ts`, `packages/api/src/config.ts`, `packages/api/src/middleware/`
- **Off-limits**: `packages/api/src/routes/email.ts`, `packages/api/src/services/`
- **Depends on**: db-schema

### Worker 3: api-email
- **Task**: Implement `POST /v1/email/send` endpoint with validation, queueing, and token-efficient responses
- **Owns**: `packages/api/src/routes/email.ts`, `packages/api/src/services/email.service.ts`, `packages/api/src/services/queue.service.ts`
- **Off-limits**: `packages/api/src/middleware/`, `packages/worker/`
- **Depends on**: db-schema, api-core

### Worker 4: api-domains
- **Task**: Implement domain verification flow with DNS record generation (SPF, DKIM, DMARC)
- **Owns**: `packages/api/src/routes/domains.ts`, `packages/api/src/services/domain.service.ts`
- **Off-limits**: `packages/api/src/routes/email.ts`, `packages/worker/`
- **Depends on**: db-schema, api-core

### Worker 5: email-worker
- **Task**: Build background worker that processes email queue and sends via SMTP
- **Owns**: `packages/worker/`
- **Off-limits**: `packages/api/src/routes/`, `packages/mcp-server/`
- **Depends on**: db-schema

### Worker 6: mcp-server
- **Task**: Create MCP server with send_email, check_status, and verify_domain tools supporting both stdio and HTTP transports
- **Owns**: `packages/mcp-server/`
- **Off-limits**: `packages/api/`, `packages/worker/`
- **Depends on**: none (calls API via HTTP)

### Worker 7: docker-deploy
- **Task**: Create Docker Compose configuration for self-hosted deployment with PostgreSQL and Haraka SMTP
- **Owns**: `docker-compose.yml`, `docker-compose.dev.yml`, `Dockerfile` files, `haraka/`
- **Off-limits**: `packages/*/src/`
- **Depends on**: api-core, email-worker

### Worker 8: docs-license
- **Task**: Create README, API documentation, self-hosting guide, MCP integration docs, and custom license
- **Owns**: `README.md`, `LICENSE`, `docs/`, `FUTURE.md`
- **Off-limits**: `packages/`
- **Depends on**: api-email, mcp-server

---

## 5. Verification Plan

### Automated Checks
- [ ] `npm run type-check` passes across all packages
- [ ] `npm run lint` passes with no errors
- [ ] `npm run test` passes all unit tests
- [ ] `npm run build` produces valid Docker images
- [ ] Database migrations apply cleanly

### Integration Tests
- [ ] API key creation and authentication works
- [ ] `POST /v1/email/send` queues email and returns message ID
- [ ] Idempotency key prevents duplicate sends
- [ ] Rate limiting triggers at threshold
- [ ] Domain verification returns correct DNS records
- [ ] Worker processes queued emails and updates status
- [ ] MCP server responds to tool calls correctly

### End-to-End Tests
- [ ] Docker Compose brings up full stack
- [ ] Email sends from API → Queue → Worker → SMTP
- [ ] Claude Desktop can call MCP tools
- [ ] Webhook events fire on delivery/bounce

### Manual Verification
- [ ] Self-hosting instructions work from scratch on clean machine
- [ ] API response payloads are minimal (token-efficient)
- [ ] License text correctly reserves hosting rights
- [ ] FUTURE.md contains AI content policy checker task

---

## 6. API Design Specifications

### Authentication
```
Authorization: Bearer mf_live_xxxxxxxxxxxx
```

API keys prefixed with `mf_live_` (production) or `mf_test_` (sandbox).

### Request/Response Format

**POST /v1/email/send**
```json
// Request
{
  "to": "recipient@example.com",
  "subject": "Hello from MailForge",
  "body": "Plain text body",
  "html": "<h1>Hello</h1><p>HTML body</p>",
  "from": "sender@yourdomain.com",
  "reply_to": "replies@yourdomain.com",
  "metadata": {"user_id": "usr_123"}
}

// Response (token-efficient)
{
  "id": "msg_abc123",
  "status": "queued"
}
```

**GET /v1/email/{id}**
```json
{
  "id": "msg_abc123",
  "status": "delivered",
  "to": "recipient@example.com",
  "sent_at": "2026-01-28T10:30:00Z"
}
```

**POST /v1/domains/verify**
```json
// Request
{
  "domain": "acme.com"
}

// Response
{
  "domain": "acme.com",
  "verified": false,
  "records": [
    {"type": "TXT", "name": "acme.com", "value": "v=spf1 include:mailforge.dev ~all"},
    {"type": "TXT", "name": "mf._domainkey.acme.com", "value": "v=DKIM1; k=rsa; p=MIGf..."},
    {"type": "TXT", "name": "_dmarc.acme.com", "value": "v=DMARC1; p=none; rua=mailto:dmarc@acme.com"}
  ]
}
```

### Error Format
```json
{
  "error": {
    "code": "invalid_recipient",
    "message": "Email address syntax invalid",
    "field": "to"
  }
}
```

### HTTP Status Codes
- `200` - Success
- `201` - Created (new message queued)
- `400` - Bad request (validation error)
- `401` - Unauthorized (invalid API key)
- `429` - Rate limited
- `500` - Internal server error

---

## 7. MCP Server Specification

### Tools

```typescript
const tools = [
  {
    name: "mailforge_send_email",
    description: "Send a transactional email. Returns message ID and status.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body (plain text or HTML)" },
        from: { type: "string", description: "Sender email (optional)" },
        reply_to: { type: "string", description: "Reply-to address (optional)" }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "mailforge_check_status",
    description: "Check delivery status of a sent message",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Message ID from send response" }
      },
      required: ["message_id"]
    }
  },
  {
    name: "mailforge_verify_domain",
    description: "Get DNS records needed to verify a sending domain",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Domain to verify (e.g., acme.com)" }
      },
      required: ["domain"]
    }
  }
]
```

### Transport Configuration

**stdio (Claude Desktop):**
```json
{
  "mcpServers": {
    "mailforge": {
      "command": "mailforge-mcp",
      "args": ["--api-key", "${MAILFORGE_API_KEY}"]
    }
  }
}
```

**HTTP (Moltbot/remote):**
```
MAILFORGE_MCP_TRANSPORT=http
MAILFORGE_MCP_PORT=3002
```

---

## 8. Licensing Model

The LICENSE file shall contain a custom license with the following terms:

1. **Free self-hosting**: Anyone may download, modify, and run MailForge for their own use at no cost
2. **Exclusive commercial hosting**: Only the original creator (or designated licensees) may offer MailForge as a hosted service for payment
3. **Contribution license**: Contributors grant the original creator full rights to their contributions
4. **No warranty**: Software provided as-is

This model mirrors the approach of projects like Supabase, GitLab, and others that offer open-source software with commercial hosting exclusivity.
