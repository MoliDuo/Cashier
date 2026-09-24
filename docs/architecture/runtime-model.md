# Runtime Model

This document describes Cashier's current processing and client refresh boundaries. It is intended
for contributors, not as a deployment guarantee.

## Source-document processing

- Vercel is the only production target; local development runs the same application path.
- A submission creates a durable processing job and schedules work with Next.js `after()`.
- There is no global drain loop, cron process, external queue, or continuously running worker.
- Processing intents use idempotent dispatch, claim leases, and lease renewal.
- Processor completion reports `atomic` when the aggregate transaction already completed its
  job, and `residual` when the dispatcher must acknowledge remaining work. Only residual
  completion invokes the separate acknowledgement; recovery claims batches through one path.
- Processing remains bounded by the Vercel function `maxDuration`.

`POST /api/v1/source-documents` returns `201` only after image processing, object upload, and
database persistence finish. It does not wait for AI parsing. If parsing fails or the request
lifecycle ends, the job remains recoverable. The next upload, ledger query, or Stream refresh
for that ledger can claim pending work. With no later request, recovery does not run automatically.

Cancelling a delivered HTTP request does not undo a completed upload. API clients should reuse the
same `Idempotency-Key` when retrying a create request.

## Category assignment jobs

Batch category assignment also uses `after()` with durable PostgreSQL work rows. A normal lifecycle
keeps claiming document work, waits through short retry delays, and does not depend on the details
page polling. Closing the page therefore does not cancel a committed job. Polling only displays
progress and gives a later request an opportunity to recover expired leases after a process restart
or serverless termination.

The database coordinates deployment-wide document slots with leases and fencing tokens. A document
is the atomic classification commit unit; groups above 50 selected entries use persisted request
blocks. An external AI request is not exactly-once: a process can die after receiving an answer but
before persisting it, so recovery may repeat that block. Category writes, source-document versions,
entry outcomes, and job counters are idempotent and commit together.

Serverless `maxDuration` can still terminate a long run. With no later ledger request and no separate
worker or scheduler, Cashier does not promise automatic recovery after that termination.

## Unified Stream

The ledger home shows one Stream containing processing, failed, and completed source documents. Server-side keyset pagination orders records by
`entryDate DESC, createdAt DESC, id DESC`; the browser preserves server order.

## Refresh ownership

Each ledger has a monotonic bigint sync version. Stream and detail observers share one ledger-scoped
React Query refresh request. The server summarizes all retained change batches after the observer's
version in one query, including category, settings, and statistics invalidation flags.

The summary also reports whether processing documents remain. While transitional work exists,
visible pages poll every three seconds; background polling is disabled, and focus or reconnect
triggers a refresh. Invalid or future versions, retained-log gaps, and `resetRequired` batches cause
the client to invalidate all affected ledger projections instead of assuming a continuous history.

React Query request deduplication gives multiple Stream and detail observers a single in-flight
refresh per ledger. Stream keyset generation and restart checks remain responsible for pagination
cursor consistency.

## Client caching

Cashier does not provide offline availability. The service worker precaches immutable assets but
does not serve navigation requests or cached API responses.

Production PWA updates are browser-side service-worker handoffs, not two server deployments. The
current worker keeps controlling an open page while a newly installed worker waits. The app asks
the waiting worker to activate only when one Cashier window remains and the visible page has no
dirty editor, active request, open dialog, batch selection, or focused text input. A successful
handoff triggers one reload under the new worker; otherwise the old page continues until a later
safe check.

Source-document images are not persisted in IndexedDB or a service-worker cache. Every view uses the
authenticated `/api/stored-files/{fileId}` route, whose responses use `Cache-Control: private,
no-store`. Reopening an image therefore performs a new authorized read.

## Storage boundaries

Web images upload directly to private S3-compatible storage with short-lived signed PUT URLs. The
server verifies MIME type, size, and SHA-256 metadata before copying an upload to its durable key.
Authenticated reads stream through `/api/stored-files/{fileId}`.

API v1 inline images use the server-side upload path. The public v1 response contract is independent
of internal server-action reconciliation DTOs.

The stored-file adapter is assembled with `createStoredFileAdapter(dependencies)`. Upload planning,
proxy upload, finalization and compensation, and authorized reads are responsibility-focused
functions sharing explicit storage, clock, authorization-query, and upload-session dependencies.

Finalization replay is read-only after authorization. Evidence reads fetch bytes and metadata in
one object-store GET and share a promise only within one processing invocation.

Request-triggered maintenance uses a 60-second cooldown. Object cleanup claims at most 25 jobs,
executes four deletions concurrently, and uses five-minute leases. Acknowledgement requires the
current unexpired token; successful sibling jobs lock their upload session before deleting the
job and checking whether the session has any remaining work.

## Exchange-rate recalculation

The transaction that first persists a daily exchange-rate snapshot is the only normal enqueue point
for ledger recalculation jobs. Request-triggered maintenance drains due jobs; snapshot persistence
does not start detached promises. There is no process-global event subscriber registry or
instrumentation lifecycle token.

Jobs remain durable and use claim leases, fencing tokens, bounded concurrency, exponential retry,
and a permanent-failure state. Migration `0035_maintenance_work_lifecycle.sql` backfills historical
snapshots once. Runtime maintenance does not repeatedly scan history to recreate missing jobs.

## Simplified persistence

Processing leases, scheduling state, timestamps, and diagnostic fields live in processing_outbox.
There is no second attempts table to synchronize. Historical terminal diagnostics are migrated into
these rows; existing claim tokens and expiry times are preserved.

Manual edits update the active projection and increment the document version without creating a
revision or copying entry history. Splits keep the original active revision and create evidence
revisions only for newly created documents. Existing history stays intact. The latest submission
revision still identifies original input for retry; it is distinct from the active result.

AI text, image, and JSON repair requests use the single configured model. Category document slots
are limited to one across database-coordinated workers. The AI client serializes provider requests
within each process and honors Retry-After cooldowns; this is not a provider-wide quota across
multiple application instances.

Migration 0052 refuses to retire V1 category results still within their seven-day retention window,
or active processing attempts lacking durable jobs. It transfers diagnostics before dropping the
old attempts table. Run migrations with old application workers stopped before starting new code.
