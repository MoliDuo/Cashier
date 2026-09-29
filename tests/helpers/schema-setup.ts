import { eq, sql } from "drizzle-orm";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/persistence";
import {
  seedBooks,
  seedDocumentFiles,
  seedLedger,
  seedSourceDocument,
  seedUser,
} from "../../scripts/lib/seed";

type TestDatabase = NodePgDatabase<typeof schema>;

/** The day a record created now counts on when a fixture does not date it. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Ensures the ledger has books at all. Fixtures that create the ledger by hand
 * call this instead of the retired couple-configuration helper.
 */
export async function ensureTestLedgerBooks(
  db: TestDatabase,
  names: readonly string[] = ["共同支出"]
): Promise<Map<string, string>> {
  // A fixture may call this after deleting the ledger in its own setup; there
  // is nothing to hang a book on then, and the FK rightly refuses.
  const ledger = await db.select({ id: schema.ledgers.id }).from(schema.ledgers);
  if (ledger.length === 0) return new Map();
  const existing = await db
    .select({ id: schema.books.id, name: schema.books.name })
    .from(schema.books);
  if (existing.length > 0) return new Map(existing.map((row) => [row.name, row.id]));
  return createTestBooks(db, names);
}

/**
 * The books a test ledger starts with, in switcher order.
 */
export async function createTestBooks(
  db: TestDatabase,
  names: readonly string[] = ["共同支出"]
): Promise<Map<string, string>> {
  return seedBooks(db, names);
}

/**
 * The id of the ledger's first book, for fixtures that drive a port directly
 * and need a plain string rather than an insert-time subquery.
 */
export async function testBookId(db: TestDatabase): Promise<string> {
  const row = await db
    .select({ id: schema.books.id })
    .from(schema.books)
    .orderBy(schema.books.sortOrder)
    .limit(1)
    .then((rows) => rows[0]);
  if (row == null) throw new Error("The ledger has no book fixture");
  return row.id;
}

// Helper to create a test user and its login address, returning the user ID.
export async function createTestUser(
  db: TestDatabase,
  email?: string,
  id = TEST_USER_ID
): Promise<string> {
  const finalEmail = email ?? `test-${crypto.randomUUID()}@example.com`;

  const existing = await db
    .select()
    .from(schema.users)
    .where(sql`${schema.users.id} = ${id}`)
    .limit(1);
  if (existing.length !== 0) {
    await db
      .update(schema.loginEmails)
      .set({ email: finalEmail })
      .where(eq(schema.loginEmails.userId, id));
    return id;
  }

  return seedUser(db, { id, email: finalEmail });
}

// Helper to create a test user and ledger together
export async function createTestUserWithLedger(
  db: TestDatabase,
  email?: string,
  _ledgerName?: string,
  userId?: string
): Promise<{ userId: string }> {
  const finalUserId = await createTestUser(db, email, userId ?? TEST_USER_ID);

  await seedLedger(db);
  await createTestBooks(db);

  return { userId: finalUserId };
}

/** One single-byte JPEG stored file per image a fixture names. */
function testImageFiles(imageUrls: readonly string[]) {
  return imageUrls.map(() => ({ contentType: "image/jpeg", byteSize: 1 }));
}

/**
 * Creates a source document whose latest parse attempt has the given status.
 * The input text and files live on the document, as a submission leaves them.
 */
export async function createTestSourceDocument(
  db: TestDatabase,
  overrides: Partial<{
    text: string;
    status: "processing" | "completed" | "invalid" | "failed" | "cancelled";
    imageUrls: string[];
    entryDate: string;
    title: string | null;
  }> = {}
): Promise<string> {
  const status = overrides.status ?? "completed";
  return db.transaction((tx) =>
    seedSourceDocument(tx, {
      bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      documentDate: overrides.entryDate ?? todayUtc(),
      title: overrides.title ?? null,
      inputText: overrides.text ?? "Test document",
      attempts: [
        {
          status:
            status === "processing"
              ? "processing"
              : status === "invalid" || status === "failed"
                ? "failed"
                : "completed",
          failureKind:
            status === "invalid"
              ? "invalid_input"
              : status === "failed"
                ? "processing_error"
                : null,
        },
      ],
      files: testImageFiles(overrides.imageUrls ?? []),
    })
  );
}

/**
 * A record with entries and no parse attempt, the shape a split or a date
 * organization leaves: it has no submission, so its status is idle.
 */
export async function createTestRecord(
  db: TestDatabase,
  input: {
    bookId: string;
    title?: string | null;
    entryDate?: string;
    inputText?: string | null;
    entries: readonly {
      id?: string;
      categoryId: string | null;
      amount: string;
      currency: string | null;
      itemName: string;
      description: string | null;
      createdAt?: string;
    }[];
  }
): Promise<{ sourceDocumentId: string }> {
  const sourceDocumentId = await db.transaction((tx) =>
    seedSourceDocument(tx, {
      bookId: input.bookId,
      title: input.title ?? null,
      documentDate: input.entryDate ?? todayUtc(),
      inputText: input.inputText ?? null,
      entries: input.entries.map((entry) => ({
        ...(entry.id === undefined ? {} : { id: entry.id }),
        categoryId: entry.categoryId,
        itemName: entry.itemName,
        amount: entry.amount,
        currency: entry.currency ?? "CNY",
        description: entry.description,
        ...(entry.createdAt === undefined ? {} : { createdAt: new Date(entry.createdAt) }),
      })),
    })
  );
  return { sourceDocumentId };
}

/**
 * Settles fixture ledger entries inserted straight into a document: gives its
 * live entries contiguous positions, in the order they were written, and
 * records the given text and files as the document's input when it has none.
 * Entries belong to their document, so they are listed without a parse.
 */
export async function activateTestSourceDocumentProjection(
  db: TestDatabase,
  sourceDocumentId: string,
  content: {
    text?: string | null;
    imageUrls?: string[];
    /** Records a completed parse attempt as the latest one, so status filters see "completed". */
    parsed?: boolean;
  } = {}
): Promise<void> {
  await db.transaction(async (tx) => {
    const documents = await tx
      .select()
      .from(schema.sourceDocuments)
      .where(eq(schema.sourceDocuments.id, sourceDocumentId))
      .limit(1);
    const document = documents[0];
    if (document == null) throw new Error("Expected source document fixture");
    if (document.inputText == null && content.text != null) {
      await tx
        .update(schema.sourceDocuments)
        .set({ inputText: content.text })
        .where(eq(schema.sourceDocuments.id, sourceDocumentId));
    }
    const existingFiles = await tx
      .select({ id: schema.sourceDocumentFiles.id })
      .from(schema.sourceDocumentFiles)
      .where(eq(schema.sourceDocumentFiles.sourceDocumentId, sourceDocumentId))
      .limit(1);
    if (existingFiles.length === 0) {
      await seedDocumentFiles(tx, sourceDocumentId, testImageFiles(content.imageUrls ?? []));
    }
    if (content.parsed === true && document.latestAttemptId == null) {
      const [attempt] = await tx
        .insert(schema.extractionAttempts)
        .values({
          sourceDocumentId,
          status: "completed",
          finishedAt: new Date(),
        })
        .returning({ id: schema.extractionAttempts.id });
      await tx
        .update(schema.sourceDocuments)
        .set({ latestAttemptId: attempt!.id })
        .where(eq(schema.sourceDocuments.id, sourceDocumentId));
    }
    // Entries already settled keep their order; ones inserted since follow them.
    await tx.execute(sql`
      UPDATE ledger_entries AS entry
      SET position = ordered.position
      FROM (
        SELECT id, (row_number() OVER (ORDER BY created_at, position, ctid) - 1)::integer AS position
        FROM ledger_entries
        WHERE source_document_id = ${sourceDocumentId}
      ) AS ordered
      WHERE entry.id = ordered.id AND entry.position <> ordered.position
    `);
  });
}
