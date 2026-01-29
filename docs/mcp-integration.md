# MCP Integration Guide

OpenSend provides native support for the Model Context Protocol (MCP), enabling AI agents like Claude to send emails directly.

---

## What is MCP?

The Model Context Protocol (MCP) is an open standard that allows AI assistants to interact with external tools and services. Instead of generating code for you to run, the AI can directly execute actions like sending emails.

**Benefits for AI Agents:**
- Direct tool access without code generation
- Token-efficient responses
- Structured error handling
- Seamless integration with Claude Desktop, Cursor, and other MCP clients

---

## Available Tools

The OpenSend MCP server provides these tools:

### send_email

Send an email message.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | Yes | Recipient email address |
| `from` | string | Yes | Sender email (verified domain) |
| `subject` | string | Yes | Email subject line |
| `body` | string | Yes | Email body (plain text) |
| `html` | string | No | HTML body (optional) |
| `reply_to` | string | No | Reply-to address |

**Example prompt:** *"Send an email to john@example.com from hello@mycompany.com with subject 'Meeting Tomorrow' and body 'Hi John, just confirming our meeting at 2pm.'"*

**Response:**

```json
{
  "id": "msg_abc123",
  "status": "queued"
}
```

---

### check_status

Check the delivery status of a sent email.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message_id` | string | Yes | Message ID from send_email |

**Example prompt:** *"Check the status of email msg_abc123"*

**Response:**

```json
{
  "id": "msg_abc123",
  "status": "delivered",
  "delivered_at": "2026-01-28T10:30:05Z"
}
```

---

### verify_domain

Initiate domain verification and get DNS records.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | string | Yes | Domain to verify |

**Example prompt:** *"Verify the domain mycompany.com for sending emails"*

**Response:**

```json
{
  "domain": "mycompany.com",
  "status": "pending",
  "records": [
    {
      "type": "TXT",
      "name": "_opensend",
      "value": "opensend-verify=abc123"
    }
  ]
}
```

---

## Configuration

### Environment Variables

The MCP server uses these environment variables:

```bash
# Required
MAILFORGE_API_KEY=mf_your_api_key
MAILFORGE_API_URL=http://localhost:3000  # or https://api.opensend.dev

# Optional
MCP_PORT=3001
LOG_LEVEL=info
```

### Running Standalone

```bash
# From the opensend directory
cd packages/mcp-server
npm install
npm start
```

Or with npx (for Claude Desktop):

```bash
npx @opensend/mcp-server
```

---

## Client Configuration

### Claude Desktop

See [Claude Desktop Setup](claude-desktop.md) for detailed instructions.

Quick config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "opensend": {
      "command": "npx",
      "args": ["-y", "@opensend/mcp-server"],
      "env": {
        "MAILFORGE_API_KEY": "mf_your_api_key",
        "MAILFORGE_API_URL": "https://api.opensend.dev"
      }
    }
  }
}
```

### Cursor

Add to Cursor settings:

```json
{
  "mcp.servers": {
    "opensend": {
      "command": "npx",
      "args": ["-y", "@opensend/mcp-server"],
      "env": {
        "MAILFORGE_API_KEY": "mf_your_api_key",
        "MAILFORGE_API_URL": "https://api.opensend.dev"
      }
    }
  }
}
```

### Self-Hosted MCP Server

If running your own OpenSend instance:

```json
{
  "mcpServers": {
    "opensend": {
      "command": "npx",
      "args": ["-y", "@opensend/mcp-server"],
      "env": {
        "MAILFORGE_API_KEY": "mf_your_api_key",
        "MAILFORGE_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

Or connect directly to your MCP server:

```json
{
  "mcpServers": {
    "opensend": {
      "url": "http://localhost:3001"
    }
  }
}
```

---

## Usage Examples

### Basic Email Sending

**User prompt:**
> Send an email to support@acme.com from contact@mycompany.com with subject "Partnership Inquiry" and body "Hi, I'd like to discuss a potential partnership. Please let me know your availability."

**Claude's action:**
```
Using tool: send_email
Parameters:
  to: support@acme.com
  from: contact@mycompany.com
  subject: Partnership Inquiry
  body: Hi, I'd like to discuss a potential partnership. Please let me know your availability.
```

**Result:**
> I've sent the email. Message ID: msg_xyz789, status: queued.

### Checking Delivery Status

**User prompt:**
> Did that email get delivered?

**Claude's action:**
```
Using tool: check_status
Parameters:
  message_id: msg_xyz789
```

**Result:**
> The email was delivered successfully at 2:30 PM.

### Setting Up a New Domain

**User prompt:**
> I need to send emails from newdomain.com. Can you help me set that up?

**Claude's action:**
```
Using tool: verify_domain
Parameters:
  domain: newdomain.com
```

**Result:**
> I've initiated domain verification for newdomain.com. You'll need to add these DNS records:
> - TXT record: _opensend.newdomain.com -> opensend-verify=abc123
> - TXT record: opensend._domainkey.newdomain.com -> v=DKIM1; k=rsa; p=...

---

## Error Handling

The MCP server returns structured errors:

```json
{
  "error": "invalid_recipient",
  "message": "Email address format is invalid"
}
```

**Common errors:**

| Error | Description | Resolution |
|-------|-------------|------------|
| `invalid_recipient` | Bad email format | Check email address |
| `invalid_sender` | Domain not verified | Verify domain first |
| `rate_limited` | Too many requests | Wait and retry |
| `unauthorized` | Bad API key | Check MAILFORGE_API_KEY |

---

## Token Efficiency

OpenSend is designed to minimize token usage:

**Minimal responses:**
```json
{"id":"msg_abc123","status":"queued"}
```

**vs. typical API response:**
```json
{
  "success": true,
  "data": {
    "message": {
      "id": "msg_abc123",
      "status": "queued",
      "created_at": "2026-01-28T10:30:00.000Z",
      "updated_at": "2026-01-28T10:30:00.000Z",
      "recipient": "user@example.com",
      "sender": "hello@domain.com",
      "subject": "Hello",
      ...
    }
  },
  "meta": {
    "request_id": "req_xyz",
    "rate_limit_remaining": 99
  }
}
```

This saves 200+ tokens per API call, preserving context window for complex tasks.

---

## Debugging

### Enable Debug Logging

```bash
LOG_LEVEL=debug npx @opensend/mcp-server
```

### Test Tool Calls

```bash
# Test the MCP server directly
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "send_email",
    "parameters": {
      "to": "test@example.com",
      "from": "hello@yourdomain.com",
      "subject": "Test",
      "body": "Test message"
    }
  }'
```

### Check Connection

```bash
curl http://localhost:3001/health
```

---

## Security Considerations

1. **API Key Protection**: Never commit API keys. Use environment variables.
2. **Domain Verification**: Only verified domains can be used as senders.
3. **Rate Limiting**: Prevents abuse, applied per API key.
4. **Audit Logging**: All sends are logged with timestamps and metadata.

---

## Next Steps

- [Claude Desktop Setup](claude-desktop.md) - Detailed Claude configuration
- [API Reference](api-reference.md) - Full API documentation
- [Self-Hosting Guide](self-hosting.md) - Run your own instance
