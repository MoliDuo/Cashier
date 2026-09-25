-- The job row holds the lease and progress is counted when a job is read, so
-- the per-document claim columns, the selection chunks and the cached counters
-- that 0009 stopped writing go away.
DROP TABLE category_assignment_selection_chunks;
--> statement-breakpoint
ALTER TABLE category_reclassification_job_documents
  DROP COLUMN claim_token,
  DROP COLUMN claim_expires_at,
  DROP COLUMN claim_started_at,
  DROP COLUMN heartbeat_at;
--> statement-breakpoint
ALTER TABLE category_reclassification_jobs
  DROP COLUMN declared_entry_count,
  DROP COLUMN received_entry_count,
  DROP COLUMN applied_count,
  DROP COLUMN confirmed_count,
  DROP COLUMN failed_count,
  DROP COLUMN conflict_count,
  DROP COLUMN skipped_count,
  DROP COLUMN cancelled_count,
  DROP COLUMN document_total,
  DROP COLUMN document_completed;
