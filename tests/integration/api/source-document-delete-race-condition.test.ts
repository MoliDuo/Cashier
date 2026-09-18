import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { ledgers, sourceDocuments } from "@/persistence";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
  TEST_USER_ID,
} from "../../helpers/schema-setup";
import { getTestDb } from "../../setup";

describe("SourceDocument delete concurrency", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers).where(eq(ledgers.userId, TEST_USER_ID));
    ({ ledgerId } = await createTestUserWithLedger(db, undefined, "Test Ledger", TEST_USER_ID));
  });

  it("allows only one same-version delete to commit", async () => {
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
    const results = await Promise.allSettled([
      deleteSourceDocumentAction(ledgerId, document.id, 1),
      deleteSourceDocumentAction(ledgerId, document.id, 1),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const deleted = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, document.id),
    });
    expect(deleted?.version).toBe(2);
  });
});
