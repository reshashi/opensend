# =============================================================================
# MailForge MCP Server Dockerfile
# =============================================================================
#
# Multi-stage build for the MCP (Model Context Protocol) server.
# This enables AI agents to send emails via natural tool calls.
#
# Build:
#   docker build -t mailforge-mcp ./packages/mcp-server
#
# Run:
#   docker run -p 3001:3001 \
#     -e MAILFORGE_API_URL=http://api:3000 \
#     -e MAILFORGE_API_KEY=mf_xxx \
#     mailforge-mcp
#
# =============================================================================

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

# Copy MCP server package
COPY packages/mcp-server/package.json ./packages/mcp-server/
COPY packages/mcp-server/tsconfig.json ./packages/mcp-server/

# Install dependencies
RUN npm ci

# Copy MCP server source
COPY packages/mcp-server/src ./packages/mcp-server/src
COPY packages/mcp-server/bin ./packages/mcp-server/bin

# Build shared package first
WORKDIR /app/packages/shared
RUN npm run build

# Build MCP server package
WORKDIR /app/packages/mcp-server
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

COPY --from=builder /app/packages/mcp-server/package.json ./packages/mcp-server/
COPY --from=builder /app/packages/mcp-server/dist ./packages/mcp-server/dist
COPY --from=builder /app/packages/mcp-server/bin ./packages/mcp-server/bin

# Install production dependencies only
RUN npm ci --omit=dev

# Switch to non-root user
USER mailforge

# Set working directory to MCP server
WORKDIR /app/packages/mcp-server

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:${MCP_PORT:-3001}/health || exit 1

# Environment variables
ENV NODE_ENV=production
ENV MCP_PORT=3001
ENV MCP_HOST=0.0.0.0
ENV MAILFORGE_API_URL=http://api:3000

# Expose MCP server port
EXPOSE 3001

# Run the MCP server in HTTP mode for Docker
CMD ["node", "dist/index.js", "--transport", "http"]
