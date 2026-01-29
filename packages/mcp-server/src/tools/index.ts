import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../config.js';
import {
  sendEmailToolDefinition,
  sendEmailInputSchema,
  sendEmailOutputSchema,
  handleSendEmail,
  type SendEmailInput,
} from './send-email.js';
import {
  checkStatusToolDefinition,
  checkStatusInputSchema,
  checkStatusOutputSchema,
  handleCheckStatus,
  type CheckStatusInput,
} from './check-status.js';
import {
  verifyDomainToolDefinition,
  verifyDomainInputSchema,
  verifyDomainOutputSchema,
  handleVerifyDomain,
  type VerifyDomainInput,
} from './verify-domain.js';

/**
 * Register all OpenSend tools with the MCP server
 */
export function registerTools(server: McpServer, config: Config): void {
  // Register opensend_send_email
  server.registerTool(
    sendEmailToolDefinition.name,
    {
      title: sendEmailToolDefinition.title,
      description: sendEmailToolDefinition.description,
      inputSchema: sendEmailInputSchema,
      outputSchema: sendEmailOutputSchema,
    },
    async (input) => {
      return handleSendEmail(input as SendEmailInput, config);
    }
  );
  
  // Register opensend_check_status
  server.registerTool(
    checkStatusToolDefinition.name,
    {
      title: checkStatusToolDefinition.title,
      description: checkStatusToolDefinition.description,
      inputSchema: checkStatusInputSchema,
      outputSchema: checkStatusOutputSchema,
    },
    async (input) => {
      return handleCheckStatus(input as CheckStatusInput, config);
    }
  );
  
  // Register opensend_verify_domain
  server.registerTool(
    verifyDomainToolDefinition.name,
    {
      title: verifyDomainToolDefinition.title,
      description: verifyDomainToolDefinition.description,
      inputSchema: verifyDomainInputSchema,
      outputSchema: verifyDomainOutputSchema,
    },
    async (input) => {
      return handleVerifyDomain(input as VerifyDomainInput, config);
    }
  );
}

// Re-export tool definitions for external use
export {
  sendEmailToolDefinition,
  checkStatusToolDefinition,
  verifyDomainToolDefinition,
};
