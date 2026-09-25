# Runtime Model

This document describes Cashier's current processing and client refresh boundaries. It is intended
for contributors, not as a deployment guarantee.

## Source-document processing

- Vercel is the only production target; local development runs the same application path.
- A submission creates a processing attempt (a `source_document_revisions` row) and schedules
  work with Next.js `after()`. The attempt is its own queue entry; there is no separate job table.
- There is no global drain loop, cron process, external queue, or continuously running worker.
- A worker claims the attempt while it is still processing and still the document's latest
  submission, renews the lease while it runs, and closes it in the transaction that records the
  result or the failure. A claim counts an attempt; a claim past the attempt limit fails the
  attempt under its lease.
- Processing remains bounded by the Vercel function `maxDuration`.

`POST /api/v1/source-documents` returns `201` only after image processing, object upload, and
database persistence finish. It does not wait for AI parsing. If parsing fails or the request
lifecycle ends, the job remains recoverable. The next upload, ledger query, or Stream refresh
for that ledger can claim pending work, and the daily cron schedules whatever is still due.

Cancelling a delivered HTTP request does not undo a completed upload. API clients should reuse the
same `Idempotency-Key` when retrying a create request. The key is stored on the document it
created, scoped to the ledger and sender, and never expires: a repeat returns that document
without processing images again, a repeat with other content is refused with `409`, and a
concurrent repeat waits on the ledger lock for the first to commit.

## Category assignment jobs

Batch category assignment also uses `after()` with durable PostgreSQL work rows. The selection is
submitted once, up to `CATEGORY_ASSIGNMENT_MAX_ENTRIES` entries, and the server registers the job,
its documents, and its entries in one transaction. A ledger has at most one active job, and a run
leases the job row, so each ledger has one worker and no global slot is shared between ledgers.

The run works through the job's due documents one at a time and waits through short retry delays,
but it stops once its run budget (`CATEGORY_RUN_BUDGET_MS`) is spent and hands the document it was
on back without charging an attempt. When no pending document remains, the run settles the job's
status from the entry outcomes in the same transaction. Closing the page does not cancel a started
job. While a job is active, the progress poll starts a fresh run every few seconds, which continues
where the last one stopped once the previous lease expires; the daily cron drains any job left
behind.

A document is the atomic classification commit unit; groups above 50 selected entries use persisted
request blocks. An external AI request is not exactly-once: a process can die after receiving an
answer but before persisting it, so recovery may repeat that block. Category writes,
source-document versions, and entry outcomes are fenced by the job lease and commit together.
Progress is counted from the entry and document rows when it is read.

## Unified Stream

The ledger home shows one Stream containing processing, failed, and completed source documents. Server-side keyset pagination orders records by
`entryDate DESC, createdAt DESC, id DESC`; the browser preserves server order.

## Refresh ownership

Each ledger has a monotonic bigint sync version. Stream and detail observers share one ledger-scoped
React Query refresh request. A single sync-state row stores the last changed version for categories,
settings, and statistics. Triggers allocate one version per ledger per transaction and update the
relevant resource watermarks atomically. Refresh compares these watermarks with the observer's
version; no change history, retention window, or log pruning is required. A main-currency change
advances every resource watermark.

The response also reports whether processing documents remain. While transitional work exists,
visible pages poll every three seconds; background polling is disabled, and focus or reconnect
triggers a refresh. Invalid or future versions invalidate all affected ledger projections.

React Query request deduplication gives multiple Stream and detail observers a single in-flight
refresh per ledger. Stream keyset generation and restart checks remain responsible for pagination
cursor consistency.

## Client caching

Cashier does not provide offline availability and registers no service worker; every page load
fetches the current deployment. The web manifest keeps the app installable from the browser menu
and the iOS share sheet. `public/sw.js` only retires the precaching worker older releases
installed: it activates immediately, deletes every cache, and unregisters itself.

Source-document images are not persisted in IndexedDB or a service-worker cache. Every view uses the
authenticated `/api/stored-files/{fileId}` route, whose responses use `Cache-Control: private,
no-store`. Reopening an image therefore performs a new authorized read.

## Storage boundaries

Web images upload directly to private S3-compatible storage with short-lived signed PUT URLs.
Planning records one pending `stored_files` row per image (`finalized_at` is null) under the ledger
lock, once the ledger has room: at most 20 pending files and 100 MiB stored since UTC midnight. The
signed URL targets `temporary/{ledgerId}/{storedFileId}`. Finalization, within 15 minutes, checks
each temporary object against the declared MIME type, size, and SHA-256, normalizes it, writes the
durable key, and marks the row ready; finalizing ready files again returns them unchanged. Only
ready files can be attached to a revision. Authenticated reads stream through
`/api/stored-files/{fileId}`.

API v1 inline images skip `temporary/`: the server normalizes them, reserves pending rows the same
way, writes the durable objects, and marks the rows ready. A submission that fails afterwards
discards the files it stored. The public v1 response contract is independent of internal
server-action reconciliation DTOs.

The stored-file implementation lives in `src/server/stored-files/`. Its `ObjectStore` contract
requires streaming reads, signed uploads, reads with metadata, and paged listing. Uploads and
authorized reads are plain functions over `getS3Storage()`; tests replace the object store by
mocking `@/lib/storage/s3`.

Evidence reads fetch bytes and metadata in one object-store GET and share a promise only within one
processing invocation.

Maintenance runs once a day from Vercel Cron at `/api/cron/daily` (`src/server/maintenance/daily.ts`),
authenticated by `CRON_SECRET`; requests no longer trigger it. Each step runs independently within
the cron budget: expired records, scheduling every ledger's due processing and category work with
`after()`, the exchange-rate refresh, pending files older than a day, ready files no document has
used for seven days (rows first, then their objects), `temporary/` objects older than a day, and
stored objects older than a day that no row names.

## Exchange rates

Entries store only their amount and currency. Reads convert with the `convert_amount` SQL function
at the document's effective date against `exchange_rates`, which holds one row per calendar day
and currency. An entry whose day has no rate reads as unconverted; it is never converted at another
day's rate. Writes make one best-effort attempt to cache the rates they need before the
transaction and save regardless; the daily cron fills missing days and replaces provisional rows. Changing the main currency only updates the setting.

## Simplified persistence

Processing leases, attempt counts, and scheduling state live on the processing attempt itself.
Leases use the shared helper in `src/lib/db/lease.ts`, timed by the database clock only: a lease is
held while its expiry is later than `clock_timestamp()`. A lease lasts 60 seconds and the worker
renews it every 15 seconds, both derived from `FUNCTION_MAX_DURATION_SECONDS`, so an attempt whose
function was killed can be claimed again within a minute.

A claim counts the attempt. Failures are classified once, by `src/lib/background/retry.ts`:
transient provider failures (rate limits, outages, timeouts) give the attempt back to the queue with
a backoff until its third attempt, while permanent and configuration failures fail it at once.
Recovery only reads which attempts are due and unheld; a duplicate schedule loses the claim.

Entries belong to their document alone. A completed parse replaces the document's entries; a
failed or cancelled one leaves them in place. The document's current input (text and files) lives
on the document: a submission or edit-retry replaces it, and a split or date organization copies
it to each new document so the new record keeps its evidence. Manual edits change entries in place
without creating revisions or copying entry history; revisions exist only for parse attempts, and
the document's latest submission points at the current one.

AI text, image, and JSON repair requests use the single configured model. Category assignment runs
one worker per ledger. The AI client serializes provider requests
within each process and honors Retry-After cooldowns; this is not a provider-wide quota across
multiple application instances.
