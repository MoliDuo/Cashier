import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { getTestDb } from "tests/setup";
import { ledgers, sourceDocuments } from "@/persistence";
import { createTestUserWithLedger, TEST_USER_ID } from "tests/helpers/schema-setup";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
import { auth } from "@/auth";

describe("source-document delete tolerance", () => {
  let ledgerId = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: TEST_USER_ID, email: "test@example.com" },
      expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
    const db = getTestDb();
    await db.delete(ledgers);
    ({ ledgerId } = await createTestUserWithLedger(
      db,
      undefined,
      "Source Document Ledger",
      TEST_USER_ID
    ));
  });

  it("returns deleted false instead of throwing when the document is already soft deleted", async () => {
    const db = getTestDb();
    const [document] = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    await expect(
      deleteSourceDocumentAction(document!.id, document!.version)
    ).resolves.toMatchObject({
      ok: true,
      sourceDocumentId: document!.id,
      data: { deleted: true },
    });
    await expect(deleteSourceDocumentAction(document!.id, document!.version)).rejects.toThrow(
      NotFoundError
    );
  });
});
