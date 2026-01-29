import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import type { Config } from '../config.js';
import { registerTools } from '../tools/index.js';

/**
 * Start MCP server with HTTP transport
 * This transport is used by remote clients like Moltbot
 */
export async function startHttpTransport(config: Config): Promise<void> {
  const server = new McpServer({
    name: 'mailforge',
    version: '0.1.0',
  });
  
  // Register all tools
  registerTools(server, config);
  
  // Setup Express for HTTP transport
  const app = express();
  app.use(express.json());
  
  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', server: 'mailforge-mcp', version: '0.1.0' });
  });
  
  // MCP endpoint
  app.post('/mcp', async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      
      res.on('close', () => {
        transport.close();
      });
      
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP request error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });
  
  // Start listening
  const httpServer = app.listen(config.httpPort, () => {
    console.log(`MailForge MCP server started (HTTP transport)`);
    console.log(`  - MCP endpoint: http://localhost:${config.httpPort}/mcp`);
    console.log(`  - Health check: http://localhost:${config.httpPort}/health`);
  });
  
  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    httpServer.close();
    await server.close();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
