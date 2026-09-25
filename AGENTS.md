# Agent Guidelines

Read [CONTRIBUTING.md](./CONTRIBUTING.md) for the authoritative development setup, project layout,
coding style, test workflow, commit conventions, and pull request requirements.

## Agent behavior

- Read `docs/architecture/coding-patterns.md` before changing module boundaries, server actions,
  server functions, or cross-module flows.
- Read `docs/architecture/target-architecture.md` before changing the data model or restructuring a
  module. Refactors move toward it; a change that departs from it updates that document first.
- Preserve inward dependency direction. Keep routes and API handlers in `src/app/`, feature logic
  in `src/modules/`, cross-module background flows in `src/server/`, shared infrastructure in
  `src/lib/`, and database definitions and migrations in `src/persistence/`.
- Prefer existing repository patterns over new abstractions. Keep changes scoped, avoid unrelated
  rewrites, and do not revert user changes in a dirty worktree.
- Add focused regression coverage for behavior changes. Run the narrowest relevant checks while
  working and the repository gate described in `CONTRIBUTING.md` before declaring completion.
- Validate external input with Zod, authorize ledger access, scope tenant queries by `ledgerId`, and
  never log tokens, raw personal data, provider credentials, or image contents.
- Treat database, object-storage, generated-history, and backup cleanup as destructive. Review the
  target set before deleting it.
