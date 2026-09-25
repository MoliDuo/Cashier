-- A create request's idempotency key now lives on the document it created and
-- never expires. idempotency_records stays until the code that still reads it
-- during this deploy is gone.
ALTER TABLE "source_documents" ADD COLUMN "idempotency_source" text;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "idempotency_fingerprint" text;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "ck_source_documents_idempotency" CHECK (("source_documents"."idempotency_source" IS NULL) = ("source_documents"."idempotency_key" IS NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "uq_source_documents_idempotency" ON "source_documents" USING btree ("ledger_id","idempotency_source","idempotency_key");--> statement-breakpoint
-- Uploads no longer use sessions or a cleanup queue.
DROP TABLE "object_cleanup_jobs";--> statement-breakpoint
DROP TABLE "upload_session_files";--> statement-breakpoint
DROP TABLE "upload_sessions";--> statement-breakpoint
DROP TYPE "upload_file_status";--> statement-breakpoint
DROP TYPE "upload_session_status";--> statement-breakpoint
DROP TYPE "upload_transport";
