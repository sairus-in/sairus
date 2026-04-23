# Multi-stage Dockerfile for College Bus Management Backend
# Production-ready with security hardening

# ─── Stage 1: Dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/backend/package.json ./apps/backend/

# Install pnpm
RUN npm install -g pnpm@9

# Install dependencies
RUN pnpm install --frozen-lockfile

# ─── Stage 2: Builder ──────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9

# Copy workspace files
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy source code
COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

# Build shared package first
RUN pnpm --filter shared build

# Generate Prisma client
RUN cd apps/backend && npx prisma generate

# Build backend
RUN pnpm --filter backend build

# ─── Stage 3: Production ────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Security: Run as non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 fastify

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy built application
COPY --from=builder --chown=fastify:nodejs /app/apps/backend/dist ./dist
COPY --from=builder --chown=fastify:nodejs /app/apps/backend/node_modules ./node_modules
COPY --from=builder --chown=fastify:nodejs /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=fastify:nodejs /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy Prisma files for migrations
COPY --from=builder --chown=fastify:nodejs /app/apps/backend/src/db/prisma ./prisma
COPY --from=builder --chown=fastify:nodejs /app/apps/backend/package.json ./

USER fastify

EXPOSE 3000

ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/v1/ready', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
