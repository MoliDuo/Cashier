-- A category assignment is leased as a whole: one worker runs a job at a
-- time and fences every write on the job's lease, so the documents' claim
-- columns, the selection chunks and the cached counters stop being written.
-- The next release drops them.
ALTER TABLE category_reclassification_jobs
  ADD COLUMN claim_token uuid,
  ADD COLUMN claim_expires_at timestamp with time zone;
--> statement-breakpoint
-- A selection is now submitted in one request, so a selection still being
-- uploaded in chunks can never be committed.
UPDATE category_reclassification_job_entries AS entry
SET outcome = 'cancelled', error_code = 'selection_upload_expired', updated_at = now()
FROM category_reclassification_jobs AS job
WHERE job.id = entry.job_id AND job.status = 'preparing' AND entry.outcome IS NULL;
--> statement-breakpoint
UPDATE category_reclassification_job_documents AS work
SET status = 'cancelled', error_code = 'selection_upload_expired', updated_at = now()
FROM category_reclassification_jobs AS job
WHERE job.id = work.job_id AND job.status = 'preparing';
--> statement-breakpoint
UPDATE category_reclassification_jobs
SET status = 'cancelled', last_error = 'selection_upload_expired', completed_at = now(),
    updated_at = now()
WHERE status = 'preparing';
--> statement-breakpoint
-- A document is either waiting or has its outcome; the one a worker was on
-- when this deployed is picked up again under the job's lease.
UPDATE category_reclassification_job_documents
SET status = 'pending', updated_at = now()
WHERE status = 'running';
