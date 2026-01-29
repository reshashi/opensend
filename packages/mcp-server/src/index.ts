import { loadConfig } from './config.js';
import { startStdioTransport } from './transports/stdio.js';
import { startHttpTransport } from './transports/http.js';

// Re-export for programmatic use
export { loadConfig, type Config } from './config.js';
export { registerTools } from './tools/index.js';
export {
  sendEmailToolDefinition,
  checkStatusToolDefinition,
  verifyDomainToolDefinition,
} from './tools/index.js';

/**
 * Start the MCP server with stdio transport
 * Used by Claude Desktop and other local clients
 */
export async function startStdio(): Promise<void> {
  const config = loadConfig();
  await startStdioTransport(config);
}

/**
 * Start the MCP server with HTTP transport
 * Used by remote clients like Moltbot
 */
export async function startHttp(): Promise<void> {
  const config = loadConfig();
  await startHttpTransport(config);
}

/**
 * Start the MCP server based on configuration
 */
export async function start(): Promise<void> {
  const config = loadConfig();
  
  if (config.transport === 'http') {
    await startHttpTransport(config);
  } else {
    await startStdioTransport(config);
  }
}

/**
 * Main entry point - auto-starts based on config
 */
async function main(): Promise<void> {
  try {
    await start();
  } catch (error) {
    console.error('Failed to start OpenSend MCP server:', error);
    process.exit(1);
  }
}

// Run if this is the main module
// Check if running as ES module main entry
const isMain = import.meta.url === `file://${process.argv[1]}` ||
               process.argv[1]?.endsWith('/opensend-mcp') ||
               process.argv[1]?.endsWith('\\opensend-mcp');

if (isMain) {
  main();
}
