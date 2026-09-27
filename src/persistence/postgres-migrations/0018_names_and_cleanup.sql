-- One release renames what the refactors left misnamed, drops what nothing
-- reads, and tightens columns, instead of the usual expand/contract steps.
-- The build now runs before this migration and every migration runs in one
-- transaction, so the old release meets the new names only for the seconds
-- this takes, and a failure leaves the database untouched.

-- Indexes no query uses. Entries are never ordered by their own created_at,
-- documents are filtered by effective_date rather than document_date, and the
-- rest are prefixes of other indexes or served only the dropped upload quota.
DROP INDEX idx_ledger_entries_active_feed;
--> statement-breakpoint
DROP INDEX idx_ledger_entries_active_category;
--> statement-breakpoint
DROP INDEX idx_ledger_entries_active_currency;
--> statement-breakpoint
DROP INDEX uq_ledger_entries_ledger_id_id;
--> statement-breakpoint
DROP INDEX idx_source_documents_ledger_document_date;
--> statement-breakpoint
DROP INDEX idx_source_documents_ledger_book;
--> statement-breakpoint
DROP INDEX idx_source_document_revisions_document_created;
--> statement-breakpoint
DROP INDEX idx_source_document_revisions_ledger_processing_status;
--> statement-breakpoint
DROP INDEX idx_source_document_revisions_recoverable;
--> statement-breakpoint
DROP INDEX uq_source_document_revisions_ledger_id_id;
--> statement-breakpoint
DROP INDEX idx_service_credentials_ledger_id;
--> statement-breakpoint
DROP INDEX idx_category_assignment_documents_due;
--> statement-breakpoint
DROP INDEX uq_category_reclassification_jobs_active;
--> statement-breakpoint
DROP INDEX idx_stored_files_ledger_created;
--> statement-breakpoint
-- Codes are salted per token, so their hashes never collide; lookups go by email.
ALTER TABLE otp_tokens DROP CONSTRAINT otp_tokens_token_hash_unique;
--> statement-breakpoint

-- The title lives on the document. A document whose own title is empty takes
-- the title of its newest completed extraction, which is what readers showed.
UPDATE source_documents AS document
SET title = latest.title
FROM (
  SELECT DISTINCT ON (source_document_id) ledger_id, source_document_id, btrim(title) AS title
  FROM source_document_revisions
  WHERE processing_status = 'completed' AND btrim(coalesce(title, '')) <> ''
  ORDER BY source_document_id, submitted_at DESC
) AS latest
WHERE document.ledger_id = latest.ledger_id
  AND document.id = latest.source_document_id
  AND btrim(coalesce(document.title, '')) = '';
--> statement-breakpoint

-- Extraction attempts: "revision" named a manual edit history that no longer
-- exists; each row is one extraction and its own queue entry.
DROP TRIGGER trg_source_document_revisions_change_log ON source_document_revisions;
--> statement-breakpoint
ALTER TABLE source_document_revisions RENAME TO extraction_attempts;
--> statement-breakpoint
ALTER TYPE revision_processing_status RENAME TO extraction_attempt_status;
--> statement-breakpoint
ALTER TYPE revision_failure_kind RENAME TO extraction_failure_kind;
--> statement-breakpoint
ALTER TABLE extraction_attempts RENAME COLUMN processing_status TO status;
--> statement-breakpoint
ALTER TABLE extraction_attempts RENAME COLUMN input_date_reference TO reference_date;
--> statement-breakpoint
ALTER TABLE extraction_attempts RENAME COLUMN next_available_at TO next_attempt_at;
--> statement-breakpoint
ALTER TABLE extraction_attempts
  ALTER COLUMN input_document_date TYPE date USING input_document_date::date,
  ALTER COLUMN claim_token TYPE uuid USING claim_token::uuid,
  DROP COLUMN title,
  DROP COLUMN created_at;
--> statement-breakpoint
ALTER TABLE extraction_attempts RENAME COLUMN input_document_date TO requested_date;
--> statement-breakpoint
ALTER TABLE extraction_attempts ALTER COLUMN submitted_at SET DEFAULT now();
--> statement-breakpoint
ALTER INDEX source_document_revisions_pkey RENAME TO extraction_attempts_pkey;
--> statement-breakpoint
ALTER INDEX uq_source_document_revisions_ledger_document_id RENAME TO uq_extraction_attempts_ledger_document_id;
--> statement-breakpoint
ALTER INDEX uq_source_document_revisions_one_processing RENAME TO uq_extraction_attempts_one_processing;
--> statement-breakpoint
ALTER TABLE extraction_attempts RENAME CONSTRAINT fk_revisions_source_document_ledger TO fk_extraction_attempts_source_document;
--> statement-breakpoint
-- Recovery looks for a ledger's due attempts; the same index answers whether
-- a ledger has anything processing.
CREATE INDEX idx_extraction_attempts_due ON extraction_attempts (ledger_id, next_attempt_at)
  WHERE status = 'processing';
--> statement-breakpoint
-- Lease renewals only move the claim columns, so they tell no client anything.
CREATE TRIGGER trg_extraction_attempts_change_log
  AFTER INSERT OR DELETE
  OR UPDATE OF status, failure_kind, failure_code, failure_message, finished_at
  ON extraction_attempts
  FOR EACH ROW EXECUTE FUNCTION record_ledger_change('attempt');
--> statement-breakpoint

-- Source documents.
ALTER TABLE source_documents RENAME COLUMN latest_submission_revision_id TO latest_attempt_id;
--> statement-breakpoint
ALTER INDEX idx_source_documents_active_feed RENAME TO idx_source_documents_feed;
--> statement-breakpoint
ALTER INDEX idx_source_documents_latest_submission_revision RENAME TO idx_source_documents_latest_attempt;
--> statement-breakpoint
ALTER TABLE source_documents RENAME CONSTRAINT fk_source_documents_latest_submission_revision TO fk_source_documents_latest_attempt;
--> statement-breakpoint
ALTER TABLE source_documents RENAME CONSTRAINT fk_source_documents_book_ledger TO fk_source_documents_book;
--> statement-breakpoint
ALTER TABLE source_documents RENAME CONSTRAINT source_documents_ledger_id_ledgers_id_fk TO fk_source_documents_ledger;
--> statement-breakpoint
ALTER TABLE source_documents RENAME CONSTRAINT source_documents_version_check TO ck_source_documents_version;
--> statement-breakpoint
-- A book's feed and stats filter by book and read in feed order.
CREATE INDEX idx_source_documents_book_feed
  ON source_documents (ledger_id, book_id, effective_date DESC, created_at DESC, id DESC);
--> statement-breakpoint
ALTER TABLE source_document_files RENAME CONSTRAINT fk_source_document_files_document_ledger TO fk_source_document_files_source_document;
--> statement-breakpoint
ALTER TABLE source_document_files RENAME CONSTRAINT fk_source_document_files_stored_file_ledger TO fk_source_document_files_stored_file;
--> statement-breakpoint

-- Entries always belong to a document.
ALTER TABLE ledger_entries ALTER COLUMN source_document_id SET NOT NULL;
--> statement-breakpoint
ALTER INDEX idx_ledger_entries_category_all RENAME TO idx_ledger_entries_category;
--> statement-breakpoint
ALTER TABLE ledger_entries RENAME CONSTRAINT fk_ledger_entries_category_ledger TO fk_ledger_entries_category;
--> statement-breakpoint
ALTER TABLE ledger_entries RENAME CONSTRAINT fk_ledger_entries_document_ledger TO fk_ledger_entries_source_document;
--> statement-breakpoint
ALTER TABLE ledger_entries RENAME CONSTRAINT ledger_entries_ledger_id_ledgers_id_fk TO fk_ledger_entries_ledger;
--> statement-breakpoint
ALTER INDEX idx_entry_categories_active_sort RENAME TO idx_entry_categories_sort;
--> statement-breakpoint
ALTER TABLE entry_categories RENAME CONSTRAINT entry_categories_ledger_id_ledgers_id_fk TO fk_entry_categories_ledger;
--> statement-breakpoint
ALTER INDEX uniq_books_active_name RENAME TO uq_books_active_name;
--> statement-breakpoint
ALTER TABLE books RENAME CONSTRAINT books_ledger_id_ledgers_id_fk TO fk_books_ledger;
--> statement-breakpoint

-- Category assignment: one name for the feature instead of two.
ALTER TABLE category_reclassification_jobs RENAME TO category_assignment_jobs;
--> statement-breakpoint
ALTER TABLE category_reclassification_job_documents RENAME TO category_assignment_documents;
--> statement-breakpoint
ALTER TABLE category_reclassification_job_entries RENAME TO category_assignment_entries;
--> statement-breakpoint
-- Nothing has written these states since jobs took their lease.
UPDATE category_assignment_jobs
SET status = 'cancelled', completed_at = coalesce(completed_at, now()), updated_at = now()
WHERE status = 'preparing';
--> statement-breakpoint
UPDATE category_assignment_documents SET status = 'pending', updated_at = now()
WHERE status = 'running';
--> statement-breakpoint
ALTER TYPE category_reclassification_status RENAME TO category_reclassification_status_retired;
--> statement-breakpoint
CREATE TYPE category_assignment_job_status AS ENUM (
  'pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled'
);
--> statement-breakpoint
ALTER TABLE category_assignment_jobs
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE category_assignment_job_status
    USING status::text::category_assignment_job_status,
  ALTER COLUMN status SET DEFAULT 'pending';
--> statement-breakpoint
DROP TYPE category_reclassification_status_retired;
--> statement-breakpoint
ALTER TYPE category_assignment_document_status RENAME TO category_assignment_document_status_retired;
--> statement-breakpoint
CREATE TYPE category_assignment_document_status AS ENUM (
  'pending', 'succeeded', 'failed', 'conflict', 'skipped', 'cancelled'
);
--> statement-breakpoint
ALTER TABLE category_assignment_documents
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE category_assignment_document_status
    USING status::text::category_assignment_document_status,
  ALTER COLUMN status SET DEFAULT 'pending';
--> statement-breakpoint
DROP TYPE category_assignment_document_status_retired;
--> statement-breakpoint
-- The candidate ids are the ids in the candidate snapshot; nothing writes the
-- job-level error.
ALTER TABLE category_assignment_jobs
  DROP COLUMN candidate_category_ids,
  DROP COLUMN last_error,
  ADD CONSTRAINT ck_category_assignment_jobs_mode CHECK (mode IN ('ai', 'assign', 'clear'));
--> statement-breakpoint
ALTER TABLE category_assignment_jobs RENAME COLUMN direct_category_id TO assign_category_id;
--> statement-breakpoint
ALTER TABLE category_assignment_jobs RENAME COLUMN parent_job_id TO retry_of_job_id;
--> statement-breakpoint
ALTER INDEX category_reclassification_jobs_pkey RENAME TO category_assignment_jobs_pkey;
--> statement-breakpoint
ALTER INDEX uq_category_assignment_request_key RENAME TO uq_category_assignment_jobs_request_key;
--> statement-breakpoint
-- One run per ledger at a time.
CREATE UNIQUE INDEX uq_category_assignment_jobs_active ON category_assignment_jobs (ledger_id)
  WHERE status IN ('pending', 'running');
--> statement-breakpoint
ALTER TABLE category_assignment_jobs RENAME CONSTRAINT category_reclassification_jobs_ledger_id_ledgers_id_fk TO fk_category_assignment_jobs_ledger;
--> statement-breakpoint
ALTER TABLE category_assignment_jobs RENAME CONSTRAINT category_reclassification_jobs_parent_job_id_fk TO fk_category_assignment_jobs_retry_of_job;
--> statement-breakpoint
ALTER TABLE category_assignment_documents RENAME COLUMN attempts TO attempt_count;
--> statement-breakpoint
ALTER TABLE category_assignment_documents RENAME COLUMN first_selection_order TO selection_order;
--> statement-breakpoint
ALTER TABLE category_assignment_documents ALTER COLUMN next_attempt_at SET DEFAULT now();
--> statement-breakpoint
ALTER INDEX category_reclassification_job_documents_pkey RENAME TO category_assignment_documents_pkey;
--> statement-breakpoint
ALTER TABLE category_assignment_documents RENAME CONSTRAINT category_reclassification_job_documents_job_id_fkey TO fk_category_assignment_documents_job;
--> statement-breakpoint
ALTER TABLE category_assignment_documents RENAME CONSTRAINT category_reclassification_job_documents_ledger_id_fkey TO fk_category_assignment_documents_ledger;
--> statement-breakpoint
ALTER TABLE category_assignment_documents RENAME CONSTRAINT category_reclassification_job_documents_source_document_id_fkey TO fk_category_assignment_documents_source_document;
--> statement-breakpoint
-- Deleting a document cascades into its assignment work.
CREATE INDEX idx_category_assignment_documents_source_document
  ON category_assignment_documents (source_document_id);
--> statement-breakpoint
ALTER INDEX category_reclassification_job_entries_pkey RENAME TO category_assignment_entries_pkey;
--> statement-breakpoint
ALTER INDEX uq_category_assignment_entry_order RENAME TO uq_category_assignment_entries_selection_order;
--> statement-breakpoint
ALTER TABLE category_assignment_entries RENAME CONSTRAINT category_reclassification_job_entries_job_id_fkey TO fk_category_assignment_entries_job;
--> statement-breakpoint
ALTER TABLE category_assignment_entries RENAME CONSTRAINT category_reclassification_job_entries_ledger_id_fkey TO fk_category_assignment_entries_ledger;
--> statement-breakpoint
ALTER TABLE category_assignment_entries RENAME CONSTRAINT fk_category_assignment_entry_document TO fk_category_assignment_entries_document;
--> statement-breakpoint

-- Sign-in: both one-time-code tables are challenges, like the WebAuthn one.
ALTER TABLE otp_tokens RENAME TO sign_in_challenges;
--> statement-breakpoint
ALTER TABLE sign_in_challenges RENAME COLUMN token_hash TO code_hash;
--> statement-breakpoint
ALTER TABLE sign_in_challenges RENAME COLUMN expires TO expires_at;
--> statement-breakpoint
ALTER INDEX otp_tokens_pkey RENAME TO sign_in_challenges_pkey;
--> statement-breakpoint
ALTER INDEX uniq_otp_tokens_email RENAME TO uq_sign_in_challenges_email;
--> statement-breakpoint
ALTER INDEX idx_otp_tokens_expires RENAME TO idx_sign_in_challenges_expires_at;
--> statement-breakpoint
-- It verifies an address being added to the account; nothing is changed.
ALTER TABLE email_change_challenges RENAME TO login_email_challenges;
--> statement-breakpoint
ALTER TABLE login_email_challenges RENAME COLUMN new_email TO email;
--> statement-breakpoint
ALTER TABLE login_email_challenges RENAME COLUMN token_hash TO code_hash;
--> statement-breakpoint
ALTER INDEX email_change_challenges_pkey RENAME TO login_email_challenges_pkey;
--> statement-breakpoint
ALTER INDEX uniq_email_change_challenge_user RENAME TO uq_login_email_challenges_user;
--> statement-breakpoint
ALTER INDEX idx_email_change_challenge_expires RENAME TO idx_login_email_challenges_expires_at;
--> statement-breakpoint
ALTER TABLE login_email_challenges RENAME CONSTRAINT email_change_challenges_user_id_users_id_fk TO fk_login_email_challenges_user;
--> statement-breakpoint
-- Every login address is verified before it is added.
UPDATE login_emails SET email_verified = created_at WHERE email_verified IS NULL;
--> statement-breakpoint
ALTER TABLE login_emails RENAME COLUMN email_verified TO verified_at;
--> statement-breakpoint
ALTER TABLE login_emails ALTER COLUMN verified_at SET NOT NULL;
--> statement-breakpoint
ALTER INDEX uniq_login_emails_email RENAME TO uq_login_emails_email;
--> statement-breakpoint
ALTER TABLE login_emails RENAME CONSTRAINT login_emails_user_id_users_id_fk TO fk_login_emails_user;
--> statement-breakpoint
ALTER TABLE sessions RENAME CONSTRAINT sessions_user_id_users_id_fk TO fk_sessions_user;
--> statement-breakpoint
ALTER TABLE passkeys RENAME CONSTRAINT passkeys_user_id_users_id_fk TO fk_passkeys_user;
--> statement-breakpoint
ALTER TABLE webauthn_challenges RENAME CONSTRAINT webauthn_challenges_user_id_users_id_fk TO fk_webauthn_challenges_user;
--> statement-breakpoint

-- A credential's deleted_at always meant "revoked".
ALTER TABLE service_credentials RENAME COLUMN deleted_at TO revoked_at;
--> statement-breakpoint
ALTER TABLE service_credentials RENAME CONSTRAINT ck_active_service_credentials_hashed TO ck_service_credentials_active_hashed;
--> statement-breakpoint
ALTER TABLE service_credentials RENAME CONSTRAINT fk_service_credentials_book_ledger TO fk_service_credentials_book;
--> statement-breakpoint
ALTER TABLE service_credentials RENAME CONSTRAINT service_credentials_ledger_id_ledgers_id_fk TO fk_service_credentials_ledger;
--> statement-breakpoint
ALTER INDEX uniq_service_credentials_token_hash RENAME TO uq_service_credentials_token_hash;
--> statement-breakpoint

-- Remaining conventions: fk_/ck_ prefixes and <table>_pkey everywhere.
ALTER TABLE stored_files RENAME CONSTRAINT stored_files_ledger_id_ledgers_id_fk TO fk_stored_files_ledger;
--> statement-breakpoint
ALTER TABLE ledger_sync_state RENAME CONSTRAINT ledger_sync_state_ledger_id_fkey TO fk_ledger_sync_state_ledger;
--> statement-breakpoint
ALTER TABLE ledger_sync_state RENAME CONSTRAINT ledger_sync_state_version_check TO ck_ledger_sync_state_version;
--> statement-breakpoint
ALTER TABLE exchange_rates RENAME CONSTRAINT exchange_rates_rate_date_currency_pk TO exchange_rates_pkey;
--> statement-breakpoint
ALTER TABLE rate_limit_buckets DROP COLUMN created_at;
--> statement-breakpoint

-- Row timestamps default to now() so a plain SQL insert need not supply them.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name IN ('created_at', 'updated_at')
      AND column_default IS NULL
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT now()', target.table_name, target.column_name);
  END LOOP;
END $$;
--> statement-breakpoint

-- NOT NULL constraints keep the table and column names they were created
-- under; name each after where it now lives.
DO $$
DECLARE
  target record;
  wanted text;
BEGIN
  FOR target IN
    SELECT con.conname, cls.relname, att.attname
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE ns.nspname = current_schema() AND con.contype = 'n'
  LOOP
    wanted := left(target.relname || '_' || target.attname, 54) || '_not_null';
    IF target.conname <> wanted THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', target.relname, target.conname, wanted);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- One UPDATE per changed row instead of an upsert, two updates and two JSON
-- conversions. The ledger's sync row is created by the first change it sees.
CREATE OR REPLACE FUNCTION record_ledger_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  change_kind text := TG_ARGV[0];
  target_ledger_id uuid;
  currency_changed boolean := false;
BEGIN
  IF change_kind = 'settings' THEN
    target_ledger_id := NEW.id;
    currency_changed := NEW.main_currency IS DISTINCT FROM OLD.main_currency;
  ELSIF TG_OP = 'DELETE' THEN
    target_ledger_id := OLD.ledger_id;
  ELSE
    target_ledger_id := NEW.ledger_id;
  END IF;

  LOOP
    -- A transaction's later changes reuse its version; updating this one row
    -- serializes concurrent writers.
    UPDATE ledger_sync_state SET
      version = CASE WHEN transaction_id = txid_current() THEN version ELSE version + 1 END,
      transaction_id = txid_current(),
      categories_version = CASE WHEN change_kind = 'category' OR currency_changed
        THEN CASE WHEN transaction_id = txid_current() THEN version ELSE version + 1 END
        ELSE categories_version END,
      settings_version = CASE WHEN change_kind = 'settings'
        THEN CASE WHEN transaction_id = txid_current() THEN version ELSE version + 1 END
        ELSE settings_version END,
      stats_version = CASE WHEN change_kind IN ('document', 'entry', 'category', 'settings')
        THEN CASE WHEN transaction_id = txid_current() THEN version ELSE version + 1 END
        ELSE stats_version END,
      updated_at = now()
    WHERE ledger_id = target_ledger_id;
    EXIT WHEN FOUND;
    -- A cascade from a ledger being deleted has nothing to record.
    IF NOT EXISTS (SELECT 1 FROM ledgers WHERE id = target_ledger_id) THEN
      RETURN NULL;
    END IF;
    INSERT INTO ledger_sync_state (ledger_id, version, updated_at)
    VALUES (target_ledger_id, 0, now())
    ON CONFLICT (ledger_id) DO NOTHING;
  END LOOP;
  RETURN NULL;
END $$;
