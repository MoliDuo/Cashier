-- Idempotency keys moved onto source_documents; nothing reads the old table.
-- The soft-delete columns stay until the code that no longer names them is
-- deployed, and go in the next migration.
DROP TABLE "idempotency_records";--> statement-breakpoint
DROP TYPE "idempotency_status";
