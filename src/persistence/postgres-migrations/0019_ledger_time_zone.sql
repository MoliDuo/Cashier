-- One zone dates the whole ledger. It starts as the zone of the first live book
-- that had one of its own; books.time_zone is no longer read and is dropped in
-- a later release, so the previous release keeps working while this runs.
ALTER TABLE "ledgers" ADD COLUMN "time_zone" text DEFAULT 'Asia/Shanghai' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledgers" ADD CONSTRAINT "ck_ledgers_time_zone_length" CHECK (length("ledgers"."time_zone") BETWEEN 1 AND 50);--> statement-breakpoint
UPDATE "ledgers" SET "time_zone" = first_zone."time_zone"
FROM (
  SELECT DISTINCT ON ("ledger_id") "ledger_id", "time_zone"
  FROM "books"
  WHERE "time_zone" IS NOT NULL AND "time_zone" <> '' AND "archived_at" IS NULL
  ORDER BY "ledger_id", "sort_order", "created_at", "id"
) AS first_zone
WHERE first_zone."ledger_id" = "ledgers"."id";--> statement-breakpoint
-- Every record carries its own day. A record written without one fell back to
-- its UTC creation day; it now gets its creation day in the ledger's zone.
UPDATE "source_documents" SET "document_date" = ("source_documents"."created_at" AT TIME ZONE "ledgers"."time_zone")::date
FROM "ledgers"
WHERE "ledgers"."id" = "source_documents"."ledger_id" AND "source_documents"."document_date" IS NULL;
