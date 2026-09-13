# Architecture and Coding Patterns

## Dependency direction

Cashier is split into domain modules, application contracts, infrastructure adapters, and transport
entrypoints. Dependencies point inward:

1. Domain and application use cases depend on module-owned contracts or application ports.
2. Infrastructure adapters implement ports and may depend on PostgreSQL, S3, email, or AI clients.
3. Server actions and API routes authenticate, validate with Zod, invoke one use case, and map results.
4. The server composition root is the only place that assembles concrete adapters.

An application layer is justified by business decisions, transaction orchestration, or contract
mapping, not by a fixed number of calls. A server action may call an injected port directly when an
intermediate function would only rename and forward the same arguments.

Transport DTOs do not cross into persistence adapters. Database rows and provider response types do
not cross into modules. New code must not add a service locator lookup inside domain logic; pass the
required port through the use case boundary. Concrete runtime wiring belongs in the server composition root.

## Runtime boundaries

- Authenticate every server action and authorize the target ledger before reading or mutating data.
- Treat forwarded client addresses as untrusted unless `TRUSTED_PROXY` is explicitly configured.
- Log correlation IDs and stable, hashed identifiers. Do not log raw email addresses, IP addresses,
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
- Source-document writes go through the versioned aggregate (`SourceDocumentAggregateWritePort`), not
  a second write path. External IO — FX conversion, provider calls — runs before the transaction
  starts, never inside it; a write transaction locks the ledger row first, then locks the target
  document row(s) in ascending ID order, and only then compares the locked row's `version`
  against the caller's `expectedVersion`. Ledger-wide configuration the write depends on (for example
  `mainCurrency`) is not covered by a document's `version` and must be re-verified against the
  locked ledger row inside the same transaction. A failed check aborts before any write; a command
  that changes nothing observable for the caller (a no-op replay, an unchanged field) must not
  increment `version` — every aggregate command that does produce a user-observable change
  increments the target document's `version` by exactly one.
- Use the narrowest read port that satisfies the caller. Edit-retry evidence uses `getInput`; it
  must not load ledger entries or category projections that the caller discards.
- Loaded ledger settings are complete contracts; only update inputs are partial. Do not repeat
  defaults at each consumer. Metadata-only edits preserve stored amounts and FX results; amount,
  currency, and document-date changes recalculate only affected entries before acquiring locks.
- Projection replacement is an internal helper of the versioned aggregate, not an independent
  write port. Pass already locked documents and projections into transaction helpers.

## Frontend

- Use centralized query keys and `useLedgerMutation` for server state changes.
- Load tab-specific components and translations only when that tab is active.
- Deferred feature translations use the application QueryClient. Their key is
  `["feature-messages", version, locale, feature]`; do not add a second module-level cache or request
  listener system.
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
- Filtered ledger results show the amount without a `Filtered total` prefix. Unfiltered results may
  show `Total` / `合计`; missing bill titles use `Untitled Bill` / `未命名账单`.

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
- Interactive controls keep their own sizes: `Button` is 14px (`text-xs` at `size="sm"`), and `Input`
  and `Textarea` are 14px too, so a field is the same size as the labels, chips and buttons around
  it. They used to be `text-base md:text-sm` so iOS Safari would not zoom on focus; that trade was
  dropped on 2026-09-13 because the 16px field read a whole size larger than every control beside it
  on the widths where the app is used. Do not reintroduce a responsive step here.

Run `npm run check:architecture` locally. CI must reject import cycles.
Architecture rules inspect TypeScript syntax for protected writes and structured log fields; comments
and ordinary strings are not architectural evidence. The typography rules read class literals, so
arbitrary text sizes and the retired `text-muted` alias fail the check while comments stay exempt.
