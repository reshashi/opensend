#!/bin/bash
# =============================================================================
# MailForge DKIM Key Generation Script
# =============================================================================
#
# This script generates DKIM key pairs for email authentication.
# The private key is used by Haraka to sign outbound emails.
# The public key must be published as a DNS TXT record.
#
# Usage:
#   ./scripts/generate-dkim-keys.sh [options]
#
# Options:
#   -d, --domain DOMAIN    Domain name for the keys (default: from SMTP_HOSTNAME)
#   -s, --selector NAME    DKIM selector (default: mailforge)
#   -b, --bits NUM         Key size in bits (default: 2048)
#   -o, --output DIR       Output directory (default: ./keys)
#   -h, --help             Show this help message
#
# Examples:
#   ./scripts/generate-dkim-keys.sh --domain example.com
#   ./scripts/generate-dkim-keys.sh --domain example.com --selector dkim2024
#
# =============================================================================

set -e

# =============================================================================
# Configuration
# =============================================================================

DOMAIN="${SMTP_HOSTNAME:-mail.localhost}"
SELECTOR="${DKIM_SELECTOR:-mailforge}"
KEY_BITS=2048
OUTPUT_DIR="./keys"

# =============================================================================
# Parse command line arguments
# =============================================================================

show_help() {
    echo "MailForge DKIM Key Generator"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -d, --domain DOMAIN    Domain name for the keys (default: from SMTP_HOSTNAME or 'mail.localhost')"
    echo "  -s, --selector NAME    DKIM selector (default: 'mailforge')"
    echo "  -b, --bits NUM         Key size in bits (default: 2048)"
    echo "  -o, --output DIR       Output directory (default: './keys')"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --domain example.com"
    echo "  $0 --domain example.com --selector dkim2024"
    echo ""
    echo "After running this script:"
    echo "  1. Mount the ./keys directory to /app/keys in the Haraka container"
    echo "  2. Add the DNS TXT record shown in the output"
    echo "  3. Wait for DNS propagation (can take up to 48 hours)"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain)
            DOMAIN="$2"
            shift 2
            ;;
        -s|--selector)
            SELECTOR="$2"
            shift 2
            ;;
        -b|--bits)
            KEY_BITS="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# =============================================================================
# Validate inputs
# =============================================================================

if [ -z "${DOMAIN}" ] || [ "${DOMAIN}" = "mail.localhost" ]; then
    echo "WARNING: Using default domain 'mail.localhost'"
    echo "For production, specify your domain with --domain"
    echo ""
fi

if ! [[ "${KEY_BITS}" =~ ^(1024|2048|4096)$ ]]; then
    echo "ERROR: Key size must be 1024, 2048, or 4096"
    echo "2048 is recommended for security and compatibility"
    exit 1
fi

# Check for required tools
if ! command -v openssl &> /dev/null; then
    echo "ERROR: openssl is required but not found"
    exit 1
fi

# =============================================================================
# Create output directory
# =============================================================================

mkdir -p "${OUTPUT_DIR}"

PRIVATE_KEY="${OUTPUT_DIR}/dkim-private.pem"
PUBLIC_KEY="${OUTPUT_DIR}/dkim-public.pem"
DNS_RECORD="${OUTPUT_DIR}/dkim-dns-record.txt"

# =============================================================================
# Generate keys
# =============================================================================

echo "=========================================="
echo "MailForge DKIM Key Generator"
echo "=========================================="
echo ""
echo "Domain: ${DOMAIN}"
echo "Selector: ${SELECTOR}"
echo "Key Size: ${KEY_BITS} bits"
echo "Output: ${OUTPUT_DIR}"
echo ""

# Check if keys already exist
if [ -f "${PRIVATE_KEY}" ]; then
    echo "WARNING: Private key already exists at ${PRIVATE_KEY}"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

echo "Generating ${KEY_BITS}-bit RSA key pair..."

# Generate private key
openssl genrsa -out "${PRIVATE_KEY}" ${KEY_BITS} 2>/dev/null

# Extract public key
openssl rsa -in "${PRIVATE_KEY}" -pubout -out "${PUBLIC_KEY}" 2>/dev/null

# Set proper permissions
chmod 600 "${PRIVATE_KEY}"
chmod 644 "${PUBLIC_KEY}"

echo "Keys generated successfully!"
echo ""

# =============================================================================
# Generate DNS record
# =============================================================================

echo "=========================================="
echo "DNS Configuration"
echo "=========================================="
echo ""

# Extract public key for DNS (remove header/footer and newlines)
PUBLIC_KEY_DATA=$(cat "${PUBLIC_KEY}" | grep -v "PUBLIC KEY" | tr -d '\n')

# DNS record name
DNS_NAME="${SELECTOR}._domainkey.${DOMAIN}"

# DNS record value (p= contains the public key)
# Split into 255-character chunks if needed (DNS TXT record limit)
DNS_VALUE="v=DKIM1; k=rsa; p=${PUBLIC_KEY_DATA}"

# Save DNS record to file
cat > "${DNS_RECORD}" << EOF
DKIM DNS Record for ${DOMAIN}
==============================

Record Type: TXT
Record Name: ${DNS_NAME}
Record Value (copy everything below):

${DNS_VALUE}

------------------------------

Alternative format (if your DNS provider has a character limit):

Name: ${SELECTOR}._domainkey
Type: TXT
Value: v=DKIM1; k=rsa; p=${PUBLIC_KEY_DATA}

------------------------------

To verify DKIM is set up correctly, use:
  dig TXT ${DNS_NAME}

Or use an online DKIM validator like:
  https://www.mail-tester.com/spf-dkim-check
EOF

echo "Add this TXT record to your DNS:"
echo ""
echo "  Name: ${DNS_NAME}"
echo "  Type: TXT"
echo "  Value:"
echo ""
echo "  ${DNS_VALUE}"
echo ""
echo "DNS record saved to: ${DNS_RECORD}"
echo ""

# =============================================================================
# Summary
# =============================================================================

echo "=========================================="
echo "Summary"
echo "=========================================="
echo ""
echo "Files created:"
echo "  Private key: ${PRIVATE_KEY}"
echo "  Public key:  ${PUBLIC_KEY}"
echo "  DNS record:  ${DNS_RECORD}"
echo ""
echo "Next steps:"
echo "  1. Add the TXT record to your DNS"
echo "  2. Wait for DNS propagation (up to 48 hours)"
echo "  3. Verify with: dig TXT ${DNS_NAME}"
echo ""
echo "Docker usage:"
echo "  Mount the keys directory when running Haraka:"
echo "  docker run -v ${OUTPUT_DIR}:/app/keys:ro mailforge-smtp"
echo ""
echo "Or in docker-compose.yml:"
echo "  volumes:"
echo "    - ./keys:/app/keys:ro"
echo ""
