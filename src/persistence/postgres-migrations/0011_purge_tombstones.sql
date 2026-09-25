-- Deletes now remove rows, so the tombstones written before them go. A
-- document takes its entries, revisions and file links with it; the stored
-- files stay for the orphan sweep.
DELETE FROM source_documents WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
DELETE FROM ledger_entries WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
DELETE FROM entry_categories WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
-- Every row left is live. Rebuild the indexes that were limited to live rows
-- over the whole table, so dropping deleted_at later cannot take them along.
DROP INDEX "idx_entry_categories_active_sort";
--> statement-breakpoint
CREATE INDEX "idx_entry_categories_active_sort" ON "entry_categories" USING btree ("ledger_id","sort_order","created_at","id");
--> statement-breakpoint
DROP INDEX "idx_ledger_entries_active_feed";
--> statement-breakpoint
CREATE INDEX "idx_ledger_entries_active_feed" ON "ledger_entries" USING btree ("ledger_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
DROP INDEX "idx_ledger_entries_active_category";
--> statement-breakpoint
CREATE INDEX "idx_ledger_entries_active_category" ON "ledger_entries" USING btree ("ledger_id","category_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
DROP INDEX "idx_ledger_entries_active_currency";
--> statement-breakpoint
CREATE INDEX "idx_ledger_entries_active_currency" ON "ledger_entries" USING btree ("ledger_id","currency","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
DROP INDEX "idx_ledger_entries_document_position";
--> statement-breakpoint
CREATE INDEX "idx_ledger_entries_document_position" ON "ledger_entries" USING btree ("ledger_id","source_document_id","position","id");
--> statement-breakpoint
DROP INDEX "idx_ledger_entries_search";
--> statement-breakpoint
CREATE INDEX "idx_ledger_entries_search" ON "ledger_entries" USING gin (lower("item_name" || ' ' || COALESCE("description", '')) public.gin_trgm_ops);
--> statement-breakpoint
DROP INDEX "idx_source_documents_ledger_book";
--> statement-breakpoint
CREATE INDEX "idx_source_documents_ledger_book" ON "source_documents" USING btree ("ledger_id","book_id");
--> statement-breakpoint
DROP INDEX "idx_source_documents_active_feed";
--> statement-breakpoint
CREATE INDEX "idx_source_documents_active_feed" ON "source_documents" USING btree ("ledger_id","effective_date" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
DROP INDEX "idx_source_documents_ledger_document_date";
--> statement-breakpoint
CREATE INDEX "idx_source_documents_ledger_document_date" ON "source_documents" USING btree ("ledger_id","document_date","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
-- A deferrable constraint is checked when a statement ends rather than row by
-- row, so one UPDATE can swap category names without temporary names.
DROP INDEX "uniq_category_name_per_ledger";
--> statement-breakpoint
ALTER TABLE "entry_categories" ADD CONSTRAINT "uq_entry_categories_ledger_name" UNIQUE("ledger_id","name")
  DEFERRABLE INITIALLY IMMEDIATE;
