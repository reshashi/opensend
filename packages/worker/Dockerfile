# MailForge Worker Dockerfile
# Multi-stage build for production-ready container

# ============================================================================
# Stage 1: Build
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace configuration
COPY package.json package-lock.json ./

# Copy shared package (dependency)
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src

# Copy worker package
COPY packages/worker/package.json ./packages/worker/
COPY packages/worker/tsconfig.json ./packages/worker/

# Install dependencies
RUN npm ci

# Copy worker source
COPY packages/worker/src ./packages/worker/src

# Build shared package first
WORKDIR /app/packages/shared
RUN npm run build

# Build worker package
WORKDIR /app/packages/worker
RUN npm run build

# ============================================================================
# Stage 2: Production
# ============================================================================
FROM node:20-alpine AS production

# Add non-root user for security
RUN addgroup -g 1001 -S mailforge && \
    adduser -u 1001 -S mailforge -G mailforge

WORKDIR /app

# Copy workspace configuration
COPY package.json package-lock.json ./

# Copy built packages
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

COPY --from=builder /app/packages/worker/package.json ./packages/worker/
COPY --from=builder /app/packages/worker/dist ./packages/worker/dist

# Install production dependencies only
RUN npm ci --omit=dev

# Switch to non-root user
USER mailforge

# Set working directory to worker
WORKDIR /app/packages/worker

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('ok')" || exit 1

# Environment variables
ENV NODE_ENV=production
ENV SMTP_HOST=localhost
ENV SMTP_PORT=587
ENV WORKER_CONCURRENCY=10
ENV MAX_RETRIES=3
ENV RETRY_DELAY_MS=5000
ENV POLL_INTERVAL_MS=5000

# Run the worker
CMD ["node", "dist/index.js"]
