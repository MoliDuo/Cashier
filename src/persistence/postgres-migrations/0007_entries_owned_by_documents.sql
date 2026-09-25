-- The worker now claims processing attempts directly. Attempts the previous
-- release made through the outbox since 0006 carry their lease and count over.
UPDATE source_document_revisions AS revision
SET claim_token = outbox.claim_token,
    claim_expires_at = outbox.claim_expires_at,
    attempt_count = GREATEST(revision.attempt_count, outbox.schedule_attempt_count),
    next_available_at = outbox.next_available_at
FROM processing_outbox AS outbox
WHERE outbox.ledger_id = revision.ledger_id
  AND outbox.revision_id = revision.id
  AND outbox.status IN ('pending', 'claimed')
  AND revision.processing_status = 'processing';
--> statement-breakpoint
-- Documents the release before 0006 wrote during its deploy window have no
-- document input yet; they take it from their current attempt like 0006 did.
INSERT INTO source_document_files (ledger_id, source_document_id, stored_file_id, position, created_at)
SELECT file.ledger_id, document.id, file.stored_file_id, file.position, file.created_at
FROM source_documents AS document
JOIN revision_files AS file
  ON file.ledger_id = document.ledger_id
 AND file.revision_id = COALESCE(document.latest_submission_revision_id, document.active_revision_id)
WHERE NOT EXISTS (
  SELECT 1 FROM source_document_files AS listed
  WHERE listed.ledger_id = document.ledger_id AND listed.source_document_id = document.id
);
--> statement-breakpoint
UPDATE source_documents AS document
SET input_text = revision.input_text
FROM source_document_revisions AS revision
WHERE revision.ledger_id = document.ledger_id
  AND revision.id = COALESCE(document.latest_submission_revision_id, document.active_revision_id)
  AND revision.input_text IS NOT NULL
  AND document.input_text IS NULL;
--> statement-breakpoint
-- Entries now belong to their document alone. A live entry on a revision other
-- than the active one was never shown, since every read joined through the
-- active revision; left live it would appear. They are soft-deleted instead.
UPDATE ledger_entries AS entry
SET deleted_at = now(), updated_at = now()
FROM source_documents AS document
WHERE document.ledger_id = entry.ledger_id
  AND document.id = entry.source_document_id
  AND entry.deleted_at IS NULL
  AND entry.source_document_revision_id IS DISTINCT FROM document.active_revision_id;
--> statement-breakpoint
DROP INDEX uq_ledger_entries_revision_position;
--> statement-breakpoint
DROP INDEX idx_ledger_entries_active_source;
