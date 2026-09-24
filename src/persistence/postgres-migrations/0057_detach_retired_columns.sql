-- Second step of retiring the columns 0056 prepared. The release shipped with
-- this migration no longer selects them, but the release still serving while it
-- builds does, so the columns stay until the next migration. Only the indexes,
-- constraints and the foreign key built on them go now; nothing reads those.
-- Every revision has had exactly one outbox row and every stored file the one
-- S3 provider, so the narrower unique indexes hold for the existing rows.
CREATE UNIQUE INDEX uq_processing_outbox_revision ON processing_outbox (revision_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_stored_files_storage_key ON stored_files (storage_key);
--> statement-breakpoint
DROP INDEX uq_processing_outbox_revision_attempt;
--> statement-breakpoint
DROP INDEX idx_processing_outbox_pending_dispatch;
--> statement-breakpoint
ALTER TABLE processing_outbox DROP CONSTRAINT ck_processing_outbox_attempt_number;
--> statement-breakpoint
DROP INDEX uq_stored_files_provider_key;
--> statement-breakpoint
DROP INDEX uq_source_document_revisions_document_number;
--> statement-breakpoint
ALTER TABLE source_document_revisions DROP CONSTRAINT ck_source_document_revisions_number;
--> statement-breakpoint
DROP INDEX idx_ledgers_user_id;
--> statement-breakpoint
ALTER TABLE ledgers DROP CONSTRAINT ledgers_user_id_users_id_fk;
