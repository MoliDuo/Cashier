-- Repairs the credential loss introduced by 0038_source_document_lifecycle.
--
-- 0038 inferred `origin = 'submission'` from live processing evidence: an
-- attempt, an outbox row, a pending-revision pointer, or a non-completed
-- outcome. Revisions backfilled from the retired SQLite database (2026-07-14)
-- carry none of that evidence and still report a completed outcome, so 0038
-- classified them as `manual_edit`. `latest_submission_revision_id` was then
-- only filled from revisions already marked `submission`, which left those
-- documents with a NULL pointer and every submission-backed read empty:
-- original images and text, submission status, and retry / edit-retry.
--
-- Only the submission marker is restored. Active results, ledger entries,
-- stored files, and later manual edits are untouched, and
-- `source_documents.version` is deliberately not bumped so clients that cached
-- a document keep their optimistic state. The change-log triggers on these two
-- tables still publish one change batch per affected ledger, which is what
-- makes clients refetch the repaired documents.
--
-- Safe to re-run: after the repair, no row matches either statement.
WITH legacy_submission AS (
  SELECT revision.id AS revision_id,
         document.document_date AS document_date
  FROM source_documents AS document
  JOIN source_document_revisions AS revision
    ON revision.ledger_id = document.ledger_id
   AND revision.source_document_id = document.id
   AND revision.revision_number = 1
  WHERE document.latest_submission_revision_id IS NULL
    AND revision.origin = 'manual_edit'
    -- A document that already has a submission revision is out of scope: either
    -- 0038 handled it, or a later flow intentionally detached the input.
    AND NOT EXISTS (
      SELECT 1 FROM source_document_revisions AS existing
      WHERE existing.source_document_id = document.id
        AND existing.origin = 'submission'
    )
    -- Require recoverable input, so a document with neither an image nor text
    -- keeps its manual origin and stays detached.
    AND (
      EXISTS (
        SELECT 1 FROM revision_files AS file
        WHERE file.ledger_id = revision.ledger_id
          AND file.revision_id = revision.id
      )
      OR coalesce(revision.input_text, '') <> ''
    )
    -- Splitting and date organization copy a submission's text and files into a
    -- brand-new document. That child has no submission of its own, so it must
    -- stay detached even though its revision 1 carries the parent's content.
    AND NOT EXISTS (
      SELECT 1
      FROM source_document_revisions AS sibling
      WHERE sibling.origin = 'submission'
        AND sibling.source_document_id <> document.id
        AND coalesce(sibling.input_text, '') = coalesce(revision.input_text, '')
        AND NOT EXISTS (
          (
            SELECT file.stored_file_id FROM revision_files AS file
            WHERE file.revision_id = sibling.id
            EXCEPT
            SELECT file.stored_file_id FROM revision_files AS file
            WHERE file.revision_id = revision.id
          )
          UNION ALL
          (
            SELECT file.stored_file_id FROM revision_files AS file
            WHERE file.revision_id = revision.id
            EXCEPT
            SELECT file.stored_file_id FROM revision_files AS file
            WHERE file.revision_id = sibling.id
          )
        )
    )
)
UPDATE source_document_revisions AS revision
SET origin = 'submission',
    processing_status = 'completed',
    failure_kind = NULL,
    failure_code = NULL,
    failure_message = NULL,
    finished_at = coalesce(revision.finished_at, revision.submitted_at, revision.created_at),
    input_document_date = coalesce(
      revision.input_document_date,
      legacy_submission.document_date::text
    )
FROM legacy_submission
WHERE revision.id = legacy_submission.revision_id;--> statement-breakpoint
UPDATE source_documents AS document
SET latest_submission_revision_id = revision.id
FROM source_document_revisions AS revision
WHERE revision.ledger_id = document.ledger_id
  AND revision.source_document_id = document.id
  AND revision.revision_number = 1
  AND revision.origin = 'submission'
  AND document.latest_submission_revision_id IS NULL;
