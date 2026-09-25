import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { ledgerEntries, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import { createManualDocument } from "@/modules/source-document/server/projections/writes";
import { deleteSourceDocumentAtomically } from "@/modules/source-document/server/delete";
import { saveSourceDocumentChanges } from "@/modules/source-document/server/updates";

const projectionEntry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.50",
  exchangeRate: "1.000000",
} as const;

describe("current-runtime target adapters", () => {
  it("creates and edits manual projections, and deletes through the aggregate", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const created = await createManualDocument({
      ledgerId,
      title: "Manual",
      entryDate: "2026-07-15",
      entries: [projectionEntry],
      bookId: await testBookId(db, ledgerId),
    });
    const originalEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId),
    });
    expect(originalEntry).toBeDefined();
    expect(
      await db.query.sourceDocumentRevisions.findMany({
        where: eq(sourceDocumentRevisions.sourceDocumentId, created.sourceDocumentId),
      })
    ).toEqual([]);

    const edited = await saveSourceDocumentChanges({
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      expectedVersion: 1,
      sourceDocument: { title: "Edited" },
      entries: [{ ledgerEntryId: originalEntry!.id, data: { amount: "18.00" } }],
    });
    expect(edited.ok).toBe(true);
    const replacementEntries = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId),
    });
    expect(replacementEntries).toHaveLength(1);
    const replacementEntry = replacementEntries[0];
    expect(replacementEntry).toMatchObject({
      id: originalEntry!.id,
      amount: "18.000",
      deletedAt: null,
    });

    await expect(
      deleteSourceDocumentAtomically({
        ledgerId,
        sourceDocumentId: created.sourceDocumentId,
      })
    ).resolves.toMatchObject({ deleted: true });
    expect(
      await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, created.sourceDocumentId),
      })
    ).toBeUndefined();
    expect(
      await db.query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.id, replacementEntry!.id),
      })
    ).toBeUndefined();
  });
});
