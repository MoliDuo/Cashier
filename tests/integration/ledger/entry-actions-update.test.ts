import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { updateLedgerEntryAction } from "@/modules/ledger/server-actions/entries";
import { ValidationError } from "@/lib/errors";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getTestDb } from "../../setup";
import {
  activateTestSourceDocumentProjection,
  configureTestCoupleLedger,
  TEST_USER_ID,
} from "../../helpers/schema-setup";

vi.mock("@/application/adapters/postgres/exchange-rate", () => {
  const rateBook = { getRates: vi.fn(), convertBatch: vi.fn() };
  return { ExchangeRateService: rateBook, postgresFxRateBook: rateBook, fetchWithRetry: vi.fn() };
});

describe("updateLedgerEntryAction version CAS", () => {
  let ledgerId: string;
  let sourceDocumentId: string;
  let entryId: string;

  beforeEach(async () => {
    const db = getTestDb();
    ledgerId = crypto.randomUUID();
    sourceDocumentId = crypto.randomUUID();
    entryId = crypto.randomUUID();
    await db.insert(ledgers).values({ id: ledgerId, userId: TEST_USER_ID, mainCurrency: "CNY" });
    await configureTestCoupleLedger(db, ledgerId);
    await db.insert(sourceDocuments).values({
      id: sourceDocumentId,
      ledgerId,
    });
    await db.insert(ledgerEntries).values({
      id: entryId,
      ledgerId,
      sourceDocumentId,
      itemName: "Lunch",
      amount: "50.000",
      currency: "CNY",
      convertedAmount: "50.000",
      exchangeRate: "1",
    });
    await activateTestSourceDocumentProjection(db, sourceDocumentId);
  });

  it("preserves the entry ID and increments the document exactly once", async () => {
    const result = await updateLedgerEntryAction(
      ledgerId,
      { sourceDocumentId, expectedVersion: 1 },
      entryId,
      { itemName: "Dinner" }
    );
    expect(result).toEqual({
      ok: true,
      sourceDocumentId,
      version: 2,
      data: { ledgerEntryId: entryId },
    });
    const entry = await getTestDb().query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });
    expect(entry?.itemName).toBe("Dinner");
    expect(entry?.deletedAt).toBeNull();
  });

  it("does not write or increment for a no-op", async () => {
    const result = await updateLedgerEntryAction(
      ledgerId,
      { sourceDocumentId, expectedVersion: 1 },
      entryId,
      { itemName: "Lunch" }
    );
    expect(result).toMatchObject({ ok: true, version: 1 });
    const document = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(document?.version).toBe(1);
  });

  it("edits a deduction while preserving its negative direction", async () => {
    await getTestDb()
      .update(ledgerEntries)
      .set({ amount: "-8.000", convertedAmount: "-8.000" })
      .where(eq(ledgerEntries.id, entryId));

    await expect(
      updateLedgerEntryAction(ledgerId, { sourceDocumentId, expectedVersion: 1 }, entryId, {
        amount: "-6",
      })
    ).resolves.toMatchObject({ ok: true, version: 2 });

    const entry = await getTestDb().query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryId),
    });
    expect(entry).toMatchObject({ amount: "-6.000", convertedAmount: "-6.000" });

    await expect(
      updateLedgerEntryAction(ledgerId, { sourceDocumentId, expectedVersion: 2 }, entryId, {
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
      updateLedgerEntryAction(ledgerId, { sourceDocumentId, expectedVersion: 1 }, entryId, {
        itemName: "Stale",
      })
    ).resolves.toMatchObject({ ok: false, reason: "stale", currentVersion: 2 });
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
      updateLedgerEntryAction(ledgerId, { sourceDocumentId, expectedVersion: 1 }, entryId, {
        itemName: "Dinner",
      })
    );
    const second = barrier.then(() =>
      updateLedgerEntryAction(ledgerId, { sourceDocumentId, expectedVersion: 1 }, entryId, {
        description: "Team meal",
      })
    );

    release();
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      expect.objectContaining({ reason: "stale", expectedVersion: 1, currentVersion: 2 }),
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
