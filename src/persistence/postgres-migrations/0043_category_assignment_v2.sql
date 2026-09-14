DROP INDEX "uq_category_reclassification_jobs_active";
--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE text USING "status"::text;
--> statement-breakpoint
ALTER TYPE "category_reclassification_status" RENAME TO "category_reclassification_status_v1";
--> statement-breakpoint
CREATE TYPE "category_reclassification_status" AS ENUM(
  'preparing', 'pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled'
);
--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs"
  ALTER COLUMN "status" TYPE "category_reclassification_status"
    USING "status"::"category_reclassification_status",
  ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
DROP TYPE "category_reclassification_status_v1";
--> statement-breakpoint
CREATE TYPE "category_assignment_entry_outcome" AS ENUM(
  'applied', 'confirmed', 'failed', 'conflict', 'skipped', 'cancelled'
);
--> statement-breakpoint
CREATE TYPE "category_assignment_document_status" AS ENUM(
  'pending', 'running', 'succeeded', 'failed', 'conflict', 'skipped', 'cancelled'
);
--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs"
  DROP CONSTRAINT "ck_category_reclassification_jobs_entries",
  DROP CONSTRAINT "ck_category_reclassification_jobs_candidates",
  ADD COLUMN "format_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "mode" text DEFAULT 'ai' NOT NULL,
  ADD COLUMN "direct_category_id" uuid,
  ADD COLUMN "candidate_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN "custom_prompt_snapshot" text,
  ADD COLUMN "request_key" uuid,
  ADD COLUMN "parent_job_id" uuid,
  ADD COLUMN "declared_entry_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "received_entry_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "failed_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "conflict_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "skipped_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "cancelled_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "document_total" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "document_completed" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "completed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs"
  ALTER COLUMN "ledger_entry_ids" SET DEFAULT ARRAY[]::uuid[],
  ALTER COLUMN "candidate_category_ids" SET DEFAULT ARRAY[]::uuid[];
--> statement-breakpoint
UPDATE "category_reclassification_jobs"
SET "status" = 'failed',
    "last_error" = 'upgrade_interrupted',
    "claim_token" = NULL,
    "claim_expires_at" = NULL,
    "completed_at" = now(),
    "updated_at" = now()
WHERE "status" IN ('pending', 'running');
--> statement-breakpoint
ALTER TABLE "category_reclassification_jobs"
  ADD CONSTRAINT "category_reclassification_jobs_parent_job_id_fk"
  FOREIGN KEY ("parent_job_id") REFERENCES "category_reclassification_jobs"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_category_reclassification_jobs_active"
  ON "category_reclassification_jobs" ("ledger_id")
  WHERE "status" IN ('preparing', 'pending', 'running');
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_category_assignment_request_key"
  ON "category_reclassification_jobs" ("ledger_id", "request_key");
--> statement-breakpoint
CREATE TABLE "category_assignment_selection_chunks" (
  "job_id" uuid NOT NULL REFERENCES "category_reclassification_jobs"("id") ON DELETE CASCADE,
  "ledger_id" uuid NOT NULL REFERENCES "ledgers"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL,
  "content_hash" text NOT NULL,
  "entry_count" integer NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("job_id", "chunk_index")
);
--> statement-breakpoint
CREATE INDEX "idx_category_assignment_chunks_ledger_job"
  ON "category_assignment_selection_chunks" ("ledger_id", "job_id");
--> statement-breakpoint
CREATE TABLE "category_reclassification_job_documents" (
  "job_id" uuid NOT NULL REFERENCES "category_reclassification_jobs"("id") ON DELETE CASCADE,
  "ledger_id" uuid NOT NULL REFERENCES "ledgers"("id") ON DELETE CASCADE,
  "source_document_id" uuid NOT NULL REFERENCES "source_documents"("id") ON DELETE CASCADE,
  "expected_version" integer NOT NULL,
  "revision_id" uuid NOT NULL,
  "first_selection_order" integer NOT NULL,
  "status" "category_assignment_document_status" DEFAULT 'pending' NOT NULL,
  "claim_token" uuid,
  "claim_expires_at" timestamp with time zone,
  "claim_started_at" timestamp with time zone,
  "heartbeat_at" timestamp with time zone,
  "completed_chunk_count" integer DEFAULT 0 NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "error_code" text,
  "evidence_incomplete" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("job_id", "source_document_id")
);
--> statement-breakpoint
CREATE INDEX "idx_category_assignment_documents_due"
  ON "category_reclassification_job_documents" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX "idx_category_assignment_documents_ledger_job"
  ON "category_reclassification_job_documents" ("ledger_id", "job_id");
--> statement-breakpoint
CREATE TABLE "category_reclassification_job_entries" (
  "job_id" uuid NOT NULL REFERENCES "category_reclassification_jobs"("id") ON DELETE CASCADE,
  "ledger_id" uuid NOT NULL REFERENCES "ledgers"("id") ON DELETE CASCADE,
  "ledger_entry_id" uuid NOT NULL,
  "source_document_id" uuid NOT NULL,
  "selection_order" integer NOT NULL,
  "expected_version" integer NOT NULL,
  "original_category_id" uuid,
  "target_category_id" uuid,
  "decision_persisted" boolean DEFAULT false NOT NULL,
  "outcome" "category_assignment_entry_outcome",
  "error_code" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("job_id", "ledger_entry_id"),
  CONSTRAINT "fk_category_assignment_entry_document"
    FOREIGN KEY ("job_id", "source_document_id")
    REFERENCES "category_reclassification_job_documents"("job_id", "source_document_id")
    ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_category_assignment_entry_order"
  ON "category_reclassification_job_entries" ("job_id", "selection_order");
--> statement-breakpoint
CREATE INDEX "idx_category_assignment_entries_ledger_job"
  ON "category_reclassification_job_entries" ("ledger_id", "job_id");
