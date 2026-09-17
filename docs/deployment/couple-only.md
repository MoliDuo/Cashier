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

Against the **local copy only**, run `npm run db:migrate`. This one command
applies schema migrations and automatically merges both existing member ledgers.
It skips the merge on an empty or already merged database, and stops on an
invalid shared ledger, active work, or unexpected existing attribution. The
data merge runs in a single transaction and preserves unchanged row contents
(including original money, revision links, image keys, and credential hashes),
checks attribution and foreign keys, and rolls back the merge on any mismatch.
Schema migrations commit before the data merge; if the merge fails, correct
the cause and run `npm run db:migrate` again. Do not start the app until it
completes successfully.
Migration `0045_couple_runtime_cleanup.sql` drops the obsolete registration
column and requires both attribution columns to be non-null. The migration
runner checks that existing configured members were active and had completed
registration before applying migrations. It stops on unassigned historical
documents or credentials, including deleted and revoked rows. The old ledger
owner column stays available for the original-data merge and cleanup tools.
Both tools recognize the pre-0045 and post-0045 schemas.
Matching categories with identical properties merge; differing properties
receive an ID-derived suffix. A different main currency requires valid
stored exchange rates. Re-running `npm run db:migrate` after a successful merge
does not move data again.

For a **new empty database**, configure the three `COUPLE_*_ID` UUIDs and
`COUPLE_OWNER_EMAIL`, `COUPLE_OWNER_PASSWORD`, `COUPLE_PARTNER_EMAIL`, and
`COUPLE_PARTNER_PASSWORD`. After `npm run db:migrate`, run
`npm run db:bootstrap` to preview and `npm run db:bootstrap -- --apply` to
create exactly two accounts, one ledger, and its default categories.
Bootstrap rejects nonempty databases and never runs during normal app startup.
The Docker runner image was also tested against a separate empty local database:
preview made no writes, and `--apply` created two users, one ledger, and 13
default categories.

The single-command rehearsal restored the immutable backup into
`cashier_couple_one_command_20260917` and ran `npm run db:migrate` twice.
The first run merged the ledgers; the second reported `ready`. The shared
ledger has 1,547 source documents, 2,568 entries, 1,839 revisions,
1,508 stored-file records, and 3 credentials. There are no unvalidated
constraints. These are snapshot counts, not a live production baseline.

For the runtime cleanup rehearsal, a new database
`cashier_couple_runtime_20260917` was restored from the same original dump.
It applied `0044` and `0045`, merged both ledgers, rejected a second merge,
then removed the four unrelated accounts using a fresh cleanup preview.
The result has two users, one active shared ledger, the same 1,547 documents,
2,568 entries, 1,839 revisions, 1,508 stored-file records, and three credentials.
There are no null attributions or unvalidated constraints. A separate copy
of the already-merged `0044` rehearsal database also upgraded directly to
`0045` with no null attributions or unvalidated constraints. The original
dump and earlier rehearsal databases were left unchanged.

When another demo server is running, set `CASHIER_DEMO_PROJECT` and unused
`CASHIER_DEMO_APP_PORT`, `CASHIER_DEMO_POSTGRES_PORT`, and `CASHIER_DEMO_S3_PORT`
for `npm run test:demo`; this creates separate containers and volumes instead
of resetting the active demo workspace.

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
and verify a **new** complete database backup. Then run `npm run db:migrate`
to apply the schema and merge both ledgers. Verify both logins, per-person and
combined accounting totals, API key continuity, and old image references
before resuming writes. Account cleanup is a separate operation with its
own preview and verification.

If validation after a committed migration fails, keep writers stopped and
restore the latest pre-migration backup into a clean database with
`pg_restore`, then restart the recorded previous application version.
Switching Git branches does not restore database contents.
