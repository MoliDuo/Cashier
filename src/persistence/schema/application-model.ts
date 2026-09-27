import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  timestamp,
  jsonb,
  uuid,
  pgEnum,
  bigint,
  primaryKey,
  boolean,
  date,
} from "drizzle-orm/pg-core";
import { ledgers } from "./ledger";
import { sourceDocuments } from "./source-document";
import { rowTimestamp } from "./columns";

export const extractionAttemptStatusEnum = pgEnum("extraction_attempt_status", [
  "processing",
  "completed",
  "failed",
  "cancelled",
]);
export const extractionFailureKindEnum = pgEnum("extraction_failure_kind", [
  "invalid_input",
  "processing_error",
]);

/**
 * One extraction of a document's input. An attempt is its own queue entry: a
 * worker leases it through the claim columns, and a transient failure hands it
 * back due again at `next_attempt_at`.
 */
export const extractionAttempts = pgTable(
  "extraction_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    /** The document date the submission asked for, if any. */
    requestedDate: date("requested_date", { mode: "string" }),
    /** The day relative dates in the input are resolved against. */
    referenceDate: date("reference_date", { mode: "string" }),
    status: extractionAttemptStatusEnum("status").notNull(),
    failureKind: extractionFailureKindEnum("failure_kind"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    submittedAt: rowTimestamp("submitted_at"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId, table.sourceDocumentId],
      foreignColumns: [sourceDocuments.ledgerId, sourceDocuments.id],
      name: "fk_extraction_attempts_source_document",
    }).onDelete("cascade"),
    uniqueIndex("uq_extraction_attempts_one_processing")
      .on(table.sourceDocumentId)
      .where(sql`${table.status} = 'processing'`),
    index("idx_extraction_attempts_due")
      .on(table.ledgerId, table.nextAttemptAt)
      .where(sql`${table.status} = 'processing'`),
    uniqueIndex("uq_extraction_attempts_ledger_document_id").on(
      table.ledgerId,
      table.sourceDocumentId,
      table.id
    ),
  ]
);

export const storedFiles = pgTable(
  "stored_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    originalFilename: text("original_filename"),
    checksum: text("checksum"),
    createdAt: rowTimestamp("created_at"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "fk_stored_files_ledger",
    }).onDelete("cascade"),
    uniqueIndex("uq_stored_files_ledger_id_id").on(table.ledgerId, table.id),
    uniqueIndex("uq_stored_files_storage_key").on(table.storageKey),
    check("ck_stored_files_byte_size", sql`${table.byteSize} >= 0`),
  ]
);

/** The files of a source document's current input, in upload order. */
export const sourceDocumentFiles = pgTable(
  "source_document_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    storedFileId: uuid("stored_file_id").notNull(),
    position: integer("position").notNull(),
    createdAt: rowTimestamp("created_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId, table.sourceDocumentId],
      foreignColumns: [sourceDocuments.ledgerId, sourceDocuments.id],
      name: "fk_source_document_files_source_document",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId, table.storedFileId],
      foreignColumns: [storedFiles.ledgerId, storedFiles.id],
      name: "fk_source_document_files_stored_file",
    }),
    uniqueIndex("uq_source_document_files_document_position").on(
      table.sourceDocumentId,
      table.position
    ),
    uniqueIndex("uq_source_document_files_document_file").on(
      table.sourceDocumentId,
      table.storedFileId
    ),
    index("idx_source_document_files_ledger_file").on(table.ledgerId, table.storedFileId),
    check("ck_source_document_files_position", sql`${table.position} >= 0`),
  ]
);

export const categoryAssignmentJobStatusEnum = pgEnum("category_assignment_job_status", [
  "pending",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);
export const categoryAssignmentEntryOutcomeEnum = pgEnum("category_assignment_entry_outcome", [
  "applied",
  "confirmed",
  "failed",
  "conflict",
  "skipped",
  "cancelled",
]);
export const categoryAssignmentDocumentStatusEnum = pgEnum("category_assignment_document_status", [
  "pending",
  "succeeded",
  "failed",
  "conflict",
  "skipped",
  "cancelled",
]);

/**
 * One category assignment run. The documents it works through and the
 * outcome of each selected entry live in the two tables below; progress is
 * counted from them when the job is read.
 */
export const categoryAssignmentJobs = pgTable(
  "category_assignment_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    status: categoryAssignmentJobStatusEnum("status").notNull().default("pending"),
    mode: text("mode").$type<"ai" | "assign" | "clear">().notNull().default("ai"),
    /** The category an `assign` run sets on every selected entry. */
    assignCategoryId: uuid("assign_category_id"),
    /** The categories an `ai` run may choose from, as they were when it started. */
    candidateSnapshot: jsonb("candidate_snapshot")
      .$type<Array<{ id: string; name: string; description: string | null }>>()
      .notNull()
      .default([]),
    customPromptSnapshot: text("custom_prompt_snapshot"),
    requestKey: uuid("request_key"),
    /** The run whose failures this run retries. */
    retryOfJobId: uuid("retry_of_job_id"),
    // One worker runs a job at a time; its lease fences every write the run
    // makes, from a document's decisions to the job's final status.
    claimToken: uuid("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "fk_category_assignment_jobs_ledger",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.retryOfJobId],
      foreignColumns: [table.id],
      name: "fk_category_assignment_jobs_retry_of_job",
    }).onDelete("set null"),
    uniqueIndex("uq_category_assignment_jobs_request_key").on(table.ledgerId, table.requestKey),
    // One run per ledger at a time: a double submit becomes a conflict instead
    // of paying for the same model calls twice.
    uniqueIndex("uq_category_assignment_jobs_active")
      .on(table.ledgerId)
      .where(sql`${table.status} IN ('pending', 'running')`),
    check("ck_category_assignment_jobs_mode", sql`${table.mode} IN ('ai', 'assign', 'clear')`),
  ]
);

export const categoryAssignmentDocuments = pgTable(
  "category_assignment_documents",
  {
    jobId: uuid("job_id").notNull(),
    ledgerId: uuid("ledger_id").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    /** The position of the document's first selected entry in the selection. */
    selectionOrder: integer("selection_order").notNull(),
    status: categoryAssignmentDocumentStatusEnum("status").notNull().default("pending"),
    completedChunkCount: integer("completed_chunk_count").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: rowTimestamp("next_attempt_at"),
    errorCode: text("error_code"),
    evidenceIncomplete: boolean("evidence_incomplete").notNull().default(false),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    primaryKey({
      name: "category_assignment_documents_pkey",
      columns: [table.jobId, table.sourceDocumentId],
    }),
    foreignKey({
      columns: [table.jobId],
      foreignColumns: [categoryAssignmentJobs.id],
      name: "fk_category_assignment_documents_job",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "fk_category_assignment_documents_ledger",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceDocumentId],
      foreignColumns: [sourceDocuments.id],
      name: "fk_category_assignment_documents_source_document",
    }).onDelete("cascade"),
    index("idx_category_assignment_documents_ledger_job").on(table.ledgerId, table.jobId),
    index("idx_category_assignment_documents_source_document").on(table.sourceDocumentId),
  ]
);

export const categoryAssignmentEntries = pgTable(
  "category_assignment_entries",
  {
    jobId: uuid("job_id").notNull(),
    ledgerId: uuid("ledger_id").notNull(),
    ledgerEntryId: uuid("ledger_entry_id").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    selectionOrder: integer("selection_order").notNull(),
    originalCategoryId: uuid("original_category_id"),
    targetCategoryId: uuid("target_category_id"),
    decisionPersisted: boolean("decision_persisted").notNull().default(false),
    outcome: categoryAssignmentEntryOutcomeEnum("outcome"),
    errorCode: text("error_code"),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    primaryKey({
      name: "category_assignment_entries_pkey",
      columns: [table.jobId, table.ledgerEntryId],
    }),
    uniqueIndex("uq_category_assignment_entries_selection_order").on(
      table.jobId,
      table.selectionOrder
    ),
    index("idx_category_assignment_entries_ledger_job").on(table.ledgerId, table.jobId),
    foreignKey({
      columns: [table.jobId],
      foreignColumns: [categoryAssignmentJobs.id],
      name: "fk_category_assignment_entries_job",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "fk_category_assignment_entries_ledger",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.jobId, table.sourceDocumentId],
      foreignColumns: [
        categoryAssignmentDocuments.jobId,
        categoryAssignmentDocuments.sourceDocumentId,
      ],
      name: "fk_category_assignment_entries_document",
    }).onDelete("cascade"),
  ]
);

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  bucketKey: text("bucket_key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});

export const ledgerSyncState = pgTable(
  "ledger_sync_state",
  {
    ledgerId: uuid("ledger_id").primaryKey(),
    version: bigint("version", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    transactionId: bigint("transaction_id", { mode: "bigint" }),
    categoriesVersion: bigint("categories_version", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    settingsVersion: bigint("settings_version", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    statsVersion: bigint("stats_version", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "fk_ledger_sync_state_ledger",
    }).onDelete("cascade"),
    check("ck_ledger_sync_state_version", sql`${table.version} >= 0`),
  ]
);
