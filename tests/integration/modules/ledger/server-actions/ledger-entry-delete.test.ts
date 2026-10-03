import { describe, it, expect, beforeEach } from "vitest";
import { deleteLedgerEntryAction } from "@/modules/ledger/server-actions/entries";
import { getTestDb } from "tests/setup";
import { ledgerEntries, ledgers } from "@/persistence";
import { eq } from "drizzle-orm";
import {
  createTestLedger,
  createTestSourceDocument,
  activateTestSourceDocumentProjection,
} from "tests/helpers/schema-setup";

describe("Ledger Entry Delete Action", () => {
  let testEntryId: string;
  let testSourceDocId: string;

  beforeEach(async () => {
    const db = getTestDb();
    // Clean up the existing ledger to avoid the singleton constraint
    await db.delete(ledgers);
    await createTestLedger(db);

    // Create a test source document for entries
    testSourceDocId = await createTestSourceDocument(db);

    const [entry] = await db
      .insert(ledgerEntries)
      .values({
        sourceDocumentId: testSourceDocId,
        amount: "100",
        currency: "CNY",
        itemName: "Delete Me",
      })
      .returning();
    expect(entry).toBeDefined();
    if (entry == null) {
      throw new Error("Expected ledger entry to be created");
    }
    testEntryId = entry.id;
    await activateTestSourceDocumentProjection(db, testSourceDocId);
  });

  it("should delete a ledger entry", async () => {
    await deleteLedgerEntryAction(testSourceDocId, testEntryId);

    const db = getTestDb();
    const deletedEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, testEntryId),
    });
    expect(deletedEntry).toBeUndefined();
  });
});
