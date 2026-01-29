#!/bin/bash
# =============================================================================
# MailForge Haraka Docker Entrypoint
# =============================================================================
#
# This script prepares the Haraka configuration before starting the server.
# It handles environment variable substitution and TLS certificate setup.
#

set -e

# =============================================================================
# Configuration from environment variables
# =============================================================================

HOSTNAME="${HARAKA_HOSTNAME:-mail.localhost}"
LOG_LEVEL="${HARAKA_LOG_LEVEL:-INFO}"

echo "MailForge Haraka SMTP Server"
echo "============================="
echo "Hostname: ${HOSTNAME}"
echo "Log Level: ${LOG_LEVEL}"
echo ""

# =============================================================================
# Update configuration files with environment variables
# =============================================================================

# Update 'me' file with hostname
echo "${HOSTNAME}" > /app/config/me
echo "Updated hostname configuration: ${HOSTNAME}"

# =============================================================================
# Generate self-signed TLS certificates if not provided
# =============================================================================

TLS_KEY="/app/keys/tls-key.pem"
TLS_CERT="/app/keys/tls-cert.pem"

if [ ! -f "${TLS_KEY}" ] || [ ! -f "${TLS_CERT}" ]; then
    echo "TLS certificates not found, generating self-signed certificates..."
    
    # Create keys directory if it doesn't exist
    mkdir -p /app/keys
    
    # Generate self-signed certificate
    openssl req -new -newkey rsa:2048 -days 365 -nodes -x509 \
        -subj "/CN=${HOSTNAME}/O=MailForge/C=US" \
        -keyout "${TLS_KEY}" \
        -out "${TLS_CERT}" 2>/dev/null
    
    echo "Generated self-signed TLS certificate for ${HOSTNAME}"
    echo "WARNING: Using self-signed certificates. For production, use Let's Encrypt or similar."
else
    echo "Using provided TLS certificates"
fi

# =============================================================================
# Generate DKIM keys if not provided
# =============================================================================

DKIM_KEY="/app/keys/dkim-private.pem"

if [ ! -f "${DKIM_KEY}" ]; then
    echo "DKIM private key not found at ${DKIM_KEY}"
    echo "NOTE: DKIM signing will use domain-specific keys from the database"
fi

# =============================================================================
# Wait for dependencies (if DATABASE_URL is set)
# =============================================================================

if [ -n "${DATABASE_URL}" ]; then
    echo "Waiting for database to be ready..."
    
    # Extract host and port from DATABASE_URL
    # Format: postgres://user:pass@host:port/db
    DB_HOST=$(echo "${DATABASE_URL}" | sed -E 's/.*@([^:]+):.*/\1/')
    DB_PORT=$(echo "${DATABASE_URL}" | sed -E 's/.*:([0-9]+)\/.*/\1/')
    
    if [ -n "${DB_HOST}" ] && [ -n "${DB_PORT}" ]; then
        for i in $(seq 1 30); do
            if nc -z "${DB_HOST}" "${DB_PORT}" 2>/dev/null; then
                echo "Database is ready"
                break
            fi
            echo "Waiting for database... (${i}/30)"
            sleep 1
        done
    fi
fi

# =============================================================================
# Wait for API server (if MAILFORGE_API_URL is set)
# =============================================================================

if [ -n "${MAILFORGE_API_URL}" ]; then
    echo "Waiting for MailForge API to be ready..."
    
    # Extract host and port from URL
    API_HOST=$(echo "${MAILFORGE_API_URL}" | sed -E 's|https?://([^:]+):?.*|\1|')
    API_PORT=$(echo "${MAILFORGE_API_URL}" | sed -E 's|.*:([0-9]+).*|\1|')
    API_PORT="${API_PORT:-3000}"
    
    for i in $(seq 1 30); do
        if nc -z "${API_HOST}" "${API_PORT}" 2>/dev/null; then
            echo "MailForge API is ready"
            break
        fi
        echo "Waiting for API... (${i}/30)"
        sleep 1
    done
fi

# =============================================================================
# Print configuration summary
# =============================================================================

echo ""
echo "Configuration Summary:"
echo "----------------------"
echo "SMTP Hostname: ${HOSTNAME}"
echo "TLS Certificate: ${TLS_CERT}"
echo "DKIM Key: ${DKIM_KEY}"
echo "API URL: ${MAILFORGE_API_URL:-not configured}"
echo ""
echo "Starting Haraka SMTP server..."
echo ""

# =============================================================================
# Execute the command
# =============================================================================

exec "$@"
