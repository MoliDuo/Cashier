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
  unique,
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
export const processingAttemptStatusEnum = pgEnum("processing_attempt_status", [
  "queued",
  "processing",
  "completed",
  "invalid",
  "failed",
  "cancelled",
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

export const processingAttempts = pgTable(
  "processing_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    status: processingAttemptStatusEnum("status").notNull().default("queued"),
    retryClassification: retryClassificationEnum("retry_classification"),
    diagnosticCode: text("diagnostic_code"),
    correlationId: text("correlation_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId, table.revisionId],
      foreignColumns: [sourceDocumentRevisions.ledgerId, sourceDocumentRevisions.id],
      name: "fk_processing_attempts_revision_ledger",
    }).onDelete("cascade"),
    uniqueIndex("uq_processing_attempts_revision_number").on(table.revisionId, table.attemptNumber),
    index("idx_processing_attempts_ledger_status").on(table.ledgerId, table.status),
    check("ck_processing_attempts_number", sql`${table.attemptNumber} > 0`),
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
    // Nullable only for upload sessions created by a prior compatible image.
    expectedContentType: text("expected_content_type"),
    expectedByteSize: bigint("expected_byte_size", { mode: "number" }),
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
 * One AI reclassification run over a batch of entries. `cursor` is the only
 * progress pointer (how far into `ledgerEntryIds` the run has consumed), so a
 * resumed run never re-asks the model about a prefix it already applied.
 * `total` is derived from the array and `undecided` from
 * `total - appliedCount - confirmedCount`.
 */
export const categoryReclassificationStatusEnum = pgEnum("category_reclassification_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);

export const categoryReclassificationJobs = pgTable(
  "category_reclassification_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    status: categoryReclassificationStatusEnum("status").notNull().default("pending"),
    ledgerEntryIds: uuid("ledger_entry_ids").array().notNull(),
    candidateCategoryIds: uuid("candidate_category_ids").array().notNull(),
    cursor: integer("cursor").notNull().default(0),
    appliedCount: integer("applied_count").notNull().default(0),
    confirmedCount: integer("confirmed_count").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    claimToken: uuid("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    nextAttemptAt: requiredTimestamp("next_attempt_at").$defaultFn(() => new Date()),
    lastError: text("last_error"),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
    updatedAt: requiredTimestamp("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [
    index("idx_category_reclassification_jobs_due").on(table.status, table.nextAttemptAt),
    // One run per ledger at a time: a double submit becomes a conflict instead
    // of paying for the same model calls twice.
    uniqueIndex("uq_category_reclassification_jobs_active")
      .on(table.ledgerId)
      .where(sql`${table.status} IN ('pending', 'running')`),
    check(
      "ck_category_reclassification_jobs_entries",
      sql`cardinality(${table.ledgerEntryIds}) BETWEEN 1 AND 100`
    ),
    check(
      "ck_category_reclassification_jobs_candidates",
      sql`cardinality(${table.candidateCategoryIds}) BETWEEN 2 AND 8`
    ),
    check(
      "ck_category_reclassification_jobs_cursor",
      sql`${table.cursor} >= 0 AND ${table.cursor} <= cardinality(${table.ledgerEntryIds})`
    ),
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

export const ledgerChangeBatches = pgTable(
  "ledger_change_batches",
  {
    ledgerId: uuid("ledger_id").notNull(),
    version: bigint("version", { mode: "bigint" }).notNull(),
    transactionId: bigint("transaction_id", { mode: "bigint" }).notNull(),
    categoriesChanged: boolean("categories_changed").notNull().default(false),
    settingsChanged: boolean("settings_changed").notNull().default(false),
    statsChanged: boolean("stats_changed").notNull().default(false),
    resetRequired: boolean("reset_required").notNull().default(false),
    createdAt: requiredTimestamp("created_at").$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.ledgerId, table.version] }),
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "ledger_change_batches_ledger_id_fkey",
    }).onDelete("cascade"),
    unique("ledger_change_batches_ledger_id_transaction_id_key").on(
      table.ledgerId,
      table.transactionId
    ),
    index("idx_ledger_change_batches_created").on(table.createdAt),
    check("ledger_change_batches_version_check", sql`${table.version} > 0`),
  ]
);
