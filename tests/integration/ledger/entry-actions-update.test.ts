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
  target: { sourceDocumentId: string; expectedVersion: number },
  entryId: string,
  data: Parameters<typeof batchUpdateLedgerEntriesAction>[2]
) {
  return batchUpdateLedgerEntriesAction([target], [entryId], data);
}

describe("single-entry update version CAS", () => {
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
    const result = await updateEntry({ sourceDocumentId, expectedVersion: 1 }, entryId, {
      itemName: "Dinner",
    });
    expect(result).toEqual({
      ok: true,
      versions: [{ sourceDocumentId, version: 2 }],
      data: { ledgerEntryIds: [entryId], affectedCount: 1 },
    });
    const entry = await getTestDb().query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });
    expect(entry?.itemName).toBe("Dinner");
    expect(entry?.deletedAt).toBeNull();
  });

  it("does not write or increment for a no-op", async () => {
    const result = await updateEntry({ sourceDocumentId, expectedVersion: 1 }, entryId, {
      itemName: "Lunch",
    });
    expect(result).toMatchObject({ ok: true, versions: [{ version: 1 }] });
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
      updateEntry({ sourceDocumentId, expectedVersion: 1 }, entryId, {
        amount: "-6",
      })
    ).resolves.toMatchObject({ ok: true, versions: [{ version: 2 }] });

    const entry = await getTestDb().query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });
    expect(entry).toMatchObject({ amount: "-6.000" });

    await expect(
      updateEntry({ sourceDocumentId, expectedVersion: 2 }, entryId, {
        amount: "6",
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns stale without changing the entry", async () => {
    await getTestDb()
      .update(sourceDocuments)
      .set({ version: 2 })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    await expect(
      updateEntry({ sourceDocumentId, expectedVersion: 1 }, entryId, {
        itemName: "Stale",
      })
    ).resolves.toMatchObject({
      ok: false,
      reason: "stale",
      staleTargets: [{ currentVersion: 2 }],
    });
    const entry = await getTestDb().query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });
    expect(entry?.itemName).toBe("Lunch");
  });

  it("allows exactly one of two synchronized commands with the same version", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = barrier.then(() =>
      updateEntry({ sourceDocumentId, expectedVersion: 1 }, entryId, {
        itemName: "Dinner",
      })
    );
    const second = barrier.then(() =>
      updateEntry({ sourceDocumentId, expectedVersion: 1 }, entryId, {
        description: "Team meal",
      })
    );

    release();
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({
        reason: "stale",
        staleTargets: [expect.objectContaining({ expectedVersion: 1, currentVersion: 2 })],
      }),
    ]);

    const [entry, document] = await Promise.all([
      getTestDb().query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entryId) }),
      getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      }),
    ]);
    expect(document?.version).toBe(2);
    expect(
      (entry?.itemName === "Dinner" && entry.description == null) ||
        (entry?.itemName === "Lunch" && entry.description === "Team meal")
    ).toBe(true);
  });
});
