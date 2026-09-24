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
export const revisionOriginEnum = pgEnum("revision_origin", [
  "submission",
  "manual_edit",
  "manual_entry",
]);
export const revisionFailureKindEnum = pgEnum("revision_failure_kind", [
  "invalid_input",
  "processing_error",
]);
export const retryClassificationEnum = pgEnum("retry_classification", [
  "retryable",
  "permanent",
  "invalid",
]);
export const processingOutboxStatusEnum = pgEnum("processing_outbox_status", [
  "pending",
  "claimed",
  "completed",
  "failed",
  "cancelled",
]);
export const uploadSessionStatusEnum = pgEnum("upload_session_status", [
  "open",
  "finalizing",
  "finalized",
  "expired",
  "cancelled",
]);
export const uploadTransportEnum = pgEnum("upload_transport", ["proxy", "direct"]);
export const uploadFileStatusEnum = pgEnum("upload_file_status", [
  "planned",
  "uploaded",
  "finalized",
  "rejected",
]);
export const idempotencyStatusEnum = pgEnum("idempotency_status", ["pending", "completed"]);

export const sourceDocumentRevisions = pgTable(
  "source_document_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title"),
    origin: revisionOriginEnum("origin").notNull().default("submission"),
    inputText: text("input_text"),
    inputDocumentDate: text("input_document_date"),
    inputDateReference: date("input_date_reference", { mode: "string" }),
    processingStatus: revisionProcessingStatusEnum("processing_status"),
    failureKind: revisionFailureKindEnum("failure_kind"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    submittedAt: requiredTimestamp("submitted_at").$defaultFn(() => new Date()),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId, table.sourceDocumentId],
      foreignColumns: [sourceDocuments.ledgerId, sourceDocuments.id],
      name: "fk_revisions_source_document_ledger",
    }).onDelete("cascade"),
    uniqueIndex("uq_source_document_revisions_ledger_id_id").on(table.ledgerId, table.id),
    uniqueIndex("uq_source_document_revisions_ledger_document_id").on(
      table.ledgerId,
      table.sourceDocumentId,
      table.id
    ),
    uniqueIndex("uq_source_document_revisions_document_number").on(
      table.sourceDocumentId,
      table.revisionNumber
    ),
    index("idx_source_document_revisions_ledger_processing_status").on(
      table.ledgerId,
      table.processingStatus
    ),
    index("idx_source_document_revisions_document_created").on(
      table.sourceDocumentId,
      table.createdAt
    ),
    check("ck_source_document_revisions_number", sql`${table.revisionNumber} > 0`),
  ]
);

export const storedFiles = pgTable(
  "stored_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    storageProvider: text("storage_provider").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    originalFilename: text("original_filename"),
    checksum: text("checksum"),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_stored_files_ledger_id_id").on(table.ledgerId, table.id),
    uniqueIndex("uq_stored_files_provider_key").on(table.storageProvider, table.storageKey),
    index("idx_stored_files_ledger_created").on(table.ledgerId, table.createdAt),
    check("ck_stored_files_byte_size", sql`${table.byteSize} >= 0`),
  ]
);

export const revisionFiles = pgTable(
  "revision_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    storedFileId: uuid("stored_file_id").notNull(),
    position: integer("position").notNull(),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId, table.revisionId],
      foreignColumns: [sourceDocumentRevisions.ledgerId, sourceDocumentRevisions.id],
      name: "fk_revision_files_revision_ledger",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId, table.storedFileId],
      foreignColumns: [storedFiles.ledgerId, storedFiles.id],
      name: "fk_revision_files_stored_file_ledger",
    }),
    uniqueIndex("uq_revision_files_revision_position").on(table.revisionId, table.position),
    uniqueIndex("uq_revision_files_revision_file").on(table.revisionId, table.storedFileId),
    index("idx_revision_files_ledger_file").on(table.ledgerId, table.storedFileId),
    check("ck_revision_files_position", sql`${table.position} >= 0`),
  ]
);

export const processingOutbox = pgTable(
  "processing_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    status: processingOutboxStatusEnum("status").notNull().default("pending"),
    retryClassification: retryClassificationEnum("retry_classification"),
    diagnosticCode: text("diagnostic_code"),
    correlationId: text("correlation_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    requestedAt: requiredTimestamp("requested_at").$defaultFn(() => new Date()),
    availableAt: requiredTimestamp("available_at").$defaultFn(() => new Date()),
    claimToken: text("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
    scheduleAttemptCount: integer("schedule_attempt_count").notNull().default(0),
    lastScheduledAt: timestamp("last_scheduled_at", { withTimezone: true }),
    nextAvailableAt: requiredTimestamp("next_available_at").$defaultFn(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId, table.revisionId],
      foreignColumns: [sourceDocumentRevisions.ledgerId, sourceDocumentRevisions.id],
      name: "fk_processing_outbox_revision_ledger",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId, table.sourceDocumentId],
      foreignColumns: [sourceDocuments.ledgerId, sourceDocuments.id],
      name: "fk_processing_outbox_document_ledger",
    }).onDelete("cascade"),
    uniqueIndex("uq_processing_outbox_revision_attempt").on(table.revisionId, table.attemptNumber),
    index("idx_processing_outbox_pending_dispatch")
      .on(table.availableAt, table.createdAt)
      .where(sql`${table.status} = 'pending'`),
    index("idx_processing_outbox_claim_expiry")
      .on(table.claimExpiresAt)
      .where(sql`${table.status} = 'claimed'`),
    index("idx_processing_outbox_recoverable").on(
      table.ledgerId,
      table.status,
      table.nextAvailableAt
    ),
    check("ck_processing_outbox_attempt_number", sql`${table.attemptNumber} > 0`),
  ]
);

export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    finalizationTokenHash: text("finalization_token_hash").notNull(),
    transport: uploadTransportEnum("transport").notNull().default("proxy"),
    status: uploadSessionStatusEnum("status").notNull().default("open"),
    expiresAt: requiredTimestamp("expires_at"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_upload_sessions_ledger_id_id").on(table.ledgerId, table.id),
    uniqueIndex("uq_upload_sessions_finalization_token_hash").on(table.finalizationTokenHash),
    index("idx_upload_sessions_ledger_status_expiry").on(
      table.ledgerId,
      table.status,
      table.expiresAt
    ),
  ]
);

export const uploadSessionFiles = pgTable(
  "upload_session_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    uploadSessionId: uuid("upload_session_id").notNull(),
    storedFileId: uuid("stored_file_id"),
    targetId: uuid("target_id").notNull(),
    position: integer("position").notNull(),
    expectedContentType: text("expected_content_type").notNull(),
    expectedByteSize: bigint("expected_byte_size", { mode: "number" }).notNull(),
    originalFilename: text("original_filename"),
    expectedChecksum: text("expected_checksum"),
    status: uploadFileStatusEnum("status").notNull().default("planned"),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId, table.uploadSessionId],
      foreignColumns: [uploadSessions.ledgerId, uploadSessions.id],
      name: "fk_upload_session_files_session_ledger",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId, table.storedFileId],
      foreignColumns: [storedFiles.ledgerId, storedFiles.id],
      name: "fk_upload_session_files_stored_file_ledger",
    }),
    uniqueIndex("uq_upload_session_files_session_target").on(table.uploadSessionId, table.targetId),
    uniqueIndex("uq_upload_session_files_session_position").on(
      table.uploadSessionId,
      table.position
    ),
    index("idx_upload_session_files_ledger_file").on(table.ledgerId, table.storedFileId),
    check("ck_upload_session_files_position", sql`${table.position} >= 0`),
    check(
      "ck_upload_session_files_expected_byte_size",
      sql`${table.expectedByteSize} IS NULL OR ${table.expectedByteSize} >= 0`
    ),
  ]
);

export const objectCleanupJobs = pgTable(
  "object_cleanup_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storageKey: text("storage_key").notNull(),
    uploadSessionId: uuid("upload_session_id").references(() => uploadSessions.id, {
      onDelete: "cascade",
    }),
    attempts: integer("attempts").notNull().default(0),
    claimToken: uuid("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    nextAttemptAt: requiredTimestamp("next_attempt_at").$defaultFn(() => new Date()),
    lastError: text("last_error"),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_object_cleanup_jobs_storage_key").on(table.storageKey),
    index("idx_object_cleanup_jobs_due").on(table.nextAttemptAt, table.createdAt),
  ]
);

export const exchangeRateRecalculationStatusEnum = pgEnum("exchange_rate_recalculation_status", [
  "pending",
  "claimed",
  "failed",
]);

export const exchangeRateRecalculationJobs = pgTable(
  "exchange_rate_recalculation_jobs",
  {
    rateDate: text("rate_date").notNull(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    status: exchangeRateRecalculationStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    claimToken: uuid("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    nextAttemptAt: requiredTimestamp("next_attempt_at").$defaultFn(() => new Date()),
    lastError: text("last_error"),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: requiredTimestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.rateDate, table.ledgerId] }),
    index("idx_exchange_rate_recalculation_jobs_due").on(table.status, table.nextAttemptAt),
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
    declaredEntryCount: integer("declared_entry_count").notNull().default(0),
    receivedEntryCount: integer("received_entry_count").notNull().default(0),
    candidateCategoryIds: uuid("candidate_category_ids")
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    appliedCount: integer("applied_count").notNull().default(0),
    confirmedCount: integer("confirmed_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    conflictCount: integer("conflict_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    cancelledCount: integer("cancelled_count").notNull().default(0),
    documentTotal: integer("document_total").notNull().default(0),
    documentCompleted: integer("document_completed").notNull().default(0),
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

export const categoryAssignmentSelectionChunks = pgTable(
  "category_assignment_selection_chunks",
  {
    jobId: uuid("job_id").notNull(),
    ledgerId: uuid("ledger_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    contentHash: text("content_hash").notNull(),
    entryCount: integer("entry_count").notNull(),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.chunkIndex] }),
    foreignKey({
      columns: [table.jobId],
      foreignColumns: [categoryReclassificationJobs.id],
      name: "category_assignment_selection_chunks_job_id_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "category_assignment_selection_chunks_ledger_id_fkey",
    }).onDelete("cascade"),
    index("idx_category_assignment_chunks_ledger_job").on(table.ledgerId, table.jobId),
  ]
);

export const categoryReclassificationJobDocuments = pgTable(
  "category_reclassification_job_documents",
  {
    jobId: uuid("job_id").notNull(),
    ledgerId: uuid("ledger_id").notNull(),
    sourceDocumentId: uuid("source_document_id").notNull(),
    expectedVersion: integer("expected_version").notNull(),
    revisionId: uuid("revision_id").notNull(),
    firstSelectionOrder: integer("first_selection_order").notNull(),
    status: categoryAssignmentDocumentStatusEnum("status").notNull().default("pending"),
    claimToken: uuid("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    claimStartedAt: timestamp("claim_started_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
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
    expectedVersion: integer("expected_version").notNull(),
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

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    principalType: text("principal_type").$type<"credential" | "user">().notNull(),
    principalId: uuid("principal_id").notNull(),
    key: text("key").notNull(),
    status: idempotencyStatusEnum("status").notNull().default("pending"),
    result: jsonb("result").$type<unknown>(),
    contentFingerprint: text("content_fingerprint"),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    expiresAt: requiredTimestamp("expires_at"),
  },
  (table) => [
    primaryKey({ columns: [table.principalType, table.principalId, table.key] }),
    check(
      "ck_idempotency_records_principal_type",
      sql`${table.principalType} IN ('credential', 'user')`
    ),
    index("idx_idempotency_records_status_expiry").on(table.status, table.expiresAt),
    index("idx_idempotency_pending_lease")
      .on(table.leaseExpiresAt, table.createdAt)
      .where(sql`${table.status} = 'pending'`),
  ]
);

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
