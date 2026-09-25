-- Last step of retiring columns earlier releases stopped writing and then
-- stopped selecting. The release still serving while this runs never reads them.
ALTER TABLE processing_outbox
  DROP COLUMN attempt_number,
  DROP COLUMN available_at,
  DROP COLUMN retry_classification,
  DROP COLUMN claimed_at,
  DROP COLUMN last_scheduled_at,
  DROP COLUMN correlation_id;
--> statement-breakpoint
DROP TYPE retry_classification;
--> statement-breakpoint
ALTER TABLE source_document_revisions
  DROP COLUMN revision_number,
  DROP COLUMN origin;
--> statement-breakpoint
DROP TYPE revision_origin;
--> statement-breakpoint
ALTER TABLE stored_files DROP COLUMN storage_provider;
--> statement-breakpoint
ALTER TABLE ledgers
  DROP COLUMN user_id,
  DROP COLUMN deleted_at;
--> statement-breakpoint
ALTER TABLE users
  DROP COLUMN name,
  DROP COLUMN image,
  DROP COLUMN deleted_at;
