# OpenSend MCP Server

MCP (Model Context Protocol) server for OpenSend that enables AI agents like Claude to send emails via natural tool calls.

## Installation

```bash
npm install @opensend/mcp-server
```

Or install globally:

```bash
npm install -g @opensend/mcp-server
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MAILFORGE_API_KEY` | Yes | - | Your OpenSend API key |
| `MAILFORGE_API_URL` | No | `http://localhost:3000` | OpenSend API URL |
| `MAILFORGE_MCP_TRANSPORT` | No | `stdio` | Transport type: `stdio` or `http` |
| `MAILFORGE_MCP_PORT` | No | `3002` | HTTP port (for http transport) |

### CLI Arguments

CLI arguments take precedence over environment variables:

```bash
opensend-mcp --api-key YOUR_API_KEY --transport stdio
opensend-mcp --api-key YOUR_API_KEY --transport http --port 3002
```

## Usage with Claude Desktop

Add to your Claude Desktop configuration (`~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "opensend": {
      "command": "opensend-mcp",
      "args": ["--api-key", "YOUR_API_KEY"]
    }
  }
}
```

Or using environment variables:

```json
{
  "mcpServers": {
    "opensend": {
      "command": "opensend-mcp",
      "env": {
        "MAILFORGE_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

## Usage with HTTP Transport (for Moltbot)

Start the server with HTTP transport:

```bash
MAILFORGE_API_KEY=your-key opensend-mcp --transport http --port 3002
```

The server exposes:
- `POST /mcp` - MCP endpoint
- `GET /health` - Health check endpoint

## Available Tools

### opensend_send_email

Send a transactional email. Returns message ID and status.

**Parameters:**
- `to` (required) - Recipient email address
- `subject` (required) - Email subject line
- `body` (required) - Email body (plain text or HTML)
- `from` (optional) - Sender email (uses default if not specified)
- `reply_to` (optional) - Reply-to address

**Example:**
```json
{
  "to": "customer@example.com",
  "subject": "Your order has shipped!",
  "body": "<h1>Great news!</h1><p>Your order #12345 is on its way.</p>",
  "from": "orders@yourstore.com"
}
```

### opensend_check_status

Check delivery status of a sent message.

**Parameters:**
- `message_id` (required) - Message ID from send response

**Returns:** Status (queued, sending, sent, delivered, bounced, failed, deferred), timestamps, and bounce reason if applicable.

### opensend_verify_domain

Get DNS records needed to verify a sending domain.

**Parameters:**
- `domain` (required) - Domain to verify (e.g., acme.com)

**Returns:** List of DNS records (TXT, CNAME, MX) to add to your domain registrar.

## Programmatic Usage

```typescript
import { startStdio, startHttp, registerTools } from '@opensend/mcp-server';

// Start with stdio transport
await startStdio();

// Or start with HTTP transport
await startHttp();

// Or register tools on your own MCP server
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from '@opensend/mcp-server';

const server = new McpServer({ name: 'my-server', version: '1.0.0' });
const config = loadConfig();
registerTools(server, config);
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev

# Type check
npm run type-check

# Start with stdio
npm run start:stdio

# Start with HTTP
npm run start:http
```

## License

See LICENSE file in the repository root.
