import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTestDb } from "../../setup";
import { ledgers, ledgerEntries, sourceDocumentRevisions } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

const { getRatesMock, convertBatchMock } = vi.hoisted(() => ({
  getRatesMock: vi.fn(async () => ({
    base: "USD",
    date: "2026-01-01",
    rates: { CNY: 1 } as Record<string, number>,
  })),
  convertBatchMock: vi.fn(),
}));

vi.mock("@/application/adapters/postgres/exchange-rate", () => {
  const rateBook = {
    getRates: getRatesMock,
    convertBatch: convertBatchMock,
  };
  return { ExchangeRateService: rateBook, postgresFxRateBook: rateBook, fetchWithRetry: vi.fn() };
});
import { batchDeleteLedgerEntriesAction } from "@/modules/ledger/server-actions/entries";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

async function seedDoc(db: ReturnType<typeof getTestDb>, ledgerId: string, entryDate?: string) {
  const [doc] = await db
    .insert(sourceDocuments)
    .values({
      id: randomUUID(),
      ledgerId,
      documentDate: entryDate ?? null,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    })
    .returning();
  expect(doc).toBeDefined();
  if (doc === undefined) {
    throw new Error("Expected source document insert to return a row");
  }
  await activateTestSourceDocumentProjection(db, doc.id);
  return doc;
}

describe("batchDeleteLedgerEntriesAction", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    ledgerId = randomUUID();
    await db.insert(ledgers).values({
      id: ledgerId,
      userId: TEST_USER_ID,
      mainCurrency: "CNY",
    });
    await ensureTestLedgerBooks(db, ledgerId);
  });

  it("deletes multiple entries from one document without creating a revision", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, ledgerId);
    const entries = await db
      .insert(ledgerEntries)
      .values(
        [10, 20, 30].map((amount, index) => ({
          id: randomUUID(),
          ledgerId,
          sourceDocumentId: doc.id,
          itemName: `Item ${index}`,
          amount: String(amount),
          currency: "CNY",
          convertedAmount: String(amount),
        }))
      )
      .returning();
    await activateTestSourceDocumentProjection(db, doc.id);

    const beforeRevisionCount = await db
      .select({ id: sourceDocumentRevisions.id })
      .from(sourceDocumentRevisions)
      .where(eq(sourceDocumentRevisions.sourceDocumentId, doc.id));
    const result = await batchDeleteLedgerEntriesAction(
      [{ sourceDocumentId: doc.id, expectedVersion: 1 }],
      entries.slice(0, 2).map((entry) => entry.id)
    );

    expect(result.succeeded.map((item) => item.id).sort()).toEqual(
      entries
        .slice(0, 2)
        .map((entry) => entry.id)
        .sort()
    );
    expect(result.failed).toHaveLength(0);
    const afterRevisionCount = await db
      .select({ id: sourceDocumentRevisions.id })
      .from(sourceDocumentRevisions)
      .where(eq(sourceDocumentRevisions.sourceDocumentId, doc.id));
    expect(afterRevisionCount).toHaveLength(beforeRevisionCount.length);

    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, doc.id),
    });
    const activeEntries = await db.query.ledgerEntries.findMany({
      where: and(
        eq(ledgerEntries.sourceDocumentId, doc.id),
        eq(ledgerEntries.sourceDocumentRevisionId, document!.activeRevisionId!),
        isNull(ledgerEntries.deletedAt)
      ),
    });
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0]?.itemName).toBe("Item 2");
  });

  it("reports entries of a document without an active projection as not found", async () => {
    const db = getTestDb();
    const [doc] = await db
      .insert(sourceDocuments)
      .values({
        id: randomUUID(),
        ledgerId,
        documentDate: null,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    expect(doc).toBeDefined();
    const entries = await db
      .insert(ledgerEntries)
      .values(
        [10, 20].map((amount, index) => ({
          id: randomUUID(),
          ledgerId,
          sourceDocumentId: doc!.id,
          itemName: `Orphan ${index}`,
          amount: String(amount),
          currency: "CNY",
          convertedAmount: String(amount),
        }))
      )
      .returning();

    const result = await batchDeleteLedgerEntriesAction(
      [{ sourceDocumentId: doc!.id, expectedVersion: 1 }],
      entries.map((entry) => entry.id)
    );

    // The document has no active projection, so the entries cannot be deleted.
    // The per-entry delete path reports this as a failure instead of a silent skip.
    expect(result.succeeded).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.failed.map((failure) => failure.id).sort()).toEqual(
      entries.map((entry) => entry.id).sort()
    );
    expect(result.failed[0]?.code).toBe("NOT_FOUND");
  });

  it("commits one document's deletion independently of another document's failure in the same batch", async () => {
    const db = getTestDb();
    const okDoc = await seedDoc(db, ledgerId);
    const badDoc = await seedDoc(db, ledgerId);
    const [okEntry] = await db
      .insert(ledgerEntries)
      .values({
        id: randomUUID(),
        ledgerId,
        sourceDocumentId: okDoc.id,
        itemName: "Keeper's sibling",
        amount: "10",
        currency: "CNY",
        convertedAmount: "10",
      })
      .returning();
    await activateTestSourceDocumentProjection(db, okDoc.id);
    // A ledger entry that does not belong to `badDoc`'s active projection —
    // this group's transaction throws, so it must land in `failed`.
    const foreignEntryId = randomUUID();

    const result = await batchDeleteLedgerEntriesAction(
      [
        { sourceDocumentId: okDoc.id, expectedVersion: 1 },
        { sourceDocumentId: badDoc.id, expectedVersion: 1 },
      ],
      [okEntry!.id, foreignEntryId]
    );

    expect(result.succeeded).toEqual([{ id: okEntry!.id, sourceDocumentId: okDoc.id, version: 2 }]);
    expect(result.stale).toEqual([]);
    expect(result.failed).toEqual([{ id: foreignEntryId, code: "NOT_FOUND" }]);

    const okDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, okDoc.id),
    });
    expect(okDocument?.version).toBe(2);
    const badDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, badDoc.id),
    });
    // `badDoc` was never targeted by a real write — its own group failed
    // before touching its document row.
    expect(badDocument?.version).toBe(1);
  });

  it("rolls back every entry in one document's group when part of that group fails", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, ledgerId);
    const entries = await db
      .insert(ledgerEntries)
      .values(
        [10, 20].map((amount, index) => ({
          id: randomUUID(),
          ledgerId,
          sourceDocumentId: doc.id,
          itemName: `Group item ${index}`,
          amount: String(amount),
          currency: "CNY",
          convertedAmount: String(amount),
        }))
      )
      .returning();
    await activateTestSourceDocumentProjection(db, doc.id);
    // A second, non-active revision plus a real, non-deleted ledger entry
    // linked to it: the entry groups with the document's other entries (same
    // `sourceDocumentId`, not deleted, so it passes the ownership check) but
    // is absent from the *active* projection the group's transaction reads —
    // so the whole group's transaction fails, not just this one id.
    const [otherRevision] = await db
      .insert(sourceDocumentRevisions)
      .values({
        ledgerId,
        sourceDocumentId: doc.id,
        revisionNumber: 2,
        processingStatus: "cancelled",
      })
      .returning();
    const [inactiveEntry] = await db
      .insert(ledgerEntries)
      .values({
        id: randomUUID(),
        ledgerId,
        sourceDocumentId: doc.id,
        sourceDocumentRevisionId: otherRevision!.id,
        itemName: "Not on the active revision",
        amount: "5",
        currency: "CNY",
        convertedAmount: "5",
      })
      .returning();

    const result = await batchDeleteLedgerEntriesAction(
      [{ sourceDocumentId: doc.id, expectedVersion: 1 }],
      [...entries.map((entry) => entry.id), inactiveEntry!.id]
    );

    expect(result.succeeded).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.failed.map((failure) => failure.id).sort()).toEqual(
      [...entries.map((entry) => entry.id), inactiveEntry!.id].sort()
    );

    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, doc.id),
    });
    // Zero writes: the document's version and active entries are untouched.
    expect(document?.version).toBe(1);
    const activeEntries = await db.query.ledgerEntries.findMany({
      where: and(
        eq(ledgerEntries.sourceDocumentId, doc.id),
        eq(ledgerEntries.sourceDocumentRevisionId, document!.activeRevisionId!)
      ),
    });
    expect(activeEntries.map((entry) => entry.id).sort()).toEqual(
      entries.map((entry) => entry.id).sort()
    );
  });
});
