-- Category assignments compare each entry's category; nothing reads the
-- expected versions any more, and the revision is only kept for the release
-- that still writes it.
ALTER TABLE category_reclassification_job_documents DROP COLUMN expected_version;
--> statement-breakpoint
ALTER TABLE category_reclassification_job_entries DROP COLUMN expected_version;
--> statement-breakpoint
ALTER TABLE category_reclassification_job_documents ALTER COLUMN revision_id DROP NOT NULL;
--> statement-breakpoint
-- Lease updates only move the claim columns, so they no longer tell every
-- open client that the ledger changed.
DROP TRIGGER trg_source_document_revisions_change_log ON source_document_revisions;
--> statement-breakpoint
CREATE TRIGGER trg_source_document_revisions_change_log
  AFTER INSERT OR DELETE
  OR UPDATE OF processing_status, failure_kind, failure_code, failure_message, title, finished_at
  ON source_document_revisions
  FOR EACH ROW EXECUTE FUNCTION record_ledger_change('revision');
--> statement-breakpoint
-- A processing attempt becomes its own queue entry. The lease is copied from
-- the outbox here and again, for the attempts made meanwhile, by the release
-- that moves the worker onto these columns.
ALTER TABLE source_document_revisions
  ADD COLUMN claim_token text,
  ADD COLUMN claim_expires_at timestamp with time zone,
  ADD COLUMN attempt_count integer DEFAULT 0 NOT NULL,
  ADD COLUMN next_available_at timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE source_document_revisions AS revision
SET claim_token = outbox.claim_token,
    claim_expires_at = outbox.claim_expires_at,
    attempt_count = outbox.schedule_attempt_count,
    next_available_at = outbox.next_available_at
FROM processing_outbox AS outbox
WHERE outbox.ledger_id = revision.ledger_id
  AND outbox.revision_id = revision.id
  AND revision.processing_status = 'processing';
--> statement-breakpoint
-- An attempt a later submission replaced can no longer finish.
UPDATE source_document_revisions AS revision
SET processing_status = 'cancelled', finished_at = now()
FROM source_documents AS document
WHERE document.ledger_id = revision.ledger_id
  AND document.id = revision.source_document_id
  AND revision.processing_status = 'processing'
  AND document.latest_submission_revision_id IS DISTINCT FROM revision.id;
--> statement-breakpoint
-- Attempts left processing with no live job predate the outbox or lost it;
-- once attempts are their own queue they would run months late. They fail
-- instead, so the reader can retry or fill the record in by hand.
UPDATE source_document_revisions AS revision
SET processing_status = 'failed',
    failure_kind = 'processing_error',
    failure_code = 'processing_timeout',
    finished_at = now()
WHERE revision.processing_status = 'processing'
  AND NOT EXISTS (
    SELECT 1 FROM processing_outbox AS outbox
    WHERE outbox.ledger_id = revision.ledger_id
      AND outbox.revision_id = revision.id
      AND outbox.status IN ('pending', 'claimed')
  );
--> statement-breakpoint
CREATE UNIQUE INDEX uq_source_document_revisions_one_processing
  ON source_document_revisions USING btree (source_document_id)
  WHERE processing_status = 'processing';
--> statement-breakpoint
CREATE INDEX idx_source_document_revisions_recoverable
  ON source_document_revisions USING btree (next_available_at)
  WHERE processing_status = 'processing';
--> statement-breakpoint
-- The current input moves onto the document: its text here, its files in
-- source_document_files. Both come from the current attempt, which is the
-- latest submission or, for a record typed in by hand, the active revision.
CREATE TABLE source_document_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  ledger_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  stored_file_id uuid NOT NULL,
  position integer NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT ck_source_document_files_position CHECK (position >= 0),
  CONSTRAINT fk_source_document_files_document_ledger FOREIGN KEY (ledger_id, source_document_id)
    REFERENCES source_documents (ledger_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_source_document_files_stored_file_ledger FOREIGN KEY (ledger_id, stored_file_id)
    REFERENCES stored_files (ledger_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_source_document_files_document_position
  ON source_document_files USING btree (source_document_id, position);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_source_document_files_document_file
  ON source_document_files USING btree (source_document_id, stored_file_id);
--> statement-breakpoint
CREATE INDEX idx_source_document_files_ledger_file
  ON source_document_files USING btree (ledger_id, stored_file_id);
--> statement-breakpoint
ALTER TABLE source_documents ADD COLUMN input_text text;
--> statement-breakpoint
INSERT INTO source_document_files (ledger_id, source_document_id, stored_file_id, position, created_at)
SELECT file.ledger_id, document.id, file.stored_file_id, file.position, file.created_at
FROM source_documents AS document
JOIN revision_files AS file
  ON file.ledger_id = document.ledger_id
 AND file.revision_id = COALESCE(document.latest_submission_revision_id, document.active_revision_id);
--> statement-breakpoint
UPDATE source_documents AS document
SET input_text = revision.input_text
FROM source_document_revisions AS revision
WHERE revision.ledger_id = document.ledger_id
  AND revision.id = COALESCE(document.latest_submission_revision_id, document.active_revision_id)
  AND revision.input_text IS NOT NULL;
--> statement-breakpoint
-- Entries will belong to the document alone; this replaces the index keyed
-- by revision once the revision column goes.
CREATE INDEX idx_ledger_entries_document_position
  ON ledger_entries USING btree (ledger_id, source_document_id, position, id)
  WHERE deleted_at IS NULL;
