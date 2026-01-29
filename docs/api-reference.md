# MailForge API Reference

Base URL: `https://api.mailforge.dev` (hosted) or `http://localhost:3000` (self-hosted)

---

## Authentication

All API requests require authentication via Bearer token:

```
Authorization: Bearer mf_your_api_key
```

API keys are prefixed with `mf_` for easy identification.

---

## Response Format

All responses use token-efficient JSON. We minimize payload size to preserve context windows for AI agents.

### Success Response

```json
{
  "id": "msg_abc123",
  "status": "queued"
}
```

### Error Response

```json
{
  "error": "invalid_recipient",
  "message": "Email address format is invalid"
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `invalid_request` | Malformed request body |
| `invalid_recipient` | Invalid email address format |
| `invalid_sender` | Sender domain not verified |
| `rate_limited` | Rate limit exceeded |
| `suppressed` | Recipient is on suppression list |
| `unauthorized` | Invalid or missing API key |
| `not_found` | Resource not found |
| `server_error` | Internal server error |

---

## Rate Limiting

Default limits (configurable for self-hosted):

| Window | Limit |
|--------|-------|
| Per minute | 100 requests |
| Per hour | 1,000 requests |
| Per day | 10,000 requests |

Rate limit headers are included in all responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1706450400
```

When rate limited, the API returns `429 Too Many Requests`:

```json
{
  "error": "rate_limited",
  "message": "Rate limit exceeded",
  "retry_after": 45
}
```

---

## Endpoints

### Send Email

`POST /v1/email/send`

Send a single email message.

**Request:**

```json
{
  "to": "recipient@example.com",
  "from": "sender@yourdomain.com",
  "subject": "Hello",
  "text": "Plain text body",
  "html": "<p>HTML body (optional)</p>",
  "reply_to": "reply@yourdomain.com",
  "headers": {
    "X-Custom-Header": "value"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `to` | string | Yes | Recipient email address |
| `from` | string | Yes | Sender email (domain must be verified) |
| `subject` | string | Yes | Email subject line |
| `text` | string | Yes* | Plain text body |
| `html` | string | No | HTML body (overrides text for HTML clients) |
| `reply_to` | string | No | Reply-to address |
| `headers` | object | No | Custom headers (X- prefixed) |

*Either `text` or `html` is required.

**Response:**

```json
{
  "id": "msg_abc123",
  "status": "queued"
}
```

**Status Values:**
- `queued` - Message accepted, pending delivery
- `sent` - Message delivered to recipient server
- `delivered` - Delivery confirmed (if webhook configured)
- `bounced` - Delivery failed permanently
- `failed` - Sending error

---

### Get Email Status

`GET /v1/email/{id}`

Retrieve the status of a sent email.

**Request:**

```bash
curl https://api.mailforge.dev/v1/email/msg_abc123 \
  -H "Authorization: Bearer mf_your_api_key"
```

**Response:**

```json
{
  "id": "msg_abc123",
  "status": "delivered",
  "to": "recipient@example.com",
  "from": "sender@yourdomain.com",
  "subject": "Hello",
  "created_at": "2026-01-28T10:30:00Z",
  "delivered_at": "2026-01-28T10:30:05Z"
}
```

---

### Verify Domain

`POST /v1/domains/verify`

Initiate domain verification. Returns DNS records to configure.

**Request:**

```json
{
  "domain": "yourdomain.com"
}
```

**Response:**

```json
{
  "domain": "yourdomain.com",
  "status": "pending",
  "records": [
    {
      "type": "TXT",
      "name": "_mailforge",
      "value": "mailforge-verify=abc123"
    },
    {
      "type": "TXT",
      "name": "mailforge._domainkey",
      "value": "v=DKIM1; k=rsa; p=MIGfMA0..."
    },
    {
      "type": "TXT",
      "name": "_dmarc",
      "value": "v=DMARC1; p=quarantine; rua=mailto:dmarc@mailforge.dev"
    }
  ]
}
```

---

### Get Domain Status

`GET /v1/domains/{domain}`

Check verification status for a domain.

**Request:**

```bash
curl https://api.mailforge.dev/v1/domains/yourdomain.com \
  -H "Authorization: Bearer mf_your_api_key"
```

**Response:**

```json
{
  "domain": "yourdomain.com",
  "status": "verified",
  "verified_at": "2026-01-28T10:00:00Z",
  "spf": true,
  "dkim": true,
  "dmarc": true
}
```

**Status Values:**
- `pending` - Awaiting DNS configuration
- `verified` - Domain verified and ready to send
- `failed` - Verification failed (check DNS)

---

### List Suppressions

`GET /v1/suppressions`

Get list of suppressed email addresses (bounces, complaints, unsubscribes).

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | Filter by type: `bounce`, `complaint`, `unsubscribe` |
| `limit` | integer | Results per page (default: 100, max: 1000) |
| `cursor` | string | Pagination cursor |

**Request:**

```bash
curl "https://api.mailforge.dev/v1/suppressions?type=bounce&limit=50" \
  -H "Authorization: Bearer mf_your_api_key"
```

**Response:**

```json
{
  "data": [
    {
      "email": "bounced@example.com",
      "type": "bounce",
      "reason": "mailbox_full",
      "created_at": "2026-01-28T10:00:00Z"
    }
  ],
  "cursor": "eyJpZCI6MTAwfQ"
}
```

---

### Delete Suppression

`DELETE /v1/suppressions/{email}`

Remove an email from the suppression list.

**Request:**

```bash
curl -X DELETE https://api.mailforge.dev/v1/suppressions/user@example.com \
  -H "Authorization: Bearer mf_your_api_key"
```

**Response:**

```json
{
  "deleted": true
}
```

---

### Create Webhook

`POST /v1/webhooks`

Register a webhook endpoint for delivery events.

**Request:**

```json
{
  "url": "https://yourapp.com/webhooks/mailforge",
  "events": ["delivered", "bounced", "complained"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | HTTPS webhook endpoint |
| `events` | array | Yes | Events to subscribe to |

**Event Types:**
- `queued` - Message queued for delivery
- `sent` - Message sent to recipient server
- `delivered` - Delivery confirmed
- `bounced` - Hard bounce (permanent failure)
- `soft_bounced` - Soft bounce (temporary failure)
- `complained` - Spam complaint received
- `unsubscribed` - Recipient unsubscribed

**Response:**

```json
{
  "id": "wh_xyz789",
  "url": "https://yourapp.com/webhooks/mailforge",
  "events": ["delivered", "bounced", "complained"],
  "secret": "whsec_abc123"
}
```

**Webhook Payload:**

```json
{
  "event": "delivered",
  "message_id": "msg_abc123",
  "timestamp": "2026-01-28T10:30:05Z",
  "recipient": "user@example.com"
}
```

**Signature Verification:**

Webhooks include a signature header for verification:

```
X-MailForge-Signature: sha256=abc123...
```

Verify by computing HMAC-SHA256 of the raw body with your webhook secret.

---

### Health Check

`GET /health`

Check API server health. No authentication required.

**Response:**

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

---

## Code Examples

### Node.js

```javascript
const response = await fetch('https://api.mailforge.dev/v1/email/send', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer mf_your_api_key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    to: 'user@example.com',
    from: 'hello@yourdomain.com',
    subject: 'Hello',
    text: 'Message body'
  })
});

const { id, status } = await response.json();
console.log(`Message ${id}: ${status}`);
```

### Python

```python
import requests

response = requests.post(
    'https://api.mailforge.dev/v1/email/send',
    headers={'Authorization': 'Bearer mf_your_api_key'},
    json={
        'to': 'user@example.com',
        'from': 'hello@yourdomain.com',
        'subject': 'Hello',
        'text': 'Message body'
    }
)

data = response.json()
print(f"Message {data['id']}: {data['status']}")
```

### cURL

```bash
curl -X POST https://api.mailforge.dev/v1/email/send \
  -H "Authorization: Bearer mf_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"to":"user@example.com","from":"hello@yourdomain.com","subject":"Hello","text":"Message body"}'
```

---

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid API key |
| 404 | Not Found |
| 429 | Rate Limited |
| 500 | Server Error |

---

## SDK Libraries

Official SDKs (coming soon):
- Node.js: `@mailforge/sdk`
- Python: `mailforge-python`
- Go: `mailforge-go`

For now, use the REST API directly or the MCP server for AI agents.
