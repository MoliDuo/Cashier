-- Baseline of the schema every deployment had reached by 0057. The migrations
-- before it were folded into this file; a database older than that has to be
-- upgraded with the `pre-baseline` tag first (scripts/migrate-database.mjs
-- refuses to run on it).
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
--> statement-breakpoint
CREATE TYPE category_assignment_document_status AS ENUM (
    'pending',
    'running',
    'succeeded',
    'failed',
    'conflict',
    'skipped',
    'cancelled'
);
--> statement-breakpoint
CREATE TYPE category_assignment_entry_outcome AS ENUM (
    'applied',
    'confirmed',
    'failed',
    'conflict',
    'skipped',
    'cancelled'
);
--> statement-breakpoint
CREATE TYPE category_reclassification_status AS ENUM (
    'preparing',
    'pending',
    'running',
    'succeeded',
    'partial',
    'failed',
    'cancelled'
);
--> statement-breakpoint
CREATE TYPE exchange_rate_recalculation_status AS ENUM (
    'pending',
    'claimed',
    'failed'
);
--> statement-breakpoint
CREATE TYPE idempotency_status AS ENUM (
    'pending',
    'completed'
);
--> statement-breakpoint
CREATE TYPE processing_outbox_status AS ENUM (
    'pending',
    'claimed',
    'completed',
    'failed',
    'cancelled'
);
--> statement-breakpoint
CREATE TYPE retry_classification AS ENUM (
    'retryable',
    'permanent',
    'invalid'
);
--> statement-breakpoint
CREATE TYPE revision_failure_kind AS ENUM (
    'invalid_input',
    'processing_error'
);
--> statement-breakpoint
CREATE TYPE revision_origin AS ENUM (
    'submission',
    'manual_edit',
    'manual_entry'
);
--> statement-breakpoint
CREATE TYPE revision_processing_status AS ENUM (
    'processing',
    'completed',
    'failed',
    'cancelled'
);
--> statement-breakpoint
CREATE TYPE upload_file_status AS ENUM (
    'planned',
    'uploaded',
    'finalized',
    'rejected'
);
--> statement-breakpoint
CREATE TYPE upload_session_status AS ENUM (
    'open',
    'finalizing',
    'finalized',
    'expired',
    'cancelled'
);
--> statement-breakpoint
CREATE TYPE upload_transport AS ENUM (
    'proxy',
    'direct'
);
--> statement-breakpoint
CREATE FUNCTION record_ledger_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  target_ledger_id uuid;
  change_version bigint;
  change_kind text := TG_ARGV[0];
  new_row jsonb := coalesce(to_jsonb(NEW), '{}'::jsonb);
  old_row jsonb := coalesce(to_jsonb(OLD), '{}'::jsonb);
  currency_changed boolean;
BEGIN
  target_ledger_id := CASE WHEN change_kind = 'settings'
    THEN coalesce(new_row->>'id', old_row->>'id')::uuid
    ELSE coalesce(new_row->>'ledger_id', old_row->>'ledger_id')::uuid
  END;
  IF NOT EXISTS (SELECT 1 FROM ledgers WHERE id = target_ledger_id) THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  currency_changed := change_kind = 'settings'
    AND old_row->>'main_currency' IS DISTINCT FROM new_row->>'main_currency';
  INSERT INTO ledger_sync_state(ledger_id, version, updated_at)
  VALUES (target_ledger_id, 0, now()) ON CONFLICT (ledger_id) DO NOTHING;
  -- Updating this one row serializes concurrent writers. A transaction's later
  -- triggers reuse its version and accumulate resource changes at that version.
  UPDATE ledger_sync_state SET
    version = version + CASE WHEN transaction_id = txid_current() THEN 0 ELSE 1 END,
    transaction_id = txid_current(), updated_at = now()
  WHERE ledger_id = target_ledger_id RETURNING version INTO change_version;
  UPDATE ledger_sync_state SET
    categories_version = CASE WHEN change_kind = 'category' OR currency_changed
      THEN change_version ELSE categories_version END,
    settings_version = CASE WHEN change_kind = 'settings'
      THEN change_version ELSE settings_version END,
    stats_version = CASE WHEN change_kind IN ('document', 'entry', 'category', 'settings')
      THEN change_version ELSE stats_version END
  WHERE ledger_id = target_ledger_id;
  RETURN coalesce(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TABLE books (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    name text NOT NULL,
    time_zone text,
    sort_order integer DEFAULT 0 NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_books_name_length CHECK (((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 20))),
    CONSTRAINT ck_books_time_zone_length CHECK (((time_zone IS NULL) OR (length(time_zone) <= 50)))
);
--> statement-breakpoint
CREATE TABLE category_assignment_selection_chunks (
    job_id uuid NOT NULL,
    ledger_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    content_hash text NOT NULL,
    entry_count integer NOT NULL,
    created_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE category_reclassification_job_documents (
    job_id uuid NOT NULL,
    ledger_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    expected_version integer NOT NULL,
    revision_id uuid NOT NULL,
    first_selection_order integer NOT NULL,
    status category_assignment_document_status DEFAULT 'pending'::category_assignment_document_status NOT NULL,
    claim_token uuid,
    claim_expires_at timestamp with time zone,
    claim_started_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    completed_chunk_count integer DEFAULT 0 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone NOT NULL,
    error_code text,
    evidence_incomplete boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE category_reclassification_job_entries (
    job_id uuid NOT NULL,
    ledger_id uuid NOT NULL,
    ledger_entry_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    selection_order integer NOT NULL,
    expected_version integer NOT NULL,
    original_category_id uuid,
    target_category_id uuid,
    decision_persisted boolean DEFAULT false NOT NULL,
    outcome category_assignment_entry_outcome,
    error_code text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE category_reclassification_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    status category_reclassification_status DEFAULT 'pending'::category_reclassification_status NOT NULL,
    candidate_category_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    applied_count integer DEFAULT 0 NOT NULL,
    confirmed_count integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    mode text DEFAULT 'ai'::text NOT NULL,
    direct_category_id uuid,
    candidate_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    custom_prompt_snapshot text,
    request_key uuid,
    parent_job_id uuid,
    declared_entry_count integer DEFAULT 0 NOT NULL,
    received_entry_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    conflict_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    cancelled_count integer DEFAULT 0 NOT NULL,
    document_total integer DEFAULT 0 NOT NULL,
    document_completed integer DEFAULT 0 NOT NULL,
    completed_at timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE currency_rates (
    date date NOT NULL,
    base character varying(3) DEFAULT 'EUR'::text NOT NULL,
    rates jsonb NOT NULL,
    updated_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE email_change_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    new_email text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    last_attempt_at timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE entry_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    icon text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE exchange_rate_recalculation_jobs (
    rate_date text NOT NULL,
    ledger_id uuid NOT NULL,
    status exchange_rate_recalculation_status DEFAULT 'pending'::exchange_rate_recalculation_status NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    claim_token uuid,
    claim_expires_at timestamp with time zone,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE idempotency_records (
    status idempotency_status DEFAULT 'pending'::idempotency_status NOT NULL,
    result jsonb,
    created_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    content_fingerprint text,
    principal_id uuid NOT NULL,
    key text NOT NULL,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    principal_type text NOT NULL,
    CONSTRAINT ck_idempotency_records_principal_type CHECK ((principal_type = ANY (ARRAY['credential'::text, 'user'::text])))
);
--> statement-breakpoint
CREATE TABLE ledger_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    category_id uuid,
    source_document_id uuid,
    source_document_revision_id uuid,
    amount numeric(21,3) NOT NULL,
    currency character varying(3) NOT NULL,
    item_name text NOT NULL,
    description text,
    converted_amount numeric(21,3),
    exchange_rate numeric(30,12),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT ck_ledger_entries_currency CHECK (((currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT ck_ledger_entries_position CHECK (("position" >= 0))
);
--> statement-breakpoint
CREATE TABLE ledger_sync_state (
    ledger_id uuid NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    transaction_id bigint,
    categories_version bigint DEFAULT 0 NOT NULL,
    settings_version bigint DEFAULT 0 NOT NULL,
    stats_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT ledger_sync_state_version_check CHECK ((version >= 0))
);
--> statement-breakpoint
CREATE TABLE ledgers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    ai_language text DEFAULT 'zh-CN'::text NOT NULL,
    preferred_currencies character varying(3)[] DEFAULT (ARRAY[]::character varying[])::character varying(3)[] NOT NULL,
    main_currency character varying(3) DEFAULT 'CNY'::character varying NOT NULL,
    collapse_entries_default boolean DEFAULT false NOT NULL,
    ai_custom_prompt text DEFAULT ''::text NOT NULL,
    CONSTRAINT ck_ledgers_ai_custom_prompt_length CHECK ((length(ai_custom_prompt) <= 4000)),
    CONSTRAINT ck_ledgers_ai_language_length CHECK (((length(ai_language) >= 2) AND (length(ai_language) <= 35))),
    CONSTRAINT ck_ledgers_main_currency CHECK (((main_currency)::text ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT ck_ledgers_preferred_currencies CHECK (((cardinality(preferred_currencies) <= 32) AND ((cardinality(preferred_currencies) = 0) OR (array_to_string(preferred_currencies, ','::text) ~ '^([A-Z]{3})(,[A-Z]{3})*$'::text))))
);
--> statement-breakpoint
CREATE TABLE login_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text NOT NULL,
    email_verified timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE object_cleanup_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    storage_key text NOT NULL,
    upload_session_id uuid,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    claim_token uuid,
    claim_expires_at timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE otp_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    token_hash text NOT NULL,
    expires timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    last_attempt_at timestamp with time zone,
    ip_address inet
);
--> statement-breakpoint
CREATE TABLE processing_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    attempt_number integer DEFAULT 1 NOT NULL,
    status processing_outbox_status DEFAULT 'pending'::processing_outbox_status NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    claim_token text,
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    schedule_attempt_count integer DEFAULT 0 NOT NULL,
    last_scheduled_at timestamp with time zone,
    next_available_at timestamp with time zone DEFAULT now() NOT NULL,
    source_document_id uuid NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    retry_classification retry_classification,
    diagnostic_code text,
    correlation_id text,
    started_at timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE rate_limit_buckets (
    bucket_key text NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    window_start timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE revision_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    stored_file_id uuid NOT NULL,
    "position" integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_revision_files_position CHECK (("position" >= 0))
);
--> statement-breakpoint
CREATE TABLE service_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone,
    deleted_at timestamp with time zone,
    token_hash text,
    token_prefix text,
    token_suffix text,
    book_id uuid NOT NULL,
    CONSTRAINT ck_active_service_credentials_hashed CHECK (((deleted_at IS NOT NULL) OR ((token_hash IS NOT NULL) AND (token_prefix IS NOT NULL) AND (token_suffix IS NOT NULL))))
);
--> statement-breakpoint
CREATE TABLE setup_state (
    id boolean DEFAULT true NOT NULL,
    code_hash text NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_setup_state_failed_attempts CHECK ((failed_attempts >= 0)),
    CONSTRAINT ck_setup_state_single_row CHECK (id)
);
--> statement-breakpoint
CREATE TABLE source_document_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    revision_number integer,
    input_text text,
    failure_message text,
    failure_code text,
    submitted_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    title text,
    origin revision_origin DEFAULT 'submission'::revision_origin NOT NULL,
    input_document_date text,
    processing_status revision_processing_status,
    failure_kind revision_failure_kind,
    input_date_reference date
);
--> statement-breakpoint
CREATE TABLE source_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    title text,
    document_date date,
    active_revision_id uuid,
    latest_submission_revision_id uuid,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    effective_date date GENERATED ALWAYS AS (COALESCE(document_date, ((created_at AT TIME ZONE 'UTC'::text))::date)) STORED NOT NULL,
    date_organization_suggestion jsonb,
    book_id uuid NOT NULL,
    CONSTRAINT source_documents_version_check CHECK ((version > 0))
);
--> statement-breakpoint
CREATE TABLE stored_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    storage_provider text DEFAULT 's3'::text NOT NULL,
    storage_key text NOT NULL,
    content_type text NOT NULL,
    byte_size bigint NOT NULL,
    original_filename text,
    checksum text,
    created_at timestamp with time zone NOT NULL,
    finalized_at timestamp with time zone,
    deleted_at timestamp with time zone,
    CONSTRAINT ck_stored_files_byte_size CHECK ((byte_size >= 0))
);
--> statement-breakpoint
CREATE TABLE upload_session_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    upload_session_id uuid NOT NULL,
    stored_file_id uuid,
    target_id uuid NOT NULL,
    "position" integer NOT NULL,
    expected_content_type text NOT NULL,
    expected_byte_size bigint NOT NULL,
    original_filename text,
    expected_checksum text,
    status upload_file_status DEFAULT 'planned'::upload_file_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_upload_session_files_expected_byte_size CHECK (((expected_byte_size IS NULL) OR (expected_byte_size >= 0))),
    CONSTRAINT ck_upload_session_files_position CHECK (("position" >= 0))
);
--> statement-breakpoint
CREATE TABLE upload_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ledger_id uuid NOT NULL,
    finalization_token_hash text NOT NULL,
    status upload_session_status DEFAULT 'open'::upload_session_status NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    finalized_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    transport upload_transport DEFAULT 'proxy'::upload_transport NOT NULL
);
--> statement-breakpoint
CREATE TABLE users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    image text,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone,
    password_hash text,
    password_updated_at timestamp with time zone,
    auth_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_users_auth_version_positive CHECK ((auth_version > 0))
);
--> statement-breakpoint
ALTER TABLE ONLY books
    ADD CONSTRAINT books_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY category_assignment_selection_chunks
    ADD CONSTRAINT category_assignment_selection_chunks_pkey PRIMARY KEY (job_id, chunk_index);
--> statement-breakpoint
ALTER TABLE ONLY category_reclassification_job_documents
    ADD CONSTRAINT category_reclassification_job_documents_pkey PRIMARY KEY (job_id, source_document_id);
--> statement-breakpoint
ALTER TABLE ONLY category_reclassification_job_entries
    ADD CONSTRAINT category_reclassification_job_entries_pkey PRIMARY KEY (job_id, ledger_entry_id);
--> statement-breakpoint
ALTER TABLE ONLY category_reclassification_jobs
    ADD CONSTRAINT category_reclassification_jobs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY currency_rates
    ADD CONSTRAINT currency_rates_pkey PRIMARY KEY (date);
--> statement-breakpoint
ALTER TABLE ONLY email_change_challenges
    ADD CONSTRAINT email_change_challenges_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY entry_categories
    ADD CONSTRAINT entry_categories_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY exchange_rate_recalculation_jobs
    ADD CONSTRAINT exchange_rate_recalculation_jobs_rate_date_ledger_id_pk PRIMARY KEY (rate_date, ledger_id);
--> statement-breakpoint
ALTER TABLE ONLY idempotency_records
    ADD CONSTRAINT idempotency_records_pkey PRIMARY KEY (principal_type, principal_id, key);
--> statement-breakpoint
ALTER TABLE ONLY ledger_entries
    ADD CONSTRAINT ledger_entries_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY ledger_sync_state
    ADD CONSTRAINT ledger_sync_state_pkey PRIMARY KEY (ledger_id);
--> statement-breakpoint
ALTER TABLE ONLY ledgers
    ADD CONSTRAINT ledgers_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY login_emails
    ADD CONSTRAINT login_emails_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY object_cleanup_jobs
    ADD CONSTRAINT object_cleanup_jobs_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY otp_tokens
    ADD CONSTRAINT otp_tokens_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY otp_tokens
    ADD CONSTRAINT otp_tokens_token_hash_unique UNIQUE (token_hash);
--> statement-breakpoint
ALTER TABLE ONLY processing_outbox
    ADD CONSTRAINT processing_outbox_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY rate_limit_buckets
    ADD CONSTRAINT rate_limit_buckets_pkey PRIMARY KEY (bucket_key);
--> statement-breakpoint
ALTER TABLE ONLY revision_files
    ADD CONSTRAINT revision_files_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY service_credentials
    ADD CONSTRAINT service_credentials_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY setup_state
    ADD CONSTRAINT setup_state_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY source_document_revisions
    ADD CONSTRAINT source_document_revisions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY source_documents
    ADD CONSTRAINT source_documents_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY stored_files
    ADD CONSTRAINT stored_files_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY upload_session_files
    ADD CONSTRAINT upload_session_files_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY upload_sessions
    ADD CONSTRAINT upload_sessions_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE INDEX idx_books_active_sort ON books USING btree (ledger_id, sort_order, created_at, id) WHERE (archived_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_category_assignment_chunks_ledger_job ON category_assignment_selection_chunks USING btree (ledger_id, job_id);
--> statement-breakpoint
CREATE INDEX idx_category_assignment_documents_due ON category_reclassification_job_documents USING btree (status, next_attempt_at);
--> statement-breakpoint
CREATE INDEX idx_category_assignment_documents_ledger_job ON category_reclassification_job_documents USING btree (ledger_id, job_id);
--> statement-breakpoint
CREATE INDEX idx_category_assignment_entries_ledger_job ON category_reclassification_job_entries USING btree (ledger_id, job_id);
--> statement-breakpoint
CREATE INDEX idx_email_change_challenge_expires ON email_change_challenges USING btree (expires_at);
--> statement-breakpoint
CREATE INDEX idx_entry_categories_active_sort ON entry_categories USING btree (ledger_id, sort_order, created_at, id) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_exchange_rate_recalculation_jobs_due ON exchange_rate_recalculation_jobs USING btree (status, next_attempt_at);
--> statement-breakpoint
CREATE INDEX idx_idempotency_pending_lease ON idempotency_records USING btree (lease_expires_at, created_at) WHERE (status = 'pending'::idempotency_status);
--> statement-breakpoint
CREATE INDEX idx_idempotency_records_status_expiry ON idempotency_records USING btree (status, expires_at);
--> statement-breakpoint
CREATE INDEX idx_ledger_entries_active_amount ON ledger_entries USING btree (ledger_id, converted_amount) WHERE ((deleted_at IS NULL) AND (converted_amount IS NOT NULL));
--> statement-breakpoint
CREATE INDEX idx_ledger_entries_active_category ON ledger_entries USING btree (ledger_id, category_id, created_at DESC, id DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_ledger_entries_active_currency ON ledger_entries USING btree (ledger_id, currency, created_at DESC, id DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_ledger_entries_active_feed ON ledger_entries USING btree (ledger_id, created_at DESC, id DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_ledger_entries_active_source ON ledger_entries USING btree (ledger_id, source_document_id, source_document_revision_id, "position", id) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_ledger_entries_category_all ON ledger_entries USING btree (ledger_id, category_id);
--> statement-breakpoint
CREATE INDEX idx_ledger_entries_search ON ledger_entries USING gin (lower(((item_name || ' '::text) || COALESCE(description, ''::text))) public.gin_trgm_ops) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_login_emails_user_id ON login_emails USING btree (user_id);
--> statement-breakpoint
CREATE INDEX idx_object_cleanup_jobs_due ON object_cleanup_jobs USING btree (next_attempt_at, created_at);
--> statement-breakpoint
CREATE INDEX idx_otp_tokens_expires ON otp_tokens USING btree (expires);
--> statement-breakpoint
CREATE INDEX idx_processing_outbox_claim_expiry ON processing_outbox USING btree (claim_expires_at) WHERE (status = 'claimed'::processing_outbox_status);
--> statement-breakpoint
CREATE INDEX idx_processing_outbox_recoverable ON processing_outbox USING btree (ledger_id, status, next_available_at);
--> statement-breakpoint
CREATE INDEX idx_revision_files_ledger_file ON revision_files USING btree (ledger_id, stored_file_id);
--> statement-breakpoint
CREATE INDEX idx_service_credentials_ledger_book ON service_credentials USING btree (ledger_id, book_id);
--> statement-breakpoint
CREATE INDEX idx_service_credentials_ledger_id ON service_credentials USING btree (ledger_id);
--> statement-breakpoint
CREATE INDEX idx_source_document_revisions_document_created ON source_document_revisions USING btree (source_document_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_source_document_revisions_ledger_processing_status ON source_document_revisions USING btree (ledger_id, processing_status);
--> statement-breakpoint
CREATE INDEX idx_source_documents_active_feed ON source_documents USING btree (ledger_id, effective_date DESC NULLS LAST, created_at DESC NULLS LAST, id DESC NULLS LAST) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_source_documents_active_revision ON source_documents USING btree (active_revision_id);
--> statement-breakpoint
CREATE INDEX idx_source_documents_latest_submission_revision ON source_documents USING btree (latest_submission_revision_id);
--> statement-breakpoint
CREATE INDEX idx_source_documents_ledger_book ON source_documents USING btree (ledger_id, book_id) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_source_documents_ledger_document_date ON source_documents USING btree (ledger_id, document_date, created_at DESC NULLS LAST, id DESC NULLS LAST) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX idx_stored_files_ledger_created ON stored_files USING btree (ledger_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_upload_session_files_ledger_file ON upload_session_files USING btree (ledger_id, stored_file_id);
--> statement-breakpoint
CREATE INDEX idx_upload_sessions_ledger_status_expiry ON upload_sessions USING btree (ledger_id, status, expires_at);
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_books_active_name ON books USING btree (ledger_id, name) WHERE (archived_at IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_category_name_per_ledger ON entry_categories USING btree (ledger_id, name) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_email_change_challenge_user ON email_change_challenges USING btree (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_login_emails_email ON login_emails USING btree (lower(email));
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_otp_tokens_email ON otp_tokens USING btree (email);
--> statement-breakpoint
CREATE UNIQUE INDEX uniq_service_credentials_token_hash ON service_credentials USING btree (token_hash) WHERE (token_hash IS NOT NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_books_ledger_id_id ON books USING btree (ledger_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_category_assignment_entry_order ON category_reclassification_job_entries USING btree (job_id, selection_order);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_category_assignment_request_key ON category_reclassification_jobs USING btree (ledger_id, request_key);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_category_reclassification_jobs_active ON category_reclassification_jobs USING btree (ledger_id) WHERE (status = ANY (ARRAY['preparing'::category_reclassification_status, 'pending'::category_reclassification_status, 'running'::category_reclassification_status]));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_entry_categories_ledger_id_id ON entry_categories USING btree (ledger_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_ledger_entries_ledger_id_id ON ledger_entries USING btree (ledger_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_ledger_entries_revision_position ON ledger_entries USING btree (source_document_revision_id, "position") WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_object_cleanup_jobs_storage_key ON object_cleanup_jobs USING btree (storage_key);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_processing_outbox_revision ON processing_outbox USING btree (revision_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_revision_files_revision_file ON revision_files USING btree (revision_id, stored_file_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_revision_files_revision_position ON revision_files USING btree (revision_id, "position");
--> statement-breakpoint
CREATE UNIQUE INDEX uq_source_document_revisions_ledger_document_id ON source_document_revisions USING btree (ledger_id, source_document_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_source_document_revisions_ledger_id_id ON source_document_revisions USING btree (ledger_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_source_documents_ledger_id_id ON source_documents USING btree (ledger_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_stored_files_ledger_id_id ON stored_files USING btree (ledger_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_stored_files_storage_key ON stored_files USING btree (storage_key);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_upload_session_files_session_position ON upload_session_files USING btree (upload_session_id, "position");
--> statement-breakpoint
CREATE UNIQUE INDEX uq_upload_session_files_session_target ON upload_session_files USING btree (upload_session_id, target_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_upload_sessions_finalization_token_hash ON upload_sessions USING btree (finalization_token_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_upload_sessions_ledger_id_id ON upload_sessions USING btree (ledger_id, id);
--> statement-breakpoint
CREATE TRIGGER trg_entry_categories_change_log AFTER INSERT OR DELETE OR UPDATE ON entry_categories FOR EACH ROW EXECUTE FUNCTION record_ledger_change('category');
--> statement-breakpoint
CREATE TRIGGER trg_ledger_entries_change_log AFTER INSERT OR DELETE OR UPDATE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION record_ledger_change('entry');
--> statement-breakpoint
CREATE TRIGGER trg_ledgers_settings_change_log AFTER UPDATE OF ai_language, preferred_currencies, main_currency, collapse_entries_default, ai_custom_prompt ON ledgers FOR EACH ROW EXECUTE FUNCTION record_ledger_change('settings');
--> statement-breakpoint
CREATE TRIGGER trg_source_document_revisions_change_log AFTER INSERT OR DELETE OR UPDATE ON source_document_revisions FOR EACH ROW EXECUTE FUNCTION record_ledger_change('revision');
--> statement-breakpoint
CREATE TRIGGER trg_source_documents_change_log AFTER INSERT OR DELETE OR UPDATE ON source_documents FOR EACH ROW EXECUTE FUNCTION record_ledger_change('document');
--> statement-breakpoint
ALTER TABLE ONLY books
    ADD CONSTRAINT books_ledger_id_ledgers_id_fk FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY category_assignment_selection_chunks
    ADD CONSTRAINT category_assignment_selection_chunks_job_id_fkey FOREIGN KEY (job_id) REFERENCES category_reclassification_jobs(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY category_assignment_selection_chunks
    ADD CONSTRAINT category_assignment_selection_chunks_ledger_id_fkey FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY category_reclassification_job_documents
    ADD CONSTRAINT category_reclassification_job_documents_job_id_fkey FOREIGN KEY (job_id) REFERENCES category_reclassification_jobs(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY category_reclassification_job_documents
    ADD CONSTRAINT category_reclassification_job_documents_ledger_id_fkey FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY category_reclassification_job_documents
    ADD CONSTRAINT category_reclassification_job_documents_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES source_documents(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY category_reclassification_job_entries
    ADD CONSTRAINT category_reclassification_job_entries_job_id_fkey FOREIGN KEY (job_id) REFERENCES category_reclassification_jobs(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY category_reclassification_job_entries
    ADD CONSTRAINT category_reclassification_job_entries_ledger_id_fkey FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY category_reclassification_jobs
    ADD CONSTRAINT category_reclassification_jobs_ledger_id_ledgers_id_fk FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY category_reclassification_jobs
    ADD CONSTRAINT category_reclassification_jobs_parent_job_id_fk FOREIGN KEY (parent_job_id) REFERENCES category_reclassification_jobs(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY email_change_challenges
    ADD CONSTRAINT email_change_challenges_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY entry_categories
    ADD CONSTRAINT entry_categories_ledger_id_ledgers_id_fk FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY exchange_rate_recalculation_jobs
    ADD CONSTRAINT exchange_rate_recalculation_jobs_ledger_id_ledgers_id_fk FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY category_reclassification_job_entries
    ADD CONSTRAINT fk_category_assignment_entry_document FOREIGN KEY (job_id, source_document_id) REFERENCES category_reclassification_job_documents(job_id, source_document_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY ledger_entries
    ADD CONSTRAINT fk_ledger_entries_category_ledger FOREIGN KEY (ledger_id, category_id) REFERENCES entry_categories(ledger_id, id) ON DELETE SET NULL (category_id);
--> statement-breakpoint
ALTER TABLE ONLY ledger_entries
    ADD CONSTRAINT fk_ledger_entries_document_ledger FOREIGN KEY (ledger_id, source_document_id) REFERENCES source_documents(ledger_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY ledger_entries
    ADD CONSTRAINT fk_ledger_entries_document_revision FOREIGN KEY (ledger_id, source_document_id, source_document_revision_id) REFERENCES source_document_revisions(ledger_id, source_document_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY ledger_entries
    ADD CONSTRAINT fk_ledger_entries_revision_ledger FOREIGN KEY (ledger_id, source_document_revision_id) REFERENCES source_document_revisions(ledger_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY processing_outbox
    ADD CONSTRAINT fk_processing_outbox_document_ledger FOREIGN KEY (ledger_id, source_document_id) REFERENCES source_documents(ledger_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY processing_outbox
    ADD CONSTRAINT fk_processing_outbox_revision_ledger FOREIGN KEY (ledger_id, revision_id) REFERENCES source_document_revisions(ledger_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY revision_files
    ADD CONSTRAINT fk_revision_files_revision_ledger FOREIGN KEY (ledger_id, revision_id) REFERENCES source_document_revisions(ledger_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY revision_files
    ADD CONSTRAINT fk_revision_files_stored_file_ledger FOREIGN KEY (ledger_id, stored_file_id) REFERENCES stored_files(ledger_id, id);
--> statement-breakpoint
ALTER TABLE ONLY source_document_revisions
    ADD CONSTRAINT fk_revisions_source_document_ledger FOREIGN KEY (ledger_id, source_document_id) REFERENCES source_documents(ledger_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY service_credentials
    ADD CONSTRAINT fk_service_credentials_book_ledger FOREIGN KEY (ledger_id, book_id) REFERENCES books(ledger_id, id);
--> statement-breakpoint
ALTER TABLE ONLY source_documents
    ADD CONSTRAINT fk_source_documents_active_revision FOREIGN KEY (ledger_id, id, active_revision_id) REFERENCES source_document_revisions(ledger_id, source_document_id, id) ON DELETE SET NULL (active_revision_id);
--> statement-breakpoint
ALTER TABLE ONLY source_documents
    ADD CONSTRAINT fk_source_documents_book_ledger FOREIGN KEY (ledger_id, book_id) REFERENCES books(ledger_id, id);
--> statement-breakpoint
ALTER TABLE ONLY source_documents
    ADD CONSTRAINT fk_source_documents_latest_submission_revision FOREIGN KEY (ledger_id, id, latest_submission_revision_id) REFERENCES source_document_revisions(ledger_id, source_document_id, id);
--> statement-breakpoint
ALTER TABLE ONLY upload_session_files
    ADD CONSTRAINT fk_upload_session_files_session_ledger FOREIGN KEY (ledger_id, upload_session_id) REFERENCES upload_sessions(ledger_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY upload_session_files
    ADD CONSTRAINT fk_upload_session_files_stored_file_ledger FOREIGN KEY (ledger_id, stored_file_id) REFERENCES stored_files(ledger_id, id);
--> statement-breakpoint
ALTER TABLE ONLY ledger_entries
    ADD CONSTRAINT ledger_entries_ledger_id_ledgers_id_fk FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY ledger_sync_state
    ADD CONSTRAINT ledger_sync_state_ledger_id_fkey FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY login_emails
    ADD CONSTRAINT login_emails_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY object_cleanup_jobs
    ADD CONSTRAINT object_cleanup_jobs_upload_session_id_upload_sessions_id_fk FOREIGN KEY (upload_session_id) REFERENCES upload_sessions(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY service_credentials
    ADD CONSTRAINT service_credentials_ledger_id_ledgers_id_fk FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY source_documents
    ADD CONSTRAINT source_documents_ledger_id_ledgers_id_fk FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY stored_files
    ADD CONSTRAINT stored_files_ledger_id_ledgers_id_fk FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY upload_sessions
    ADD CONSTRAINT upload_sessions_ledger_id_ledgers_id_fk FOREIGN KEY (ledger_id) REFERENCES ledgers(id) ON DELETE CASCADE;
