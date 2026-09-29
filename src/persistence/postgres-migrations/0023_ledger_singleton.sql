-- The expand step for retiring ledger_id. The ledger is a singleton, and from
-- this release on the application neither reads nor writes ledger_id: the
-- database fills it from the one ledger row, so every composite key and tenant
-- unique key it still backs stays enforced. The previous release keeps writing
-- the column and keeps working. 0024 drops it.
DO $$
BEGIN
  IF (SELECT count(*) FROM "ledgers") > 1 THEN
    RAISE EXCEPTION 'Cashier expects at most one ledger, found %', (SELECT count(*) FROM "ledgers");
  END IF;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ledgers_singleton" ON "ledgers" USING btree ((true));--> statement-breakpoint
CREATE FUNCTION current_ledger_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS 'SELECT id FROM ledgers';--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "ledger_id" SET DEFAULT current_ledger_id();--> statement-breakpoint
ALTER TABLE "entry_categories" ALTER COLUMN "ledger_id" SET DEFAULT current_ledger_id();--> statement-breakpoint
ALTER TABLE "ledger_entries" ALTER COLUMN "ledger_id" SET DEFAULT current_ledger_id();--> statement-breakpoint
ALTER TABLE "service_credentials" ALTER COLUMN "ledger_id" SET DEFAULT current_ledger_id();--> statement-breakpoint
ALTER TABLE "source_documents" ALTER COLUMN "ledger_id" SET DEFAULT current_ledger_id();--> statement-breakpoint
ALTER TABLE "category_assignment_documents" ALTER COLUMN "ledger_id" SET DEFAULT current_ledger_id();--> statement-breakpoint
ALTER TABLE "category_assignment_entries" ALTER COLUMN "ledger_id" SET DEFAULT current_ledger_id();--> statement-breakpoint
ALTER TABLE "category_assignment_jobs" ALTER COLUMN "ledger_id" SET DEFAULT current_ledger_id();--> statement-breakpoint
ALTER TABLE "extraction_attempts" ALTER COLUMN "ledger_id" SET DEFAULT current_ledger_id();--> statement-breakpoint
ALTER TABLE "source_document_files" ALTER COLUMN "ledger_id" SET DEFAULT current_ledger_id();--> statement-breakpoint
ALTER TABLE "stored_files" ALTER COLUMN "ledger_id" SET DEFAULT current_ledger_id();--> statement-breakpoint
-- A record whose processing succeeded without a requested date lost its day to
-- the UTC fallback before this release. Give it its creation day in the
-- ledger's zone again, as 0022 did.
UPDATE "source_documents" SET "document_date" = ("source_documents"."created_at" AT TIME ZONE "ledgers"."time_zone")::date
FROM "ledgers"
WHERE "source_documents"."document_date" IS NULL;
