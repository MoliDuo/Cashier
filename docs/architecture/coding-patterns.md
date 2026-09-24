# Architecture and Coding Patterns

## Dependency direction

Cashier has one runtime (Vercel, PostgreSQL, S3-compatible storage), so there are no ports,
adapters, or composition root. Code calls the function that does the work:

```
src/app/                  routes and API handlers: authenticate, validate, call, map the response
src/modules/<m>/
  server-actions/         Zod validation + withLedgerAccess, then call server/ functions directly
  server/                 drizzle data access and transactions ("server-only")
  domain/                 pure decisions: state, amounts, parsing, prompts (no db, framework, IO)
  hooks/ ui/              client code
src/server/               cross-module background flows: processing, category reclassification,
                          exchange-rate recalculation, maintenance, stored files, API v1 pipeline
src/lib/                  shared infrastructure: db, locks, S3, AI client, email, logger, env
src/persistence/          schema and migrations
```

1. `app` → `modules` / `server` → `lib` → `persistence`. `src/lib` and `src/persistence` never import
   modules or `src/server`; `src/server` never imports routes, server actions, or UI.
2. Modules and `src/server` may call each other's `server/` functions, as long as there are no
   file-level import cycles.
3. Server actions and API routes never touch the database or provider SDKs directly.
4. A function that only renames and forwards arguments should not exist; call the target instead.

Pull a decision out into `domain/` when it has branches worth unit-testing; leave straight-line data
access in `server/` and cover it with PostgreSQL integration tests. Unit tests replace collaborators
with `vi.mock` of the concrete module rather than injected fakes.

## Runtime boundaries

- Authenticate every server action and authorize the target ledger before reading or mutating data.
- Treat forwarded client addresses as untrusted unless `TRUSTED_PROXY` is explicitly configured.
- Log correlation IDs and identifiers tagged by logIdentifier; email and IP identifiers are hashed. Do not log raw email addresses, IP addresses,
  bearer tokens, OTP values, image contents, or provider payloads.
- Keep external email, exchange-rate, AI, and object-store calls outside database transactions and
  ledger locks.
- Use conditional writes, row locks, or fencing tokens for one-shot and leased workflows.

## Data access

- Scope tenant data by `ledgerId` in SQL and include soft-delete predicates.
- Prefer set-based statements (`UPDATE FROM`, CTEs, and `unnest`) to per-row queries.
- Keep keyset ordering and cursor fields identical. A cursor includes a fingerprint of its query.
- Use the persisted accounting amount for Details, Stats, and Stream summaries. Cross-currency 1:1
  fallback is forbidden.
- Source-document writes live in the registered writers under `src/modules/source-document/server/`
  (the architecture check lists them), not a second write path. External IO — FX conversion, provider calls — runs before the transaction
  starts, never inside it; a write transaction locks the ledger row first, then locks the target
  document row(s) in ascending ID order, and only then compares the locked row's `version`
  against the caller's `expectedVersion`. Ledger-wide configuration the write depends on (for example
  `mainCurrency`) is not covered by a document's `version` and must be re-verified against the
  locked ledger row inside the same transaction. A failed check aborts before any write; a command
  that changes nothing observable for the caller (a no-op replay, an unchanged field) must not
  increment `version` — every aggregate command that does produce a user-observable change
  increments the target document's `version` by exactly one.
- Document details use one complete detail contract, including entries and evidence file metadata.
  Historical revision numbers remain stored for audit; new revisions use UUID identities and document
  versions for concurrency, without allocating sequential revision numbers.
- Use the narrowest read that satisfies the caller. Edit-retry evidence reads only the revision
  input; it must not load ledger entries or category projections that the caller discards.
- Loaded ledger settings are complete contracts; only update inputs are partial. Do not repeat
  defaults at each consumer. Metadata-only edits preserve stored amounts and FX results; amount,
  currency, and document-date changes recalculate only affected entries before acquiring locks.
- Projection replacement is an internal helper of the versioned aggregate, not an independent
  writer. Pass already locked documents and projections into transaction helpers.

## Frontend

- Use centralized query keys and `useLedgerMutation` for server state changes.
- Load tab-specific components only when that tab is active. The message catalog is one file for
  one language; it ships with the page rather than being fetched per feature. Catalog validation checks
  ICU syntax and statically known message keys. Chinese literals and dynamic keys are allowed;
  dynamic keys remain the caller's responsibility.
- Keep browser image data as `File`/`Blob` through compression and upload. Object URLs are UI
  resources and must be revoked when an image is replaced, removed, reset, or unmounted.
- Treat Infinite Query pages and detail queries as independent server-state views. Ledger mutations
  invalidate ledger-scoped resource groups; do not patch unrelated filtered windows or maintain a
  canonical client entity store.
- A committed aggregate snapshot may replace its exact detail query, with older responses prevented
  from rolling back its version. Continuous splitting uses this snapshot for the next command.
  Background list/statistics refreshes must not keep a successful command pending; editors without
  a committed snapshot wait only for their target detail. Browser ledger reads use the session query
  route rather than the Server Action queue, including tab prefetches.
- Derive render state directly, use functional state updates, and avoid module barrel imports in
  client entrypoints.
- Tabs own their query loading and error states. Statistics retain the last successful data with
  its corresponding period while refreshing. Same-generation Stream refreshes retain loaded pages.
- Create and retry drafts use distinct typed inputs. Retry keeps the original draft version for
  conflict detection and shares the unsaved-changes guard for close, history navigation, and pending
  submission. Server refreshes must not silently advance that baseline.
- The client instrumentation entrypoint installs the history traversal listener before hydration;
  the active ledger hook registers and releases its handler. Registering a later `popstate` listener
  cannot reliably stop the router from unmounting a dirty editor first. Dialog exit completion uses
  Radix's close-focus lifecycle, not CSS animation events that may never fire.

### Design baseline

- Keep the interface modern-minimal, dense, practical, and workbench-oriented. Use the existing
  tokens in `src/app/design-tokens.css` and `src/app/globals.css` rather than introducing a parallel
  theme system.
- Use `#10a37f` for primary actions and focus, not decoration. Keep surfaces neutral and reserve
  semantic colors for state: danger `#b24c5a`, warning `#9a6b1f`, info `#4f6f7a`, and success
  `#24836e`. Dark surfaces use the existing near-black neutral scale.
- Use the operating-system sans-serif stack with local Chinese fallbacks. Do not remotely load web
  fonts, and keep letter spacing at `0`.
- Follow the 4/8pt spacing scale. Touch controls remain at least 44px; cards and desktop dialogs use
  at most an 8px radius; long mobile flows use square full-screen surfaces with `100dvh`, safe-area
  padding, fixed headers and footers, and a scrollable body.
- Keep motion functional and low-key: opacity and transform only, 160-280ms transitions, CSS
  spinners for processing, and near-instant reduced-motion states.
- Use Lucide icons for commands and navigation. Empty or explanatory states do not need decorative
  icons. Mobile filters use bottom drawers; date pickers, calculators, and confirmations use compact
  dialogs.
- Filtered ledger results show the amount without a `筛选合计` prefix. Unfiltered results may show
  `合计`; missing bill titles use `未命名账单`.

### Typography

Reach for a role in `src/components/typography.ts` before writing a raw size. The table is the
single answer to "how big is this kind of text", and it is what keeps page headings, section
headings, metadata and micro labels identical across surfaces.

| Role           | Size              | Use for                                              |
| -------------- | ----------------- | ---------------------------------------------------- |
| `pageTitle`    | 24px semibold     | The `<h1>` of a page.                                |
| `dialogTitle`  | 18px semibold     | A modal or sheet title.                              |
| `sectionTitle` | 16px semibold     | A page-level section heading, like a settings group. |
| `cardTitle`    | 14px semibold     | The title of one card in a list.                     |
| `body`         | 14px              | Default prose.                                       |
| `bodyStrong`   | 14px medium       | Form labels, entry names, inline values.             |
| `bodyMuted`    | 14px muted        | Descriptions and hints under a title.                |
| `meta`         | 12px muted        | Secondary metadata: timestamps, counts, hints.       |
| `micro`        | 11px muted        | Chips, chart ticks, dense badges.                    |
| `provisional`  | 11px italic muted | Machine-generated text that may still change.        |

- The sizes above are the frozen scale. `micro` is the only tier Tailwind does not ship; it lives in
  `src/app/globals.css` as `--text-micro`. Do not add arbitrary values such as `text-[13px]`, and do
  not add a step between tiers — `text-xl` (20px) is retired from headings so page titles are always
  24px. Larger display type (the 404 watermark, OTP and amount fields) is the deliberate exception.
- Secondary text is either `text-muted-foreground` or `text-muted-foreground/60`. The `text-muted`
  alias is gone: both names resolved to the same token, which made the palette look larger than it
  was.
- Headings are `font-semibold`. `font-bold` is reserved for display numerals.
- Interactive controls keep their own sizes. Input and Textarea use 16px on mobile to avoid
  focus zoom in iOS Safari and 14px on desktop; Button uses its existing size variants.

Run `npm run check:architecture` locally. CI must reject import cycles.
Architecture rules inspect TypeScript syntax for protected writes and structured log fields; comments
and ordinary strings are not architectural evidence. The typography rules read class literals, so
arbitrary text sizes and the retired `text-muted` alias fail the check while comments stay exempt.

### Category assignment writes

Category changes initiated by persistent assignment jobs belong to the source-document aggregate.
Acquire locks in this order: ledger, source documents ordered by ID, then assignment job/document
work. The aggregate transaction validates the document version, active revision, editable state,
target category, claim token, and lease before changing any entry. It increments each document
version at most once and writes entry outcomes, work status, and parent counters in the same
transaction. Do not reintroduce a standalone unversioned category writer or record job progress in a
second transaction.
