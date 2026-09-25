-- Deletes remove rows and no code names these columns any more; every row
-- here has deleted_at NULL. Service credentials keep theirs as the revoked mark.
ALTER TABLE "entry_categories" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "source_documents" DROP COLUMN "deleted_at";--> statement-breakpoint
ALTER TABLE "stored_files" DROP COLUMN "deleted_at";
