-- The contract step for retiring ledger_id. The previous release neither reads
-- nor writes it, so every key built on it becomes a plain single-column key
-- under the same name, and the column goes. The change log keeps one row.
-- A record's day becomes required: every write path already sets it.

-- Every record gets its day before the column turns NOT NULL, and a parse
-- still running from before the last release asks for the day its record
-- already has, so its success keeps that day.
UPDATE "source_documents" SET "document_date" = ("source_documents"."created_at" AT TIME ZONE "ledgers"."time_zone")::date
FROM "ledgers"
WHERE "source_documents"."document_date" IS NULL;--> statement-breakpoint
UPDATE "extraction_attempts" SET "requested_date" = "source_documents"."document_date"
FROM "source_documents"
WHERE "extraction_attempts"."source_document_id" = "source_documents"."id"
  AND "extraction_attempts"."status" = 'processing'
  AND "extraction_attempts"."requested_date" IS NULL;--> statement-breakpoint

-- Keys that name the ledger.
ALTER TABLE "books" DROP CONSTRAINT "fk_books_ledger";--> statement-breakpoint
ALTER TABLE "category_assignment_documents" DROP CONSTRAINT "fk_category_assignment_documents_ledger";--> statement-breakpoint
ALTER TABLE "category_assignment_entries" DROP CONSTRAINT "fk_category_assignment_entries_ledger";--> statement-breakpoint
ALTER TABLE "category_assignment_jobs" DROP CONSTRAINT "fk_category_assignment_jobs_ledger";--> statement-breakpoint
ALTER TABLE "entry_categories" DROP CONSTRAINT "fk_entry_categories_ledger";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "fk_ledger_entries_ledger";--> statement-breakpoint
ALTER TABLE "ledger_sync_state" DROP CONSTRAINT "fk_ledger_sync_state_ledger";--> statement-breakpoint
ALTER TABLE "service_credentials" DROP CONSTRAINT "fk_service_credentials_ledger";--> statement-breakpoint
ALTER TABLE "source_documents" DROP CONSTRAINT "fk_source_documents_ledger";--> statement-breakpoint
ALTER TABLE "stored_files" DROP CONSTRAINT "fk_stored_files_ledger";--> statement-breakpoint

-- Composite keys, rebuilt without the ledger below.
ALTER TABLE "extraction_attempts" DROP CONSTRAINT "fk_extraction_attempts_source_document";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "fk_ledger_entries_category";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "fk_ledger_entries_source_document";--> statement-breakpoint
ALTER TABLE "service_credentials" DROP CONSTRAINT "fk_service_credentials_book";--> statement-breakpoint
ALTER TABLE "source_document_files" DROP CONSTRAINT "fk_source_document_files_source_document";--> statement-breakpoint
ALTER TABLE "source_document_files" DROP CONSTRAINT "fk_source_document_files_stored_file";--> statement-breakpoint
ALTER TABLE "source_documents" DROP CONSTRAINT "fk_source_documents_book";--> statement-breakpoint
ALTER TABLE "source_documents" DROP CONSTRAINT "fk_source_documents_latest_attempt";--> statement-breakpoint
ALTER TABLE "entry_categories" DROP CONSTRAINT "uq_entry_categories_ledger_name";--> statement-breakpoint

-- Indexes that lead with the ledger, and the targets of the composite keys.
DROP INDEX "idx_books_active_sort";--> statement-breakpoint
DROP INDEX "uq_books_active_name";--> statement-breakpoint
DROP INDEX "uq_books_ledger_id_id";--> statement-breakpoint
DROP INDEX "idx_category_assignment_documents_ledger_job";--> statement-breakpoint
DROP INDEX "idx_category_assignment_entries_ledger_job";--> statement-breakpoint
DROP INDEX "uq_category_assignment_jobs_active";--> statement-breakpoint
DROP INDEX "uq_category_assignment_jobs_request_key";--> statement-breakpoint
DROP INDEX "idx_entry_categories_sort";--> statement-breakpoint
DROP INDEX "uq_entry_categories_ledger_id_id";--> statement-breakpoint
DROP INDEX "idx_extraction_attempts_due";--> statement-breakpoint
DROP INDEX "uq_extraction_attempts_ledger_document_id";--> statement-breakpoint
DROP INDEX "idx_ledger_entries_category";--> statement-breakpoint
DROP INDEX "idx_ledger_entries_document_position";--> statement-breakpoint
DROP INDEX "idx_service_credentials_ledger_book";--> statement-breakpoint
DROP INDEX "idx_source_document_files_ledger_file";--> statement-breakpoint
DROP INDEX "idx_source_documents_book_feed";--> statement-breakpoint
DROP INDEX "idx_source_documents_feed";--> statement-breakpoint
DROP INDEX "uq_source_documents_idempotency";--> statement-breakpoint
DROP INDEX "uq_source_documents_ledger_id_id";--> statement-breakpoint
DROP INDEX "uq_stored_files_ledger_id_id";--> statement-breakpoint

ALTER TABLE "books" DROP COLUMN "ledger_id";--> statement-breakpoint
ALTER TABLE "category_assignment_documents" DROP COLUMN "ledger_id";--> statement-breakpoint
ALTER TABLE "category_assignment_entries" DROP COLUMN "ledger_id";--> statement-breakpoint
ALTER TABLE "category_assignment_jobs" DROP COLUMN "ledger_id";--> statement-breakpoint
ALTER TABLE "entry_categories" DROP COLUMN "ledger_id";--> statement-breakpoint
ALTER TABLE "extraction_attempts" DROP COLUMN "ledger_id";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP COLUMN "ledger_id";--> statement-breakpoint
ALTER TABLE "service_credentials" DROP COLUMN "ledger_id";--> statement-breakpoint
ALTER TABLE "source_document_files" DROP COLUMN "ledger_id";--> statement-breakpoint
ALTER TABLE "source_documents" DROP COLUMN "ledger_id";--> statement-breakpoint
ALTER TABLE "stored_files" DROP COLUMN "ledger_id";--> statement-breakpoint
DROP FUNCTION current_ledger_id();--> statement-breakpoint

-- The change log keeps a single row: a second one cannot exist.
ALTER TABLE "ledger_sync_state" DROP CONSTRAINT "ledger_sync_state_pkey";--> statement-breakpoint
ALTER TABLE "ledger_sync_state" DROP COLUMN "ledger_id";--> statement-breakpoint
ALTER TABLE "ledger_sync_state" ADD COLUMN "id" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_sync_state" ADD CONSTRAINT "ledger_sync_state_pkey" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "ledger_sync_state" ADD CONSTRAINT "ck_ledger_sync_state_singleton" CHECK ("id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION record_ledger_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  change_kind text := TG_ARGV[0];
  currency_changed boolean := false;
BEGIN
  IF change_kind = 'settings' THEN
    currency_changed := NEW.main_currency IS DISTINCT FROM OLD.main_currency;
  END IF;

  LOOP
    -- A transaction's later changes reuse its version; updating this one row
    -- serializes concurrent writers.
    UPDATE ledger_sync_state SET
      version = CASE WHEN transaction_id = txid_current() THEN version ELSE version + 1 END,
      transaction_id = txid_current(),
      categories_version = CASE WHEN change_kind = 'category' OR currency_changed
        THEN CASE WHEN transaction_id = txid_current() THEN version ELSE version + 1 END
        ELSE categories_version END,
      settings_version = CASE WHEN change_kind = 'settings'
        THEN CASE WHEN transaction_id = txid_current() THEN version ELSE version + 1 END
        ELSE settings_version END,
      stats_version = CASE WHEN change_kind IN ('document', 'entry', 'category', 'settings')
        THEN CASE WHEN transaction_id = txid_current() THEN version ELSE version + 1 END
        ELSE stats_version END,
      updated_at = now();
    EXIT WHEN FOUND;
    INSERT INTO ledger_sync_state DEFAULT VALUES ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NULL;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION record_exchange_rate_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM changed_rates) THEN
    RETURN NULL;
  END IF;
  INSERT INTO ledger_sync_state DEFAULT VALUES ON CONFLICT DO NOTHING;
  UPDATE ledger_sync_state SET
    version = version + CASE WHEN transaction_id = txid_current() THEN 0 ELSE 1 END,
    stats_version = version + CASE WHEN transaction_id = txid_current() THEN 0 ELSE 1 END,
    transaction_id = txid_current(),
    updated_at = now();
  RETURN NULL;
END $$;--> statement-breakpoint

-- The same keys and indexes, without the ledger.
ALTER TABLE "entry_categories" ADD CONSTRAINT "uq_entry_categories_name" UNIQUE ("name") DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_extraction_attempts_document_id" ON "extraction_attempts" USING btree ("source_document_id", "id");--> statement-breakpoint
ALTER TABLE "extraction_attempts" ADD CONSTRAINT "fk_extraction_attempts_source_document" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "fk_ledger_entries_category" FOREIGN KEY ("category_id") REFERENCES "entry_categories"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "fk_ledger_entries_source_document" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "service_credentials" ADD CONSTRAINT "fk_service_credentials_book" FOREIGN KEY ("book_id") REFERENCES "books"("id");--> statement-breakpoint
ALTER TABLE "source_document_files" ADD CONSTRAINT "fk_source_document_files_source_document" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "source_document_files" ADD CONSTRAINT "fk_source_document_files_stored_file" FOREIGN KEY ("stored_file_id") REFERENCES "stored_files"("id");--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "fk_source_documents_book" FOREIGN KEY ("book_id") REFERENCES "books"("id");--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "fk_source_documents_latest_attempt" FOREIGN KEY ("id", "latest_attempt_id") REFERENCES "extraction_attempts"("source_document_id", "id");--> statement-breakpoint
CREATE INDEX "idx_books_active_sort" ON "books" USING btree ("sort_order", "created_at", "id") WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_books_active_name" ON "books" USING btree ("name") WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_category_assignment_jobs_active" ON "category_assignment_jobs" USING btree ((true)) WHERE "status" IN ('pending', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_category_assignment_jobs_request_key" ON "category_assignment_jobs" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "idx_entry_categories_sort" ON "entry_categories" USING btree ("sort_order", "created_at", "id");--> statement-breakpoint
CREATE INDEX "idx_extraction_attempts_due" ON "extraction_attempts" USING btree ("next_attempt_at") WHERE "status" = 'processing';--> statement-breakpoint
CREATE INDEX "idx_ledger_entries_category" ON "ledger_entries" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_ledger_entries_document_position" ON "ledger_entries" USING btree ("source_document_id", "position", "id");--> statement-breakpoint
CREATE INDEX "idx_service_credentials_book" ON "service_credentials" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "idx_source_document_files_stored_file" ON "source_document_files" USING btree ("stored_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_source_documents_idempotency" ON "source_documents" USING btree ("idempotency_source", "idempotency_key");--> statement-breakpoint

-- A record's day is required, and the feeds read it directly. effective_date
-- stays until the next release, since the previous one still reads it.
ALTER TABLE "source_documents" ALTER COLUMN "document_date" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_source_documents_feed" ON "source_documents" USING btree ("document_date" DESC, "created_at" DESC, "id" DESC);--> statement-breakpoint
CREATE INDEX "idx_source_documents_book_feed" ON "source_documents" USING btree ("book_id", "document_date" DESC, "created_at" DESC, "id" DESC);
