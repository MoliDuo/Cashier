import { check, pgTable, text, index, uuid, date, integer, jsonb } from "drizzle-orm/pg-core";
import { type InferSelectModel, sql } from "drizzle-orm";
import { rowTimestamp } from "./columns";

export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    index("idx_source_documents_latest_attempt").on(table.latestAttemptId),
    check("ck_source_documents_version", sql`${table.version} > 0`),
    check(
      "ck_source_documents_idempotency",
      sql`(${table.idempotencySource} IS NULL) = (${table.idempotencyKey} IS NULL)`
    ),
  ]
);

export type SourceDocument = InferSelectModel<typeof sourceDocuments>;
