# One image serves all roles via different commands:
#   app     → node server.js           (Next.js standalone)
#   worker  → node dist/worker.cjs      (node-cron)
#   migrate → node dist/migrate.cjs && node dist/seed.cjs
# The worker + migrate + seed are self-contained esbuild bundles, so the minimal
# runner needs no extra node_modules beyond the Next standalone trace.

FROM node:22-alpine AS base
WORKDIR /app

# --- deps: install with a frozen lockfile (incl. dev deps for the build) ------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- builder: Next standalone + bundled worker/migrate/seed -------------------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build:all

# --- runner: minimal runtime image -------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/migrations ./migrations

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
