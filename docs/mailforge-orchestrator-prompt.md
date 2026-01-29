# MailForge: Open-Source Email & SMS Infrastructure for AI Agents

## Claude Code Orchestrator Prompt

> **For use with:** [claude-orchestrator](https://github.com/reshashi/claude-orchestrator)
> **Execution model:** Parallel workers via `/spawn`, decision checkpoints requiring human input
> **Philosophy:** Use existing MCP servers and Claude skills—avoid custom code where possible

---

## 🚨 CRITICAL: How to Use This Prompt

This prompt is designed for **Claude Code** running with the **claude-orchestrator** pattern.

### Execution Rules

1. **STOP at every `🛑 DECISION CHECKPOINT`** — Present options, ask clarifying questions, wait for human response before proceeding
2. **Use `/spawn` for parallel work** — Never work sequentially when tasks can be parallelized
3. **MCP-first** — Always check if an MCP server exists before writing custom code
4. **No UI** — This is infrastructure for bots. Zero frontend, zero dashboards, zero visual components
5. **Integrate with consumers** — Design for Claude API, Moltbot gateway, and direct MCP tool calls

---

## Project Overview

**Mission:** Build an open-source email and SMS delivery platform where:
- 99% of API calls come from AI agents (Claude, GPT, Moltbot, etc.)
- The hosted version charges a small markup on underlying infrastructure costs
- Self-hosting is free forever

**Anti-goals:**
- No marketing automation / drip campaigns
- No visual email builders
- No contact list management
- No dashboards or admin UIs
- No human-facing features

---

## Phase 0: Project Setup

### Initial Commands
```bash
# Create project structure
mkdir -p mailforge/{api,workers,mcp-server,config,docs}
cd mailforge
git init

# Initialize orchestrator worktrees
wt create mailforge main
```

### 🛑 DECISION CHECKPOINT: Core Technology Stack

Before spawning workers, I need your input on foundational choices:

**Question 1: Primary Language**
- **Option A: Go** — Single binary, excellent performance, strong stdlib for networking
- **Option B: Rust** — Maximum performance, memory safety, steeper learning curve
- **Option C: TypeScript/Bun** — Faster iteration, aligns with Moltbot (Node.js), more MCP tooling available

*Recommendation: TypeScript/Bun for faster iteration and MCP ecosystem alignment*

**Question 2: Database**
- **Option A: PostgreSQL only** — Use LISTEN/NOTIFY for queue, everything in one place
- **Option B: PostgreSQL + Redis** — Separate cache/queue layer
- **Option C: SQLite + Litestream** — Simpler self-hosting, replicated backups

*Recommendation: PostgreSQL only for simplicity*

**Question 3: SMTP Strategy**
- **Option A: Haraka (Node.js)** — Plugin ecosystem, 50k emails/min per instance
- **Option B: Postal (existing OSS)** — Fork and adapt, already battle-tested
- **Option C: Amazon SES relay** — For hosted version, self-hosters bring their own

*Recommendation: Haraka for self-hosted, SES option for hosted*

**Awaiting your decisions before proceeding...**

---

## Phase 1: Core API Server

### Worker Spawning Plan
```bash
# After technology decisions are made:
/spawn api-core "Create core API server with health check and auth middleware"
/spawn api-email "Implement POST /v1/email/send endpoint"
/spawn api-sms "Implement POST /v1/sms/send endpoint"  
/spawn api-webhooks "Implement webhook registration and dispatch"
```

### 🛑 DECISION CHECKPOINT: Authentication Model

**Question: How should API consumers authenticate?**

- **Option A: API Keys only** — Simple, stateless, like SendGrid
- **Option B: OAuth 2.0** — More complex, better for multi-tenant hosted version
- **Option C: Both** — API keys for bots, OAuth for managed integrations

*Recommendation: API Keys only—bots don't need OAuth*

**Question: Rate Limiting Strategy**

- **Option A: Per-key limits** — 100 req/sec default, configurable
- **Option B: Token bucket** — Smooth burst handling
- **Option C: No limits** — Trust the bots (self-hosted philosophy)

*Recommendation: Token bucket with generous defaults*

**Awaiting your decisions before proceeding...**

---

## Phase 2: MCP Server (Critical Path)

### Use Existing MCP Infrastructure

**DO NOT write custom MCP server code if avoidable.**

Check these first:
```bash
# Search for existing email MCP servers
gh search repos "mcp server email" --limit 20

# Check MCP registry
# https://github.com/mcp
```

### MCP Server Specification

If we must build custom, the MCP server exposes these tools:

```typescript
// Tool definitions for MCP
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
        from: { type: "string", description: "Sender email (optional, uses default)" },
        reply_to: { type: "string", description: "Reply-to address (optional)" }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "mailforge_send_sms",
    description: "Send an SMS message. Returns message ID and status.",
    inputSchema: {
      type: "object", 
      properties: {
        to: { type: "string", description: "Phone number in E.164 format (+1234567890)" },
        body: { type: "string", description: "SMS message body (max 1600 chars)" }
      },
      required: ["to", "body"]
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

### Worker Spawning
```bash
/spawn mcp-server "Build MCP server exposing mailforge tools - use @modelcontextprotocol/sdk"
/spawn mcp-claude "Create Claude Desktop config and test integration"
/spawn mcp-moltbot "Create Moltbot integration config for gateway"
```

### 🛑 DECISION CHECKPOINT: MCP Transport

**Question: Which MCP transport(s) to support?**

- **Option A: stdio only** — Simplest, works with Claude Desktop
- **Option B: HTTP/SSE** — Works with remote deployments, Moltbot
- **Option C: Both** — stdio for local, HTTP for hosted

*Recommendation: Both—stdio for Claude Desktop, HTTP for Moltbot gateway*

**Awaiting your decision before proceeding...**

---

## Phase 3: Moltbot Integration

### Gateway Integration

Moltbot uses a WebSocket gateway at `ws://127.0.0.1:18789`. MailForge should be callable as a tool from Moltbot sessions.

**Integration approaches:**

1. **MCP Server (preferred)** — Moltbot supports MCP tools natively
2. **Direct tool registration** — Add to Moltbot's tool allowlist
3. **HTTP API** — Moltbot can call any HTTP endpoint

### Moltbot Configuration

```yaml
# ~/.clawdbot/config.yaml (Moltbot config)
agent:
  model: "anthropic/claude-sonnet-4-5"
  
tools:
  mailforge:
    type: mcp
    command: "mailforge-mcp"
    # OR for remote:
    url: "https://api.mailforge.dev/mcp"
```

### Claude Integration

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "mailforge": {
      "command": "mailforge-mcp",
      "args": ["--api-key", "${MAILFORGE_API_KEY}"]
    }
  }
}
```

### 🛑 DECISION CHECKPOINT: Bot Identity

**Question: How should bots identify themselves?**

- **Option A: API key in header** — `Authorization: Bearer mf_xxx`
- **Option B: Bot ID in payload** — `{"bot_id": "moltbot-123", ...}`
- **Option C: Both** — Key for auth, ID for attribution/logging

*Recommendation: Both—API key for auth, optional bot_id for observability*

**Awaiting your decision before proceeding...**

---

## Phase 4: Email Infrastructure

### Use Existing Tools First

Before writing SMTP code, check:

```bash
# Existing Haraka installation
which haraka

# Existing Postal installation  
docker images | grep postal

# AWS SES CLI
aws ses get-account-sending-enabled
```

### Worker Spawning
```bash
/spawn smtp-haraka "Configure Haraka SMTP server with DKIM signing"
/spawn smtp-queue "Implement PostgreSQL-backed send queue with retries"
/spawn smtp-bounce "Implement bounce processing and suppression list"
/spawn smtp-warmup "Create IP warmup scheduling logic"
```

### 🛑 DECISION CHECKPOINT: Deliverability Strategy

**Question: IP Strategy for hosted version**

- **Option A: Shared IP pool** — Lower cost, reputation risk from bad actors
- **Option B: Dedicated IPs** — $5/IP/month cost, full control
- **Option C: Hybrid** — Shared for low-volume, dedicated at threshold

*Recommendation: Hybrid—shared under 10k/month, dedicated above*

**Question: ESP Fallback**

- **Option A: Pure self-hosted** — Full control, more ops burden
- **Option B: SES fallback** — Use AWS SES as backup for deliverability
- **Option C: Multi-ESP** — Route by recipient domain (Gmail→SES, Outlook→own IP)

*Recommendation: SES fallback for hosted, pure self-hosted option available*

**Awaiting your decisions before proceeding...**

---

## Phase 5: SMS Infrastructure

### Use Existing Carriers

**DO NOT build carrier integrations from scratch.**

Use existing APIs:
- **Telnyx** — Best developer experience, competitive pricing
- **Twilio** (ironic, but reliable) — Fallback option
- **Plivo** — Good international coverage

### Worker Spawning
```bash
/spawn sms-telnyx "Integrate Telnyx API for US/CA SMS"
/spawn sms-webhook "Handle delivery receipts and inbound SMS"
/spawn sms-queue "Implement SMS send queue with rate limiting"
```

### 🛑 DECISION CHECKPOINT: SMS Scope

**Question: Geographic coverage for MVP**

- **Option A: US only** — Simplest compliance, lowest cost
- **Option B: US + Canada + UK** — Covers most English-speaking agents
- **Option C: Global** — Complex compliance (GDPR, carrier agreements)

*Recommendation: US + Canada for MVP*

**Question: Inbound SMS**

- **Option A: Outbound only** — Simpler, covers most bot use cases
- **Option B: Inbound support** — Enables 2-way conversations
- **Option C: Later phase** — Ship outbound first, add inbound in v2

*Recommendation: Outbound only for MVP*

**Awaiting your decisions before proceeding...**

---

## Phase 6: API Design (Bot-Optimized)

### Token-Efficient Responses

```typescript
// ❌ Bad - Wastes tokens
{
  "success": true,
  "message": "Your email has been queued for delivery",
  "data": {
    "message_id": "msg_abc123",
    "status": "queued",
    "created_at": "2025-01-28T10:30:00Z",
    "updated_at": "2025-01-28T10:30:00Z",
    // ... 20 more fields
  }
}

// ✅ Good - Minimal response
{
  "id": "msg_abc123",
  "status": "queued"
}
```

### Idempotency

```bash
# Same idempotency key = same response, no duplicate sends
curl -X POST https://api.mailforge.dev/v1/email/send \
  -H "Idempotency-Key: req_unique_123" \
  -H "Authorization: Bearer mf_xxx" \
  -d '{"to": "user@example.com", "subject": "Hello", "body": "World"}'
```

### Batch Operations

```typescript
// Send up to 100 emails in one request
POST /v1/email/send/batch
{
  "messages": [
    {"to": "a@example.com", "subject": "Hi A", "body": "..."},
    {"to": "b@example.com", "subject": "Hi B", "body": "..."}
  ]
}
```

---

## Phase 7: Deployment

### Self-Hosted (Docker Compose)

```yaml
# docker-compose.yml
version: '3.8'
services:
  api:
    image: mailforge/api:latest
    environment:
      - DATABASE_URL=postgres://...
      - SMTP_HOST=smtp
    ports:
      - "3000:3000"
  
  smtp:
    image: mailforge/smtp:latest
    ports:
      - "25:25"
      - "587:587"
  
  worker:
    image: mailforge/worker:latest
    environment:
      - DATABASE_URL=postgres://...
  
  postgres:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### Hosted Version

```bash
/spawn deploy-fly "Create Fly.io deployment config"
/spawn deploy-railway "Create Railway deployment config"  
```

### 🛑 DECISION CHECKPOINT: Hosting Platform

**Question: Primary hosting platform for managed version**

- **Option A: Fly.io** — Good edge distribution, simple scaling
- **Option B: Railway** — Great DX, easy PostgreSQL
- **Option C: Render** — Simple, good free tier
- **Option D: Self-managed K8s** — Maximum control, more ops

*Recommendation: Railway for MVP simplicity*

**Awaiting your decision before proceeding...**

---

## Integration Examples

### Claude Code (Direct API)

```python
import anthropic
import httpx

client = anthropic.Anthropic()

# Claude can call MailForge directly
response = client.messages.create(
    model="claude-sonnet-4-5-20250514",
    max_tokens=1024,
    tools=[{
        "name": "send_email",
        "description": "Send an email via MailForge",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string"},
                "subject": {"type": "string"},
                "body": {"type": "string"}
            },
            "required": ["to", "subject", "body"]
        }
    }],
    messages=[{"role": "user", "content": "Send a reminder email to alice@example.com about the meeting tomorrow"}]
)

# Handle tool use
if response.stop_reason == "tool_use":
    tool_use = response.content[1]
    result = httpx.post(
        "https://api.mailforge.dev/v1/email/send",
        headers={"Authorization": f"Bearer {MAILFORGE_API_KEY}"},
        json=tool_use.input
    )
```

### Moltbot (Gateway)

```bash
# User messages Moltbot on WhatsApp:
# "Send an email to my accountant about the Q4 taxes"

# Moltbot calls mailforge_send_email tool automatically
# Bot has persistent memory of who "my accountant" is
```

### MCP Direct

```bash
# Claude Desktop or Cursor/Windsurf
# Just configure the MCP server and tools are available naturally

# User: "Email the team about the deployment being complete"
# Claude: [calls mailforge_send_email with composed message]
```

---

## Quality Gates (Orchestrator Agents)

### QA Guardian (`/review`)
- Verify API responses are token-efficient
- Check for hardcoded credentials
- Ensure all endpoints have idempotency support
- Validate MCP tool schemas

### DevOps Engineer (`/deploy`)
- Verify Docker images build
- Check PostgreSQL migrations
- Validate environment variable documentation
- Test health check endpoints

### Code Simplifier (Large PRs)
- Reduce dependencies
- Eliminate unnecessary abstractions
- Keep the "no UI" principle enforced

---

## Success Criteria

### MVP Complete When:
- [ ] `POST /v1/email/send` works end-to-end
- [ ] `POST /v1/sms/send` works for US numbers
- [ ] MCP server installable via `npm install -g mailforge-mcp`
- [ ] Claude Desktop integration documented
- [ ] Moltbot integration tested
- [ ] Docker Compose self-host works
- [ ] Railway/Fly one-click deploy works

### Metrics to Track:
- Messages sent by AI agents (primary)
- Time to first successful send (<5 minutes)
- API response latency (p99 <100ms)
- Deliverability rate (>98% inbox)

---

## Appendix: MCP Servers to Evaluate

Before writing code, check if these solve the problem:

| Server | Purpose | URL |
|--------|---------|-----|
| @anthropic/mcp-server-fetch | HTTP requests | Built-in |
| mcp-server-postgres | Database access | npm |
| Amazon SES MCP | Email via SES | AWS Blog |
| Composio Agent Mail | Email for agents | composio.dev |

**Always prefer existing MCP servers over custom code.**

---

## Call to Action

**Claude Code:** When executing this prompt:

1. **Read the full prompt first** — Understand the decision checkpoints
2. **Stop at every 🛑** — Present options, wait for human input
3. **Use `/spawn` liberally** — Parallelize everything possible
4. **Check MCP registry first** — Don't reinvent wheels
5. **Keep responses minimal** — You're building for bots like yourself
6. **Test with Moltbot** — If it works with Moltbot, it works everywhere

**The goal is infrastructure that makes sending email/SMS as easy as a single tool call for any AI agent.**
