import { z } from 'zod';
import type { Config } from '../config.js';

/**
 * Input schema for mailforge_check_status tool
 */
export const checkStatusInputSchema = {
  message_id: z.string().min(1).describe('Message ID from send response'),
};

/**
 * Output schema for mailforge_check_status tool
 */
export const checkStatusOutputSchema = {
  message_id: z.string(),
  status: z.enum(['queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'deferred']),
  created_at: z.string(),
  sent_at: z.string().nullable(),
  delivered_at: z.string().nullable(),
  last_event: z.string().nullable(),
  bounce_reason: z.string().nullable().optional(),
};

export type CheckStatusInput = z.infer<z.ZodObject<typeof checkStatusInputSchema>>;
export type CheckStatusOutput = z.infer<z.ZodObject<typeof checkStatusOutputSchema>>;

/**
 * Tool definition for mailforge_check_status
 */
export const checkStatusToolDefinition = {
  name: 'mailforge_check_status',
  title: 'Check Email Status',
  description: 'Check delivery status of a sent message',
  inputSchema: checkStatusInputSchema,
  outputSchema: checkStatusOutputSchema,
};

/**
 * Check status handler - calls MailForge API
 */
export async function handleCheckStatus(
  input: CheckStatusInput,
  config: Config
): Promise<{ content: Array<{ type: 'text'; text: string }>; structuredContent: CheckStatusOutput }> {
  const { message_id } = input;
  
  const response = await fetch(`${config.apiUrl}/v1/messages/${encodeURIComponent(message_id)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorJson.message || errorText;
    } catch {
      errorMessage = errorText;
    }
    
    if (response.status === 404) {
      throw new Error(`Message not found: ${message_id}`);
    }
    
    throw new Error(`Failed to check status: ${response.status} - ${errorMessage}`);
  }
  
  const data = await response.json() as {
    message_id: string;
    status: 'queued' | 'sending' | 'sent' | 'delivered' | 'bounced' | 'failed' | 'deferred';
    created_at: string;
    sent_at: string | null;
    delivered_at: string | null;
    last_event: string | null;
    bounce_reason?: string | null;
  };
  
  const output: CheckStatusOutput = {
    message_id: data.message_id,
    status: data.status,
    created_at: data.created_at,
    sent_at: data.sent_at,
    delivered_at: data.delivered_at,
    last_event: data.last_event,
    bounce_reason: data.bounce_reason ?? null,
  };
  
  // Build human-readable status message
  let statusText = `Message Status: ${output.status.toUpperCase()}\nMessage ID: ${output.message_id}\nCreated: ${output.created_at}`;
  
  if (output.sent_at) {
    statusText += `\nSent: ${output.sent_at}`;
  }
  
  if (output.delivered_at) {
    statusText += `\nDelivered: ${output.delivered_at}`;
  }
  
  if (output.last_event) {
    statusText += `\nLast Event: ${output.last_event}`;
  }
  
  if (output.bounce_reason) {
    statusText += `\nBounce Reason: ${output.bounce_reason}`;
  }
  
  return {
    content: [{
      type: 'text',
      text: statusText,
    }],
    structuredContent: output,
  };
}
