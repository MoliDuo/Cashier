-- Only obsolete session metadata is retired. Durable stored files and their
-- document references are preserved; temporary objects use the cleanup queue.
CREATE TEMP TABLE retired_upload_sessions ON COMMIT DROP AS
SELECT DISTINCT session.id, session.ledger_id, session.created_at, session.expires_at
FROM upload_sessions session
JOIN upload_session_files target ON target.upload_session_id = session.id
WHERE target.expected_content_type IS NULL OR target.expected_byte_size IS NULL;
--> statement-breakpoint
DO $$
DECLARE target_count bigint;
BEGIN
  SELECT count(*) INTO target_count FROM retired_upload_sessions;
  IF EXISTS (SELECT 1 FROM retired_upload_sessions
    WHERE created_at > now() - interval '1 day' OR expires_at > now()) THEN
    RAISE EXCEPTION 'Legacy upload sessions are still within their compatibility window; drain old app instances and wait until sessions expire and are at least one day old before retrying migration 0054';
  END IF;
  RAISE NOTICE 'Retiring % expired legacy upload sessions; durable files are preserved', target_count;
END $$;
--> statement-breakpoint
INSERT INTO object_cleanup_jobs (storage_key, next_attempt_at, created_at)
SELECT 'temporary/' || session.ledger_id || '/' || session.id || '/' || target.target_id,
  now(), now()
FROM retired_upload_sessions session
JOIN upload_session_files target ON target.upload_session_id = session.id
ON CONFLICT (storage_key) DO UPDATE SET upload_session_id = NULL;
--> statement-breakpoint
DELETE FROM upload_sessions WHERE id IN (SELECT id FROM retired_upload_sessions);
--> statement-breakpoint
ALTER TABLE upload_session_files
  ALTER COLUMN expected_content_type SET NOT NULL,
  ALTER COLUMN expected_byte_size SET NOT NULL;
