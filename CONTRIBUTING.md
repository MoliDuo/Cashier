# Running Cashier

Cashier is built for the two people who use it. It is published under the AGPL so that anyone who
wants it can fork it and make it theirs — not so that it can be made to fit everyone. Bug reports
are welcome; feature requests are likely to be answered with "fork it, that sounds right for you."

Node.js 24.

## The demo workspace

This is the fastest way to see the app, and it touches nothing of yours: no remote database, no
object storage, no email, no AI credentials, no project `.env`.

```bash
npm ci
npm run dev:demo
```

Open the printed loopback URL and select `Continue as dev`. The startup banner lists the seeded
sample API keys, each labelled with the book it writes to. `docker-compose.demo.yml` brings up a
dedicated `cashier-demo` PostgreSQL and MinIO, migrates `cashier_demo`, and seeds fictional receipts
and history. Every launch restores the fixture, so last session's edits are gone.

```bash
npm run demo:reset            # preview
npm run demo:reset -- --apply # apply
```

Occupied ports: `CASHIER_DEMO_APP_PORT`, `CASHIER_DEMO_POSTGRES_PORT`, `CASHIER_DEMO_S3_PORT`.

## Against real infrastructure

```bash
npm ci
cp .env.local.example .env
npm run docker:local
npm run db:migrate
npm run dev
```

Fill in the AI values. Accounts do not come from the environment: against an empty database the
server prints a one-time setup code to its logs, and `/setup` asks for that code plus one
login email, one password, and the book names.

Never commit `.env`, provider credentials, real receipts, API keys, or raw personal data.

## Where things live

- `src/app/` — routes and API handlers
- `src/modules/` — business logic and feature UI
- `src/application/`, `src/lib/`, `src/components/`, `src/persistence/` — shared contracts and infrastructure
- `src/persistence/postgres-migrations/` — PostgreSQL migrations
- `messages/` — translations
- `tests/unit/`, `tests/integration/`

[Architecture and Coding Patterns](./docs/architecture/coding-patterns.md) describes the import
boundaries, which `npm run check:architecture` enforces.
[Testing Architecture](./docs/architecture/testing.md) covers test placement and isolation.

## Checks

Unit tests need only Node.js 24. Integration tests also need a running Docker daemon; the runner
starts an isolated `postgres:17-alpine` container itself. No `.env`, no real credentials, no fixed
port, no manually created database. The first integration run is slow while Docker pulls its images.

```bash
npm test                  # unit
npm run test:watch
npm run test:integration
npm run test:all          # both
npx vitest run tests/unit/path/to/file.test.ts
```

`npm run check` runs everything: formatting, the architecture and dead-code checks, lint, types,
translation validation, the full test suite with coverage, and a production build against isolated
placeholders. Coverage thresholds live in `vitest.config.mts`.

`TEST_DATABASE_URL` may be set for advanced workflows, but it must name a PostgreSQL database
ending in `_test`, with `public.pg_trgm` installed and permission to create schemas. Test commands
never fall back to `DATABASE_URL`.

## Browser smoke tests

```bash
npx playwright install chromium
npm run test:smoke
```

Starts a temporary PostgreSQL container and a uniquely named smoke database, applies real
migrations, seeds a fictional password account, builds production assets, and runs desktop and
mobile Chromium. No auth bypass, no real email, AI, or object storage. It covers password
rejection and login, shared ledger access, manual entry, editing, persistence across reload,
deletion, logout, and protected-page redirects. Failures keep screenshots and traces in
`test-results/` and a report in `playwright-report/`.

## Commits

Conventional Commit subjects: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `perf:`, `test:`.
