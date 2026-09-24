import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ZodError } from "zod";
import { batchUpdateSourceDocumentsAction } from "@/modules/source-document/server-actions/update";
import { getTestDb } from "../../setup";
import { currencyRates, ledgerEntries, sourceDocuments, ledgers } from "@/persistence";
import { createLedgerData, createSourceDocumentData } from "../../helpers/factories";
import { eq } from "drizzle-orm";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";
import * as exchangeRates from "@/modules/currency/server/exchange-rates";

// Mock auth module
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/auth";

describe("Source Document Update Actions", () => {
  const testUserId = "00000000-0000-0000-0000-000000000000";

  beforeEach(() => {
    vi.mocked(
      auth as unknown as () => Promise<{
        user: { id: string; email: string };
        expires: string;
      } | null>
    ).mockResolvedValue({
      user: { id: testUserId, email: "test@example.com" },
      expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
  });

  describe("batchUpdateSourceDocumentsAction", () => {
    it("converts only changed dates in a mixed batch and preserves metadata-only FX", async () => {
      const db = getTestDb();
      const ledger = createLedgerData({ mainCurrency: "USD" });
      await db.insert(ledgers).values(ledger);
      await ensureTestLedgerBooks(db, ledger.id);
      const documents = ["2024-03-14", "2024-03-15"].map((documentDate) =>
        createSourceDocumentData(ledger.id, { status: "completed", documentDate })
      );
      await db.insert(sourceDocuments).values(
        documents.map((document) => ({
          ...document,
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${document.ledgerId} ORDER BY sort_order LIMIT 1)`,
        }))
      );
      const ids = documents.map(() => crypto.randomUUID());
      for (const [index, document] of documents.entries()) {
        await db.insert(ledgerEntries).values({
          id: ids[index]!,
          ledgerId: ledger.id,
          sourceDocumentId: document.id,
          amount: "100",
          currency: "MYR",
          itemName: "Fictional item",
          convertedAmount: "23",
          exchangeRate: "0.23",
        });
        await activateTestSourceDocumentProjection(db, document.id);
      }
      const convert = vi
        .spyOn(exchangeRates, "convertAmounts")
        .mockResolvedValue([{ convertedAmount: "24", exchangeRate: "0.24" }]);
      try {
        await batchUpdateSourceDocumentsAction({
          targets: documents.map((document) => ({
            sourceDocumentId: document.id,
            expectedVersion: 1,
          })),
          data: { documentDate: "2024-03-15", title: "Updated title" },
        });
        expect(convert).toHaveBeenCalledExactlyOnceWith(
          [{ amount: "100.000", from: "MYR", date: "2024-03-15" }],
          "USD"
        );
        expect(
          await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, ids[0]!) })
        ).toMatchObject({ convertedAmount: "24.000" });
        expect(
          await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, ids[1]!) })
        ).toMatchObject({ convertedAmount: "23.000", exchangeRate: "0.230000000000" });
      } finally {
        convert.mockRestore();
      }
    });
    it("does not prepare FX or advance the version when the date is unchanged", async () => {
      const db = getTestDb();
      const ledger = createLedgerData({ mainCurrency: "USD" });
      await db.insert(ledgers).values(ledger);
      await ensureTestLedgerBooks(db, ledger.id);
      const document = createSourceDocumentData(ledger.id, {
        status: "completed",
        documentDate: "2024-03-14",
      });
      await db.insert(sourceDocuments).values({
        ...document,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${document.ledgerId} ORDER BY sort_order LIMIT 1)`,
      });
      await activateTestSourceDocumentProjection(db, document.id);
      const convert = vi.spyOn(exchangeRates, "convertAmounts");
      try {
        await batchUpdateSourceDocumentsAction({
          targets: [{ sourceDocumentId: document.id, expectedVersion: 1 }],
          data: { documentDate: "2024-03-14" },
        });
        expect(convert).not.toHaveBeenCalled();
        expect(
          await db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, document.id) })
        ).toMatchObject({ version: 1 });
      } finally {
        convert.mockRestore();
      }
    });
    it("should batch update multiple source documents", async () => {
      const db = getTestDb();
      const ledgerData = createLedgerData();
      await db.insert(ledgers).values(ledgerData);
      await ensureTestLedgerBooks(db, ledgerData.id);

      // Create multiple documents
      const docData1 = createSourceDocumentData(ledgerData.id);
      const docData2 = createSourceDocumentData(ledgerData.id);
      await db.insert(sourceDocuments).values([
        {
          ...docData1,
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${docData1.ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ...docData2,
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${docData2.ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
      ]);
      await activateTestSourceDocumentProjection(db, docData1.id);
      await activateTestSourceDocumentProjection(db, docData2.id);

      // Batch update
      await batchUpdateSourceDocumentsAction({
        targets: [docData1, docData2].map((document) => ({
          sourceDocumentId: document.id,
          expectedVersion: 1,
        })),
        data: { title: "Updated documents" },
      });

      // Verify updates
      const updated1 = await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, docData1.id),
      });
      const updated2 = await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, docData2.id),
      });

      expect(updated1?.title).toBe("Updated documents");
      expect(updated2?.title).toBe("Updated documents");
    });

    it("recalculates active entry conversions using the new historical date", async () => {
      const db = getTestDb();
      const ledgerData = createLedgerData({ mainCurrency: "USD" });
      await db.insert(ledgers).values(ledgerData);
      await ensureTestLedgerBooks(db, ledgerData.id);
      const document = createSourceDocumentData(ledgerData.id, {
        status: "completed",
        documentDate: "2024-03-14",
      });
      await db.insert(sourceDocuments).values({
        ...document,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${document.ledgerId} ORDER BY sort_order LIMIT 1)`,
      });
      const entryId = crypto.randomUUID();
      await db.insert(ledgerEntries).values({
        id: entryId,
        ledgerId: ledgerData.id,
        sourceDocumentId: document.id,
        amount: "100",
        currency: "CNY",
        itemName: "Historical item",
        convertedAmount: "20",
        exchangeRate: "0.2",
      });
      await activateTestSourceDocumentProjection(db, document.id);
      await db
        .insert(currencyRates)
        .values({
          date: "2024-03-15",
          base: "EUR",
          rates: { EUR: 1, USD: 1, CNY: 10 },
        })
        .onConflictDoNothing();

      await batchUpdateSourceDocumentsAction({
        targets: [{ sourceDocumentId: document.id, expectedVersion: 1 }],
        data: { documentDate: "2024-03-15" },
      });

      const [updatedDocument, updatedEntry] = await Promise.all([
        db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, document.id) }),
        db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entryId) }),
      ]);
      expect(updatedDocument?.documentDate).toBe("2024-03-15");
      expect(updatedEntry?.convertedAmount).toBe("10.000");
      expect(updatedEntry?.exchangeRate).toBe("0.100000000000");
    });

    it("rejects an empty batch", async () => {
      const db = getTestDb();
      const ledgerData = createLedgerData();
      await db.insert(ledgers).values(ledgerData);
      await ensureTestLedgerBooks(db, ledgerData.id);

      await expect(
        batchUpdateSourceDocumentsAction({
          targets: [],
          data: { title: "Ignored" },
        })
      ).rejects.toThrow(ZodError);
    });

    it("treats an already-matching title as a no-op: zero writes, version unchanged", async () => {
      const db = getTestDb();
      const ledgerData = createLedgerData();
      await db.insert(ledgers).values(ledgerData);
      await ensureTestLedgerBooks(db, ledgerData.id);
      const docData = createSourceDocumentData(ledgerData.id, { title: "Same title" });
      await db.insert(sourceDocuments).values({
        ...docData,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${docData.ledgerId} ORDER BY sort_order LIMIT 1)`,
      });
      await activateTestSourceDocumentProjection(db, docData.id);

      const result = await batchUpdateSourceDocumentsAction({
        targets: [{ sourceDocumentId: docData.id, expectedVersion: 1 }],
        data: { title: "Same title" },
      });

      expect(result).toMatchObject({
        ok: true,
        versions: [{ sourceDocumentId: docData.id, version: 1 }],
        data: { updatedCount: 0 },
      });
      const document = await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, docData.id),
      });
      expect(document?.version).toBe(1);
    });

    it("rolls back the whole batch — including the non-stale document — when one target is stale", async () => {
      const db = getTestDb();
      const ledgerData = createLedgerData();
      await db.insert(ledgers).values(ledgerData);
      await ensureTestLedgerBooks(db, ledgerData.id);
      const okDoc = createSourceDocumentData(ledgerData.id, { title: "Original A" });
      const staleDoc = createSourceDocumentData(ledgerData.id, { title: "Original B" });
      await db.insert(sourceDocuments).values([
        {
          ...okDoc,
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${okDoc.ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ...staleDoc,
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${staleDoc.ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
      ]);
      // Advance staleDoc's version out from under the caller's expectation.
      await db
        .update(sourceDocuments)
        .set({ version: 2 })
        .where(eq(sourceDocuments.id, staleDoc.id));

      const result = await batchUpdateSourceDocumentsAction({
        targets: [
          { sourceDocumentId: okDoc.id, expectedVersion: 1 },
          { sourceDocumentId: staleDoc.id, expectedVersion: 1 },
        ],
        data: { title: "Batch title" },
      });

      expect(result).toMatchObject({
        ok: false,
        reason: "stale",
        staleTargets: [{ sourceDocumentId: staleDoc.id, expectedVersion: 1, currentVersion: 2 }],
      });
      // The non-stale document's write is rolled back too — atomic, not partial.
      const okDocument = await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, okDoc.id),
      });
      expect(okDocument?.title).toBe("Original A");
      expect(okDocument?.version).toBe(1);
    });
  });
});
