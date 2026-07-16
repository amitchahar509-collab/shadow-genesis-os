# Shadow Genesis OS — Production Dockerfile
# Multi-stage build: install deps → build → minimal runtime

# ===== Stage 1: Install deps =====
FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ===== Stage 2: Build =====
FROM oven/bun:1.3 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun x prisma generate
# Next collects page data at build time, which imports routes that construct the
# Prisma client — that needs DATABASE_URL to exist or it throws "Invalid value
# undefined for datasource db". This is a BUILD-time placeholder only (no queries
# run during build); the runtime stage sets the real path.
ENV DATABASE_URL=file:/tmp/build.db
RUN bun run build

# ===== Stage 3: Runtime =====
FROM oven/bun:1.3-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/genesis.db
ENV PORT=3000

# Install only runtime deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy built app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/package.json ./

# Copy activity service
COPY mini-services ./mini-services

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose ports
EXPOSE 3000 3030

# Health check — use bun (guaranteed in the base image); the slim image has no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start both the Next.js app and the activity service
COPY <<'EOF' /app/start.sh
#!/bin/sh
set -e

# Initialize database
cd /app
bun x prisma db push --skip-generate

# Start activity service in background
cd /app/mini-services/activity-service
bun run index.ts &
ACTIVITY_PID=$!

# Start Next.js app
cd /app
bun run start &
NEXT_PID=$!

# Wait for either to exit
wait -n $ACTIVITY_PID $NEXT_PID
EOF
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
