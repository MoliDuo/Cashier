# Agent Guidelines

Cashier is built for the two people who use it. [README.md](./README.md) covers setup,
configuration, deployment, and the command list; the documents below are the authority for how the
code is organized and tested.

- [docs/architecture.md](./docs/architecture.md) — layering, dependency direction, data model,
  concurrency, background runtime, authentication, and frontend conventions.
- [docs/testing.md](./docs/testing.md) — test placement, isolation, and how each suite runs.
- [docs/api.md](./docs/api.md) — the public API v1 contract.

## Agent behavior

- Read `docs/architecture.md` before changing module boundaries, server actions, queries, the data
  model, or cross-module flows. Refactors move toward it; a change that departs from it updates that
  document first.
- Preserve inward dependency direction. Keep routes and API handlers in `src/app/`, feature logic
  in `src/modules/`, cross-module background flows in `src/server/`, shared infrastructure in
  `src/lib/`, and database definitions and migrations in `src/persistence/`.
- Prefer existing repository patterns over new abstractions. Keep changes scoped, avoid unrelated
  rewrites, and do not revert user changes in a dirty worktree.
- Add focused regression coverage for behavior changes, placed as `docs/testing.md` describes. Run
  the narrowest relevant checks while working and `npm run check` before declaring completion.
- Validate external input with Zod, authorize ledger access, scope tenant queries by `ledgerId`, and
  never log tokens, raw personal data, provider credentials, or image contents.
- Treat database, object-storage, generated-history, and backup cleanup as destructive. Review the
  target set before deleting it.
- Never commit `.env`, provider credentials, real receipts, API keys, or raw personal data.

## Repository gate

`npm run check` must pass before a commit lands. It runs formatting (Prettier), the architecture
check (dependency-cruiser), dead-code detection (knip), ESLint with zero warnings, `tsc`, message
catalog validation, the full test suite with the coverage thresholds in `vitest.config.mts`, and a
production build against isolated placeholders with the protected-route bundle budget. Integration
tests need a running Docker daemon. Run `npm run test:smoke` as well when a change touches sign-in,
routing, or the flows the smoke specs cover.

Pushing to `main` deploys: Vercel migrates the production database and builds in parallel with CI,
so CI does not gate the deploy. The local gate is the gate.

## Migrations

- Generate with drizzle-kit, then keep the migration as hand-written SQL; keep only the latest
  snapshot and format the journal with Prettier.
- Follow expand/contract: the previous release keeps serving while a migration runs. Stop writing a
  column, then stop reading it, then drop it, each in its own release. Names the model no longer
  mentions but the database still has go in `retiredNames` in the schema contract test.

## Commits

- Conventional Commit subjects: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `perf:`, `test:`,
  `build:`; mark breaking changes with `!`.
- Subjects describe the behavior change in plain words. Keep code, comments, and commit messages in
  English; user-facing documentation is in Chinese.
- Do not commit generated files such as `repomix-output.xml`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
