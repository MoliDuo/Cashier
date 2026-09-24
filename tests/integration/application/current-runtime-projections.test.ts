import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { postgresLedgerProjectionAdapter } from "@/application/adapters/postgres";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import { postgresSourceDocumentAggregateAdapter } from "@/application/adapters/postgres/source-document-aggregate";

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
  it("creates and edits manual projections, recalculates atomically, and soft deletes", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const created = await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
      ledgerId,
      title: "Manual",
      entryDate: "2026-07-15",
      entries: [projectionEntry],
      bookId: await testBookId(db, ledgerId),
    });
    const originalEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.sourceDocumentRevisionId, created.revisionId),
    });
    expect(originalEntry).toBeDefined();

    const edited = await postgresSourceDocumentAggregateAdapter.saveChanges({
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      expectedVersion: 1,
      sourceDocument: { title: "Edited" },
      entries: [{ ledgerEntryId: originalEntry!.id, data: { amount: "18.00" } }],
    });
    expect(edited.ok).toBe(true);
    const replacementRevisionId = (await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    }))!.activeRevisionId!;
    const replacementEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.sourceDocumentRevisionId, replacementRevisionId),
    });
    expect(replacementEntry?.amount).toBe("18.000");
    expect(replacementEntry?.id).toBe(originalEntry!.id);
    expect(
      await db.query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.sourceDocumentRevisionId, created.revisionId),
      })
    ).toMatchObject({ amount: "18.000", deletedAt: null });

    const beforeRecalculation = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });

    await expect(
      postgresLedgerProjectionAdapter.recalculate({
        ledgerId,
        updates: [
          {
            ledgerEntryId: replacementEntry!.id,
            convertedAmount: "2.50",
            exchangeRate: "0.138889",
          },
        ],
      })
    ).resolves.toBe(1);
    const afterRecalculation = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    expect(afterRecalculation?.version).toBe(beforeRecalculation!.version + 1);
    expect(afterRecalculation!.updatedAt.getTime()).toBeGreaterThan(
      beforeRecalculation!.updatedAt.getTime()
    );

    await expect(
      postgresLedgerProjectionAdapter.recalculate({
        ledgerId,
        updates: [
          {
            ledgerEntryId: replacementEntry!.id,
            convertedAmount: "2.50",
            exchangeRate: "0.138889",
          },
        ],
      })
    ).resolves.toBe(0);
    const afterNoopRecalculation = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    expect(afterNoopRecalculation?.version).toBe(afterRecalculation?.version);
    expect(afterNoopRecalculation?.updatedAt).toEqual(afterRecalculation?.updatedAt);

    await expect(
      postgresLedgerProjectionAdapter.softDelete(ledgerId, created.sourceDocumentId)
    ).resolves.toBe(true);
    const deleted = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    expect(deleted).toMatchObject({ deletedAt: expect.any(Date) });
    expect(
      (
        await db.query.ledgerEntries.findFirst({
          where: eq(ledgerEntries.id, replacementEntry!.id),
        })
      )?.deletedAt
    ).not.toBeNull();
  });
});
