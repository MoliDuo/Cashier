import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { batchUpdateLedgerEntriesAction } from "@/modules/ledger/server-actions/entries";
import { ValidationError } from "@/lib/errors";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getTestDb } from "../../setup";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";

/** A single-entry edit is a one-entry batch: the UI has no other update path. */
function updateEntry(
  sourceDocumentId: string,
  entryId: string,
  data: Parameters<typeof batchUpdateLedgerEntriesAction>[2]
) {
  return batchUpdateLedgerEntriesAction([sourceDocumentId], [entryId], data);
}

describe("single-entry update", () => {
  let ledgerId: string;
  let sourceDocumentId: string;
  let entryId: string;

  beforeEach(async () => {
    const db = getTestDb();
    ledgerId = crypto.randomUUID();
    sourceDocumentId = crypto.randomUUID();
    entryId = crypto.randomUUID();
    await db.insert(ledgers).values({ id: ledgerId, mainCurrency: "CNY" });
    await ensureTestLedgerBooks(db, ledgerId);
    await db.insert(sourceDocuments).values({
      id: sourceDocumentId,
      ledgerId,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await db.insert(ledgerEntries).values({
      id: entryId,
      ledgerId,
      sourceDocumentId,
      itemName: "Lunch",
      amount: "50.000",
      currency: "CNY",
    });
    await activateTestSourceDocumentProjection(db, sourceDocumentId);
  });

  it("preserves the entry ID and increments the document exactly once", async () => {
    const result = await updateEntry(sourceDocumentId, entryId, {
      itemName: "Dinner",
    });
    expect(result).toEqual({ ledgerEntryIds: [entryId], affectedCount: 1 });
    const entry = await getTestDb().query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });
    expect(entry?.itemName).toBe("Dinner");
    expect(entry?.deletedAt).toBeNull();
    const document = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(document?.version).toBe(2);
  });

  it("does not write or increment for a no-op", async () => {
    const result = await updateEntry(sourceDocumentId, entryId, {
      itemName: "Lunch",
    });
    expect(result).toEqual({ ledgerEntryIds: [entryId], affectedCount: 0 });
    const document = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(document?.version).toBe(1);
  });

  it("edits a deduction while preserving its negative direction", async () => {
    await getTestDb()
      .update(ledgerEntries)
      .set({ amount: "-8.000" })
      .where(eq(ledgerEntries.id, entryId));

    await expect(
      updateEntry(sourceDocumentId, entryId, {
        amount: "-6",
      })
    ).resolves.toEqual({ ledgerEntryIds: [entryId], affectedCount: 1 });

    const entry = await getTestDb().query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });
    expect(entry).toMatchObject({ amount: "-6.000" });

    await expect(
      updateEntry(sourceDocumentId, entryId, {
        amount: "6",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("updates the entry even after the document version moved on", async () => {
    await getTestDb()
      .update(sourceDocuments)
      .set({ version: 2 })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    await expect(
      updateEntry(sourceDocumentId, entryId, {
        itemName: "Dinner",
      })
    ).resolves.toEqual({ ledgerEntryIds: [entryId], affectedCount: 1 });
    const [entry, document] = await Promise.all([
      getTestDb().query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entryId) }),
      getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      }),
    ]);
    expect(entry?.itemName).toBe("Dinner");
    expect(document?.version).toBe(3);
  });

  it("serializes two synchronized commands so both edits land", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = barrier.then(() =>
      updateEntry(sourceDocumentId, entryId, {
        itemName: "Dinner",
      })
    );
    const second = barrier.then(() =>
      updateEntry(sourceDocumentId, entryId, {
        description: "Team meal",
      })
    );

    release();
    const results = await Promise.all([first, second]);
    expect(results).toEqual([
      { ledgerEntryIds: [entryId], affectedCount: 1 },
      { ledgerEntryIds: [entryId], affectedCount: 1 },
    ]);

    const [entry, document] = await Promise.all([
      getTestDb().query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entryId) }),
      getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      }),
    ]);
    expect(document?.version).toBe(3);
    expect(entry).toMatchObject({ itemName: "Dinner", description: "Team meal" });
  });
});
