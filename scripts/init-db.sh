#!/bin/bash
# =============================================================================
# MailForge Database Initialization Script
# =============================================================================
#
# This script initializes the PostgreSQL database for MailForge.
# It is designed to run as a Docker entrypoint script in the postgres container.
#
# Usage (standalone):
#   ./scripts/init-db.sh
#
# Usage (Docker):
#   The script is automatically run when the postgres container starts for the
#   first time (mounted to /docker-entrypoint-initdb.d/)
#
# =============================================================================

set -e

echo "=========================================="
echo "MailForge Database Initialization"
echo "=========================================="

# =============================================================================
# Configuration
# =============================================================================

# Use environment variables or defaults
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-mailforge}"
DB_USER="${POSTGRES_USER:-mailforge}"
DB_PASSWORD="${POSTGRES_PASSWORD:-mailforge}"

# Migration directory
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/docker-entrypoint-initdb.d/migrations}"

# =============================================================================
# Wait for PostgreSQL to be ready
# =============================================================================

wait_for_postgres() {
    echo "Waiting for PostgreSQL to be ready..."
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if pg_isready -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" > /dev/null 2>&1; then
            echo "PostgreSQL is ready!"
            return 0
        fi
        
        echo "Waiting for PostgreSQL... (attempt ${attempt}/${max_attempts})"
        sleep 1
        attempt=$((attempt + 1))
    done
    
    echo "ERROR: PostgreSQL did not become ready in time"
    return 1
}

# =============================================================================
# Run migrations
# =============================================================================

run_migrations() {
    echo ""
    echo "Running database migrations..."
    echo "Migrations directory: ${MIGRATIONS_DIR}"
    
    if [ ! -d "${MIGRATIONS_DIR}" ]; then
        echo "WARNING: Migrations directory not found: ${MIGRATIONS_DIR}"
        echo "Checking alternate locations..."
        
        # Check alternate locations
        for alt_dir in \
            "/app/packages/shared/src/db/migrations" \
            "/docker-entrypoint-initdb.d/migrations" \
            "./packages/shared/src/db/migrations"; do
            if [ -d "${alt_dir}" ]; then
                MIGRATIONS_DIR="${alt_dir}"
                echo "Found migrations at: ${MIGRATIONS_DIR}"
                break
            fi
        done
    fi
    
    if [ ! -d "${MIGRATIONS_DIR}" ]; then
        echo "ERROR: No migrations directory found"
        return 1
    fi
    
    # Run all SQL files in order
    local migration_count=0
    for migration in $(ls -1 "${MIGRATIONS_DIR}"/*.sql 2>/dev/null | sort); do
        echo ""
        echo "Running migration: $(basename ${migration})"
        echo "----------------------------------------"
        
        # Use psql with the connection details
        if [ -n "${DATABASE_URL}" ]; then
            psql "${DATABASE_URL}" -f "${migration}"
        else
            PGPASSWORD="${DB_PASSWORD}" psql \
                -h "${DB_HOST}" \
                -p "${DB_PORT}" \
                -U "${DB_USER}" \
                -d "${DB_NAME}" \
                -f "${migration}"
        fi
        
        if [ $? -eq 0 ]; then
            echo "Migration completed: $(basename ${migration})"
            migration_count=$((migration_count + 1))
        else
            echo "ERROR: Migration failed: $(basename ${migration})"
            return 1
        fi
    done
    
    echo ""
    echo "Successfully ran ${migration_count} migration(s)"
}

# =============================================================================
# Create initial API key
# =============================================================================

create_initial_api_key() {
    echo ""
    echo "Creating initial API key..."
    
    # Generate a random API key
    local raw_key="mf_$(openssl rand -hex 24)"
    local key_hash=$(echo -n "${raw_key}" | sha256sum | cut -d' ' -f1)
    
    # Insert into database
    local insert_sql="
        INSERT INTO api_keys (key_hash, name, rate_limit_per_second)
        VALUES ('${key_hash}', 'Default API Key', 100)
        ON CONFLICT (key_hash) DO NOTHING
        RETURNING id;
    "
    
    local result
    if [ -n "${DATABASE_URL}" ]; then
        result=$(psql "${DATABASE_URL}" -t -c "${insert_sql}")
    else
        result=$(PGPASSWORD="${DB_PASSWORD}" psql \
            -h "${DB_HOST}" \
            -p "${DB_PORT}" \
            -U "${DB_USER}" \
            -d "${DB_NAME}" \
            -t -c "${insert_sql}")
    fi
    
    if [ -n "${result}" ]; then
        echo ""
        echo "=========================================="
        echo "IMPORTANT: Save this API key!"
        echo "=========================================="
        echo ""
        echo "API Key: ${raw_key}"
        echo ""
        echo "This key will only be shown once."
        echo "Store it securely and use it for API requests."
        echo ""
        echo "=========================================="
        
        # Save to file if possible (for Docker setups)
        if [ -w "/app" ]; then
            echo "${raw_key}" > /app/.initial_api_key
            echo "API key also saved to /app/.initial_api_key"
        fi
    else
        echo "API key already exists or could not be created"
    fi
}

# =============================================================================
# Main execution
# =============================================================================

main() {
    # If running inside postgres container's init system,
    # we don't need to wait for postgres
    if [ -z "${POSTGRES_HOST}" ]; then
        echo "Running as postgres init script"
        
        # For postgres init scripts, just run migrations
        if [ -d "${MIGRATIONS_DIR}" ]; then
            for migration in $(ls -1 "${MIGRATIONS_DIR}"/*.sql 2>/dev/null | sort); do
                echo "Running migration: $(basename ${migration})"
                psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -f "${migration}"
            done
        fi
        
        create_initial_api_key
    else
        # Running standalone - wait for postgres first
        wait_for_postgres
        run_migrations
        create_initial_api_key
    fi
    
    echo ""
    echo "Database initialization complete!"
    echo ""
}

# Run main function
main "$@"
