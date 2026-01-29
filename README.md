# OpenSend

**Open-source email infrastructure for AI agents.**

[![License](https://img.shields.io/badge/license-MSAL-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ready-brightgreen.svg)](docs/self-hosting.md)

---

## Why OpenSend?

Email APIs like SendGrid and Twilio are designed for humans. OpenSend is designed for AI agents:

- **MCP-native** - Works with Claude Desktop, Cursor, and any MCP-compatible agent
- **Token-efficient** - Minimal JSON responses, no wasted context window
- **Simple pricing** - Pay per message, no tiers or feature gates
- **Self-host for free** - Run on your own infrastructure, zero licensing fees
- **No suspensions** - Self-host means you control your sending reputation

---

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/reshashi/opensend.git
cd opensend

# Copy environment template
cp .env.example .env

# Edit .env with your settings (database, domain, etc.)
nano .env

# Start all services
docker-compose up -d
```

Services:
- **API**: `http://localhost:3000`
- **MCP Server**: `http://localhost:3001`
- **SMTP (Haraka)**: `localhost:25`

See [Self-Hosting Guide](docs/self-hosting.md) for production deployment.

### Option 2: Hosted (Coming Soon)

Sign up at [opensend.dev](https://opensend.dev) for managed hosting.

---

## MCP Setup (Claude Desktop)

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "opensend": {
      "command": "npx",
      "args": ["-y", "@opensend/mcp-server"],
      "env": {
        "MAILFORGE_API_KEY": "your-api-key",
        "MAILFORGE_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

Then ask Claude: *"Send an email to user@example.com with subject 'Hello' and body 'Test message'"*

See [Claude Desktop Setup](docs/claude-desktop.md) for detailed instructions.

---

## API Example

```bash
# Send an email
curl -X POST https://api.opensend.dev/v1/email/send \
  -H "Authorization: Bearer mf_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "user@example.com",
    "from": "hello@yourdomain.com",
    "subject": "Hello from OpenSend",
    "text": "Your email content here."
  }'

# Response (token-efficient)
{
  "id": "msg_abc123",
  "status": "queued"
}
```

See [API Reference](docs/api-reference.md) for all endpoints.

---

## Comparison

| Feature | OpenSend | SendGrid | Twilio Email |
|---------|-----------|----------|--------------|
| MCP Support | Native | None | None |
| Token-efficient API | Yes | No | No |
| Self-host option | Free | No | No |
| Pricing model | Per message | Tiered plans | Per message |
| Account suspensions | Self-host: None | Common | Common |
| Open source | Yes | No | No |
| AI agent optimized | Yes | No | No |

---

## Features

### Core
- RESTful API for email sending
- Webhook delivery notifications
- Domain verification (SPF, DKIM, DMARC)
- Bounce and complaint handling
- Suppression list management

### AI Agent Features
- MCP server for Claude, Cursor, etc.
- Minimal response payloads
- Structured error messages
- Rate limiting with clear feedback

### Infrastructure
- Haraka SMTP server (high performance)
- PostgreSQL for persistence
- Redis for queuing (optional)
- Docker Compose deployment

---

## Documentation

- [Self-Hosting Guide](docs/self-hosting.md) - Deploy on your infrastructure
- [API Reference](docs/api-reference.md) - Complete endpoint documentation
- [MCP Integration](docs/mcp-integration.md) - Connect to AI agents
- [Claude Desktop Setup](docs/claude-desktop.md) - Claude-specific instructions

---

## Roadmap

See our [public roadmap](https://github.com/reshashi/opensend/projects/1) for planned features:

- [ ] SMS support (Twilio-compatible API)
- [ ] Email templates with variable substitution
- [ ] Scheduled sending
- [ ] Analytics dashboard
- [ ] Multi-tenant support
- [ ] Inbound email processing

---

## License

OpenSend is source-available under the [OpenSend Source Available License (MSAL)](LICENSE).

**TL;DR:**
- **Free to self-host** for any purpose
- **Free to modify** and contribute
- **Cannot offer as hosted service** without authorization

This keeps the project sustainable while giving you complete control over your email infrastructure.

---

## Contributing

Contributions are welcome! By contributing, you agree to the [Contributor License Agreement](LICENSE#4-contributor-license-agreement) in our license.

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/opensend.git

# Install dependencies
npm install

# Run tests
npm test

# Submit a PR
```

---

## Support

- **GitHub Issues**: Bug reports and feature requests
- **Discussions**: Questions and community support
- **Email**: support@opensend.dev (hosted customers)

---

Built with care for the AI agent ecosystem.
