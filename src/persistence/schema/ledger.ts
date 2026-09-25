import {
  pgTable,
  text,
  integer,
  index,
  uniqueIndex,
  timestamp,
  boolean,
  check,
  foreignKey,
  numeric,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { type InferSelectModel, sql } from "drizzle-orm";

// These declarations only provide physical target columns to FK builders.
// The complete tables remain uniquely exported from their owning modules.
const sourceDocumentsReference = pgTable("source_documents", {
  id: uuid("id").notNull(),
  ledgerId: uuid("ledger_id").notNull(),
});
const sourceDocumentRevisionsReference = pgTable("source_document_revisions", {
  id: uuid("id").notNull(),
  ledgerId: uuid("ledger_id").notNull(),
  sourceDocumentId: uuid("source_document_id").notNull(),
});

export const ledgers = pgTable(
  "ledgers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiLanguage: text("ai_language").notNull().default("zh-CN"),
    preferredCurrencies: varchar("preferred_currencies", { length: 3 })
      .array()
      .notNull()
      .default([]),
    mainCurrency: varchar("main_currency", { length: 3 }).notNull().default("CNY"),
    collapseEntriesDefault: boolean("collapse_entries_default").notNull().default(false),
    aiCustomPrompt: text("ai_custom_prompt").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    check("ck_ledgers_main_currency", sql`${table.mainCurrency} ~ '^[A-Z]{3}$'`),
    check(
      "ck_ledgers_preferred_currencies",
      sql`cardinality(${table.preferredCurrencies}) <= 32 AND (
        cardinality(${table.preferredCurrencies}) = 0 OR
        array_to_string(${table.preferredCurrencies}, ',') ~ '^([A-Z]{3})(,[A-Z]{3})*$'
      )`
    ),
    check("ck_ledgers_ai_language_length", sql`length(${table.aiLanguage}) BETWEEN 2 AND 35`),
    check("ck_ledgers_ai_custom_prompt_length", sql`length(${table.aiCustomPrompt}) <= 4000`),
  ]
);

export type Ledger = InferSelectModel<typeof ledgers>;

/**
 * A 分账: the bucket every record belongs to. Reading all of them together is
 * 总账, which is a view over every book rather than a designated one, so no row
 * here is special. `time_zone` null means "no zone of this book's own": a
 * record entered in the web app is then dated in the device's zone, while one
 * uploaded through an API key — which has no device — is dated in the server's.
 */
export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    timeZone: text("time_zone"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("uq_books_ledger_id_id").on(table.ledgerId, table.id),
    index("idx_books_active_sort")
      .on(table.ledgerId, table.sortOrder, table.createdAt, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    uniqueIndex("uniq_books_active_name")
      .on(table.ledgerId, table.name)
      .where(sql`${table.archivedAt} IS NULL`),
    check("ck_books_name_length", sql`length(btrim(${table.name})) BETWEEN 1 AND 20`),
    check(
      "ck_books_time_zone_length",
      sql`${table.timeZone} IS NULL OR length(${table.timeZone}) <= 50`
    ),
  ]
);

export type Book = InferSelectModel<typeof books>;

export const entryCategories = pgTable(
  "entry_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_entry_categories_ledger_id_id").on(table.ledgerId, table.id),
    index("idx_entry_categories_active_sort")
      .on(table.ledgerId, table.sortOrder, table.createdAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("uniq_category_name_per_ledger")
      .on(table.ledgerId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
);

export type EntryCategory = InferSelectModel<typeof entryCategories>;

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id"),
    sourceDocumentId: uuid("source_document_id"),
    sourceDocumentRevisionId: uuid("source_document_revision_id"),
    position: integer("position").notNull().default(0),
    amount: numeric("amount", { precision: 21, scale: 3, mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    itemName: text("item_name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_ledger_entries_ledger_id_id").on(table.ledgerId, table.id),
    uniqueIndex("uq_ledger_entries_revision_position")
      .on(table.sourceDocumentRevisionId, table.position)
      .where(sql`${table.deletedAt} IS NULL`),
    index("idx_ledger_entries_active_feed")
      .on(table.ledgerId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index("idx_ledger_entries_active_category")
      .on(table.ledgerId, table.categoryId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index("idx_ledger_entries_category_all").on(table.ledgerId, table.categoryId),
    index("idx_ledger_entries_active_currency")
      .on(table.ledgerId, table.currency, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index("idx_ledger_entries_active_source")
      .on(
        table.ledgerId,
        table.sourceDocumentId,
        table.sourceDocumentRevisionId,
        table.position,
        table.id
      )
      .where(sql`${table.deletedAt} IS NULL`),
    index("idx_ledger_entries_search")
      .using(
        "gin",
        sql`lower(${table.itemName} || ' ' || COALESCE(${table.description}, '')) public.gin_trgm_ops`
      )
      .where(sql`${table.deletedAt} IS NULL`),
    check("ck_ledger_entries_currency", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("ck_ledger_entries_position", sql`${table.position} >= 0`),
    // The live database (migration 0022) declares this FK as
    // `ON DELETE SET NULL (category_id)` — PostgreSQL 15+ column-list form —
    // so deleting a category nulls only category_id and never the NOT NULL
    // ledger_id. Drizzle cannot express the column list, so the delete action
    // is intentionally omitted here and enforced by the migration.
    foreignKey({
      columns: [table.ledgerId, table.categoryId],
      foreignColumns: [entryCategories.ledgerId, entryCategories.id],
      name: "fk_ledger_entries_category_ledger",
    }),
    foreignKey({
      columns: [table.ledgerId, table.sourceDocumentId],
      foreignColumns: [sourceDocumentsReference.ledgerId, sourceDocumentsReference.id],
      name: "fk_ledger_entries_document_ledger",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId, table.sourceDocumentRevisionId],
      foreignColumns: [
        sourceDocumentRevisionsReference.ledgerId,
        sourceDocumentRevisionsReference.id,
      ],
      name: "fk_ledger_entries_revision_ledger",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ledgerId, table.sourceDocumentId, table.sourceDocumentRevisionId],
      foreignColumns: [
        sourceDocumentRevisionsReference.ledgerId,
        sourceDocumentRevisionsReference.sourceDocumentId,
        sourceDocumentRevisionsReference.id,
      ],
      name: "fk_ledger_entries_document_revision",
    }).onDelete("cascade"),
  ]
);

export type LedgerEntry = InferSelectModel<typeof ledgerEntries>;

export const serviceCredentials = pgTable(
  "service_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash"),
    tokenPrefix: text("token_prefix"),
    tokenSuffix: text("token_suffix"),
    ledgerId: uuid("ledger_id")
      .notNull()
      .references(() => ledgers.id, { onDelete: "cascade" }),
    bookId: uuid("book_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_service_credentials_ledger_id").on(table.ledgerId),
    index("idx_service_credentials_ledger_book").on(table.ledgerId, table.bookId),
    uniqueIndex("uniq_service_credentials_token_hash")
      .on(table.tokenHash)
      .where(sql`${table.tokenHash} IS NOT NULL`),
    foreignKey({
      columns: [table.ledgerId, table.bookId],
      foreignColumns: [books.ledgerId, books.id],
      name: "fk_service_credentials_book_ledger",
    }),
    check(
      "ck_active_service_credentials_hashed",
      sql`${table.deletedAt} IS NOT NULL OR (${table.tokenHash} IS NOT NULL AND ${table.tokenPrefix} IS NOT NULL AND ${table.tokenSuffix} IS NOT NULL)`
    ),
  ]
);

export type ServiceCredential = InferSelectModel<typeof serviceCredentials>;
