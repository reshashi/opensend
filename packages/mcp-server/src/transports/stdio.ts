import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Config } from '../config.js';
import { registerTools } from '../tools/index.js';

/**
 * Start MCP server with stdio transport
 * This transport is used by Claude Desktop and other local clients
 */
export async function startStdioTransport(config: Config): Promise<void> {
  const server = new McpServer({
    name: 'opensend',
    version: '0.1.0',
  });
  
  // Register all tools
  registerTools(server, config);
  
  // Connect via stdio
  const transport = new StdioServerTransport();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
  
  await server.connect(transport);
  
  // Log to stderr so it doesn't interfere with stdio protocol
  console.error('OpenSend MCP server started (stdio transport)');
}
