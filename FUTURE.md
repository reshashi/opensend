# OpenSend - Future Improvements & Deferred Features

This document tracks features, improvements, and ideas that are intentionally deferred from the initial MVP. These items are valuable but not essential for the first release.

---

## Priority 1: Post-MVP (Next Release)

### AI Content Policy Checker
**Status**: Queued for Phase 2
**Description**: Implement an AI-powered content policy checker that scans outgoing emails for:
- Spam patterns and suspicious content
- Phishing attempts or malicious URLs
- Content that violates platform terms of service
- Inappropriate or harmful material

**Implementation Notes**:
- Use Claude Haiku for fast, cost-effective content analysis
- Run asynchronously in the worker pipeline before SMTP send
- Configurable strictness levels (strict/moderate/permissive)
- Whitelist for trusted senders
- Appeal/review queue for false positives
- Log all blocked emails for audit purposes

**API Design**:
```json
// Response when email blocked
{
  "id": "msg_abc123",
  "status": "blocked",
  "reason": {
    "code": "policy_violation",
    "category": "spam",
    "confidence": 0.94
  }
}
```

---

### SMS Support (US/Canada)
**Status**: Queued for Phase 2
**Description**: Add `POST /v1/sms/send` endpoint with Telnyx carrier integration

**Scope**:
- US and Canada phone numbers (E.164 format)
- Standard SMS (160 chars) and concatenated messages
- Delivery status webhooks
- MCP tool: `opensend_send_sms`

**Not in scope**:
- International SMS (complex carrier agreements)
- WhatsApp or RCS
- Inbound SMS / 2-way conversations

---

### Batch Email Sending
**Status**: Queued for Phase 2
**Description**: Allow up to 100 emails per API request

**API**:
```json
POST /v1/email/send/batch
{
  "messages": [
    {"to": "a@example.com", "subject": "Hi A", "body": "..."},
    {"to": "b@example.com", "subject": "Hi B", "body": "..."}
  ]
}
```

---

## Priority 2: Production Readiness

### IP Warmup Tooling
**Description**: Automated IP warmup scheduling for new dedicated IPs
- Gradual volume increase over 4-6 weeks
- Domain reputation monitoring
- Automatic throttling on reputation dips

### Deliverability Monitoring
**Description**: CLI-based dashboard for deliverability metrics
- Bounce rates by domain
- Spam complaint rates
- Inbox placement estimates
- Reputation scores from major providers

### Railway/Fly.io One-Click Deploy
**Description**: Pre-configured deployment templates for hosted version
- Railway template with PostgreSQL addon
- Fly.io configuration with global edge
- Environment variable setup wizards

---

## Priority 3: Developer Experience

### SDKs
**Languages to support**:
- Python (`pip install opensend`)
- Node.js (`npm install @opensend/sdk`)
- Go (`go get github.com/opensend/sdk-go`)
- Ruby (`gem install opensend`)

### Email Templates (Basic)
**Description**: Simple Handlebars/Mustache templating
```json
{
  "to": "{{email}}",
  "subject": "Welcome, {{name}}!",
  "template_id": "tmpl_welcome",
  "variables": {"name": "Alice", "email": "alice@example.com"}
}
```

### Inbound Email Processing
**Description**: Receive emails at `*.inbound.opensend.dev` and forward to webhooks
- Parse attachments
- Extract plain text and HTML
- Spam filtering
- Custom routing rules

---

## Priority 4: Enterprise Features

### Single Sign-On (SSO)
**Description**: SAML/OIDC integration for enterprise customers

### Audit Logging
**Description**: Complete audit trail of all API actions
- Who accessed what data
- Configuration changes
- Immutable log storage
- SIEM integration

### Multi-Tenant Administration
**Description**: Organization-level management for agencies/resellers
- Sub-accounts with usage limits
- Billing aggregation
- Usage reporting

### Dedicated IP Management
**Description**: Self-service dedicated IP provisioning
- IP allocation
- Reputation monitoring
- Automatic failover to shared pool

---

## Priority 5: International Expansion

### International SMS
**Regions to consider**:
1. UK (after US/Canada)
2. EU (GDPR complexity)
3. Australia/NZ
4. India (complex regulations)

### Multi-Language Support
**Description**: API error messages and documentation in multiple languages

### Regional Data Residency
**Description**: Deploy in EU, APAC regions for data sovereignty requirements

---

## Ideas Backlog (Unvalidated)

These are ideas that need more research before committing:

1. **Email validation service** - Check email deliverability before sending
2. **Sender reputation API** - Let users check their domain reputation
3. **A/B subject line testing** - Light analytics for testing subjects
4. **Calendar invite support** - Native .ics attachment handling
5. **PGP encryption** - End-to-end encrypted email option
6. **Scheduled sending** - Send at a specific future time
7. **Email preview** - Render email in major client simulators
8. **Unsubscribe link hosting** - Managed unsubscribe pages
9. **BIMI support** - Brand indicators for message identification
10. **ARC signing** - Authenticated Received Chain for forwarding

---

## Technical Debt to Address

### Performance
- [ ] Add Redis caching layer when needed
- [ ] Implement connection pooling for high-volume scenarios
- [ ] Add horizontal worker scaling

### Observability
- [ ] OpenTelemetry integration
- [ ] Structured logging with correlation IDs
- [ ] Metrics export (Prometheus format)
- [ ] Distributed tracing

### Security
- [ ] Rate limiting per endpoint (not just per key)
- [ ] IP allowlisting for API keys
- [ ] Webhook signature verification improvements
- [ ] Security audit by external firm

### Testing
- [ ] Load testing suite
- [ ] Chaos engineering tests
- [ ] End-to-end test automation

---

## Contributing

Found something missing? Want to prioritize a feature?

1. Open an issue with the `feature-request` label
2. Describe the use case and expected behavior
3. Vote on existing issues to help prioritize

The community's input helps shape what gets built next.

---

*Last updated: 2026-01-28*
