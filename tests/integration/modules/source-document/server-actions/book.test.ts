import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestSourceDocument, createTestUserWithLedger } from "tests/helpers/schema-setup";
import { books, ledgers, sourceDocuments } from "@/persistence";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assignSourceDocumentBookAction } from "@/modules/source-document/server-actions/book";

/**
 * The ways moving a record between books can fail are told apart, because the
 * reader's next action differs: pick another book for a retired one, and
 * nothing at all for a record that is gone.
 */
describe("assignSourceDocumentBookAction", () => {
  let ledgerId = "";
  let documentId = "";
  let targetBookId = "";

  async function bookOf(id: string) {
    const row = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, id),
    });
    return row?.bookId;
  }

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers);
    ({ ledgerId } = await createTestUserWithLedger(db));
    documentId = await createTestSourceDocument(db, ledgerId);
    const [target] = await db
      .insert(books)
      .values({ ledgerId, name: "哞哞的", sortOrder: 2 })
      .returning({ id: books.id });
    targetBookId = target!.id;
  });

  it("moves the record and returns the book it now belongs to", async () => {
    await expect(
      assignSourceDocumentBookAction({ sourceDocumentId: documentId, bookId: targetBookId })
    ).resolves.toEqual({ bookId: targetBookId });
    expect(await bookOf(documentId)).toBe(targetBookId);
  });

  it("reports a book archived under the reader as a validation failure", async () => {
    const db = getTestDb();
    const before = await bookOf(documentId);
    await db.update(books).set({ archivedAt: new Date() }).where(eq(books.id, targetBookId));

    await expect(
      assignSourceDocumentBookAction({ sourceDocumentId: documentId, bookId: targetBookId })
    ).rejects.toThrow(ValidationError);
    expect(await bookOf(documentId)).toBe(before);
  });

  it("reports a record that is gone as not found", async () => {
    await expect(
      assignSourceDocumentBookAction({
        sourceDocumentId: "00000000-0000-4000-8000-000000000001",
        bookId: targetBookId,
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects the removed expectedVersion field without moving anything", async () => {
    const before = await bookOf(documentId);

    await expect(
      assignSourceDocumentBookAction({
        sourceDocumentId: documentId,
        bookId: targetBookId,
        expectedVersion: 3,
      })
    ).rejects.toThrow(ValidationError);
    expect(await bookOf(documentId)).toBe(before);
  });
});
