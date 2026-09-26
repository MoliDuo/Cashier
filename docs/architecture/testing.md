# Testing Architecture

Cashier keeps fast, deterministic unit tests separate from database-backed integration tests.

## Commands and prerequisites

- `npm test` runs the unit projects once and requires only Node.js 24.
- `npm run test:watch` watches the unit projects.
- `npm run test:integration` starts an isolated PostgreSQL container and runs both integration
  projects.
- `npm run test:all` runs every project once.
- `npm run test:coverage` runs every project with the repository coverage thresholds.

Database-backed commands require a running Docker daemon but no `.env`, credentials, fixed port, or
manual migration step. Testcontainers uses `postgres:18-alpine`, the production major version, with a random host port and releases
the container after the Vitest run. The first run may download PostgreSQL and resource-reaper images.
`npm run test:prepare` checks this lifecycle once and immediately releases the resource.

## Test layers

- Unit tests do not access PostgreSQL, the network, or real time. Pure `.test.ts` logic runs in
  Node; component tests and tests that actually use browser APIs run in happy-dom. External
  boundaries are mocked or replaced with in-memory fakes.
- Integration tests verify PostgreSQL behavior, route and server-action composition, transactions,
  concurrency, and persistence-backed server functions.
- The same behavior is fully verified at the lowest suitable layer. Higher layers focus on
  authorization, validation, error mapping, and composition.

`npm run check:dead-code` runs Knip over the complete graph, tests included, so an export loses
its last reference the moment nothing at all refers to it. An export that only tests use is not
flagged, and does not need a label saying so.

## Isolation

Browser smoke tests live in `tests/smoke/` and run with Playwright against a production build.
They exercise actual browser, authentication, server-action, and PostgreSQL boundaries. Each run
owns a separate `smoke_<uuid>` database; desktop/mobile scenarios run serially with fresh browser
contexts. The runner seeds one password account, its ledger, two books, and a few categories
directly into that database. No existing user database is migrated, seeded, or truncated. See `CONTRIBUTING.md` for the command.

Database-backed Vitest global setup migrates one template database, `test_<run-id>_template`, and
provides it to the workers. Each test file runs `CREATE DATABASE … TEMPLATE` into a database of its
own, `test_<run-id>_p<pool>_w<worker>`, laid out like production (tables in `public`, the migration
log in `drizzle`), and drops it when the file ends. No file replays migrations, so integration
workers scale with the machine (half its cores). Separate runs never share databases. The runner
removes only databases carrying its own run prefix after normal completion, failure, or
interruption.

`TEST_DATABASE_URL` is an explicit advanced override and never falls back to `DATABASE_URL`. It must
be a PostgreSQL URL whose database name ends in `_test`, and its user must be allowed to create
databases. Connection or validation failures stop the run instead of starting a local container.
Cleanup first enumerates databases with the run prefix and never removes the named database or
another run's databases.

Every test worker installs an MSW network guard. Shared deterministic handlers cover the background
OpenAI failure path and Frankfurter exchange-rate fixture; tests may add case-specific handlers or
use existing mocks. Any other unhandled HTTP request fails the test even when application code
catches the request error. Diagnostics contain only `TEST_UNEXPECTED_HTTP`, the method, and the
origin; paths, query parameters, credentials, and bodies are excluded.

Tests within a file run serially because the file's setup truncates its database between tests. Do not use `test.concurrent` or `describe.concurrent` in database-backed tests
without introducing test-case-level isolation.

The `after()` mock runs callbacks immediately and tracks their returned promises. Teardown drains
all tracked work before truncation or pool shutdown; synchronous and asynchronous callback failures
fail the test. The bounded drain uses real timers even in fake-timer tests and retains timed-out
work, so unfinished callbacks cannot silently cross into a fresh database fixture. Do not add
deadlock retries around truncation to hide unfinished work.

## Duplicate and compatibility coverage

Verify a behavior completely once at the lowest suitable layer. Keep upper-layer tests for the
boundary-specific behavior they add.

Compatibility or legacy tests must state the input format, migration, or compatibility contract
they protect. When the corresponding compatibility code is removed, remove the test at the same
time.

There is one implementation of each server function, so test it directly: unit tests `vi.mock`
the concrete modules it calls, and integration tests call it against the real PostgreSQL database.
