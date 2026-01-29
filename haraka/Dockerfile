# =============================================================================
# MailForge Haraka SMTP Server Dockerfile
# =============================================================================
#
# This Dockerfile builds the Haraka SMTP server with MailForge integration.
#
# Build:
#   docker build -t mailforge-smtp ./haraka
#
# Run:
#   docker run -p 25:25 -p 587:587 \
#     -e HARAKA_HOSTNAME=mail.yourdomain.com \
#     -v ./keys:/app/keys:ro \
#     mailforge-smtp
#
# =============================================================================

FROM node:20-slim AS base

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    netcat-openbsd \
    openssl \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# =============================================================================
# Dependencies Stage
# =============================================================================
FROM base AS deps

# Install Haraka globally
RUN npm install -g Haraka@3.0.3

# Create package.json for any additional dependencies
COPY package.json* ./

# Install additional npm packages if package.json exists
RUN if [ -f package.json ]; then npm install --production; fi

# =============================================================================
# Production Stage
# =============================================================================
FROM base AS production

# Create non-root user
RUN groupadd --gid 1001 haraka && \
    useradd --uid 1001 --gid haraka --shell /bin/bash --create-home haraka

# Copy global Haraka installation
COPY --from=deps /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=deps /usr/local/bin/haraka /usr/local/bin/haraka

# Copy any additional node_modules
COPY --from=deps /app/node_modules ./node_modules

# Create required directories
RUN mkdir -p /app/config /app/plugins /app/queue /app/keys && \
    chown -R haraka:haraka /app

# Copy configuration files
COPY --chown=haraka:haraka config/ /app/config/

# Copy custom plugins
COPY --chown=haraka:haraka plugins/ /app/plugins/

# Copy entrypoint script
COPY --chown=haraka:haraka docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Environment variables
ENV NODE_ENV=production
ENV HARAKA_HOSTNAME=mail.localhost
ENV HARAKA_LOG_LEVEL=INFO

# Expose SMTP ports
# 25: Standard SMTP
# 587: Submission (with STARTTLS)
EXPOSE 25 587

# Health check - verify SMTP is accepting connections
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD nc -z localhost 25 || exit 1

# Switch to non-root user
USER haraka

# Start Haraka
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["haraka", "-c", "/app"]
