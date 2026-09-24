-- Retire only V1 results already outside the existing seven-day retention window.
-- Stop deployment if a still-visible or active legacy job needs attention.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM category_reclassification_jobs WHERE format_version = 1
    AND (status NOT IN ('succeeded', 'failed', 'cancelled') OR updated_at >= now() - interval '7 days')) THEN
    RAISE EXCEPTION 'V1 category jobs remain within retention; wait for expiry before migrating';
  END IF;
END $$;
--> statement-breakpoint
DELETE FROM category_reclassification_jobs WHERE format_version = 1;
--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs" DROP CONSTRAINT "ck_category_reclassification_jobs_cursor";--> statement-breakpoint
DROP INDEX "idx_category_reclassification_jobs_due";--> statement-breakpoint
DROP INDEX "uq_ledger_entries_revision_position";--> statement-breakpoint
ALTER TABLE "processing_outbox" ADD COLUMN "retry_classification" "retry_classification";--> statement-breakpoint
ALTER TABLE "processing_outbox" ADD COLUMN "diagnostic_code" text;--> statement-breakpoint
ALTER TABLE "processing_outbox" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "processing_outbox" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
-- Preserve diagnostics and existing leases. Orphan active attempts require explicit repair.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM processing_attempts a LEFT JOIN processing_outbox o
    ON o.ledger_id = a.ledger_id AND o.revision_id = a.revision_id AND o.attempt_number = a.attempt_number
    WHERE o.id IS NULL AND a.status IN ('queued', 'processing')) THEN
    RAISE EXCEPTION 'Active processing attempts without durable jobs require repair';
  END IF;
END $$;
--> statement-breakpoint
UPDATE processing_outbox o SET retry_classification = a.retry_classification,
  diagnostic_code = a.diagnostic_code, correlation_id = a.correlation_id,
  started_at = a.started_at, completed_at = coalesce(o.completed_at, a.completed_at)
FROM processing_attempts a WHERE o.ledger_id = a.ledger_id
  AND o.revision_id = a.revision_id AND o.attempt_number = a.attempt_number;
--> statement-breakpoint
INSERT INTO processing_outbox (ledger_id, revision_id, source_document_id, attempt_number,
  status, requested_at, available_at, next_available_at, created_at, completed_at,
  started_at, retry_classification, diagnostic_code, correlation_id)
SELECT a.ledger_id, a.revision_id, r.source_document_id, a.attempt_number,
  (CASE WHEN a.status = 'completed' THEN 'completed' WHEN a.status = 'cancelled' THEN 'cancelled'
    ELSE 'failed' END)::processing_outbox_status,
  a.created_at, a.created_at, a.created_at, a.created_at, a.completed_at,
  a.started_at, a.retry_classification, a.diagnostic_code, a.correlation_id
FROM processing_attempts a JOIN source_document_revisions r
  ON r.id = a.revision_id AND r.ledger_id = a.ledger_id
WHERE NOT EXISTS (SELECT 1 FROM processing_outbox o WHERE o.ledger_id = a.ledger_id
  AND o.revision_id = a.revision_id AND o.attempt_number = a.attempt_number);
--> statement-breakpoint
DROP TABLE processing_attempts;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ledger_entries_revision_position" ON "ledger_entries" USING btree ("source_document_revision_id","position") WHERE "ledger_entries"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs" DROP COLUMN "format_version";--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs" DROP COLUMN "ledger_entry_ids";--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs" DROP COLUMN "cursor";--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs" DROP COLUMN "attempts";--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs" DROP COLUMN "claim_token";--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs" DROP COLUMN "claim_expires_at";--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs" DROP COLUMN "next_attempt_at";--> statement-breakpoint
DROP TYPE "processing_attempt_status";
