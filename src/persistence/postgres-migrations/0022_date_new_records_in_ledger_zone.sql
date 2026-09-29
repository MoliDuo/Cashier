-- A new record now carries its day from the moment it is created. Records made
-- before that had none until their processing succeeded, so one still
-- processing, failed or cancelled fell back to its UTC creation day: the day
-- before, for anything recorded in the early morning east of UTC. They get the
-- day their submission asked for, or else their creation day in the ledger's zone.
UPDATE "source_documents" SET "document_date" = COALESCE(
  "extraction_attempts"."requested_date",
  ("source_documents"."created_at" AT TIME ZONE "ledgers"."time_zone")::date
)
FROM "ledgers", "extraction_attempts"
WHERE "ledgers"."id" = "source_documents"."ledger_id"
  AND "extraction_attempts"."id" = "source_documents"."latest_attempt_id"
  AND "source_documents"."document_date" IS NULL;--> statement-breakpoint
UPDATE "source_documents" SET "document_date" = ("source_documents"."created_at" AT TIME ZONE "ledgers"."time_zone")::date
FROM "ledgers"
WHERE "ledgers"."id" = "source_documents"."ledger_id" AND "source_documents"."document_date" IS NULL;
