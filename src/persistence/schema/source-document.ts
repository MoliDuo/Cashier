import {
  check,
  pgTable,
  text,
  index,
  uniqueIndex,
  uuid,
  date,
  integer,
  jsonb,
  foreignKey,
} from "drizzle-orm/pg-core";
import { type InferSelectModel, sql } from "drizzle-orm";
import { ledgers, books } from "./ledger";
import { rowTimestamp } from "./columns";

const extractionAttemptsReference = pgTable("extraction_attempts", {
  id: uuid("id").notNull(),
  ledgerId: uuid("ledger_id").notNull(),
  sourceDocumentId: uuid("source_document_id").notNull(),
});

export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    bookId: uuid("book_id").notNull(),
    /** The title, whether typed or taken from the latest completed extraction. */
    title: text("title"),
    /** The text of the current attempt's input; its files are in `source_document_files`. */
    inputText: text("input_text"),
    documentDate: date("document_date", { mode: "string" }),
    effectiveDate: date("effective_date", { mode: "string" })
      .notNull()
      .generatedAlwaysAs(sql`COALESCE("document_date", ("created_at" AT TIME ZONE 'UTC')::date)`),
    /** The newest extraction attempt; null for a record split off or reorganized from another. */
    latestAttemptId: uuid("latest_attempt_id"),
    version: integer("version").notNull().default(1),
    /** Who sent the create request that made the document: `user:<id>` or `credential:<id>`. */
    idempotencySource: text("idempotency_source"),
    /** The request's idempotency key; a repeat within the ledger replays this document. */
    idempotencyKey: text("idempotency_key"),
    /** The created content, so a repeat with other content is refused. */
    idempotencyFingerprint: text("idempotency_fingerprint"),
    dateOrganizationSuggestion: jsonb("date_organization_suggestion").$type<
      import("@/lib/ai/date-organization").DateOrganizationSuggestion
    >(),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "fk_source_documents_ledger",
    }).onDelete("cascade"),
    uniqueIndex("uq_source_documents_ledger_id_id").on(table.ledgerId, table.id),
    foreignKey({
      columns: [table.ledgerId, table.bookId],
      foreignColumns: [books.ledgerId, books.id],
      name: "fk_source_documents_book",
    }),
    index("idx_source_documents_feed").on(
      table.ledgerId,
      table.effectiveDate.desc(),
      table.createdAt.desc(),
      table.id.desc()
    ),
    index("idx_source_documents_book_feed").on(
      table.ledgerId,
      table.bookId,
      table.effectiveDate.desc(),
      table.createdAt.desc(),
      table.id.desc()
    ),
    index("idx_source_documents_latest_attempt").on(table.latestAttemptId),
    check("ck_source_documents_version", sql`${table.version} > 0`),
    check(
      "ck_source_documents_idempotency",
      sql`(${table.idempotencySource} IS NULL) = (${table.idempotencyKey} IS NULL)`
    ),
    uniqueIndex("uq_source_documents_idempotency").on(
      table.ledgerId,
      table.idempotencySource,
      table.idempotencyKey
    ),
    foreignKey({
      columns: [table.ledgerId, table.id, table.latestAttemptId],
      foreignColumns: [
        extractionAttemptsReference.ledgerId,
        extractionAttemptsReference.sourceDocumentId,
        extractionAttemptsReference.id,
      ],
      name: "fk_source_documents_latest_attempt",
    }),
  ]
);

export type SourceDocument = InferSelectModel<typeof sourceDocuments>;
