FROM node:24-slim AS base

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS runtime-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js evaluates server instrumentation while building. These values are
# placeholders only; Compose supplies the real runtime configuration.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV API_KEY_PEPPER=build-placeholder
ENV RATE_LIMIT_PEPPER=build-placeholder
ENV OPENAI_API_KEY=build-placeholder
ENV AUTH_SECRET=build-placeholder
ENV AUTH_OTP_PEPPER=build-placeholder
ENV APP_URL=http://localhost:3000
ENV S3_ENDPOINT=http://127.0.0.1:9000
ENV S3_BUCKET=cashier
ENV S3_ACCESS_KEY_ID=build-placeholder
ENV S3_SECRET_ACCESS_KEY=build-placeholder
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src/config/category-presets.ts ./src/config/category-presets.ts
COPY --from=builder /app/src/persistence/postgres-migrations ./src/persistence/postgres-migrations
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --chmod=755 scripts/docker-entrypoint.sh ./docker-entrypoint.sh

RUN mkdir -p /app/config && chown -R node:node /app/config
USER node

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
