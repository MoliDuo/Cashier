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

## Legacy submission credential repair (`0046`)

`0038_source_document_lifecycle.sql` decided `origin = 'submission'` from live
processing evidence: a processing attempt, an outbox row, a pending-revision
pointer, or a non-completed outcome. Revisions backfilled from the retired
SQLite database on 2026-07-14 have none of that evidence and still report a
completed outcome, so `0038` marked them `manual_edit`. Because
`latest_submission_revision_id` was only filled from revisions already marked
`submission`, those documents kept a NULL pointer and every submission-backed
read returned nothing: original images and text, submission status, and the
retry / edit-retry actions disappeared from the UI while the rows and objects
stayed intact.

`0046_restore_legacy_submissions.sql` repairs that classification. For a
document whose revision 1 is `manual_edit`, has recoverable input (a revision
file or non-empty text), and has no submission revision at all, it marks the
revision `submission` / `completed` and points `latest_submission_revision_id`
at it. It does not bump `source_documents.version`, and it does not touch
`active_revision_id`, `ledger_entries`, `stored_files`, or object storage, so
amounts, categories, and later manual edits keep their values. Clients already
holding a "no credential" snapshot refetch because the change-log trigger on
`source_document_revisions` and `source_documents` still publishes one change
batch per affected ledger. Split and date-organization children are excluded
even though their revision 1 copies a parent's text and files; a document with
neither image nor text keeps its manual origin. The migration is idempotent.

Verified on 2026-09-17 against `cashier_couple_runtime_20260917` (a derived
rehearsal database, not the original dump). A copy named
`cashier_0046_verify` received the repair directly: 659 revisions moved from
`manual_edit` to `submission`, 659 documents gained a pointer, a second run
reported `UPDATE 0` for both statements, `active_revision_id` plus `version`
were byte-identical for all 1,547 documents, and `input_text`, entry amounts,
entry categories, revision-file links, and stored-file keys were unchanged.
`npm run db:migrate` on a separate copy, `cashier_0046_migrate`, recorded
migration `46`. Counts from that derived dataset are superseded by the
original-dump retest below.

Retested on 2026-09-17 against `cashier_prod_orig`, a clean restore of the
immutable `original.dump` taken before any rehearsal work. That is the only
copy that reflects pre-upgrade production: 664 documents are repair targets
(644 with images, 20 text-only), all created before 2026-07-18. The pre-migration
dry run below reports 664 there, and 0 afterwards. The full upgrade
(`0044` + `0045` + `0046`) on a copy of that dump merged both ledgers into the
owner's ledger, left `ledger_entries` at 1,631 rows and
62,303.710 unchanged, reduced live NULL-pointer documents from 666 to 2, and
made the sample document holding stored file
`e394a76c-4df7-4b77-a8ba-25876c137921` return that image. The four documents
created on or after 2026-08-16 are excluded by the content-provenance guard,
as intended.

Earlier rehearsal copies (`cashier_couple_runtime_20260917` and the derived
`cashier_0046_verify`) show 659/1,547 because they came from the post-merge,
pruned rehearsal database rather than the original dump. Treat 659 as an
artifact of that derived dataset; the 664 figure above is the production
baseline. Live production drifts as documents are added and deleted, so use
the dry run as the authority. Run it read-only before executing the migration,
and prefer a Neon branch or PITR snapshot as the rollback point.

```sql
WITH legacy_submission AS (
  SELECT r.id AS revision_id
  FROM source_documents AS sd
  JOIN source_document_revisions AS r
    ON r.ledger_id = sd.ledger_id
   AND r.source_document_id = sd.id
   AND r.revision_number = 1
  WHERE sd.latest_submission_revision_id IS NULL
    AND r.origin = 'manual_edit'
    AND NOT EXISTS (
      SELECT 1 FROM source_document_revisions AS s
      WHERE s.source_document_id = sd.id AND s.origin = 'submission'
    )
    AND (
      EXISTS (
        SELECT 1 FROM revision_files AS rf
        WHERE rf.ledger_id = r.ledger_id AND rf.revision_id = r.id
      )
      OR coalesce(r.input_text, '') <> ''
    )
    AND NOT EXISTS (
      SELECT 1
      FROM source_document_revisions AS sibling
      WHERE sibling.origin = 'submission'
        AND sibling.source_document_id <> sd.id
        AND coalesce(sibling.input_text, '') = coalesce(r.input_text, '')
        AND NOT EXISTS (
          (
            SELECT rf.stored_file_id FROM revision_files AS rf
            WHERE rf.revision_id = sibling.id
            EXCEPT
            SELECT rf.stored_file_id FROM revision_files AS rf
            WHERE rf.revision_id = r.id
          )
          UNION ALL
          (
            SELECT rf.stored_file_id FROM revision_files AS rf
            WHERE rf.revision_id = r.id
            EXCEPT
            SELECT rf.stored_file_id FROM revision_files AS rf
            WHERE rf.revision_id = sibling.id
          )
        )
    )
)
SELECT count(*) FROM legacy_submission;
```

After the migration, re-run the count and expect 0; the only documents that may
still hold a NULL pointer are genuine manual entries with no input to recover.
Then open a few older documents and confirm the original images render and
"edit retry" seeds the draft with them.

## Member profiles and per-person time zones (`0047`)

`0047_member_profiles.sql` gives each member a nickname, a gender, and their own
time zone, and drops the ledger-wide `ledgers.time_zone` that 0045 had left
serving two people in two places. Both members are editable afterwards in
设置 → 个人资料; the migration only has to start them out distinct.

The migration numbers the rows by `created_at, id` and gives odd positions
`A`/`male` and even positions `B`/`female`, so the account created first — the
configured owner — is A. Deleted accounts are numbered too, so a later cleanup
cannot shift the two live members. `nickname` is trimmed and must be 1–20
characters, `gender` is `male` or `female`, and `time_zone` is the ledger's old
zone or NULL, where NULL still means "use this device's zone".

Three things change for deployments:

- **Date defaults follow the viewer.** `0047` copies the ledger's zone onto
  every user, so the day a record lands on is now the signed-in member's. If one
  of you relied on the ledger zone while your device was set elsewhere, set it
  explicitly in 设置 → 个人资料 → 我的时区.
- **The ledger settings trigger is redefined.** Its `UPDATE OF` list named
  `time_zone`, so the migration drops and recreates
  `trg_ledgers_settings_change_log` without that column before dropping it.
  The remaining settings columns still publish a settings change.
- **API keys stay on the server clock.** A record created through
  `/api/v1/source-documents` is dated by the server, not by either member's
  zone, because a key is not a device. `npm run db:bootstrap` on a new database
  creates A/male and B/female directly, matching what an upgraded database
  starts with.

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

### Do not run the upgrade inside a platform build

`npm run db:migrate` applies schema migrations and then merges the ledgers as
two separate transactions. Drizzle commits the schema first; the merge opens
its own transaction. If the merge stops on active work, the process exits
non-zero **after** the schema has already committed, and no application is
serving to drain that work. That is a half-upgraded production: the schema is
past `0046` while both member ledgers are still separate, and the previously
deployed app cannot run against it because `0045` dropped
`users.registration_completed_at` and made `source_documents.attributed_user_id`
non-null, which the old insert path does not set. Sign-in and document creation
fail until the merge completes.

Because of that ordering, never put `db:migrate` in a build command
(`vercel.json`, a package `build`/`postinstall` script, or a platform build
step). The merge requires a pause in writes that a build cannot express, and a
failed build leaves the committed schema without the merge. Run the upgrade as
a deliberate operation against a quiesced database, with writers stopped and no
non-terminal work:

```sql
SELECT source, status, count(*) AS rows FROM (
  SELECT 'processing_attempts' AS source, status::text AS status
    FROM processing_attempts WHERE status IN ('queued','processing')
  UNION ALL
  SELECT 'processing_outbox', status::text
    FROM processing_outbox WHERE status IN ('pending','claimed')
  UNION ALL
  SELECT 'category_reclassification_jobs', status::text
    FROM category_reclassification_jobs WHERE status IN ('preparing','pending','running')
  UNION ALL
  SELECT 'upload_sessions', status::text
    FROM upload_sessions WHERE status IN ('open','finalizing')
  UNION ALL
  SELECT 'exchange_rate_recalculation_jobs', status::text
    FROM exchange_rate_recalculation_jobs WHERE status IN ('pending','claimed')
) pending GROUP BY source, status HAVING count(*) > 0 ORDER BY source, status;
```

The merge refuses to start while any of those rows exist and now names them in
its error, for example `upload_sessions open (1)`. A leftover `open` upload
session is the common case: sessions expire after 15 minutes and are settled on
the next request, so stop the app, let them expire, and confirm the query
returns nothing. To recover a half-upgraded database, settle the reported rows
and run `npm run db:migrate` again; the schema step is a no-op and the merge
retries. `npm run db:couple-preview` reports the same breakdown without
writing.
