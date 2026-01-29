# MailForge API Server Dockerfile
# Uses Bun for fast TypeScript execution

FROM oven/bun:1.1-alpine AS base

WORKDIR /app

# Install dependencies only when needed
FROM base AS deps

# Copy workspace package files
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/

# Install all dependencies
RUN bun install --frozen-lockfile

# Build stage
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules

# Copy source files
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api
COPY package.json ./

# Build shared package first
WORKDIR /app/packages/shared
RUN bun run build

# Build API package
WORKDIR /app/packages/api
RUN bun run build

# Production stage
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user
RUN addgroup --system --gid 1001 mailforge && \
    adduser --system --uid 1001 mailforge

WORKDIR /app

# Copy built artifacts
COPY --from=builder --chown=mailforge:mailforge /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=mailforge:mailforge /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=mailforge:mailforge /app/packages/api/dist ./packages/api/dist
COPY --from=builder --chown=mailforge:mailforge /app/packages/api/package.json ./packages/api/
COPY --from=builder --chown=mailforge:mailforge /app/node_modules ./node_modules
COPY --from=builder --chown=mailforge:mailforge /app/package.json ./

USER mailforge

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health/live || exit 1

CMD ["bun", "run", "packages/api/dist/index.js"]
