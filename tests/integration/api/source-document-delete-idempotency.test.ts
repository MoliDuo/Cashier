import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { eq } from "drizzle-orm";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { ledgers, sourceDocuments } from "@/persistence";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
  TEST_USER_ID,
} from "../../helpers/schema-setup";
import { getTestDb } from "../../setup";

describe("SourceDocument delete idempotency", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers);
    ({ ledgerId } = await createTestUserWithLedger(db, undefined, "Test Ledger", TEST_USER_ID));
  });

  async function createDocument() {
    const db = getTestDb();
    const [document] = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: "2024-03-17",
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    if (document == null) throw new Error("Expected source document");
    await activateTestSourceDocumentProjection(db, document.id);
    return document;
  }

  it("deletes once without bumping the document version", async () => {
    const document = await createDocument();
    await expect(deleteSourceDocumentAction(document.id)).resolves.toEqual({
      sourceDocumentId: document.id,
      deleted: true,
    });
    const deleted = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, document.id),
    });
    expect(deleted?.deletedAt).not.toBeNull();
    expect(deleted?.version).toBe(document.version);
  });

  it("does not durably replay a lost delete response", async () => {
    const document = await createDocument();
    await deleteSourceDocumentAction(document.id);
    await expect(deleteSourceDocumentAction(document.id)).rejects.toThrow(NotFoundError);
    const deleted = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, document.id),
    });
    expect(deleted?.version).toBe(document.version);
  });
});
