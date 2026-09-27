import {
  pgTable,
  text,
  integer,
  index,
  unique,
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
import { rowTimestamp } from "./columns";

// These declarations only provide physical target columns to FK builders.
// The complete tables remain uniquely exported from their owning modules.
const sourceDocumentsReference = pgTable("source_documents", {
  id: uuid("id").notNull(),
  ledgerId: uuid("ledger_id").notNull(),
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
    /** The zone every day in the ledger is read in: "today", periods, record dates. */
    timeZone: text("time_zone").notNull().default("Asia/Shanghai"),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
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
    check("ck_ledgers_time_zone_length", sql`length(${table.timeZone}) BETWEEN 1 AND 50`),
  ]
);

export type Ledger = InferSelectModel<typeof ledgers>;

/**
 * A 分账: the bucket every record belongs to. Reading all of them together is
 * 总账, which is a view over every book rather than a designated one, so no row
 * here is special. A book has no zone of its own: the ledger's zone dates every
 * book.
 */
export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "fk_books_ledger",
    }).onDelete("cascade"),
    uniqueIndex("uq_books_ledger_id_id").on(table.ledgerId, table.id),
    index("idx_books_active_sort")
      .on(table.ledgerId, table.sortOrder, table.createdAt, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    uniqueIndex("uq_books_active_name")
      .on(table.ledgerId, table.name)
      .where(sql`${table.archivedAt} IS NULL`),
    check("ck_books_name_length", sql`length(btrim(${table.name})) BETWEEN 1 AND 20`),
  ]
);

export type Book = InferSelectModel<typeof books>;

export const entryCategories = pgTable(
  "entry_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "fk_entry_categories_ledger",
    }).onDelete("cascade"),
    uniqueIndex("uq_entry_categories_ledger_id_id").on(table.ledgerId, table.id),
    index("idx_entry_categories_sort").on(
      table.ledgerId,
      table.sortOrder,
      table.createdAt,
      table.id
    ),
    // The database declares this DEFERRABLE INITIALLY IMMEDIATE, which Drizzle
    // cannot express: it is checked when a statement ends, so one UPDATE can
    // swap names.
    unique("uq_entry_categories_ledger_name").on(table.ledgerId, table.name),
  ]
);

export type EntryCategory = InferSelectModel<typeof entryCategories>;

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ledgerId: uuid("ledger_id").notNull(),
    categoryId: uuid("category_id"),
    sourceDocumentId: uuid("source_document_id").notNull(),
    position: integer("position").notNull().default(0),
    amount: numeric("amount", { precision: 21, scale: 3, mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    itemName: text("item_name").notNull(),
    description: text("description"),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "fk_ledger_entries_ledger",
    }).onDelete("cascade"),
    index("idx_ledger_entries_category").on(table.ledgerId, table.categoryId),
    index("idx_ledger_entries_document_position").on(
      table.ledgerId,
      table.sourceDocumentId,
      table.position,
      table.id
    ),
    index("idx_ledger_entries_search").using(
      "gin",
      sql`lower(${table.itemName} || ' ' || COALESCE(${table.description}, '')) public.gin_trgm_ops`
    ),
    check("ck_ledger_entries_currency", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("ck_ledger_entries_position", sql`${table.position} >= 0`),
    // The database declares this FK `ON DELETE SET NULL (category_id)` — the
    // PostgreSQL 15+ column-list form — so deleting a category nulls only
    // category_id and never the NOT NULL ledger_id. Drizzle cannot express the
    // column list, so the delete action is left to the migration.
    foreignKey({
      columns: [table.ledgerId, table.categoryId],
      foreignColumns: [entryCategories.ledgerId, entryCategories.id],
      name: "fk_ledger_entries_category",
    }),
    foreignKey({
      columns: [table.ledgerId, table.sourceDocumentId],
      foreignColumns: [sourceDocumentsReference.ledgerId, sourceDocumentsReference.id],
      name: "fk_ledger_entries_source_document",
    }).onDelete("cascade"),
  ]
);

export type LedgerEntry = InferSelectModel<typeof ledgerEntries>;

/** An API key. Revoking one stamps `revoked_at` and keeps the row for the record. */
export const serviceCredentials = pgTable(
  "service_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash"),
    tokenPrefix: text("token_prefix"),
    tokenSuffix: text("token_suffix"),
    ledgerId: uuid("ledger_id").notNull(),
    bookId: uuid("book_id").notNull(),
    name: text("name").notNull(),
    createdAt: rowTimestamp("created_at"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.ledgerId],
      foreignColumns: [ledgers.id],
      name: "fk_service_credentials_ledger",
    }).onDelete("cascade"),
    index("idx_service_credentials_ledger_book").on(table.ledgerId, table.bookId),
    uniqueIndex("uq_service_credentials_token_hash")
      .on(table.tokenHash)
      .where(sql`${table.tokenHash} IS NOT NULL`),
    foreignKey({
      columns: [table.ledgerId, table.bookId],
      foreignColumns: [books.ledgerId, books.id],
      name: "fk_service_credentials_book",
    }),
    check(
      "ck_service_credentials_active_hashed",
      sql`${table.revokedAt} IS NOT NULL OR (${table.tokenHash} IS NOT NULL AND ${table.tokenPrefix} IS NOT NULL AND ${table.tokenSuffix} IS NOT NULL)`
    ),
  ]
);

export type ServiceCredential = InferSelectModel<typeof serviceCredentials>;
