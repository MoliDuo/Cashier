import { describe, it, expect, beforeEach } from "vitest";
import { deleteLedgerEntryAction } from "@/modules/ledger/server-actions/entries";
import { getTestDb } from "../../setup";
import { ledgerEntries, ledgers } from "@/persistence";
import { eq } from "drizzle-orm";
import {
  createTestUserWithLedger,
  createTestSourceDocument,
  activateTestSourceDocumentProjection,
  TEST_USER_ID,
} from "../../helpers/schema-setup";

describe("Ledger Entry Delete Action", () => {
  let testLedgerId: string;
  let testEntryId: string;
  let testSourceDocId: string;

  beforeEach(async () => {
    const db = getTestDb();
    // Clean up existing ledger for TEST_USER_ID to avoid unique constraint
    await db.delete(ledgers);
    const { ledgerId } = await createTestUserWithLedger(db, undefined, "Test Ledger", TEST_USER_ID);
    testLedgerId = ledgerId;

    // Create a test source document for entries
    testSourceDocId = await createTestSourceDocument(db, testLedgerId);

    const [entry] = await db
      .insert(ledgerEntries)
      .values({
        ledgerId: testLedgerId,
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

  it("refuses every ledger once a second live one exists, which is the deployment's rule", async () => {
    const db = getTestDb();
    // This deployment serves one live ledger: `getLiveLedger` returns null as
    // soon as there are two, so the refusal below is the single-ledger rule
    // firing, not per-record scoping. Scoping is held at the aggregate, in
    // tests/integration/source-document/cross-ledger-access.test.ts, where a
    // second ledger does not disable the check being measured.
    await createTestUserWithLedger(
      db,
      "other@example.com",
      "Other Ledger",
      "11111111-1111-1111-1111-111111111111"
    );

    await expect(deleteLedgerEntryAction(testSourceDocId, testEntryId)).rejects.toThrow(
      "Ledger not found"
    );

    const survivor = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, testEntryId),
    });
    expect(survivor).toBeDefined();
  });
});
