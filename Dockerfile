# Cashier runs as one long-lived Node process. The image keeps the sources and the full
# node_modules rather than a standalone output: the entrypoint migrates the database and the
# account commands run through tsx, and both need them.
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    # next start otherwise exits 143 on SIGTERM and the worker never hands its work back.
    NEXT_MANUAL_SIG_HANDLE=true

WORKDIR /app

COPY package.json package-lock.json ./
# Dev dependencies stay: the build needs them, and so do tsx and the migration at runtime.
RUN npm ci --include=dev

COPY . .

# The build only needs the startup variables to be well-formed; none of them is used or kept.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build \
    OPENAI_API_KEY=build \
    AUTH_SECRET=build-only-secret \
    APP_URL=http://localhost:3000 \
    S3_ENDPOINT=http://127.0.0.1:1 \
    S3_BUCKET=build \
    S3_ACCESS_KEY_ID=build \
    S3_SECRET_ACCESS_KEY=build \
    npm run build \
 && chown -R node:node /app

USER node
EXPOSE 3000
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
