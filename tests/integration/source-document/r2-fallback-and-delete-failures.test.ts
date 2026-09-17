import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
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
    await db.delete(ledgers).where(eq(ledgers.userId, TEST_USER_ID));
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
        attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${ledgerId})`,
      })
      .returning();
    await expect(
      deleteSourceDocumentAction(ledgerId, document!.id, document!.version)
    ).resolves.toMatchObject({
      ok: true,
      sourceDocumentId: document!.id,
      data: { deleted: true },
    });
    await expect(
      deleteSourceDocumentAction(ledgerId, document!.id, document!.version)
    ).rejects.toThrow();
  });
});
