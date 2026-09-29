import { claimAttemptForTest } from "tests/helpers/processing-attempt";
import { createPendingAttempt } from "tests/helpers/processing-attempt";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { queryEnhancedStats } from "@/modules/stats/server/enhanced-stats-query";
import { entryCategories, ledgerEntries, extractionAttempts, sourceDocuments } from "@/persistence";
import { createTestUserWithLedger, testBookId, createTestRecord } from "tests/helpers/schema-setup";
import { insertExchangeRates } from "tests/helpers/exchange-rates";
import { getTestDb } from "tests/setup";
import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { calculateLedgerStats } from "@/modules/ledger/server/stats";
import { listLedgerEntryPage } from "@/modules/ledger/server/entry-reads/list-ledger-entry-page";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";
import { activateAttempt } from "@/modules/source-document/server/projections/writes";
import {
  batchUpdateLedgerEntries,
  deleteLedgerEntry,
} from "@/modules/source-document/server/entry-commands";
import { deleteSourceDocumentAtomically } from "@/modules/source-document/server/delete";
import { recordProcessingFailure } from "@/modules/source-document/server/extraction-attempts";

const findVisibleEntry = async (id: string) => {
  const page = await listLedgerEntryPage({
    limit: 100,
    filters: {},
  });
  return page.items.find((entry) => entry.id === id) ?? null;
};
async function currentVersion(sourceDocumentId: string): Promise<number> {
  const db = getTestDb();
  const row = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
    columns: { version: true },
  });
  if (row == null) throw new Error("Source document not found");
  return row.version;
}

const entry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
} as const;

describe("target upper workflows", () => {
  it("uses persisted list state and paginates without skips", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const completed = await createTestRecord(getTestDb(), {
      entryDate: "2026-07-15",
      entries: [entry],
      bookId: await testBookId(db),
    });
    const pending = await createPendingAttempt({
      input: { text: "pending", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db),
    });
    const failedSubmission = await createPendingAttempt({
      sourceDocumentId: completed.sourceDocumentId,
      input: { text: "failed retry", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db),
    });
    await recordProcessingFailure({
      lease: await claimAttemptForTest(failedSubmission.attempt.id),
      sourceDocumentId: completed.sourceDocumentId,
      attemptId: failedSubmission.attempt.id,
      failureKind: "processing_error",
      failureMessage: "processing failed",
    });

    const first = await listStreamPage({ limit: 1 });
    const second = await listStreamPage({
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
    await createTestUserWithLedger(db);
    const [category] = await db.insert(entryCategories).values({ name: "Food" }).returning();
    const created = await createTestRecord(getTestDb(), {
      entryDate: "2026-07-15",
      entries: [{ ...entry, categoryId: category!.id }],
      bookId: await testBookId(db),
    });
    const activeEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId),
    });
    const failedPending = await createPendingAttempt({
      sourceDocumentId: created.sourceDocumentId,
      input: { text: "failed replacement", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db),
    });
    await recordProcessingFailure({
      lease: await claimAttemptForTest(failedPending.attempt.id),
      sourceDocumentId: created.sourceDocumentId,
      attemptId: failedPending.attempt.id,
      failureKind: "processing_error",
      failureMessage: "processing failed",
    });

    const stream = await listLedgerEntries({ limit: 20 });
    const detail = await findVisibleEntry(activeEntry!.id);
    const summary = await calculateLedgerStats({
      startDate: "2026-07-15",
      endDate: "2026-07-15",
    });
    const enhanced = await queryEnhancedStats({
      queryRange: { from: "2026-07-15", to: "2026-07-15" },
      compareRange: { from: "2026-07-14", to: "2026-07-14" },
    });

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
      deleteSourceDocumentAtomically({
        sourceDocumentId: created.sourceDocumentId,
      })
    ).resolves.toMatchObject({ deleted: true });
    await expect(listLedgerEntries({ limit: 20 })).resolves.toMatchObject({ items: [] });
    await expect(findVisibleEntry(activeEntry!.id)).resolves.toBeNull();
  });

  it("preserves decimal adjustments, dates, categories, currencies, and exchange-rate facts atomically", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const [category] = await db.insert(entryCategories).values({ name: "Food" }).returning();
    await insertExchangeRates("2026-07-14", { USD: 1, CNY: 8 });
    const transactionAt = "2026-07-14T12:30:00.000Z";
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] as const;
    const created = await createTestRecord(getTestDb(), {
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
          createdAt: transactionAt,
        },
        {
          id: ids[1],
          categoryId: null,
          amount: "-1.110",
          currency: "USD",
          itemName: "Order discount",
          description: "bill-level discount",
          createdAt: transactionAt,
        },
        {
          id: ids[2],
          categoryId: null,
          amount: "0.500",
          currency: "USD",
          itemName: "Service fee",
          description: "bill-level fee",
          createdAt: transactionAt,
        },
      ],
      bookId: await testBookId(db),
    });

    const stream = await listLedgerEntries({ limit: 20 });
    const detail = await findVisibleEntry(ids[0]!);
    const stats = await calculateLedgerStats({
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
          convertedAmount: "98.72",
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
      convertedAmount: "98.72",
      exchangeRate: "8.000000000000",
      sourceDocument: { id: created.sourceDocumentId, documentDate: "2026-07-14" },
    });
    expect(detail?.createdAt).toBe(transactionAt);
    expect(stats.convertedTotal).toEqual({ total: "93.84", currency: "CNY" });
    expect(stats.totals).toContainEqual({ currency: "USD", total: "11.73", count: 3 });

    await expect(
      batchUpdateLedgerEntries({
        sourceDocumentIds: [created.sourceDocumentId],
        ledgerEntryIds: [ids[0]!, crypto.randomUUID()],
        itemName: "Must roll back",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const afterRollback = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, ids[0]!),
    });
    const activeDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    const targetLinks = await db.query.ledgerEntries.findMany({
      where: and(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId)),
      orderBy: (entries, { asc }) => [asc(entries.position)],
    });
    expect(afterRollback).toMatchObject({ itemName: "Meal" });
    expect(activeDocument?.version).toBe(1);
    expect(new Set(targetLinks.map((link) => link.id))).toEqual(new Set(ids));
  });

  it("edits a manual entry in place while keeping its id and creating no attempt", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const created = await createTestRecord(getTestDb(), {
      entryDate: "2026-07-15",
      entries: [entry],
      bookId: await testBookId(db),
    });
    const original = await db.query.ledgerEntries.findFirst({
      where: and(eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId)),
    });
    const initialVersion = await currentVersion(created.sourceDocumentId);

    const updated = await batchUpdateLedgerEntries({
      sourceDocumentIds: [created.sourceDocumentId],
      ledgerEntryIds: [original!.id],
      amount: "18",
    });
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, created.sourceDocumentId),
    });
    const attempts = await db.query.extractionAttempts.findMany({
      where: eq(extractionAttempts.sourceDocumentId, created.sourceDocumentId),
    });
    const active = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, original!.id),
    });
    const retained = await db.query.ledgerEntries.findMany({
      where: eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId),
    });

    expect(updated).toMatchObject({ ledgerEntryIds: [original!.id] });
    expect(document?.version).toBe(initialVersion + 1);
    expect(attempts).toHaveLength(0);
    expect(active).toMatchObject({ id: original!.id, amount: "18.000" });
    expect(retained).toHaveLength(1);
  });

  it("mutates parsed entries in place with rollback and read consistency", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const pending = await createPendingAttempt({
      input: { text: "Lunch", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db),
    });
    await activateAttempt({
      lease: await claimAttemptForTest(pending.attempt.id),
      sourceDocumentId: pending.document.id,
      attemptId: pending.attempt.id,
      entries: [entry],
    });
    const original = await db.query.ledgerEntries.findFirst({
      where: and(eq(ledgerEntries.sourceDocumentId, pending.document.id)),
    });

    await batchUpdateLedgerEntries({
      sourceDocumentIds: [pending.document.id],
      ledgerEntryIds: [original!.id],
      amount: "18",
    });
    const afterUpdate = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, pending.document.id),
    });
    const attemptCount = (await db.select().from(extractionAttempts)).length;
    const stream = await listLedgerEntries({ limit: 20 });
    const detail = await findVisibleEntry(original!.id);
    const stats = await calculateLedgerStats({});
    expect(stream.items[0]).toMatchObject({ id: original!.id, amount: "18.000" });
    expect(detail).toMatchObject({ id: original!.id, amount: "18.000" });
    expect(stats.convertedTotal).toEqual({ total: "18", currency: "CNY" });

    await expect(
      batchUpdateLedgerEntries({
        sourceDocumentIds: [pending.document.id],
        ledgerEntryIds: [original!.id],
        categoryId: crypto.randomUUID(),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const afterRollback = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, pending.document.id),
    });
    expect(afterRollback?.version).toBe(afterUpdate?.version);
    expect(await db.select().from(extractionAttempts)).toHaveLength(attemptCount);
    await expect(
      deleteLedgerEntry({
        sourceDocumentId: pending.document.id,
        ledgerEntryId: original!.id,
      })
    ).resolves.toEqual({ ledgerEntryId: original!.id, deleted: true });
    await expect(listLedgerEntries({ limit: 20 })).resolves.toMatchObject({ items: [] });
    await expect(findVisibleEntry(original!.id)).resolves.toBeNull();
    await expect(calculateLedgerStats({})).resolves.toMatchObject({
      convertedTotal: { total: "0", currency: "CNY" },
    });
  });
});
