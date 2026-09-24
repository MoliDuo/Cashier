import { claimRevisionForTest } from "tests/helpers/processing-revision";
import { postgresSourceDocumentAggregateAdapter } from "@/application/adapters/postgres/source-document-aggregate";
import { createPendingRevision } from "tests/helpers/processing-revision";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  postgresLedgerProjectionAdapter,
  postgresRevisionAdapter,
} from "@/application/adapters/postgres";
import { calculateLedgerStats as calculateLedgerStatsUseCase } from "@/modules/ledger/application/queries/calculate-ledger-stats";
import { listLedgerEntries as listLedgerEntriesUseCase } from "@/modules/ledger/application/queries/list-ledger-entries";
import { getEnhancedStatsQuery } from "@/modules/stats/application/queries/get-enhanced-stats";
import { listStreamPage as listStreamPageUseCase } from "@/modules/source-document/application/queries/list-stream-page";
import { serverComposition } from "@/application/server-composition-root";
import {
  entryCategories,
  ledgerEntries,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { getTestDb } from "../../setup";

const findVisibleEntry = async (id: string, ledgerId: string) => {
  const page = await serverComposition.ledgerReads.listEntries({
    ledgerId,
    limit: 100,
    filters: {},
  });
  return page.items.find((entry) => entry.id === id) ?? null;
};
const listLedgerEntries = (
  ledgerId: string,
  input: Parameters<typeof listLedgerEntriesUseCase>[1]
) => listLedgerEntriesUseCase(ledgerId, input, serverComposition.ledgerReads);
const calculateLedgerStats = (
  ledgerId: string,
  query: Parameters<typeof calculateLedgerStatsUseCase>[1] = {}
) => calculateLedgerStatsUseCase(ledgerId, query, serverComposition.ledgerReads);
async function currentVersion(sourceDocumentId: string): Promise<number> {
  const db = getTestDb();
  const row = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
    columns: { version: true },
  });
  if (row == null) throw new Error("Source document not found");
  return row.version;
}
const listStreamPage = (ledgerId: string, input: Parameters<typeof listStreamPageUseCase>[1]) =>
  listStreamPageUseCase(ledgerId, input, {
    documents: serverComposition.sourceDocumentReads,
    ledgerReads: serverComposition.ledgerReads,
    changes: serverComposition.ledgerChanges,
  });

const entry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.50",
  exchangeRate: "1.000000",
} as const;

describe("target upper workflows", () => {
  it("uses persisted list state and paginates without skips", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const completed = await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
      ledgerId,
      entryDate: "2026-07-15",
      entries: [entry],
      bookId: await testBookId(db, ledgerId),
    });
    expect(
      await db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.id, completed.revisionId),
      })
    ).toMatchObject({ revisionNumber: null });
    // Simulate a historical revision: later submissions must preserve its number.
    await db
      .update(sourceDocumentRevisions)
      .set({ revisionNumber: 7 })
      .where(eq(sourceDocumentRevisions.id, completed.revisionId));
    const pending = await createPendingRevision({
      ledgerId,
      input: { text: "pending", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    const failedSubmission = await createPendingRevision({
      ledgerId,
      sourceDocumentId: completed.sourceDocumentId,
      input: { text: "failed retry", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    expect(
      await db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.id, failedSubmission.revision.id),
      })
    ).toMatchObject({ revisionNumber: null });
    expect(
      await db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.id, completed.revisionId),
      })
    ).toMatchObject({ revisionNumber: 7 });
    await postgresRevisionAdapter.recordProcessingFailure({
      lease: await claimRevisionForTest(failedSubmission.revision.id),
      ledgerId,
      sourceDocumentId: completed.sourceDocumentId,
      revisionId: failedSubmission.revision.id,
      failureKind: "processing_error",
      failureMessage: "processing failed",
    });

    const first = await listStreamPage(ledgerId, { limit: 1 });
    const second = await listStreamPage(ledgerId, {
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(first.nextCursor).not.toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id))).toEqual(
      new Set([completed.sourceDocumentId, pending.document.id])
    );
    expect(
      [...first.items, ...second.items].find((item) => item.id === completed.sourceDocumentId)
        ?.processingStatus
    ).toBe("failed");
    expect(
      [...first.items, ...second.items].find((item) => item.id === pending.document.id)
        ?.processingStatus
    ).toBe("processing");
  });

  it("keeps Stream, Details, and Stats on the same active projection", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const [category] = await db
      .insert(entryCategories)
      .values({ ledgerId, name: "Food" })
      .returning();
    const created = await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
      ledgerId,
      entryDate: "2026-07-15",
      entries: [{ ...entry, categoryId: category!.id }],
      bookId: await testBookId(db, ledgerId),
    });
    const activeEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.sourceDocumentRevisionId, created.revisionId),
    });
    const failedPending = await createPendingRevision({
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      input: { text: "failed replacement", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    await postgresRevisionAdapter.recordProcessingFailure({
      lease: await claimRevisionForTest(failedPending.revision.id),
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      revisionId: failedPending.revision.id,
      failureKind: "processing_error",
      failureMessage: "processing failed",
    });

    const stream = await listLedgerEntries(ledgerId, { limit: 20 });
    const detail = await findVisibleEntry(activeEntry!.id, ledgerId);
    const summary = await calculateLedgerStats(ledgerId, {
      startDate: "2026-07-15",
      endDate: "2026-07-15",
    });
    const enhanced = await getEnhancedStatsQuery(
      {
        ledgerId,
        queryRange: { from: "2026-07-15", to: "2026-07-15" },
        compareRange: { from: "2026-07-14", to: "2026-07-14" },
      },
      serverComposition.stats
    );

    expect(stream.items).toHaveLength(1);
    expect(stream.items[0]).toMatchObject({
      id: activeEntry!.id,
      amount: "12.500",
      currency: "CNY",
      categoryId: category!.id,
    });
    expect(detail).toMatchObject({
      id: activeEntry!.id,
      sourceDocumentId: created.sourceDocumentId,
      amount: stream.items[0]!.amount,
      currency: stream.items[0]!.currency,
      convertedAmount: stream.items[0]!.convertedAmount,
      exchangeRate: stream.items[0]!.exchangeRate,
      categoryId: stream.items[0]!.categoryId,
      sourceDocument: expect.objectContaining({ id: created.sourceDocumentId }),
    });
    expect(stream.items[0]?.sourceDocument).not.toHaveProperty("text");
    expect(summary.convertedTotal).toEqual({ total: "12.5", currency: "CNY" });
    expect(enhanced.summary).toMatchObject({ total: "12.5", currency: "CNY" });

    await expect(
      postgresSourceDocumentAggregateAdapter.deleteDocuments({
        ledgerId,
        target: { sourceDocumentId: created.sourceDocumentId, expectedVersion: 3 },
      })
    ).resolves.toMatchObject({ ok: true });
    await expect(listLedgerEntries(ledgerId, { limit: 20 })).resolves.toMatchObject({ items: [] });
    await expect(findVisibleEntry(activeEntry!.id, ledgerId)).resolves.toBeNull();
  });

  it("preserves decimal adjustments, dates, categories, currencies, and exchange-rate facts atomically", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const [category] = await db
      .insert(entryCategories)
      .values({ ledgerId, name: "Food" })
      .returning();
    const transactionAt = "2026-07-14T12:30:00.000Z";
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] as const;
    const created = await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
      ledgerId,
      title: "Receipt with adjustments",
      entryDate: "2026-07-14",
      entries: [
        {
          id: ids[0],
          categoryId: category!.id,
          amount: "12.340",
          currency: "USD",
          itemName: "Meal",
          description: null,
          convertedAmount: "98.720",
          exchangeRate: "8.000000000000",
          createdAt: transactionAt,
        },
        {
          id: ids[1],
          categoryId: null,
          amount: "-1.110",
          currency: "USD",
          itemName: "Order discount",
          description: "bill-level discount",
          convertedAmount: "-8.88",
          exchangeRate: "8.000000",
          createdAt: transactionAt,
        },
        {
          id: ids[2],
          categoryId: null,
          amount: "0.500",
          currency: "USD",
          itemName: "Service fee",
          description: "bill-level fee",
          convertedAmount: "4.00",
          exchangeRate: "8.000000",
          createdAt: transactionAt,
        },
      ],
      bookId: await testBookId(db, ledgerId),
    });

    const stream = await listLedgerEntries(ledgerId, { limit: 20 });
    const detail = await findVisibleEntry(ids[0]!, ledgerId);
    const stats = await calculateLedgerStats(ledgerId, {
      startDate: "2026-07-14",
      endDate: "2026-07-14",
    });
    expect(stream.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ids[0],
          categoryId: category!.id,
          amount: "12.340",
          currency: "USD",
          convertedAmount: "98.720",
          exchangeRate: "8.000000000000",
          sourceDocument: expect.objectContaining({ documentDate: "2026-07-14" }),
        }),
        expect.objectContaining({ id: ids[1], itemName: "Order discount", amount: "-1.110" }),
        expect.objectContaining({ id: ids[2], itemName: "Service fee", amount: "0.500" }),
      ])
    );
    expect(detail).toMatchObject({
      id: ids[0],
      category: { id: category!.id, name: "Food" },
      amount: "12.340",
      currency: "USD",
      convertedAmount: "98.720",
      exchangeRate: "8.000000000000",
      sourceDocument: { id: created.sourceDocumentId, documentDate: "2026-07-14" },
    });
    expect(detail?.createdAt).toBe(transactionAt);
    expect(stats.convertedTotal).toEqual({ total: "93.84", currency: "CNY" });
    expect(stats.totals).toContainEqual({ currency: "USD", total: "11.73", count: 3 });

    await expect(
      postgresSourceDocumentAggregateAdapter.saveChanges({
        ledgerId,
        sourceDocumentId: created.sourceDocumentId,
        expectedVersion: 1,
        entries: [
          { ledgerEntryId: ids[0]!, data: { itemName: "Must roll back" } },
          { ledgerEntryId: crypto.randomUUID(), data: { itemName: "Missing" } },
        ],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const afterRollback = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, ids[0]!),
    });
    const activeDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    const targetLinks = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentRevisionId, created.revisionId),
      orderBy: (entries, { asc }) => [asc(entries.position)],
    });
    expect(afterRollback).toMatchObject({
      convertedAmount: "98.720",
      exchangeRate: "8.000000000000",
      sourceDocumentRevisionId: created.revisionId,
    });
    expect(activeDocument?.activeRevisionId).toBe(created.revisionId);
    expect(new Set(targetLinks.map((link) => link.id))).toEqual(new Set(ids));
  });

  it("prevents cross-workspace reads and rolls back invalid manual replacement", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const { ledgerId: otherLedgerId } = await createTestUserWithLedger(
      db,
      undefined,
      undefined,
      crypto.randomUUID()
    );
    const [otherCategory] = await db
      .insert(entryCategories)
      .values({ ledgerId: otherLedgerId, name: "Other" })
      .returning();
    await expect(
      postgresLedgerProjectionAdapter.createManual({
        expectedMainCurrency: "CNY",
        ledgerId,
        entries: [{ ...entry, categoryId: otherCategory!.id }],
        bookId: await testBookId(db, ledgerId),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(sourceDocuments)).toHaveLength(0);
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);

    const created = await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
      ledgerId,
      entries: [entry],
      bookId: await testBookId(db, ledgerId),
    });
    const beforeDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    const beforeRevisionCount = await db.select().from(sourceDocumentRevisions);
    const beforeEntryCount = await db.select().from(ledgerEntries);

    await expect(listStreamPage(otherLedgerId, { limit: 20 })).resolves.toMatchObject({
      items: [],
    });
    await expect(listLedgerEntries(otherLedgerId, { limit: 20 })).resolves.toMatchObject({
      items: [],
    });
    await expect(
      serverComposition.sourceDocumentAggregate.saveChanges({
        ledgerId,
        sourceDocumentId: created.sourceDocumentId,
        expectedVersion: beforeDocument!.version,
        entries: [
          { ledgerEntryId: beforeEntryCount[0]!.id, data: { categoryId: otherCategory!.id } },
        ],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const afterDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    expect(afterDocument?.activeRevisionId).toBe(beforeDocument?.activeRevisionId);
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(
      beforeRevisionCount.length
    );
    expect(await db.select().from(ledgerEntries)).toHaveLength(beforeEntryCount.length);
  });

  it("edits a manual entry in place while keeping its revision and id", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const created = await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
      ledgerId,
      entryDate: "2026-07-15",
      entries: [entry],
      bookId: await testBookId(db, ledgerId),
    });
    const original = await db.query.ledgerEntries.findFirst({
      where: and(
        eq(ledgerEntries.sourceDocumentRevisionId, created.revisionId),
        isNull(ledgerEntries.deletedAt)
      ),
    });
    const initialVersion = await currentVersion(created.sourceDocumentId);

    const updated = await serverComposition.sourceDocumentAggregate.batchUpdateEntries({
      ledgerId,
      targets: [{ sourceDocumentId: created.sourceDocumentId, expectedVersion: initialVersion }],
      ledgerEntryIds: [original!.id],
      amount: "18",
    });
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    const revisions = await db.query.sourceDocumentRevisions.findMany({
      where: eq(sourceDocumentRevisions.sourceDocumentId, created.sourceDocumentId),
    });
    const active = await db.query.ledgerEntries.findFirst({
      where: and(eq(ledgerEntries.id, original!.id), isNull(ledgerEntries.deletedAt)),
    });
    const retained = await db.query.ledgerEntries.findMany({
      where: and(
        eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId),
        eq(ledgerEntries.sourceDocumentRevisionId, created.revisionId)
      ),
    });

    expect(updated).toMatchObject({ ok: true, data: { ledgerEntryIds: [original!.id] } });
    expect(document?.activeRevisionId).toBe(created.revisionId);
    expect(document?.version).toBe(initialVersion + 1);
    expect(revisions).toHaveLength(1);
    expect(active).toMatchObject({ id: original!.id, amount: "18.000" });
    expect(retained).toHaveLength(1);
    expect(retained[0]?.deletedAt).toBeNull();
  });

  it("mutates parsed entries through target revisions with rollback and read consistency", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const { ledgerId: otherLedgerId } = await createTestUserWithLedger(
      db,
      undefined,
      undefined,
      crypto.randomUUID()
    );
    const [otherCategory] = await db
      .insert(entryCategories)
      .values({ ledgerId: otherLedgerId, name: "Other" })
      .returning();
    const pending = await createPendingRevision({
      ledgerId,
      input: { text: "Lunch", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    await postgresLedgerProjectionAdapter.activateRevision({
      lease: await claimRevisionForTest(pending.revision.id),
      ledgerId,
      expectedMainCurrency: "CNY",
      sourceDocumentId: pending.document.id,
      revisionId: pending.revision.id,
      entries: [entry],
    });
    const original = await db.query.ledgerEntries.findFirst({
      where: and(
        eq(ledgerEntries.sourceDocumentRevisionId, pending.revision.id),
        isNull(ledgerEntries.deletedAt)
      ),
    });

    const versionBeforeUpdate = await currentVersion(pending.document.id);
    await serverComposition.sourceDocumentAggregate.batchUpdateEntries({
      ledgerId,
      targets: [{ sourceDocumentId: pending.document.id, expectedVersion: versionBeforeUpdate }],
      ledgerEntryIds: [original!.id],
      amount: "18",
    });
    const afterUpdate = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, pending.document.id),
    });
    const revisionCount = (await db.select().from(sourceDocumentRevisions)).length;
    const stream = await listLedgerEntries(ledgerId, { limit: 20 });
    const detail = await findVisibleEntry(original!.id, ledgerId);
    const stats = await calculateLedgerStats(ledgerId);
    expect(stream.items[0]).toMatchObject({ id: original!.id, amount: "18.000" });
    expect(detail).toMatchObject({ id: original!.id, amount: "18.000" });
    expect(stats.convertedTotal).toEqual({ total: "18", currency: "CNY" });

    await expect(
      serverComposition.sourceDocumentAggregate.batchUpdateEntries({
        ledgerId,
        targets: [
          {
            sourceDocumentId: pending.document.id,
            expectedVersion: afterUpdate!.version,
          },
        ],
        ledgerEntryIds: [original!.id],
        categoryId: otherCategory!.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const afterRollback = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, pending.document.id),
    });
    expect(afterRollback?.activeRevisionId).toBe(afterUpdate?.activeRevisionId);
    expect(await db.select().from(sourceDocumentRevisions)).toHaveLength(revisionCount);
    await expect(
      serverComposition.sourceDocumentAggregate.batchUpdateEntries({
        ledgerId: otherLedgerId,
        targets: [
          {
            sourceDocumentId: pending.document.id,
            expectedVersion: afterUpdate!.version,
          },
        ],
        ledgerEntryIds: [original!.id],
        amount: "99",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      serverComposition.sourceDocumentAggregate.deleteEntries({
        ledgerId,
        target: {
          sourceDocumentId: pending.document.id,
          expectedVersion: afterUpdate!.version,
        },
        ledgerEntryId: original!.id,
      })
    ).resolves.toMatchObject({
      ok: true,
      sourceDocumentId: pending.document.id,
      data: { ledgerEntryId: original!.id, deleted: true },
    });
    await expect(listLedgerEntries(ledgerId, { limit: 20 })).resolves.toMatchObject({ items: [] });
    await expect(findVisibleEntry(original!.id, ledgerId)).resolves.toBeNull();
    await expect(calculateLedgerStats(ledgerId)).resolves.toMatchObject({
      convertedTotal: { total: "0", currency: "CNY" },
    });
  });
});
