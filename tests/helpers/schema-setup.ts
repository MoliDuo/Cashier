import { eq, sql } from "drizzle-orm";
import { type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/persistence";

type TestDatabase = NodePgDatabase<typeof schema>;

export const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Ensures a ledger has books at all. Fixtures that create their ledger by hand
 * call this instead of the retired couple-configuration helper.
 */
export async function ensureTestLedgerBooks(
  db: TestDatabase,
  ledgerId: string,
  names: readonly string[] = ["共同支出"]
): Promise<Map<string, string>> {
  // A fixture may call this for a ledger it deleted in its own setup; there is
  // nothing to hang a book on then, and the FK rightly refuses.
  const ledger = await db
    .select({ id: schema.ledgers.id })
    .from(schema.ledgers)
    .where(eq(schema.ledgers.id, ledgerId))
    .limit(1);
  if (ledger.length === 0) return new Map();
  const existing = await db
    .select({ id: schema.books.id, name: schema.books.name })
    .from(schema.books)
    .where(eq(schema.books.ledgerId, ledgerId));
  if (existing.length > 0) return new Map(existing.map((row) => [row.name, row.id]));
  return createTestBooks(db, ledgerId, names);
}

/**
 * Gives an existing ledger its first book, for fixtures that insert the ledger
 * themselves rather than going through `createTestUserWithLedger`.
 */
/**
 * The books a test ledger starts with, in switcher order.
 */
export async function createTestBooks(
  db: TestDatabase,
  ledgerId: string,
  names: readonly string[] = ["共同支出"]
): Promise<Map<string, string>> {
  const rows = await db
    .insert(schema.books)
    .values(
      names.map((name, index) => ({
        ledgerId,
        name,
        sortOrder: index + 1,
      }))
    )
    .returning({ id: schema.books.id, name: schema.books.name });
  return new Map(rows.map((row) => [row.name, row.id]));
}

/**
 * The id of a ledger's first book, for fixtures that drive a port directly and
 * need a plain string rather than an insert-time subquery.
 */
export async function testBookId(db: TestDatabase, ledgerId: string): Promise<string> {
  const row = await db
    .select({ id: schema.books.id })
    .from(schema.books)
    .where(eq(schema.books.ledgerId, ledgerId))
    .orderBy(schema.books.sortOrder)
    .limit(1)
    .then((rows) => rows[0]);
  if (row == null) throw new Error(`Ledger ${ledgerId} has no book fixture`);
  return row.id;
}

function requireDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
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

  await db.insert(schema.users).values({ id });
  await db.insert(schema.loginEmails).values({
    userId: id,
    email: finalEmail,
    emailVerified: new Date(),
  });
  return id;
}

// Helper to create a test user and ledger together
export async function createTestUserWithLedger(
  db: TestDatabase,
  email?: string,
  _ledgerName?: string,
  userId?: string
): Promise<{ userId: string; ledgerId: string }> {
  const finalUserId = await createTestUser(db, email, userId ?? TEST_USER_ID);

  const ledgerId = crypto.randomUUID();
  await db.insert(schema.ledgers).values({ id: ledgerId });
  await createTestBooks(db, ledgerId);

  return { userId: finalUserId, ledgerId };
}

async function insertTestDocumentFiles(
  tx: Parameters<Parameters<TestDatabase["transaction"]>[0]>[0],
  document: { ledgerId: string; id: string },
  imageUrls: readonly string[]
): Promise<void> {
  for (const [position] of imageUrls.entries()) {
    const file = requireDefined(
      (
        await tx
          .insert(schema.storedFiles)
          .values({
            ledgerId: document.ledgerId,
            storageKey: `tests/${document.id}/${position}`,
            contentType: "image/jpeg",
            byteSize: 1,
            finalizedAt: new Date(),
          })
          .returning()
      )[0],
      "Expected inserted stored file"
    );
    await tx.insert(schema.sourceDocumentFiles).values({
      ledgerId: document.ledgerId,
      sourceDocumentId: document.id,
      storedFileId: file.id,
      position,
    });
  }
}

/**
 * Creates a source document whose latest parse attempt has the given status.
 * The input text and files live on the document, as a submission leaves them.
 */
export async function createTestSourceDocument(
  db: TestDatabase,
  ledgerId: string,
  overrides: Partial<{
    text: string;
    status: "processing" | "completed" | "invalid" | "failed" | "cancelled";
    imageUrls: string[];
    entryDate: string | null;
    title: string | null;
  }> = {}
): Promise<string> {
  return db.transaction(async (tx) => {
    const status = overrides.status ?? "completed";
    const doc = requireDefined(
      (
        await tx
          .insert(schema.sourceDocuments)
          .values({
            ledgerId,
            documentDate: overrides.entryDate,
            title: overrides.title,
            inputText: overrides.text ?? "Test document",
            bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
          })
          .returning()
      )[0],
      "Expected inserted source document"
    );
    const revision = requireDefined(
      (
        await tx
          .insert(schema.sourceDocumentRevisions)
          .values({
            ledgerId,
            sourceDocumentId: doc.id,
            processingStatus:
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
            finishedAt: status === "processing" ? null : new Date(),
          })
          .returning()
      )[0],
      "Expected inserted source document revision"
    );
    await tx
      .update(schema.sourceDocuments)
      .set({ latestSubmissionRevisionId: revision.id })
      .where(eq(schema.sourceDocuments.id, doc.id));
    await insertTestDocumentFiles(tx, doc, overrides.imageUrls ?? []);
    return doc.id;
  });
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
      await insertTestDocumentFiles(tx, document, content.imageUrls ?? []);
    }
    if (content.parsed === true && document.latestSubmissionRevisionId == null) {
      const [revision] = await tx
        .insert(schema.sourceDocumentRevisions)
        .values({
          ledgerId: document.ledgerId,
          sourceDocumentId,
          processingStatus: "completed",
          finishedAt: new Date(),
        })
        .returning({ id: schema.sourceDocumentRevisions.id });
      await tx
        .update(schema.sourceDocuments)
        .set({ latestSubmissionRevisionId: revision!.id })
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
