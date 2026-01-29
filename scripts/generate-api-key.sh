#!/bin/bash
# =============================================================================
# MailForge API Key Generation Script
# =============================================================================
#
# This script generates a new API key for MailForge and inserts it into the
# database. The plaintext key is displayed once and must be saved securely.
#
# Usage:
#   ./scripts/generate-api-key.sh [options]
#
# Options:
#   -n, --name NAME        Name/description for the API key (default: "Generated Key")
#   -r, --rate-limit NUM   Rate limit per second (default: 100)
#   -d, --database URL     Database URL (overrides DATABASE_URL env var)
#   -h, --help             Show this help message
#
# Examples:
#   ./scripts/generate-api-key.sh --name "Production App"
#   ./scripts/generate-api-key.sh --name "Testing" --rate-limit 1000
#
# Docker usage:
#   docker compose exec api ./scripts/generate-api-key.sh --name "My App"
#
# =============================================================================

set -e

# =============================================================================
# Configuration
# =============================================================================

KEY_NAME="Generated Key"
RATE_LIMIT=100
DATABASE_URL="${DATABASE_URL:-postgres://mailforge:mailforge@localhost:5432/mailforge}"

# =============================================================================
# Parse command line arguments
# =============================================================================

show_help() {
    echo "MailForge API Key Generator"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  -n, --name NAME        Name/description for the API key (default: 'Generated Key')"
    echo "  -r, --rate-limit NUM   Rate limit per second (default: 100)"
    echo "  -d, --database URL     Database URL (overrides DATABASE_URL env var)"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --name 'Production App'"
    echo "  $0 --name 'Testing' --rate-limit 1000"
    echo ""
    echo "The generated API key will be displayed once and must be saved securely."
    echo "The key is stored as a SHA-256 hash in the database for security."
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--name)
            KEY_NAME="$2"
            shift 2
            ;;
        -r|--rate-limit)
            RATE_LIMIT="$2"
            shift 2
            ;;
        -d|--database)
            DATABASE_URL="$2"
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

if [ -z "${DATABASE_URL}" ]; then
    echo "ERROR: DATABASE_URL is not set"
    echo "Set the DATABASE_URL environment variable or use --database option"
    exit 1
fi

if ! [[ "${RATE_LIMIT}" =~ ^[0-9]+$ ]]; then
    echo "ERROR: Rate limit must be a positive integer"
    exit 1
fi

# =============================================================================
# Check for required tools
# =============================================================================

check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo "ERROR: Required command not found: $1"
        exit 1
    fi
}

check_command openssl
check_command psql

# =============================================================================
# Generate API key
# =============================================================================

echo "=========================================="
echo "MailForge API Key Generator"
echo "=========================================="
echo ""
echo "Key Name: ${KEY_NAME}"
echo "Rate Limit: ${RATE_LIMIT} requests/second"
echo ""

# Generate a random API key with mf_live_ prefix
# Format: mf_live_<48 random hex characters>
RAW_KEY="mf_live_$(openssl rand -hex 24)"

# Create SHA-256 hash of the key
KEY_HASH=$(echo -n "${RAW_KEY}" | openssl dgst -sha256 | awk '{print $2}')

echo "Generating API key..."
echo "Connecting to database..."

# =============================================================================
# Insert into database
# =============================================================================

INSERT_SQL="
INSERT INTO api_keys (key_hash, name, rate_limit_per_second)
VALUES ('\${KEY_HASH}', '\${KEY_NAME}', ${RATE_LIMIT})
RETURNING id, created_at;
"

# Escape single quotes in key name
KEY_NAME_ESCAPED=$(echo "${KEY_NAME}" | sed "s/'/''/g")

# Construct the actual SQL
ACTUAL_SQL="
INSERT INTO api_keys (key_hash, name, rate_limit_per_second)
VALUES ('${KEY_HASH}', '${KEY_NAME_ESCAPED}', ${RATE_LIMIT})
RETURNING id, created_at;
"

# Execute the insert
RESULT=$(psql "${DATABASE_URL}" -t -A -c "${ACTUAL_SQL}" 2>&1)

if [ $? -ne 0 ]; then
    echo ""
    echo "ERROR: Failed to insert API key into database"
    echo "${RESULT}"
    exit 1
fi

# Parse result
KEY_ID=$(echo "${RESULT}" | cut -d'|' -f1)
CREATED_AT=$(echo "${RESULT}" | cut -d'|' -f2)

# =============================================================================
# Display the generated key
# =============================================================================

echo ""
echo "=========================================="
echo "SUCCESS: API Key Created"
echo "=========================================="
echo ""
echo "API Key ID: ${KEY_ID}"
echo "Created At: ${CREATED_AT}"
echo ""
echo "=========================================="
echo "YOUR API KEY (save this securely!):"
echo "=========================================="
echo ""
echo "  ${RAW_KEY}"
echo ""
echo "=========================================="
echo ""
echo "IMPORTANT:"
echo "  - This key will only be shown once"
echo "  - Store it in a secure location (password manager, secrets vault)"
echo "  - Use it in the Authorization header: 'Bearer ${RAW_KEY}'"
echo "  - Never commit this key to version control"
echo ""
echo "Usage example:"
echo ""
echo "  curl -X POST http://localhost:3000/v1/messages \\"
echo "    -H 'Authorization: Bearer ${RAW_KEY}' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"to\": \"user@example.com\", \"subject\": \"Hello\"}'"
echo ""

# =============================================================================
# Optional: Output in machine-readable format
# =============================================================================

if [ "${OUTPUT_FORMAT}" = "json" ]; then
    echo ""
    echo "JSON output:"
    echo "{"
    echo "  \"api_key_id\": \"${KEY_ID}\","
    echo "  \"api_key\": \"${RAW_KEY}\","
    echo "  \"name\": \"${KEY_NAME}\","
    echo "  \"rate_limit_per_second\": ${RATE_LIMIT},"
    echo "  \"created_at\": \"${CREATED_AT}\""
    echo "}"
fi
