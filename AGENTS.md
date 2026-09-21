# Agent Guidelines

Read [CONTRIBUTING.md](./CONTRIBUTING.md) for the authoritative development setup, project layout,
coding style, test workflow, commit conventions, and pull request requirements.

## Agent behavior

- Read `docs/architecture/coding-patterns.md` before changing module boundaries, application
  contracts, adapters, server actions, or runtime composition.
- Preserve inward dependency direction. Keep routes and API handlers in `src/app/`, business
  logic in `src/modules/`, shared infrastructure in `src/application/` and `src/lib/`, and database
  definitions and migrations in `src/persistence/`.
- Prefer existing repository patterns over new abstractions. Keep changes scoped, avoid unrelated
  rewrites, and do not revert user changes in a dirty worktree.
- Add focused regression coverage for behavior changes. Run the narrowest relevant checks while
  working and the repository gate described in `CONTRIBUTING.md` before declaring completion.
- Validate external input with Zod, authorize ledger access, scope tenant queries by `ledgerId`, and
  never log tokens, raw personal data, provider credentials, or image contents.
- Treat database, object-storage, generated-history, and backup cleanup as destructive. Review the
  target set before deleting it.
