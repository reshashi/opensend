import { z } from 'zod';

/**
 * Configuration schema for OpenSend MCP server
 */
const configSchema = z.object({
  /** OpenSend API URL */
  apiUrl: z.string().url().default('http://localhost:3000'),
  
  /** OpenSend API Key - required for authentication */
  apiKey: z.string().min(1, 'MAILFORGE_API_KEY is required'),
  
  /** Transport type: stdio for Claude Desktop, http for remote access */
  transport: z.enum(['stdio', 'http']).default('stdio'),
  
  /** HTTP port when using http transport */
  httpPort: z.coerce.number().int().positive().default(3002),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Parse CLI arguments
 */
function parseArgs(): Partial<Config> {
  const args = process.argv.slice(2);
  const result: Partial<Config> = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--api-key':
        if (nextArg) {
          result.apiKey = nextArg;
          i++;
        }
        break;
      case '--api-url':
        if (nextArg) {
          result.apiUrl = nextArg;
          i++;
        }
        break;
      case '--transport':
        if (nextArg === 'stdio' || nextArg === 'http') {
          result.transport = nextArg;
          i++;
        }
        break;
      case '--port':
        if (nextArg) {
          result.httpPort = parseInt(nextArg, 10);
          i++;
        }
        break;
    }
  }
  
  return result;
}

/**
 * Load configuration from environment variables and CLI arguments
 * CLI arguments take precedence over environment variables
 */
export function loadConfig(): Config {
  const cliArgs = parseArgs();
  
  const rawConfig = {
    apiUrl: cliArgs.apiUrl ?? process.env.MAILFORGE_API_URL,
    apiKey: cliArgs.apiKey ?? process.env.MAILFORGE_API_KEY,
    transport: cliArgs.transport ?? process.env.MAILFORGE_MCP_TRANSPORT,
    httpPort: cliArgs.httpPort ?? process.env.MAILFORGE_MCP_PORT,
  };
  
  const result = configSchema.safeParse(rawConfig);
  
  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`
    );
    console.error('Configuration error:\n' + errors.join('\n'));
    console.error('\nRequired environment variables:');
    console.error('  MAILFORGE_API_KEY    - Your OpenSend API key (required)');
    console.error('\nOptional environment variables:');
    console.error('  MAILFORGE_API_URL        - API URL (default: http://localhost:3000)');
    console.error('  MAILFORGE_MCP_TRANSPORT  - Transport type: stdio or http (default: stdio)');
    console.error('  MAILFORGE_MCP_PORT       - HTTP port (default: 3002)');
    console.error('\nOr use CLI arguments:');
    console.error('  --api-key <key>      - Your OpenSend API key');
    console.error('  --api-url <url>      - API URL');
    console.error('  --transport <type>   - Transport type: stdio or http');
    console.error('  --port <port>        - HTTP port');
    process.exit(1);
  }
  
  return result.data;
}
