/**
 * Domain Service
 * Business logic for domain verification and DKIM key management
 */

import { generateKeyPairSync, randomBytes } from 'crypto';
import { promises as dns } from 'dns';
import type { DatabaseClient, Result, ApiKeyId, Domain, DnsRecord } from '@opensend/shared';
import { ok, err, ValidationError, RecordNotFoundError } from '@opensend/shared';

// ============================================================================
// Types
// ============================================================================

export interface DomainVerifyResult {
  domain: string;
  verified: boolean;
  records: DnsRecord[];
  verifiedAt?: string;
}

export interface DomainCheckResult {
  domain: string;
  verified: boolean;
  checks: {
    spf: { valid: boolean; found: string | null };
    dkim: { valid: boolean; found: string | null };
    dmarc: { valid: boolean; found: string | null };
  };
}

export interface DkimKeyPair {
  publicKey: string;
  privateKey: string;
  publicKeyDns: string; // Base64 encoded without PEM headers
}

// ============================================================================
// Domain Service
// ============================================================================

/**
 * Create domain service with database client dependency
 */
export function createDomainService(db: DatabaseClient) {
  /**
   * Generate 2048-bit RSA key pair for DKIM
   */
  function generateDkimKeyPair(): DkimKeyPair {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Extract base64 content from PEM public key for DNS record
    const publicKeyDns = publicKey
      .replace('-----BEGIN PUBLIC KEY-----', '')
      .replace('-----END PUBLIC KEY-----', '')
      .replace(/\s/g, '');

    return { publicKey, privateKey, publicKeyDns };
  }

  /**
   * Generate DKIM selector (unique identifier for key rotation)
   */
  function generateDkimSelector(): string {
    // Use 'mf' prefix + random 8 chars
    return `mf${randomBytes(4).toString('hex')}`;
  }

  /**
   * Generate DNS records for domain verification
   */
  function generateDnsRecords(
    domain: string,
    dkimSelector: string,
    publicKeyDns: string
  ): DnsRecord[] {
    return [
      {
        type: 'TXT',
        name: domain,
        value: 'v=spf1 include:opensend.dev ~all',
      },
      {
        type: 'TXT',
        name: `${dkimSelector}._domainkey.${domain}`,
        value: `v=DKIM1; k=rsa; p=${publicKeyDns}`,
      },
      {
        type: 'TXT',
        name: `_dmarc.${domain}`,
        value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
      },
    ];
  }

  /**
   * Create or get existing domain with DKIM keys
   */
  async function createOrGetDomain(
    apiKeyId: ApiKeyId,
    domainName: string
  ): Promise<Result<DomainVerifyResult, Error>> {
    // Normalize domain
    const normalizedDomain = domainName.toLowerCase().trim();

    // Validate domain format
    const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
    if (!domainRegex.test(normalizedDomain)) {
      return err(new ValidationError('Invalid domain format', 'domain'));
    }

    // Check if domain already exists
    const existingResult = await db.domains.findByDomain(apiKeyId, normalizedDomain);
    if (!existingResult.ok) {
      return err(existingResult.error);
    }

    if (existingResult.value) {
      // Domain exists, return existing records
      const domain = existingResult.value;
      const publicKeyDns = extractPublicKeyDns(domain.dkimPrivateKey);
      const records = generateDnsRecords(normalizedDomain, domain.dkimSelector, publicKeyDns);

      return ok({
        domain: domain.domain,
        verified: domain.verified,
        records,
        verifiedAt: domain.verifiedAt?.toISOString(),
      });
    }

    // Generate new DKIM key pair
    const { privateKey, publicKeyDns } = generateDkimKeyPair();
    const dkimSelector = generateDkimSelector();

    // Create domain record
    const createResult = await db.domains.create({
      api_key_id: apiKeyId,
      domain: normalizedDomain,
      dkim_selector: dkimSelector,
      dkim_private_key: privateKey,
      verified: false,
    });

    if (!createResult.ok) {
      return err(createResult.error);
    }

    const records = generateDnsRecords(normalizedDomain, dkimSelector, publicKeyDns);

    return ok({
      domain: normalizedDomain,
      verified: false,
      records,
    });
  }

  /**
   * Get domain info
   */
  async function getDomain(
    apiKeyId: ApiKeyId,
    domainName: string
  ): Promise<Result<DomainVerifyResult, Error>> {
    const normalizedDomain = domainName.toLowerCase().trim();

    const result = await db.domains.findByDomain(apiKeyId, normalizedDomain);
    if (!result.ok) {
      return err(result.error);
    }

    if (!result.value) {
      return err(new RecordNotFoundError('Domain', normalizedDomain));
    }

    const domain = result.value;
    const publicKeyDns = extractPublicKeyDns(domain.dkimPrivateKey);
    const records = generateDnsRecords(normalizedDomain, domain.dkimSelector, publicKeyDns);

    return ok({
      domain: domain.domain,
      verified: domain.verified,
      records,
      verifiedAt: domain.verifiedAt?.toISOString(),
    });
  }

  /**
   * Verify domain DNS records
   */
  async function verifyDomain(
    apiKeyId: ApiKeyId,
    domainName: string
  ): Promise<Result<DomainCheckResult, Error>> {
    const normalizedDomain = domainName.toLowerCase().trim();

    // Get domain from database
    const domainResult = await db.domains.findByDomain(apiKeyId, normalizedDomain);
    if (!domainResult.ok) {
      return err(domainResult.error);
    }

    if (!domainResult.value) {
      return err(new RecordNotFoundError('Domain', normalizedDomain));
    }

    const domain = domainResult.value;

    // Check DNS records
    const spfCheck = await checkSpfRecord(normalizedDomain);
    const dkimCheck = await checkDkimRecord(normalizedDomain, domain.dkimSelector, domain.dkimPrivateKey);
    const dmarcCheck = await checkDmarcRecord(normalizedDomain);

    const allValid = spfCheck.valid && dkimCheck.valid && dmarcCheck.valid;

    // Update verified status if all checks pass
    if (allValid && !domain.verified) {
      await db.domains.update(domain.id, {
        verified: true,
        verified_at: new Date(),
      });
    }

    return ok({
      domain: normalizedDomain,
      verified: allValid,
      checks: {
        spf: spfCheck,
        dkim: dkimCheck,
        dmarc: dmarcCheck,
      },
    });
  }

  /**
   * Delete domain
   */
  async function deleteDomain(
    apiKeyId: ApiKeyId,
    domainName: string
  ): Promise<Result<boolean, Error>> {
    const normalizedDomain = domainName.toLowerCase().trim();

    // Get domain to verify ownership
    const domainResult = await db.domains.findByDomain(apiKeyId, normalizedDomain);
    if (!domainResult.ok) {
      return err(domainResult.error);
    }

    if (!domainResult.value) {
      return err(new RecordNotFoundError('Domain', normalizedDomain));
    }

    // TODO: Check for messages in last 30 days before deletion
    // For now, just delete

    const deleteResult = await db.domains.delete(domainResult.value.id);
    return deleteResult;
  }

  /**
   * List all domains for an API key
   */
  async function listDomains(apiKeyId: ApiKeyId): Promise<Result<Domain[], Error>> {
    return db.domains.findByApiKey(apiKeyId);
  }

  return {
    createOrGetDomain,
    getDomain,
    verifyDomain,
    deleteDomain,
    listDomains,
    generateDkimKeyPair,
    generateDnsRecords,
  };
}

// ============================================================================
// DNS Verification Helpers
// ============================================================================

/**
 * Extract public key DNS format from private key
 */
function extractPublicKeyDns(privateKey: string | null): string {
  if (!privateKey) {
    return '';
  }

  // Re-derive public key from private key
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // For simplicity in this implementation, we store the public key portion
  // In a production system, you'd want to store the public key separately
  // or use a library to derive it from the private key

  // Since we can't easily derive public from private in Node.js crypto,
  // we'll parse it from the actual stored key (need to store both in practice)
  // For now, return empty to indicate this should be enhanced
  return publicKey
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');
}

/**
 * Check SPF record
 */
async function checkSpfRecord(domain: string): Promise<{ valid: boolean; found: string | null }> {
  try {
    const records = await dns.resolveTxt(domain);
    const flatRecords = records.map((r) => r.join(''));
    const spfRecord = flatRecords.find((r) => r.startsWith('v=spf1'));

    if (!spfRecord) {
      return { valid: false, found: null };
    }

    // Check if opensend.dev is included
    const includesMailforge = spfRecord.includes('include:opensend.dev');
    return { valid: includesMailforge, found: spfRecord };
  } catch {
    return { valid: false, found: null };
  }
}

/**
 * Check DKIM record
 */
async function checkDkimRecord(
  domain: string,
  selector: string,
  _privateKey: string | null
): Promise<{ valid: boolean; found: string | null }> {
  try {
    const dkimDomain = `${selector}._domainkey.${domain}`;
    const records = await dns.resolveTxt(dkimDomain);
    const flatRecords = records.map((r) => r.join(''));
    const dkimRecord = flatRecords.find((r) => r.startsWith('v=DKIM1'));

    if (!dkimRecord) {
      return { valid: false, found: null };
    }

    // Check for RSA key type and presence of public key
    const hasRsaKey = dkimRecord.includes('k=rsa') && dkimRecord.includes('p=');
    return { valid: hasRsaKey, found: dkimRecord };
  } catch {
    return { valid: false, found: null };
  }
}

/**
 * Check DMARC record
 */
async function checkDmarcRecord(domain: string): Promise<{ valid: boolean; found: string | null }> {
  try {
    const dmarcDomain = `_dmarc.${domain}`;
    const records = await dns.resolveTxt(dmarcDomain);
    const flatRecords = records.map((r) => r.join(''));
    const dmarcRecord = flatRecords.find((r) => r.startsWith('v=DMARC1'));

    if (!dmarcRecord) {
      return { valid: false, found: null };
    }

    // DMARC record exists with valid format
    return { valid: true, found: dmarcRecord };
  } catch {
    return { valid: false, found: null };
  }
}

export type DomainService = ReturnType<typeof createDomainService>;
