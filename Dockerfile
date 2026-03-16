# ──────────────────────────────────────────────────────────────────
# Stage 1: Builder — compile TypeScript
# ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install all deps (including devDependencies for tsc)
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY . .
RUN npm run build
# postbuild copies src/views → dist/src/views (Nunjucks templates)

# ──────────────────────────────────────────────────────────────────
# Stage 2: Production — lean runtime image
# ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled application (includes dist/src/views from postbuild)
COPY --from=builder /app/dist ./dist

# Migration TypeScript sources — tsx runs these directly at startup
# (avoids knex/Node ESM-detection issues with compiled .js migration files)
COPY knexfile.ts ./knexfile.ts
COPY src/db/migrate.ts ./src/db/migrate.ts
COPY src/db/migrations ./src/db/migrations

# Operational scripts (sync-manifest, etc.) — tsx runs these directly
COPY scripts ./scripts

# Manifest — default baked-in copy; override with a volume mount in compose
COPY manifest ./manifest

# Entrypoint
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

# Non-root user
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 \
    && mkdir -p /app/data \
    && chown -R nodejs:nodejs /app/data

USER nodejs

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
