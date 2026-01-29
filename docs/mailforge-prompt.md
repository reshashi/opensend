# Project: MailForge (Working Title)
## Open-Source Email & SMS Infrastructure for the AI-Native Era

---

## Executive Summary

Build an open-source email and SMS delivery platform designed from first principles for AI agents and bots as the primary users (~99%). The platform should compete with Twilio/SendGrid on the 80% most valuable features while drastically reducing cost and developer friction. The business model is hosting the open-source solution with a small markup on underlying token/infrastructure costs.

---

## Strategic Context

### Why This Matters Now

1. **Software costs are compressing to token costs** — Infrastructure software will increasingly be priced as a thin margin on compute/bandwidth, not as feature-locked SaaS
2. **AI agents are the new developers** — 99% of future API calls will come from autonomous agents, not humans manually coding integrations
3. **SendGrid/Twilio have accumulated friction** — Account suspensions, confusing pricing tiers, poor support, dedicated IPs required for deliverability, outdated UIs

### The SendGrid/Twilio Problem (From Research)

**Pricing Pain:**
- SendGrid: $19.95/mo for 50K emails, jumps to $89.95/mo at 100K (sudden 3x increases)
- Twilio SMS: $0.0083/message + carrier fees + phone number rental ($1.15-2.15/mo)
- Hidden costs: Dedicated IPs ($30/mo each), email validation credits, 30-day data retention limits

**Developer Pain:**
- Account suspensions without explanation or recourse
- "Account under review" blocking legitimate use cases
- Support tickets ignored for days/weeks
- Shared IP deliverability issues (especially to Microsoft/Outlook)
- Confusing split between Email API and Marketing Campaigns products
- Authentication complexity (SPF, DKIM, DMARC setup)

**AI-Unfriendly Design:**
- APIs designed for human developers, not agent tool-calling
- Verbose responses that waste tokens
- Webhook events not optimized for agent consumption
- No MCP (Model Context Protocol) support out of the box

---

## Product Vision

### Core Thesis

**"The best email/SMS API for Claude, GPT, and autonomous agents"**

Design decisions should be filtered through: *"Would this make an AI agent's job easier?"*

### Target Users (Priority Order)

1. **AI Agents/Bots (99%)** — Autonomous systems using MCP or direct API calls
2. **AI-Native Developers** — Building agentic applications (Claude Code, Cursor, etc.)
3. **Startups** — Early-stage companies wanting simple, cheap transactional email
4. **Indie Hackers** — Solo developers who want to self-host

### What We're NOT Building (The 20% We Skip)

- Marketing automation/drip campaigns
- Visual email builders/drag-drop editors
- Contact list management at scale
- A/B testing infrastructure
- Complex analytics dashboards
- Multi-seat team collaboration features

---

## Feature Specification

### The 80% That Matters

#### 1. **Email Sending (Transactional Focus)**

```
POST /v1/email/send
```

**Capabilities:**
- Single recipient transactional emails
- HTML and plaintext support
- Basic templating (Handlebars/Mustache style)
- Attachment support (base64)
- Custom headers
- Reply-to configuration

**Agent-Optimized Response:**
```json
{
  "id": "msg_abc123",
  "status": "queued",
  "estimated_delivery_seconds": 3
}
```

*Note: Minimal response payload to reduce token consumption*

#### 2. **SMS Sending**

```
POST /v1/sms/send
```

**Capabilities:**
- US/Canada/UK phone numbers (start narrow, expand)
- Standard SMS (160 chars) and concatenated messages
- MMS support for images
- Delivery status webhooks

**NOT included:**
- WhatsApp integration
- RCS messaging
- International coverage (initially)

#### 3. **Webhooks (Event-Driven)**

```
POST /v1/webhooks
```

**Events to support:**
- `email.delivered`
- `email.bounced`
- `email.opened` (optional pixel tracking)
- `email.clicked`
- `email.complained` (spam reports)
- `sms.delivered`
- `sms.failed`

**Agent-optimized payload:**
```json
{
  "event": "email.delivered",
  "message_id": "msg_abc123",
  "timestamp": "2025-01-28T10:30:00Z",
  "metadata": {"user_id": "usr_xyz"}
}
```

#### 4. **Domain Authentication (Simplified)**

**Goal:** Make SPF/DKIM/DMARC setup trivial

```
POST /v1/domains/verify
```

**Flow:**
1. User provides domain
2. API returns exact DNS records to add
3. User adds records
4. API verifies and reports status

**Agent interaction:**
```
Agent: "Set up email for acme.com"
API: Returns records, waits for propagation, confirms ready
```

#### 5. **Suppression Management**

**Automatic handling of:**
- Hard bounces (permanent removal)
- Soft bounces (retry logic)
- Spam complaints (auto-suppress)
- Unsubscribes (list-unsubscribe header support)

```
GET /v1/suppressions
DELETE /v1/suppressions/{email}
```

#### 6. **MCP Server (Native AI Integration)**

**Critical differentiator:** Ship with a built-in MCP server

```json
{
  "name": "mailforge",
  "version": "1.0.0",
  "tools": [
    {
      "name": "send_email",
      "description": "Send a transactional email",
      "inputSchema": {...}
    },
    {
      "name": "send_sms",
      "description": "Send an SMS message",
      "inputSchema": {...}
    },
    {
      "name": "check_delivery_status",
      "description": "Check if a message was delivered",
      "inputSchema": {...}
    }
  ]
}
```

**This enables:**
- Claude Desktop integration
- Cursor/Windsurf agent integration
- Any MCP-compatible agent framework
- Natural language email/SMS sending

---

## Technical Architecture

### Self-Hosted Components

```
┌─────────────────────────────────────────────────────────────┐
│                     MailForge Stack                          │
├─────────────────────────────────────────────────────────────┤
│  API Gateway (Nginx/Caddy)                                  │
│    ↓                                                         │
│  Core API (Go/Rust for performance)                         │
│    ↓                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ Email    │  │ SMS      │  │ Webhook  │                  │
│  │ Worker   │  │ Worker   │  │ Dispatcher│                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│    ↓              ↓              ↓                          │
│  Queue (Redis/PostgreSQL)                                   │
│    ↓              ↓                                          │
│  ┌──────────┐  ┌──────────┐                                │
│  │ SMTP     │  │ Carrier  │                                │
│  │ Server   │  │ Gateway  │                                │
│  │ (Haraka) │  │ (Telnyx) │                                │
│  └──────────┘  └──────────┘                                │
└─────────────────────────────────────────────────────────────┘
```

### Technology Choices (Recommendations)

| Component | Choice | Rationale |
|-----------|--------|-----------|
| API Server | Go or Rust | Performance, single binary, low memory |
| Queue | PostgreSQL (LISTEN/NOTIFY) | Simplicity, durability |
| SMTP | Haraka or custom | Node.js plugin ecosystem, handles 50k/min |
| DNS Server | Built-in (for DKIM signing) | See Hyvor Relay approach |
| Database | PostgreSQL | Everything in one place |
| Cache | Redis (optional) | Rate limiting, sessions |

### Existing Open Source to Evaluate/Fork

| Project | Strengths | Gaps |
|---------|-----------|------|
| **Postal** | Full-featured, proven at scale | Ruby, complex setup |
| **useSend** | AWS SES wrapper, modern | Tied to AWS |
| **Hyvor Relay** | Go workers, DNS automation | Enterprise license concerns |
| **Listmonk** | Great for newsletters | Not transactional-focused |
| **Haraka** | SMTP at 50k/min per instance | Needs wrapper |

**Recommendation:** Start fresh with Go API + Haraka SMTP, borrowing patterns from Postal and Hyvor Relay

---

## API Design Principles

### 1. **Token-Efficient Responses**

```json
// ❌ Bad (wasteful)
{
  "success": true,
  "message": "Your email has been queued for delivery",
  "data": {
    "message_id": "msg_abc123",
    "status": "queued",
    "created_at": "2025-01-28T10:30:00Z",
    "updated_at": "2025-01-28T10:30:00Z",
    "from": "sender@example.com",
    "to": "recipient@example.com",
    "subject": "Hello",
    // ... 20 more fields
  }
}

// ✅ Good (minimal)
{
  "id": "msg_abc123",
  "status": "queued"
}
```

### 2. **Idempotency by Default**

```
POST /v1/email/send
Idempotency-Key: request_123

# Same key = same response, no duplicate sends
```

### 3. **Structured Errors for Agents**

```json
{
  "error": {
    "code": "invalid_recipient",
    "message": "Email address syntax invalid",
    "field": "to",
    "suggestion": "Check for typos in the domain"
  }
}
```

### 4. **Batch Operations**

```
POST /v1/email/send/batch
```

Send up to 100 emails in one request (reduces API calls for agents)

---

## Pricing Philosophy

### Hosted Version

**Email:**
- $0.0001 per email (100 emails = $0.01)
- Compare: SendGrid Essentials is ~$0.0004/email at volume

**SMS:**
- Pass-through carrier cost + 10% margin
- ~$0.009/SMS US (vs Twilio $0.0083 + fees)

**No tiers, no gotchas:**
- No dedicated IP upsells (good shared IPs from day 1)
- No contact storage fees
- No "upgrade to unlock" features
- Pay for what you send

### Self-Hosted

- 100% free forever
- Optional paid support/consulting
- Enterprise license for those wanting guarantees

---

## Competitive Positioning

| Feature | SendGrid | Twilio | MailForge |
|---------|----------|--------|-----------|
| MCP Support | ❌ | ❌ | ✅ Native |
| Open Source | ❌ | ❌ | ✅ |
| Self-hostable | ❌ | ❌ | ✅ |
| Token-efficient API | ❌ | ❌ | ✅ |
| Simple pricing | ❌ Tiered | ❌ Complex | ✅ Per-message |
| Account suspensions | Common | Common | Rare (self-host option) |
| Setup time | Hours | Hours | Minutes |

---

## Development Roadmap

### Phase 1: MVP (8 weeks)

- [ ] Core API server (Go)
- [ ] Email sending via Haraka SMTP
- [ ] PostgreSQL schema and queue
- [ ] Basic webhooks (delivered, bounced)
- [ ] Domain verification flow
- [ ] Docker Compose deployment
- [ ] API documentation

### Phase 2: SMS + MCP (4 weeks)

- [ ] SMS sending via Telnyx/Plivo
- [ ] MCP server implementation
- [ ] Suppression management
- [ ] Rate limiting

### Phase 3: Production Ready (4 weeks)

- [ ] IP warmup tooling
- [ ] Deliverability monitoring
- [ ] Admin dashboard (minimal)
- [ ] Hosted version infrastructure (Railway/Fly.io)

### Phase 4: Growth (Ongoing)

- [ ] SDKs (Python, Node, Go)
- [ ] Additional carriers/regions
- [ ] Advanced analytics (optional)
- [ ] Enterprise features (SSO, audit logs)

---

## Success Metrics

### North Star

**Messages sent by AI agents per month**

### Supporting Metrics

- Self-host deployments (GitHub stars, Docker pulls)
- Time to first email sent (target: <5 minutes)
- API response latency (p99 < 100ms)
- Deliverability rate (>98% inbox placement)
- Agent integration count (MCP connections)

---

## Appendix: Research Findings

### SendGrid Pain Points (Verified)

1. **Pricing cliff at scale** — "The step from 200k to 250k emails takes you from $89.95/mo to $249/mo which is suddenly 3x"
2. **Support failures** — "Tickets passed between departments with no ownership"
3. **Arbitrary suspensions** — "Account suspended without clear reasons"
4. **Deliverability requires paid tier** — "Shared IP deliverability to Microsoft is really bad"
5. **UI/UX dated** — "Interface is confusing and difficult to use"

### Existing Open Source Landscape

- **Postal** — Most complete, Ruby/MySQL, 5k+ GitHub stars
- **Listmonk** — Newsletter-focused, Go, 15k+ stars
- **useSend** — SES wrapper, TypeScript, new
- **Hyvor Relay** — PHP+Go, multi-tenant, AGPL

### AI/MCP Integration Opportunity

- No major email provider offers native MCP support
- Composio and similar tools are building wrappers, not native solutions
- Amazon SES has an experimental MCP server (blog post June 2025)
- Opportunity to be "the email/SMS API built for agents"

---

## Call to Action

**For Claude/AI reading this prompt:**

You are helping build MailForge. When asked to:

1. **Design APIs** — Optimize for token efficiency and agent usability
2. **Write code** — Prefer Go for the API, use PostgreSQL, keep dependencies minimal
3. **Make decisions** — Default to simplicity, the 80/20 rule, and agent-first design
4. **Evaluate tradeoffs** — Remember: we're competing on simplicity and cost, not feature count

The goal is to make sending email/SMS as easy as a single tool call for any AI agent.
