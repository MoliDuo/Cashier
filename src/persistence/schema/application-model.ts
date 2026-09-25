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

const requiredTimestamp = (name: string) => timestamp(name, { withTimezone: true }).notNull();

export const revisionProcessingStatusEnum = pgEnum("revision_processing_status", [
  "processing",
  "completed",
  "failed",
  "cancelled",
]);
export const revisionFailureKindEnum = pgEnum("revision_failure_kind", [
  "invalid_input",
  "processing_error",
]);

export const sourceDocumentRevisions = pgTable(
  "source_document_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    title: text("title"),
    inputDocumentDate: text("input_document_date"),
    inputDateReference: date("input_date_reference", { mode: "string" }),
    processingStatus: revisionProcessingStatusEnum("processing_status").notNull(),
    failureKind: revisionFailureKindEnum("failure_kind"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    submittedAt: requiredTimestamp("submitted_at").$defaultFn(() => new Date()),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
    // The processing lease: a processing attempt is its own queue entry.
    claimToken: text("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAvailableAt: timestamp("next_available_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId, table.sourceDocumentId],
      foreignColumns: [sourceDocuments.ledgerId, sourceDocuments.id],
      name: "fk_revisions_source_document_ledger",
    }).onDelete("cascade"),
    uniqueIndex("uq_source_document_revisions_one_processing")
      .on(table.sourceDocumentId)
      .where(sql`${table.processingStatus} = 'processing'`),
    index("idx_source_document_revisions_recoverable")
      .on(table.nextAvailableAt)
      .where(sql`${table.processingStatus} = 'processing'`),
    uniqueIndex("uq_source_document_revisions_ledger_id_id").on(table.ledgerId, table.id),
    uniqueIndex("uq_source_document_revisions_ledger_document_id").on(
      table.ledgerId,
      table.sourceDocumentId,
      table.id
    ),
    index("idx_source_document_revisions_ledger_processing_status").on(
      table.ledgerId,
      table.processingStatus
    ),
    index("idx_source_document_revisions_document_created").on(
      table.sourceDocumentId,
      table.createdAt
    ),
  ]
);

export const storedFiles = pgTable(
  "stored_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    originalFilename: text("original_filename"),
    checksum: text("checksum"),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_stored_files_ledger_id_id").on(table.ledgerId, table.id),
    uniqueIndex("uq_stored_files_storage_key").on(table.storageKey),
    index("idx_stored_files_ledger_created").on(table.ledgerId, table.createdAt),
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
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId, table.sourceDocumentId],
      foreignColumns: [sourceDocuments.ledgerId, sourceDocuments.id],
      name: "fk_source_document_files_document_ledger",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId, table.storedFileId],
      foreignColumns: [storedFiles.ledgerId, storedFiles.id],
      name: "fk_source_document_files_stored_file_ledger",
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

/**
 * One category assignment run. Selection, document work, persisted decisions,
 * and final outcomes live
 * in the child tables below.
 */
export const categoryReclassificationStatusEnum = pgEnum("category_reclassification_status", [
  "preparing",
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
  "running",
  "succeeded",
  "failed",
  "conflict",
  "skipped",
  "cancelled",
]);

export const categoryReclassificationJobs = pgTable(
  "category_reclassification_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    status: categoryReclassificationStatusEnum("status").notNull().default("pending"),
    mode: text("mode").$type<"ai" | "assign" | "clear">().notNull().default("ai"),
    directCategoryId: uuid("direct_category_id"),
    candidateSnapshot: jsonb("candidate_snapshot")
      .$type<import("@/modules/ledger/contracts").CategoryAssignmentCandidateSnapshot[]>()
      .notNull()
      .default([]),
    customPromptSnapshot: text("custom_prompt_snapshot"),
    requestKey: uuid("request_key"),
    parentJobId: uuid("parent_job_id"),
    candidateCategoryIds: uuid("candidate_category_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    // One worker runs a job at a time; its lease fences every write the run
    // makes, from a document's decisions to the job's final status.
    claimToken: uuid("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: requiredTimestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.parentJobId],
      foreignColumns: [table.id],
      name: "category_reclassification_jobs_parent_job_id_fk",
    }).onDelete("set null"),
    uniqueIndex("uq_category_assignment_request_key").on(table.ledgerId, table.requestKey),
    // One run per ledger at a time: a double submit becomes a conflict instead
    // of paying for the same model calls twice.
    uniqueIndex("uq_category_reclassification_jobs_active")
      .on(table.ledgerId)
      .where(sql`${table.status} IN ('preparing', 'pending', 'running')`),
  ]
);

export const categoryReclassificationJobDocuments = pgTable(
  "category_reclassification_job_documents",
  {
    jobId: uuid("job_id").notNull(),
    ledgerId: uuid("ledger_id").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    firstSelectionOrder: integer("first_selection_order").notNull(),
    status: categoryAssignmentDocumentStatusEnum("status").notNull().default("pending"),
    completedChunkCount: integer("completed_chunk_count").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: requiredTimestamp("next_attempt_at").$defaultFn(() => new Date()),
    errorCode: text("error_code"),
    evidenceIncomplete: boolean("evidence_incomplete").notNull().default(false),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: requiredTimestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.sourceDocumentId] }),
    foreignKey({
      columns: [table.jobId],
      foreignColumns: [categoryReclassificationJobs.id],
      name: "category_reclassification_job_documents_job_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "category_reclassification_job_documents_ledger_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceDocumentId],
      foreignColumns: [sourceDocuments.id],
      name: "category_reclassification_job_documents_source_document_id_fkey",
    }).onDelete("cascade"),
    index("idx_category_assignment_documents_due").on(table.status, table.nextAttemptAt),
    index("idx_category_assignment_documents_ledger_job").on(table.ledgerId, table.jobId),
  ]
);

export const categoryReclassificationJobEntries = pgTable(
  "category_reclassification_job_entries",
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
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: requiredTimestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.ledgerEntryId] }),
    uniqueIndex("uq_category_assignment_entry_order").on(table.jobId, table.selectionOrder),
    index("idx_category_assignment_entries_ledger_job").on(table.ledgerId, table.jobId),
    foreignKey({
      columns: [table.jobId],
      foreignColumns: [categoryReclassificationJobs.id],
      name: "category_reclassification_job_entries_job_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "category_reclassification_job_entries_ledger_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.jobId, table.sourceDocumentId],
      foreignColumns: [
        categoryReclassificationJobDocuments.jobId,
        categoryReclassificationJobDocuments.sourceDocumentId,
      ],
      name: "fk_category_assignment_entry_document",
    }).onDelete("cascade"),
  ]
);

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  bucketKey: text("bucket_key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: requiredTimestamp("window_start"),
  createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
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
    updatedAt: requiredTimestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "ledger_sync_state_ledger_id_fkey",
    }).onDelete("cascade"),
    check("ledger_sync_state_version_check", sql`${table.version} >= 0`),
  ]
);
