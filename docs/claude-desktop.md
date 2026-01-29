# Claude Desktop Setup

This guide walks you through setting up OpenSend with Claude Desktop, enabling Claude to send emails directly.

---

## Prerequisites

- [Claude Desktop](https://claude.ai/download) installed
- A OpenSend API key (from self-hosted instance or [opensend.dev](https://opensend.dev))
- A verified sending domain

---

## Step 1: Locate Config File

The Claude Desktop configuration file location depends on your operating system:

**macOS:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**Linux:**
```
~/.config/Claude/claude_desktop_config.json
```

If the file doesn't exist, create it.

---

## Step 2: Configure OpenSend

Add the OpenSend MCP server to your configuration:

### Using Hosted OpenSend

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

### Using Self-Hosted OpenSend

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

### Using Local MCP Server

If you're running the MCP server directly:

```json
{
  "mcpServers": {
    "opensend": {
      "command": "node",
      "args": ["/path/to/opensend/packages/mcp-server/dist/index.js"],
      "env": {
        "MAILFORGE_API_KEY": "mf_your_api_key",
        "MAILFORGE_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

---

## Step 3: Restart Claude Desktop

After saving the configuration:

1. Quit Claude Desktop completely
2. Reopen Claude Desktop
3. The OpenSend tools should now be available

---

## Step 4: Verify Setup

Ask Claude to list available tools:

> "What tools do you have access to?"

Claude should mention OpenSend tools:
- `send_email` - Send emails
- `check_status` - Check delivery status
- `verify_domain` - Verify sending domains

---

## Step 5: Test Email Sending

Try sending a test email:

> "Send a test email to myself@example.com from hello@mydomain.com with subject 'Test from Claude' and body 'This is a test email sent via Claude Desktop.'"

Claude will use the `send_email` tool and confirm the message was queued.

---

## Configuration Options

### Full Configuration Example

```json
{
  "mcpServers": {
    "opensend": {
      "command": "npx",
      "args": ["-y", "@opensend/mcp-server"],
      "env": {
        "MAILFORGE_API_KEY": "mf_your_api_key",
        "MAILFORGE_API_URL": "https://api.opensend.dev",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

### Multiple Environments

You can configure multiple OpenSend instances:

```json
{
  "mcpServers": {
    "opensend-prod": {
      "command": "npx",
      "args": ["-y", "@opensend/mcp-server"],
      "env": {
        "MAILFORGE_API_KEY": "mf_production_key",
        "MAILFORGE_API_URL": "https://api.opensend.dev"
      }
    },
    "opensend-dev": {
      "command": "npx",
      "args": ["-y", "@opensend/mcp-server"],
      "env": {
        "MAILFORGE_API_KEY": "mf_development_key",
        "MAILFORGE_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

---

## Usage Examples

### Send a Simple Email

> "Send an email to john@acme.com from sales@mycompany.com with subject 'Follow-up' and body 'Hi John, following up on our conversation yesterday.'"

### Send Email with Context

> "Draft and send a thank-you email to our new customer at customer@example.com. Use our company email hello@ourcompany.com."

### Check if Email was Delivered

> "Check the status of the email I just sent."

### Set Up a New Sending Domain

> "I want to send emails from newbrand.com. Help me set it up."

---

## Troubleshooting

### "MCP server not found"

1. Ensure Node.js 18+ is installed: `node --version`
2. Try installing the package globally: `npm install -g @opensend/mcp-server`
3. Use the full path in the config

### "Authentication failed"

1. Verify your API key is correct
2. Check the key hasn't expired
3. Ensure no extra whitespace in the config

### "Domain not verified"

1. Use the `verify_domain` tool first
2. Add required DNS records
3. Wait for DNS propagation (up to 48 hours)

### "Rate limit exceeded"

1. Wait a few minutes before retrying
2. Contact support to increase limits (hosted)
3. Adjust rate limits in `.env` (self-hosted)

### Claude Doesn't See Tools

1. Check config file syntax (valid JSON)
2. Restart Claude Desktop completely
3. Check for typos in server name

### Debug Mode

Enable verbose logging:

```json
{
  "mcpServers": {
    "opensend": {
      "command": "npx",
      "args": ["-y", "@opensend/mcp-server"],
      "env": {
        "MAILFORGE_API_KEY": "mf_your_api_key",
        "MAILFORGE_API_URL": "https://api.opensend.dev",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

Check logs in:
- macOS: `~/Library/Logs/Claude/`
- Windows: `%APPDATA%\Claude\logs\`

---

## Best Practices

### 1. Use Descriptive Prompts

Good:
> "Send an email to john@acme.com from hello@mycompany.com with subject 'Meeting Confirmation' and body 'Hi John, confirming our meeting tomorrow at 2pm.'"

Less effective:
> "Email John about the meeting"

### 2. Verify Domains First

Before sending production emails, always verify your domain to avoid delivery issues.

### 3. Check Status for Important Emails

> "Send the email and then check if it was delivered."

### 4. Use Templates for Repeated Tasks

> "Remember this template: When I say 'send weekly report to team', send an email to team@mycompany.com from reports@mycompany.com with subject 'Weekly Report - [date]'."

---

## Security Notes

1. **Keep API keys private** - Don't share your config file
2. **Use separate keys** - Create distinct keys for development/production
3. **Review before sending** - Claude will show you the email content before sending
4. **Verify recipients** - Double-check email addresses in Claude's response

---

## Next Steps

- [MCP Integration Guide](mcp-integration.md) - Deep dive into MCP tools
- [API Reference](api-reference.md) - Direct API access
- [Self-Hosting Guide](self-hosting.md) - Run your own instance
