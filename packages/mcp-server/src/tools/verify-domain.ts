import { z } from 'zod';
import type { Config } from '../config.js';

/**
 * Input schema for opensend_verify_domain tool
 */
export const verifyDomainInputSchema = {
  domain: z.string().min(1).describe('Domain to verify (e.g., acme.com)'),
};

/**
 * DNS record schema
 */
const dnsRecordSchema = z.object({
  type: z.enum(['TXT', 'CNAME', 'MX']),
  name: z.string(),
  value: z.string(),
  priority: z.number().optional(),
  verified: z.boolean(),
});

/**
 * Output schema for opensend_verify_domain tool
 */
export const verifyDomainOutputSchema = {
  domain: z.string(),
  verified: z.boolean(),
  dns_records: z.array(dnsRecordSchema),
  created_at: z.string(),
  verified_at: z.string().nullable(),
};

export type VerifyDomainInput = z.infer<z.ZodObject<typeof verifyDomainInputSchema>>;
export type VerifyDomainOutput = z.infer<z.ZodObject<typeof verifyDomainOutputSchema>>;
export type DnsRecord = z.infer<typeof dnsRecordSchema>;

/**
 * Tool definition for opensend_verify_domain
 */
export const verifyDomainToolDefinition = {
  name: 'opensend_verify_domain',
  title: 'Verify Domain',
  description: 'Get DNS records needed to verify a sending domain',
  inputSchema: verifyDomainInputSchema,
  outputSchema: verifyDomainOutputSchema,
};

/**
 * Verify domain handler - calls OpenSend API
 */
export async function handleVerifyDomain(
  input: VerifyDomainInput,
  config: Config
): Promise<{ content: Array<{ type: 'text'; text: string }>; structuredContent: VerifyDomainOutput }> {
  const { domain } = input;
  
  // First try to get existing domain, if not found, create it
  let response = await fetch(`${config.apiUrl}/v1/domains/${encodeURIComponent(domain)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
    },
  });
  
  // If domain doesn't exist, create it
  if (response.status === 404) {
    response = await fetch(`${config.apiUrl}/v1/domains`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ domain }),
    });
  }
  
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;
    
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.error?.message || errorJson.message || errorText;
    } catch {
      errorMessage = errorText;
    }
    
    throw new Error(`Failed to verify domain: ${response.status} - ${errorMessage}`);
  }
  
  const data = await response.json() as {
    domain: string;
    verified: boolean;
    dns_records: DnsRecord[];
    created_at: string;
    verified_at: string | null;
  };
  
  const output: VerifyDomainOutput = {
    domain: data.domain,
    verified: data.verified,
    dns_records: data.dns_records,
    created_at: data.created_at,
    verified_at: data.verified_at,
  };
  
  // Build human-readable response
  let text = `Domain: ${output.domain}\nVerification Status: ${output.verified ? 'VERIFIED' : 'PENDING'}\n`;
  
  if (output.verified && output.verified_at) {
    text += `Verified At: ${output.verified_at}\n`;
  }
  
  if (!output.verified) {
    text += '\nDNS Records to Add:\n';
    text += '===================\n\n';
    
    for (const record of output.dns_records) {
      text += `Type: ${record.type}\n`;
      text += `Name: ${record.name}\n`;
      text += `Value: ${record.value}\n`;
      if (record.priority !== undefined) {
        text += `Priority: ${record.priority}\n`;
      }
      text += `Status: ${record.verified ? 'Verified' : 'Not verified'}\n`;
      text += '\n';
    }
    
    text += 'Add these DNS records to your domain registrar, then call this tool again to check verification status.';
  }
  
  return {
    content: [{
      type: 'text',
      text,
    }],
    structuredContent: output,
  };
}
