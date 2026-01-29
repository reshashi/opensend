import { z } from 'zod';
import type { Config } from '../config.js';

/**
 * Input schema for opensend_send_email tool
 */
export const sendEmailInputSchema = {
  to: z.string().email().describe('Recipient email address'),
  subject: z.string().min(1).describe('Email subject line'),
  body: z.string().min(1).describe('Email body (plain text or HTML)'),
  from: z.string().email().optional().describe('Sender email (optional, uses default)'),
  reply_to: z.string().email().optional().describe('Reply-to address (optional)'),
};

/**
 * Output schema for opensend_send_email tool
 */
export const sendEmailOutputSchema = {
  message_id: z.string(),
  status: z.enum(['queued', 'sent', 'failed']),
  queued_at: z.string(),
};

export type SendEmailInput = z.infer<z.ZodObject<typeof sendEmailInputSchema>>;
export type SendEmailOutput = z.infer<z.ZodObject<typeof sendEmailOutputSchema>>;

/**
 * Tool definition for opensend_send_email
 */
export const sendEmailToolDefinition = {
  name: 'opensend_send_email',
  title: 'Send Email',
  description: 'Send a transactional email. Returns message ID and status.',
  inputSchema: sendEmailInputSchema,
  outputSchema: sendEmailOutputSchema,
};

/**
 * Send email handler - calls OpenSend API
 */
export async function handleSendEmail(
  input: SendEmailInput,
  config: Config
): Promise<{ content: Array<{ type: 'text'; text: string }>; structuredContent: SendEmailOutput }> {
  const { to, subject, body, from, reply_to } = input;
  
  const requestBody: Record<string, string> = {
    to,
    subject,
    body,
  };
  
  if (from) {
    requestBody.from = from;
  }
  
  if (reply_to) {
    requestBody.reply_to = reply_to;
  }
  
  const response = await fetch(`${config.apiUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
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
    
    throw new Error(`Failed to send email: ${response.status} - ${errorMessage}`);
  }
  
  const data = await response.json() as {
    message_id: string;
    status: 'queued' | 'sent' | 'failed';
    queued_at: string;
  };
  
  const output: SendEmailOutput = {
    message_id: data.message_id,
    status: data.status,
    queued_at: data.queued_at,
  };
  
  return {
    content: [{
      type: 'text',
      text: `Email sent successfully!\nMessage ID: ${output.message_id}\nStatus: ${output.status}\nQueued at: ${output.queued_at}`,
    }],
    structuredContent: output,
  };
}
