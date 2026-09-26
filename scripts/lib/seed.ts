/**
 * The one place non-production data is written: the smoke account, the demo
 * workspace and the integration-test fixtures all insert their users, login
 * addresses, ledgers, books, categories, API keys, records and files through
 * these functions, so a schema change has one seed to follow.
 *
 * Every function takes a drizzle database or transaction and writes only what
 * it is given; the callers decide the ids, names and timestamps. Rows that
 * carry an explicit id are inserted with `ON CONFLICT DO NOTHING`, so a seed
 * that is re-run over the same fixture leaves existing rows alone.
 */
import crypto from "node:crypto";
import { eq, sql, type SQL } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { DateOrganizationSuggestion } from "@/lib/ai/date-organization";
import * as schema from "@/persistence";
import { durableKey } from "@/server/stored-files/shared";

/** A drizzle database over the app schema, or a transaction opened on one. */
export type SeedDatabase = PgDatabase<NodePgQueryResultHKT, typeof schema>;

type RevisionStatus = (typeof schema.revisionProcessingStatusEnum.enumValues)[number];
type RevisionFailureKind = (typeof schema.revisionFailureKindEnum.enumValues)[number];

/** Rows written without a time get the moment of the write, as the app's own inserts do. */
function timestamp(at: Date | undefined): Date {
  return at ?? new Date();
}

/** An account and its one verified login address. Returns the user id. */
export async function seedUser(
  db: SeedDatabase,
  input: { id?: string; email: string; at?: Date }
): Promise<string> {
  const at = timestamp(input.at);
  const id = input.id ?? crypto.randomUUID();
  await db.insert(schema.users).values({ id, createdAt: at, updatedAt: at }).onConflictDoNothing();
  await db
    .insert(schema.loginEmails)
    .values({ userId: id, email: input.email, emailVerified: at, createdAt: at, updatedAt: at });
  return id;
}

/** A ledger with the given settings; anything left out keeps the column default. */
export async function seedLedger(
  db: SeedDatabase,
  input: {
    id?: string;
    mainCurrency?: string;
    preferredCurrencies?: string[];
    aiLanguage?: string;
    at?: Date;
  } = {}
): Promise<string> {
  const at = timestamp(input.at);
  const id = input.id ?? crypto.randomUUID();
  await db
    .insert(schema.ledgers)
    .values({
      id,
      ...(input.mainCurrency == null ? {} : { mainCurrency: input.mainCurrency }),
      ...(input.preferredCurrencies == null
        ? {}
        : { preferredCurrencies: input.preferredCurrencies }),
      ...(input.aiLanguage == null ? {} : { aiLanguage: input.aiLanguage }),
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing();
  return id;
}

export interface SeedBook {
  id?: string;
  name: string;
  timeZone?: string | null;
  /** Defaults to the book's 1-based place in the list. */
  sortOrder?: number;
}

/** A ledger's books, in switcher order. Returns each book's id by name. */
export async function seedBooks(
  db: SeedDatabase,
  ledgerId: string,
  books: readonly (string | SeedBook)[],
  at?: Date
): Promise<Map<string, string>> {
  const createdAt = timestamp(at);
  const rows = books.map((book, index) => {
    const spec: SeedBook = typeof book === "string" ? { name: book } : book;
    return {
      id: spec.id ?? crypto.randomUUID(),
      ledgerId,
      name: spec.name,
      timeZone: spec.timeZone ?? null,
      sortOrder: spec.sortOrder ?? index + 1,
      createdAt,
      updatedAt: createdAt,
    };
  });
  if (rows.length > 0) await db.insert(schema.books).values(rows).onConflictDoNothing();
  return new Map(rows.map((row) => [row.name, row.id]));
}

export interface SeedCategory {
  id?: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  /** Defaults to the category's 1-based place in the list. */
  sortOrder?: number;
}

/** A ledger's entry categories. Returns each category's id by name. */
export async function seedCategories(
  db: SeedDatabase,
  ledgerId: string,
  categories: readonly SeedCategory[],
  at?: Date
): Promise<Map<string, string>> {
  const createdAt = timestamp(at);
  const rows = categories.map((category, index) => ({
    id: category.id ?? crypto.randomUUID(),
    ledgerId,
    name: category.name,
    description: category.description ?? null,
    icon: category.icon ?? null,
    sortOrder: category.sortOrder ?? index + 1,
    createdAt,
    updatedAt: createdAt,
  }));
  if (rows.length > 0) await db.insert(schema.entryCategories).values(rows);
  return new Map(rows.map((row) => [row.name, row.id]));
}

/** An API key bound to one book; the caller hashes the token the way the app does. */
export async function seedServiceCredential(
  db: SeedDatabase,
  input: {
    id?: string;
    ledgerId: string;
    bookId: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    tokenSuffix: string;
    at?: Date;
  }
): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  await db
    .insert(schema.serviceCredentials)
    .values({
      id,
      ledgerId: input.ledgerId,
      bookId: input.bookId,
      name: input.name,
      tokenHash: input.tokenHash,
      tokenPrefix: input.tokenPrefix,
      tokenSuffix: input.tokenSuffix,
      createdAt: timestamp(input.at),
    })
    .onConflictDoNothing();
  return id;
}

export interface SeedStoredFile {
  id?: string;
  contentType?: string;
  byteSize: number;
  originalFilename?: string | null;
  checksum?: string | null;
}

/**
 * A finalized stored file, at the durable key the app itself would store it
 * under. Returns its id and that key, which is where the bytes belong.
 */
export async function seedStoredFile(
  db: SeedDatabase,
  ledgerId: string,
  file: SeedStoredFile,
  at?: Date
): Promise<{ id: string; storageKey: string }> {
  const createdAt = timestamp(at);
  const id = file.id ?? crypto.randomUUID();
  const storageKey = durableKey(ledgerId, id);
  await db.insert(schema.storedFiles).values({
    id,
    ledgerId,
    storageKey,
    contentType: file.contentType ?? "image/jpeg",
    byteSize: file.byteSize,
    originalFilename: file.originalFilename ?? null,
    checksum: file.checksum ?? null,
    createdAt,
    finalizedAt: createdAt,
  });
  return { id, storageKey };
}

/** Files attached to a document's input, in upload order. */
export async function seedDocumentFiles(
  db: SeedDatabase,
  document: { ledgerId: string; id: string },
  files: readonly SeedStoredFile[],
  at?: Date
): Promise<string[]> {
  const createdAt = timestamp(at);
  const ids: string[] = [];
  for (const [position, file] of files.entries()) {
    const stored = await seedStoredFile(db, document.ledgerId, file, createdAt);
    await db.insert(schema.sourceDocumentFiles).values({
      ledgerId: document.ledgerId,
      sourceDocumentId: document.id,
      storedFileId: stored.id,
      position,
      createdAt,
    });
    ids.push(stored.id);
  }
  return ids;
}

export interface SeedRevision {
  id?: string;
  title?: string | null;
  /** Recorded as both the submitted date text and its resolved reference date. */
  inputDocumentDate?: string | null;
  processingStatus: RevisionStatus;
  failureKind?: RevisionFailureKind | null;
  failureCode?: string | null;
  failureMessage?: string | null;
  /** Defaults to the revision's time, unless it is still processing. */
  finishedAt?: Date | null;
}

export interface SeedEntry {
  id?: string;
  categoryId?: string | null;
  itemName: string;
  amount: string;
  currency: string;
  description?: string | null;
}

export interface SeedSourceDocument {
  id?: string;
  ledgerId: string;
  /** A book id, or a subquery for one. */
  bookId: string | SQL;
  title?: string | null;
  inputText?: string | null;
  documentDate?: string | null;
  dateOrganizationSuggestion?: DateOrganizationSuggestion | null;
  /** Oldest first; the last one becomes the document's latest submission. */
  revisions?: readonly SeedRevision[];
  files?: readonly SeedStoredFile[];
  /** The document's entries, positioned in list order. */
  entries?: readonly SeedEntry[];
  at?: Date;
}

/**
 * A record as a finished submission leaves it: the document, its parse
 * attempts, its input files and its entries. Returns the document id.
 */
export async function seedSourceDocument(
  db: SeedDatabase,
  input: SeedSourceDocument
): Promise<string> {
  const at = timestamp(input.at);
  const id = input.id ?? crypto.randomUUID();
  const { ledgerId } = input;
  await db.insert(schema.sourceDocuments).values({
    id,
    ledgerId,
    bookId: input.bookId,
    title: input.title ?? null,
    inputText: input.inputText ?? null,
    documentDate: input.documentDate ?? null,
    version: 1,
    dateOrganizationSuggestion: input.dateOrganizationSuggestion ?? null,
    createdAt: at,
    updatedAt: at,
  });

  let latestRevisionId: string | undefined;
  for (const revision of input.revisions ?? []) {
    latestRevisionId = revision.id ?? crypto.randomUUID();
    const finishedAt =
      revision.finishedAt !== undefined
        ? revision.finishedAt
        : revision.processingStatus === "processing"
          ? null
          : at;
    await db.insert(schema.sourceDocumentRevisions).values({
      id: latestRevisionId,
      ledgerId,
      sourceDocumentId: id,
      title: revision.title ?? null,
      inputDocumentDate: revision.inputDocumentDate ?? null,
      inputDateReference: revision.inputDocumentDate ?? null,
      processingStatus: revision.processingStatus,
      failureKind: revision.failureKind ?? null,
      failureCode: revision.failureCode ?? null,
      failureMessage: revision.failureMessage ?? null,
      submittedAt: at,
      finishedAt,
      createdAt: at,
    });
  }

  await seedDocumentFiles(db, { ledgerId, id }, input.files ?? [], at);

  const entries = input.entries ?? [];
  if (entries.length > 0) {
    await db.insert(schema.ledgerEntries).values(
      entries.map((entry, position) => ({
        id: entry.id ?? crypto.randomUUID(),
        ledgerId,
        categoryId: entry.categoryId ?? null,
        sourceDocumentId: id,
        position,
        amount: entry.amount,
        currency: entry.currency,
        itemName: entry.itemName,
        description: entry.description ?? null,
        createdAt: at,
        updatedAt: at,
      }))
    );
  }

  if (latestRevisionId != null) {
    await db
      .update(schema.sourceDocuments)
      .set({ latestSubmissionRevisionId: latestRevisionId })
      .where(eq(schema.sourceDocuments.id, id));
  }
  return id;
}

/**
 * Final exchange rates for one day, each given as `dividend / divisor` euros
 * per unit and divided in PostgreSQL so the stored value is exactly what the
 * database computes. Maintenance never replaces a stored rate.
 */
export async function seedExchangeRates(
  db: SeedDatabase,
  rateDate: string,
  rates: ReadonlyArray<{ currency: string; dividend: string; divisor: string }>,
  at?: Date
): Promise<void> {
  if (rates.length === 0) return;
  const fetchedAt = timestamp(at);
  await db
    .insert(schema.exchangeRates)
    .values(
      rates.map(({ currency, dividend, divisor }) => ({
        rateDate,
        currency,
        perEur: sql`${dividend}::numeric / ${divisor}::numeric`,
        sourceDate: rateDate,
        fetchedAt,
      }))
    )
    .onConflictDoNothing();
}
