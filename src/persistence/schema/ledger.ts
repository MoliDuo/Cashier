import {
  pgTable,
  text,
  integer,
  index,
  uniqueIndex,
  timestamp,
  boolean,
  check,
  numeric,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { type InferSelectModel, sql } from "drizzle-orm";
import { rowTimestamp } from "./columns";

/*
 * The ledger is a singleton, so no other table names it. Until migration 0024
 * the database still carries a `ledger_id` column on every ledger table, filled
 * by `DEFAULT current_ledger_id()`, together with the composite keys and
 * indexes built on it. The model leaves all of them out, so this release
 * neither reads nor writes the column; the schema contract test lists their
 * names as retired.
 */

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
    // The ledger is a singleton: a second row cannot exist.
    uniqueIndex("uq_ledgers_singleton").on(sql`(true)`),
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
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: rowTimestamp("created_at"),
    updatedAt: rowTimestamp("updated_at"),
  },
  (table) => [check("ck_books_name_length", sql`length(btrim(${table.name})) BETWEEN 1 AND 20`)]
);

export type Book = InferSelectModel<typeof books>;

export const entryCategories = pgTable("entry_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: rowTimestamp("created_at"),
  updatedAt: rowTimestamp("updated_at"),
});

export type EntryCategory = InferSelectModel<typeof entryCategories>;

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    index("idx_ledger_entries_search").using(
      "gin",
      sql`lower(${table.itemName} || ' ' || COALESCE(${table.description}, '')) public.gin_trgm_ops`
    ),
    check("ck_ledger_entries_currency", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("ck_ledger_entries_position", sql`${table.position} >= 0`),
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
    bookId: uuid("book_id").notNull(),
    name: text("name").notNull(),
    createdAt: rowTimestamp("created_at"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_service_credentials_token_hash")
      .on(table.tokenHash)
      .where(sql`${table.tokenHash} IS NOT NULL`),
    check(
      "ck_service_credentials_active_hashed",
      sql`${table.revokedAt} IS NOT NULL OR (${table.tokenHash} IS NOT NULL AND ${table.tokenPrefix} IS NOT NULL AND ${table.tokenSuffix} IS NOT NULL)`
    ),
  ]
);

export type ServiceCredential = InferSelectModel<typeof serviceCredentials>;
