-- Contract step of read-time conversion. The release still serving while
-- this runs converts with convert_amount and exchange_rates and never reads
-- the stored conversions, the snapshot table, or the recalculation queue.
ALTER TABLE ledger_entries
  DROP COLUMN converted_amount,
  DROP COLUMN exchange_rate;
--> statement-breakpoint
DROP TABLE exchange_rate_recalculation_jobs;
--> statement-breakpoint
DROP TYPE exchange_rate_recalculation_status;
--> statement-breakpoint
DROP TABLE currency_rates;
--> statement-breakpoint
-- Category assignments now compare each entry's category instead of the
-- document version; the next release stops writing these, and a later one
-- drops them.
ALTER TABLE category_reclassification_job_documents
  ALTER COLUMN expected_version DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE category_reclassification_job_entries
  ALTER COLUMN expected_version DROP NOT NULL;
