-- Entries and the current input belong to the document, and a processing
-- attempt is its own queue entry, so what linked them to revisions goes.
-- The entry foreign keys cascade from revisions: they are dropped before any
-- revision is deleted, or deleting the manual revisions would delete entries.
ALTER TABLE ledger_entries DROP CONSTRAINT fk_ledger_entries_revision_ledger;
--> statement-breakpoint
ALTER TABLE ledger_entries DROP CONSTRAINT fk_ledger_entries_document_revision;
--> statement-breakpoint
ALTER TABLE ledger_entries DROP COLUMN source_document_revision_id;
--> statement-breakpoint
ALTER TABLE source_documents DROP CONSTRAINT fk_source_documents_active_revision;
--> statement-breakpoint
DROP INDEX idx_source_documents_active_revision;
--> statement-breakpoint
ALTER TABLE source_documents DROP COLUMN active_revision_id;
--> statement-breakpoint
ALTER TABLE category_reclassification_job_documents DROP COLUMN revision_id;
--> statement-breakpoint
DROP TABLE processing_outbox;
--> statement-breakpoint
DROP TYPE processing_outbox_status;
--> statement-breakpoint
DROP TABLE revision_files;
--> statement-breakpoint
ALTER TABLE source_document_revisions DROP COLUMN input_text;
--> statement-breakpoint
-- Revisions without a processing status were written for hand edits, splits
-- and date organization; nothing refers to them any more. None is a latest
-- submission, and the NOT NULL below fails the deploy if one were.
DELETE FROM source_document_revisions AS revision
WHERE revision.processing_status IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM source_documents AS document
    WHERE document.latest_submission_revision_id = revision.id
  );
--> statement-breakpoint
ALTER TABLE source_document_revisions ALTER COLUMN processing_status SET NOT NULL;
