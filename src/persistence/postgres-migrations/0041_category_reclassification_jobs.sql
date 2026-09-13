CREATE TYPE "category_reclassification_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "category_reclassification_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_id" uuid NOT NULL,
	"status" "category_reclassification_status" DEFAULT 'pending' NOT NULL,
	"ledger_entry_ids" uuid[] NOT NULL,
	"candidate_category_ids" uuid[] NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"confirmed_count" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claim_token" uuid,
	"claim_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ck_category_reclassification_jobs_entries" CHECK (cardinality("category_reclassification_jobs"."ledger_entry_ids") BETWEEN 1 AND 100),
	CONSTRAINT "ck_category_reclassification_jobs_candidates" CHECK (cardinality("category_reclassification_jobs"."candidate_category_ids") BETWEEN 2 AND 8),
	CONSTRAINT "ck_category_reclassification_jobs_cursor" CHECK ("category_reclassification_jobs"."cursor" >= 0 AND "category_reclassification_jobs"."cursor" <= cardinality("category_reclassification_jobs"."ledger_entry_ids"))
);
--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs" ADD CONSTRAINT "category_reclassification_jobs_ledger_id_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_category_reclassification_jobs_due" ON "category_reclassification_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_category_reclassification_jobs_active" ON "category_reclassification_jobs" USING btree ("ledger_id") WHERE "category_reclassification_jobs"."status" IN ('pending', 'running');