# Contributing to Cashier

Cashier began as a personal project and is still in an early public stage. Focused bug reports,
reproducible fixes, documentation improvements, and small feature proposals are welcome.

## Development setup

Use Node.js 24.

For product and UI work, start the isolated local demo workspace. It does not read remote database,
object-storage, email, or AI credentials from your local environment:

```bash
npm ci
npm run dev:demo
```

Open the printed loopback URL and select `Continue as dev`. The startup banner lists the seeded
sample API keys, each labelled with the book it writes to, and those tokens are valid against the
local demo only. The command uses the standalone
`docker-compose.demo.yml` definition to start a dedicated `cashier-demo` PostgreSQL and MinIO stack,
migrates `cashier_demo`, and seeds fictional receipts and ledger history. It does not require a
project `.env` file. Every launch restores the fixture, so edits from the previous session are
discarded. To inspect or rebuild only this dedicated workspace:

```bash
npm run demo:reset
npm run demo:reset -- --apply
```

The first command is a non-destructive preview. The second applies the reset. Override occupied
ports with `CASHIER_DEMO_APP_PORT`, `CASHIER_DEMO_POSTGRES_PORT`, or `CASHIER_DEMO_S3_PORT`.

For development against explicitly configured infrastructure instead:

```bash
npm ci
cp .env.local.example .env
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d \
  postgres minio storage-bootstrap
npm run db:migrate
npm run dev
```

Fill the AI values in `.env`. Accounts are not configured from the environment: on an empty
database the server prints a one-time setup code to its logs, and `/{locale}/setup` asks for that
code plus one login email, one password and the book names. Never commit `.env`,
provider credentials, real receipts, API keys, or raw personal data.

## Project layout

- Locale-prefixed routes and API handlers live in `src/app/`.
- Business logic and feature UI live in domain modules under `src/modules/`.
- Shared application contracts and infrastructure live in `src/application/`, `src/lib/`,
  `src/components/`, and `src/persistence/`.
- PostgreSQL migrations live in `src/persistence/postgres-migrations/`.
- Translations live in `messages/`.
- Unit and integration tests live in `tests/unit/` and `tests/integration/`.

Read [Architecture and Coding Patterns](./docs/architecture/coding-patterns.md) before changing
module boundaries, data access, server actions, or runtime composition. Test placement and isolation
rules are in [Testing Architecture](./docs/architecture/testing.md).

## Code style

- Use strict TypeScript and the `@/*` alias.
- Prettier uses two-space indentation, semicolons, double quotes, ES5 trailing commas, and a
  100-column width.
- Prefer kebab-case utility and route filenames, PascalCase React components, and `useX` hook names.
- Validate external input with Zod.
- Authenticate server mutations and authorize the target ledger.
- Scope tenant data by `ledgerId` and preserve inward dependency direction.

## Tests and checks

Unit tests require only Node.js 24. Pure logic tests run in Node; `.test.tsx` files and the small
set of tests that use browser APIs run in happy-dom. Integration tests also require a running Docker daemon; the
test runner starts an isolated `postgres:17-alpine` container automatically. The first integration
run may take longer while Docker downloads the PostgreSQL and resource-reaper images. Tests do not
require `.env`, real credentials, a fixed local port, or a manually created database.

Dead-code review runs both a complete graph and a production-only graph. Use `@testOnly` only for a
production-file helper directly exercised by focused tests, and `@publicContract` only for a reviewed
framework or compatibility entrypoint that Knip cannot discover. Do not add directory-wide ignores.

Run the narrowest relevant check while working:

```bash
npm test
npm run test:watch
npm run test:integration
npx vitest run tests/unit/path/to/file.test.ts
```

`npm run test:all` runs all unit and integration projects once; `npm run test:run` is an equivalent
compatibility entrypoint. `npm run test:prepare` performs a one-time PostgreSQL environment check
and then releases its container. An explicit `TEST_DATABASE_URL` may be used for advanced workflows,
but it must reference a PostgreSQL database whose name ends in `_test`, with `public.pg_trgm` already
installed and permission to create schemas. Test commands never fall back to `DATABASE_URL`.

Before opening a pull request, run:

```bash
npm run check
```

This runs formatting, architecture checks, lint, type checking, tests, coverage, a production build
with isolated build-check placeholders, and translation validation. Coverage thresholds are 70% for
lines, 68% for statements, 65% for functions, and 60% for branches. The ordinary `npm run build`
still uses the caller's production configuration.

## Browser smoke tests

With Node.js 24 and Docker available:

```bash
npx playwright install chromium
npm run test:smoke
```

The runner starts a temporary PostgreSQL container and creates a uniquely named smoke database,
applies real migrations, seeds a fictional password account, builds production assets, and runs
desktop and mobile Chromium tests. It does not use an authentication bypass, real email, AI, or
object storage. `TEST_DATABASE_URL` may override the test connection, but must still point to a
loopback database named `cashier_test` with `CREATEDB` permission. Never point it at production.

The suite covers password rejection/login, shared ledger access, manual entry,
editing, persistence after reload, deletion, logout, and protected-page redirects. Failures retain
screenshots and traces in `test-results/` and an HTML report in `playwright-report/`. Normal exit,
failure, and handled interruptions stop the test server and remove only this run's database.
CI runs this separately from the Vitest gate and requires it before publishing an image.

## Commits and pull requests

Use Conventional Commit subjects such as:

```text
feat: add ...
fix: prevent ...
docs: explain ...
chore: update ...
```

Pull requests should:

- Explain the user-visible behavior change and its reason.
- Link the issue or discussion when one exists.
- List the commands used for validation.
- Call out migrations, configuration changes, or compatibility implications.
- Include screenshots or recordings for UI changes, using fictional or fully sanitized data.

For substantial behavior changes, open an issue or discussion before investing in a large
implementation. Do not mix unrelated cleanup into the same pull request.
