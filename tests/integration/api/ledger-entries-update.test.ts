import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { batchUpdateLedgerEntriesAction } from "@/modules/ledger/server-actions/entries";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getTestDb } from "../../setup";
import {
  TEST_USER_ID,
  activateTestSourceDocumentProjection,
  createTestSourceDocument,
  createTestUserWithLedger,
} from "../../helpers/schema-setup";

/**
 * The transport's own job is to reject a malformed target before the aggregate
 * sees it. Proving that needs a ledger the caller really owns: without one the
 * access wrapper rejects first, and a bare "it threw" says nothing about which
 * guard fired.
 */
async function seedOwnedEntry() {
  const db = getTestDb();
  await db.delete(ledgers).where(eq(ledgers.userId, TEST_USER_ID));
  const { ledgerId } = await createTestUserWithLedger(db, undefined, "Test Ledger", TEST_USER_ID);
  const sourceDocumentId = await createTestSourceDocument(db, ledgerId);
  const [entry] = await db
    .insert(ledgerEntries)
    .values({
      ledgerId,
      sourceDocumentId,
      amount: "100.00",
      currency: "CNY",
      itemName: "Original",
    })
    .returning();
  if (entry == null) throw new Error("Expected the seeded ledger entry");
  await activateTestSourceDocumentProjection(db, sourceDocumentId);
  return { ledgerId, sourceDocumentId, entryId: entry.id };
}

describe("ledger entry update transport validation", () => {
  it("rejects a malformed version target before the aggregate is reached", async () => {
    const { entryId } = await seedOwnedEntry();
    const db = getTestDb();
    const before = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });

    const rejection = await batchUpdateLedgerEntriesAction(
      [{ sourceDocumentId: "not-a-uuid", expectedVersion: 1 }],
      [entryId],
      { itemName: "Updated" }
    ).catch((error: unknown) => error);

    // Not merely "it threw": the access wrapper would have thrown too, and it
    // would have meant the payload was never validated at all.
    expect(rejection).toBeInstanceOf(ValidationError);
    expect(rejection).not.toBeInstanceOf(NotFoundError);
    expect((rejection as ValidationError).code).toBe("VALIDATION_ERROR");
    expect((rejection as ValidationError).statusCode).toBe(400);

    const after = await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entryId) });
    expect(after?.itemName).toBe("Original");
    expect(after?.updatedAt).toEqual(before?.updatedAt);
  });

  it("rejects an entry id that is not an identifier without touching the document", async () => {
    const { sourceDocumentId } = await seedOwnedEntry();
    const db = getTestDb();
    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });

    const rejection = await batchUpdateLedgerEntriesAction(
      [{ sourceDocumentId, expectedVersion: 1 }],
      ["not-an-entry"],
      { itemName: "Updated" }
    ).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(ValidationError);
    // A rejected command must not burn a version, or the next optimistic write
    // from an untouched client would fail for a change that never happened.
    const after = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(after?.version).toBe(before?.version);
  });
});
