import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ZodError } from "zod";
import { ConflictError } from "@/lib/errors";
import { batchUpdateSourceDocumentsAction } from "@/modules/source-document/server-actions/update";
import { getTestDb } from "../../setup";
import { ledgerEntries, sourceDocuments, ledgers } from "@/persistence";
import { createLedgerData, createSourceDocumentData } from "../../helpers/factories";
import { eq } from "drizzle-orm";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";
import { insertExchangeRates } from "../../helpers/exchange-rates";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";

async function convertedAmountsById(ledgerId: string) {
  const page = await listStreamPage(ledgerId, { limit: 20 });
  return new Map(
    page.items.flatMap((item) =>
      (item.ledgerEntries ?? []).map((entry) => [entry.id, entry.convertedAmount] as const)
    )
  );
}

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
    it("reads every re-dated entry at its document's new day's rate", async () => {
      const db = getTestDb();
      const ledger = createLedgerData({ mainCurrency: "USD" });
      await db.insert(ledgers).values(ledger);
      await ensureTestLedgerBooks(db, ledger.id);
      await insertExchangeRates("2024-03-14", { USD: "1.15", MYR: "5" });
      await insertExchangeRates("2024-03-15", { USD: "1.2", MYR: "5" });
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
        });
        await activateTestSourceDocumentProjection(db, document.id);
      }
      expect(await convertedAmountsById(ledger.id)).toEqual(
        new Map([
          [ids[0]!, "23.00"],
          [ids[1]!, "24.00"],
        ])
      );

      await batchUpdateSourceDocumentsAction({
        sourceDocumentIds: documents.map((document) => document.id),
        data: { documentDate: "2024-03-15", title: "Updated title" },
      });

      expect(await convertedAmountsById(ledger.id)).toEqual(
        new Map([
          [ids[0]!, "24.00"],
          [ids[1]!, "24.00"],
        ])
      );
    });
    it("does not ask for rates or advance the version when the date is unchanged", async () => {
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
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      try {
        await batchUpdateSourceDocumentsAction({
          sourceDocumentIds: [document.id],
          data: { documentDate: "2024-03-14" },
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(
          await db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, document.id) })
        ).toMatchObject({ version: 1 });
      } finally {
        fetchSpy.mockRestore();
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
        sourceDocumentIds: [docData1.id, docData2.id],
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

    it("reads active entries converted at the new historical date", async () => {
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
      });
      await activateTestSourceDocumentProjection(db, document.id);
      await insertExchangeRates("2024-03-15", { USD: 1, CNY: 10 });

      await batchUpdateSourceDocumentsAction({
        sourceDocumentIds: [document.id],
        data: { documentDate: "2024-03-15" },
      });

      const updatedDocument = await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, document.id),
      });
      expect(updatedDocument?.documentDate).toBe("2024-03-15");
      expect((await convertedAmountsById(ledgerData.id)).get(entryId)).toBe("10.00");
    });

    it("rejects an empty batch", async () => {
      const db = getTestDb();
      const ledgerData = createLedgerData();
      await db.insert(ledgers).values(ledgerData);
      await ensureTestLedgerBooks(db, ledgerData.id);

      await expect(
        batchUpdateSourceDocumentsAction({
          sourceDocumentIds: [],
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
        sourceDocumentIds: [docData.id],
        data: { title: "Same title" },
      });

      expect(result).toEqual({ sourceDocumentIds: [docData.id], updatedCount: 0 });
      const document = await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, docData.id),
      });
      expect(document?.version).toBe(1);
    });

    it("rejects the whole batch, leaving every document untouched, when one is deleted", async () => {
      const db = getTestDb();
      const ledgerData = createLedgerData();
      await db.insert(ledgers).values(ledgerData);
      await ensureTestLedgerBooks(db, ledgerData.id);
      const okDoc = createSourceDocumentData(ledgerData.id, { title: "Original A" });
      const deletedDoc = createSourceDocumentData(ledgerData.id, { title: "Original B" });
      await db.insert(sourceDocuments).values([
        {
          ...okDoc,
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${okDoc.ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ...deletedDoc,
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${deletedDoc.ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
      ]);
      await activateTestSourceDocumentProjection(db, okDoc.id);
      await activateTestSourceDocumentProjection(db, deletedDoc.id);
      await db
        .update(sourceDocuments)
        .set({ deletedAt: new Date() })
        .where(eq(sourceDocuments.id, deletedDoc.id));

      await expect(
        batchUpdateSourceDocumentsAction({
          sourceDocumentIds: [okDoc.id, deletedDoc.id],
          data: { title: "Batch title" },
        })
      ).rejects.toThrow(ConflictError);
      const okDocument = await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, okDoc.id),
      });
      expect(okDocument?.title).toBe("Original A");
      expect(okDocument?.version).toBe(1);
    });
  });
});
