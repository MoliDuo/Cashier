# Couple-only branch

This branch uses two existing accounts and one existing ledger. Configure
`COUPLE_OWNER_USER_ID`, `COUPLE_PARTNER_USER_ID`, and `COUPLE_LEDGER_ID` with
distinct, existing account IDs and the owner's existing ledger ID. The
configuration fails closed; signing in never creates a new ledger.

## Local backup and rehearsal

Do not change the production database during preparation. Take a complete
PostgreSQL custom-format dump **before** applying schema migrations, using a
compatible `pg_dump` version and a read-only connection. Keep the original
dump outside the repository with directory mode `0700` and file mode `0600`.
Record its SHA-256, PostgreSQL version, migration version, and table counts.
Restore a separate local database with `pg_restore --no-owner --no-acl
--exit-on-error --single-transaction` and compare every table count. The
database archive stores file keys and relationships, not S3 image bytes.

The 2026-09-17 rehearsal backup is in
`/home/xiangyu/Backups/Cashier/2026-09-17T010015933Z/`; its
`manifest.json` and `SHA256SUMS` contain the restorable snapshot metadata.
The isolated PostgreSQL container `cashier-couple-rehearsal-20260917` listens
only on loopback port 55439. Neither rehearsal database runs the app, workers,
email, AI, or object-storage writes. Do not commit the backup or share it.

Against the **local copy only**, run `npm run db:migrate` and then
`npm run db:couple-preview`. The preview uses a consistent read-only
snapshot and reports record counts, matching category names, active work, and
unexpected existing attribution without printing entry data. Stop if active
work or unexpected attribution is reported. After checking the preview, run
`npm run db:couple-preview -- --apply` on the isolated copy. A single
transaction moves ledger-scoped data, preserves unchanged row contents
(including original money, revision links, image keys, and credential hashes),
checks attribution and foreign keys, and rolls back on any mismatch.
Matching categories with identical properties merge; differing properties
receive an ID-derived suffix. A different main currency requires valid
stored exchange rates. Re-running after a successful merge is rejected.

The second local restore of the same immutable backup successfully applied
the updated merge: the shared ledger has 1,547 source documents, 2,568
entries, 1,839 revisions, 1,508 stored-file records, and 3 credentials.
All foreign keys are valid. These are snapshot counts, not a live production
baseline.

## Optional database cleanup

`npm run db:couple-cleanup` previews all accounts outside the two configured
IDs, their ledgers and ledger-scoped records, OTP tokens, and idempotency
records. It requires a completed shared-ledger merge. To apply **only on an
isolated local copy**, use
`npm run db:couple-cleanup -- --apply --expect=<targetFingerprint>` where the
fingerprint is copied from a fresh preview. The script rechecks targets under
locks, rejects unknown ledger/user relationships and active work, and removes
dependent rows before deleting ledgers and users. It does not contact S3 or
schedule image deletion. A mismatched fingerprint rolls back without
deleting anything.

Removing the other accounts' database rows leaves their S3 images without
database references. Do not run `scripts/prune-storage.mjs --apply` or its
scheduled equivalent while those images must be retained: its durable-orphan
scan would delete them. Existing object-cleanup jobs for target accounts
also block database cleanup.

## Future production operation

No production schema upgrade, merge, account cleanup, or deployment is
included in this rehearsal. Before a future production operation, require
`npm run check` and `npm run test:smoke` to pass; stop all app/API writers,
workers, uploads and storage cleanup; confirm there is no active work; take
and verify a **new** complete database backup; and repeat the preview against
the paused database. Apply the schema migration and merge only after the
backup. Verify both logins, per-person and combined accounting totals, API
key continuity, and old image references before resuming writes. Account
cleanup is a separate operation with its own preview and verification.

If validation after a committed migration fails, keep writers stopped and
restore the latest pre-migration backup into a clean database with
`pg_restore`, then restart the recorded previous application version.
Switching Git branches does not restore database contents.
