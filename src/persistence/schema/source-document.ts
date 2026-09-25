import {
  check,
  pgTable,
  text,
  index,
  uniqueIndex,
  timestamp,
  uuid,
  date,
  integer,
  jsonb,
  foreignKey,
} from "drizzle-orm/pg-core";
import { type InferSelectModel, sql } from "drizzle-orm";
import { ledgers, books } from "./ledger";

const sourceDocumentRevisionsReference = pgTable("source_document_revisions", {
  id: uuid("id").notNull(),
  ledgerId: uuid("ledger_id").notNull(),
  sourceDocumentId: uuid("source_document_id").notNull(),
});

export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    bookId: uuid("book_id").notNull(),
    title: text("title"),
    /** The text of the current attempt's input; its files are in `source_document_files`. */
    inputText: text("input_text"),
    documentDate: date("document_date", { mode: "string" }),
    effectiveDate: date("effective_date", { mode: "string" })
      .notNull()
      .generatedAlwaysAs(sql`COALESCE("document_date", ("created_at" AT TIME ZONE 'UTC')::date)`),
    latestSubmissionRevisionId: uuid("latest_submission_revision_id"),
    version: integer("version").notNull().default(1),
    dateOrganizationSuggestion: jsonb("date_organization_suggestion").$type<
      import("@/modules/source-document/date-organization-contracts").DateOrganizationSuggestion
    >(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_source_documents_ledger_id_id").on(table.ledgerId, table.id),
    index("idx_source_documents_ledger_book")
      .on(table.ledgerId, table.bookId)
      .where(sql`${table.deletedAt} IS NULL`),
    foreignKey({
      columns: [table.ledgerId, table.bookId],
      foreignColumns: [books.ledgerId, books.id],
      name: "fk_source_documents_book_ledger",
    }),
    index("idx_source_documents_active_feed")
      .on(table.ledgerId, table.effectiveDate.desc(), table.createdAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index("idx_source_documents_latest_submission_revision").on(table.latestSubmissionRevisionId),
    index("idx_source_documents_ledger_document_date")
      .on(table.ledgerId, table.documentDate, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    check("source_documents_version_check", sql`${table.version} > 0`),
    foreignKey({
      columns: [table.ledgerId, table.id, table.latestSubmissionRevisionId],
      foreignColumns: [
        sourceDocumentRevisionsReference.ledgerId,
        sourceDocumentRevisionsReference.sourceDocumentId,
        sourceDocumentRevisionsReference.id,
      ],
      name: "fk_source_documents_latest_submission_revision",
    }),
  ]
);

export type SourceDocument = InferSelectModel<typeof sourceDocuments>;
