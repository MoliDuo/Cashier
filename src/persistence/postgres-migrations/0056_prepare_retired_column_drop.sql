-- First half of retiring columns nothing reads any more. Vercel migrates before
-- it builds, so the previous release keeps serving against this schema until the
-- new build is live, and indefinitely if that build fails. Everything here is
-- therefore safe for both releases: columns the new code stops writing get
-- defaults or lose NOT NULL, and the rows the new code no longer filters out are
-- removed. The columns themselves are dropped by the next migration.
ALTER TABLE processing_outbox ALTER COLUMN attempt_number SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE processing_outbox ALTER COLUMN available_at SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE stored_files ALTER COLUMN storage_provider SET DEFAULT 's3';
--> statement-breakpoint
ALTER TABLE ledgers ALTER COLUMN user_id DROP NOT NULL;
--> statement-breakpoint
-- 0048 folded the second account into the first and left soft-deleted rows
-- behind. It already refused to run while any record sat outside the live
-- ledger, so a soft-deleted ledger holds at most configuration and stray
-- uploads. Refuse anything more than that rather than cascade it away.
CREATE TEMP TABLE retired_ledgers ON COMMIT DROP AS
SELECT id FROM ledgers WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
DO $$
DECLARE
  document_count bigint;
  ledger_count bigint;
  file_count bigint;
  user_count bigint;
BEGIN
  SELECT count(*) INTO ledger_count FROM retired_ledgers;
  SELECT count(*) INTO document_count
    FROM source_documents WHERE ledger_id IN (SELECT id FROM retired_ledgers);
  IF document_count > 0 THEN
    RAISE EXCEPTION
      '0056 found % source document(s) in soft-deleted ledgers', document_count
      USING HINT = 'Move or delete those records before retrying; nothing was changed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ledgers l JOIN users u ON u.id = l.user_id
     WHERE l.deleted_at IS NULL AND u.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '0056 found a live ledger owned by a soft-deleted account'
      USING HINT = 'Restore the account or reassign the ledger before retrying.';
  END IF;
  SELECT count(*) INTO file_count
    FROM stored_files WHERE ledger_id IN (SELECT id FROM retired_ledgers);
  SELECT count(*) INTO user_count FROM users WHERE deleted_at IS NOT NULL;
  RAISE NOTICE
    'Removing % soft-deleted ledger(s) with % stray file(s) and % soft-deleted account(s)',
    ledger_count, file_count, user_count;
END $$;
--> statement-breakpoint
-- Stray uploads keep their objects until the cleanup queue removes them.
UPDATE object_cleanup_jobs SET upload_session_id = NULL
WHERE upload_session_id IN (
  SELECT id FROM upload_sessions WHERE ledger_id IN (SELECT id FROM retired_ledgers)
);
--> statement-breakpoint
INSERT INTO object_cleanup_jobs (storage_key, next_attempt_at, created_at)
SELECT storage_key, now(), now()
FROM stored_files
WHERE ledger_id IN (SELECT id FROM retired_ledgers)
UNION
SELECT 'temporary/' || session.ledger_id || '/' || session.id || '/' || target.target_id,
  now(), now()
FROM upload_sessions session
JOIN upload_session_files target ON target.upload_session_id = session.id
WHERE session.ledger_id IN (SELECT id FROM retired_ledgers)
ON CONFLICT (storage_key) DO NOTHING;
--> statement-breakpoint
DELETE FROM revision_files WHERE ledger_id IN (SELECT id FROM retired_ledgers);
--> statement-breakpoint
DELETE FROM upload_session_files WHERE ledger_id IN (SELECT id FROM retired_ledgers);
--> statement-breakpoint
DELETE FROM ledgers WHERE id IN (SELECT id FROM retired_ledgers);
--> statement-breakpoint
DELETE FROM users WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
-- Failure codes written before the stable set existed. Invalid-input rows keep
-- their parser diagnostics; only processing failures are shown by code.
UPDATE source_document_revisions
SET failure_code = CASE failure_code
  WHEN 'INTERNAL' THEN 'ai_schema_invalid'
  WHEN 'VALIDATION_FAILED' THEN 'ai_schema_invalid'
  WHEN 'RATE_LIMITED' THEN 'ai_provider_unavailable'
  WHEN 'STORAGE_UNAVAILABLE' THEN 'storage_failure'
  ELSE 'processing_unavailable'
END
WHERE failure_kind IS DISTINCT FROM 'invalid_input'
  AND failure_code IS NOT NULL
  AND failure_code NOT IN (
    'ai_provider_unavailable',
    'ai_schema_invalid',
    'exchange_rate_failure',
    'storage_failure',
    'processing_unavailable',
    'request_bound_retry_exhausted',
    'processing_timeout'
  );
