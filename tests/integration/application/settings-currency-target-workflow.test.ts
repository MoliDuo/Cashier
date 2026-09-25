import { claimRevisionForTest } from "tests/helpers/processing-revision";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateLedgerSettings } from "@/modules/ledger/server/settings";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { exchangeRates } from "@/persistence/schema/currency";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { getTestDb } from "../../setup";
import { insertExchangeRates } from "../../helpers/exchange-rates";
import { calculateLedgerStats } from "@/modules/ledger/server/stats";
import { hasActiveLedgerEntries } from "@/modules/ledger/server/entry-reads/has-active-entries";
import {
  activateRevision,
  createManualDocument,
} from "@/modules/source-document/server/projections/writes";

type UpdateLedgerData = Omit<Parameters<typeof updateLedgerSettings>[1], "expectedUpdatedAt">;

const updateLedger = async (ledgerId: string, data: UpdateLedgerData) => {
  const current = await getTestDb().query.ledgers.findFirst({ where: eq(ledgers.id, ledgerId) });
  if (current == null) throw new Error("Expected ledger fixture");
  return updateLedgerSettings(ledgerId, {
    ...data,
    expectedUpdatedAt: current.updatedAt.toISOString(),
  });
};

describe("target Settings currency workflow", () => {
  let ledgerId = "";
  let sourceDocumentId: string;

  async function createEntry() {
    const result = await createManualDocument({
      ledgerId,
      entryDate: "2026-07-15",
      entries: [
        {
          id: crypto.randomUUID(),
          categoryId: null,
          amount: "80.00",
          currency: "CNY",
          itemName: "Atomic currency entry",
          description: null,
        },
      ],
      bookId: await testBookId(getTestDb(), ledgerId),
    });
    sourceDocumentId = result.sourceDocumentId;
  }

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers);
    ({ ledgerId } = await createTestUserWithLedger(db));
    await db
      .update(ledgers)
      .set({ preferredCurrencies: ["CNY", "USD"] })
      .where(eq(ledgers.id, ledgerId));
    await insertExchangeRates("2026-07-15", { CNY: 8, USD: 1 });
  });

  it("allows main currency change on empty ledger", async () => {
    const updated = await updateLedger(ledgerId, {
      settings: { mainCurrency: "USD" },
    });
    expect(updated.settings.mainCurrency).toBe("USD");
  });

  it("changes main currency without rewriting entries, which then read in the new currency", async () => {
    await createEntry();

    const before = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });

    const updated = await updateLedger(ledgerId, {
      settings: { mainCurrency: "USD" },
    });
    const [entry, document, stats] = await Promise.all([
      getTestDb().query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.ledgerId, ledgerId),
      }),
      getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      }),
      calculateLedgerStats(ledgerId, {}),
    ]);

    expect(updated.settings.mainCurrency).toBe("USD");
    expect(entry).toMatchObject({ amount: "80.000", currency: "CNY" });
    expect(document?.version).toBe(before!.version);
    expect(stats.convertedTotal).toEqual({ total: "10", currency: "USD" });
    expect(stats.unconvertedCount).toBe(0);
  });

  it("allows other setting changes when entries exist", async () => {
    await createEntry();

    const updated = await updateLedger(ledgerId, {
      settings: { aiLanguage: "en" },
    });
    expect(updated.settings.aiLanguage).toBe("en");
    expect(updated.settings.mainCurrency).toBe("CNY");
  });

  it("hasActiveEntries returns false for empty ledger", async () => {
    expect(await hasActiveLedgerEntries(ledgerId)).toBe(false);
  });

  it("hasActiveEntries returns true after entry creation", async () => {
    await createEntry();
    expect(await hasActiveLedgerEntries(ledgerId)).toBe(true);
  });

  it("hasActiveEntries returns false after the source document is deleted", async () => {
    await createEntry();
    expect(await hasActiveLedgerEntries(ledgerId)).toBe(true);

    const db = getTestDb();
    await db.delete(sourceDocuments).where(eq(sourceDocuments.id, sourceDocumentId));

    expect(await hasActiveLedgerEntries(ledgerId)).toBe(false);
  });

  it("allows main currency change after the source document is deleted", async () => {
    await createEntry();

    const db = getTestDb();
    await db.delete(sourceDocuments).where(eq(sourceDocuments.id, sourceDocumentId));

    const updated = await updateLedger(ledgerId, {
      settings: { mainCurrency: "USD" },
    });
    expect(updated.settings.mainCurrency).toBe("USD");
  });

  it("rejects an unsupported main currency and keeps the settings", async () => {
    await createEntry();

    await expect(updateLedger(ledgerId, { settings: { mainCurrency: "ZZZ" } })).rejects.toThrow(
      "Currency not found: ZZZ"
    );

    const ledger = await getTestDb().query.ledgers.findFirst({ where: eq(ledgers.id, ledgerId) });
    expect(ledger?.mainCurrency).toBe("CNY");
  });

  describe("historical rate gaps", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Inserts a second main-currency entry dated `entryDate`, a day with no stored rates. */
    async function addMainCurrencyOnlyEntry(entryDate: string) {
      const db = getTestDb();
      const sourceDocumentId = crypto.randomUUID();
      await db.insert(sourceDocuments).values({
        id: sourceDocumentId,
        ledgerId,
        documentDate: entryDate,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      });
      await db.insert(ledgerEntries).values({
        ledgerId,
        sourceDocumentId,
        amount: "40.00",
        currency: "CNY",
        itemName: "Main-currency-only entry",
      });
    }

    it("fetches the rates of a day that has none when the main currency changes", async () => {
      await createEntry();
      await addMainCurrencyOnlyEntry("2026-07-14");
      const db = getTestDb();

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ base: "EUR", rates: { "2026-07-14": { CNY: 8, USD: 1 } } }),
      } as Response);

      const updated = await updateLedger(ledgerId, {
        settings: { mainCurrency: "USD" },
      });

      expect(updated.settings.mainCurrency).toBe("USD");
      expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("..2026-07-14"),
        expect.anything()
      );
      expect(
        await db.query.exchangeRates.findFirst({
          where: eq(exchangeRates.rateDate, "2026-07-14"),
        })
      ).toBeDefined();
      expect((await calculateLedgerStats(ledgerId, {})).convertedTotal).toEqual({
        total: "15",
        currency: "USD",
      });
    });

    it("keeps the main-currency change when the provider has no rate for a day", async () => {
      await createEntry();
      // Before the ECB reference series' earliest date.
      await addMainCurrencyOnlyEntry("1990-01-01");

      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      } as Response);

      const updated = await updateLedger(ledgerId, { settings: { mainCurrency: "USD" } });

      expect(updated.settings.mainCurrency).toBe("USD");
      const stats = await calculateLedgerStats(ledgerId, {});
      expect(stats.convertedTotal).toEqual({ total: "10", currency: "USD" });
      expect(stats.unconvertedCount).toBe(1);
    });
  });

  it("accepts exactly one of two concurrent settings writes", async () => {
    const db = getTestDb();
    const current = await db.query.ledgers.findFirst({ where: eq(ledgers.id, ledgerId) });
    if (current == null) throw new Error("Expected ledger fixture");
    const input = {
      expectedUpdatedAt: current.updatedAt.toISOString(),
      settings: { mainCurrency: "USD" },
    } as const;

    const results = await Promise.allSettled([
      updateLedgerSettings(ledgerId, input),
      updateLedgerSettings(ledgerId, input),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")?.reason).toMatchObject({
      code: "CONFLICT",
    });
    expect(
      (await db.query.ledgers.findFirst({ where: eq(ledgers.id, ledgerId) }))?.mainCurrency
    ).toBe("USD");
  });
});

describe("settings concurrency invariants", () => {
  it("concurrent main-currency change and first createManual are serialised by the ledger lock", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db, "settings-race-create-manual");
    // Resolved up front: awaiting it inside the array below would leave the
    // settings update running with no handler attached until it returned.
    const bookId = await testBookId(db, ledgerId);

    for (let i = 0; i < 5; i++) {
      // Run main-currency change and first entry creation concurrently on a fresh ledger.
      const results = await Promise.allSettled([
        updateLedger(ledgerId, { settings: { mainCurrency: "USD" } }),
        createManualDocument({
          ledgerId,
          entryDate: "2026-07-15",
          entries: [
            {
              categoryId: null,
              amount: "80.00",
              currency: "CNY",
              itemName: "Race entry",
              description: null,
            },
          ],
          bookId,
        }),
      ]);

      // The lock serialises operations: either settings changes first (then entries are
      // created with the new currency) or entries are created first (then settings throws).
      // Neither deadlock should occur.
      const ledger = await db.query.ledgers.findFirst({
        where: eq(ledgers.id, ledgerId),
      });
      const activeEntries = await db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.ledgerId, ledgerId),
      });

      // Invariant: if entries were created, settings either succeeded before entry creation
      // or threw because entries already existed. The ledger lock ensures no interleaving.
      // In either case, the ledger row is intact and readable.
      expect(ledger).not.toBeNull();

      // Verify main-currency/entry consistency invariant.
      const [settingsResult, createResult] = results;
      const mainCurrency = ledger?.mainCurrency;

      if (createResult.status === "fulfilled") {
        // Entries were created — either settings ran first (changed currency) and entries
        // followed, or entries ran first and settings was rejected.
        if (settingsResult.status === "fulfilled" && settingsResult.value != null) {
          // Settings succeeded: must have run before entries, so mainCurrency is "USD"
          expect(mainCurrency).toBe("USD");
          // Entries use the currency they were created with (CNY), which may differ from
          // the new main currency — this is an expected edge-case when settings changes
          // before the first entry is created.
          expect(activeEntries.length).toBeGreaterThan(0);
          expect(activeEntries.every((e) => e.currency === "CNY")).toBe(true);
        } else {
          // Settings was rejected: entries existed first, so mainCurrency stays at its default.
          expect(mainCurrency).toBe("CNY");
          expect(activeEntries.length).toBeGreaterThan(0);
        }
      } else if (settingsResult.status === "fulfilled" && settingsResult.value != null) {
        // Only settings succeeded, no entries created — mainCurrency is "USD".
        expect(mainCurrency).toBe("USD");
        expect(activeEntries).toHaveLength(0);
      }

      // Clean up for next iteration
      if (createResult.status === "fulfilled") {
        // Deleting the documents takes their entries with them.
        await db.delete(sourceDocuments).where(eq(sourceDocuments.ledgerId, ledgerId));
      }
      // Reset main currency if it was changed
      if (settingsResult.status === "fulfilled" && settingsResult.value != null) {
        await db.update(ledgers).set({ mainCurrency: "CNY" }).where(eq(ledgers.id, ledgerId));
      }
    }
  });

  it("concurrent main-currency change and first activateRevision are serialised by the ledger lock", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db, "settings-race-activate-revision");

    for (let i = 0; i < 5; i++) {
      // Create a pending revision first (this creates the document but not the active projection).
      const sourceDocumentId = crypto.randomUUID();
      await db
        .insert(sourceDocuments)
        .values({
          id: sourceDocumentId,
          ledgerId,
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const { revision } = await db.transaction(async (tx) => {
        const { createProcessingRevisionInTransaction: createProcessingRevision } =
          await import("@/modules/source-document/server/revisions");
        return createProcessingRevision(tx, {
          ledgerId,
          sourceDocumentId,
          input: { text: "Race test", storedFileIds: [], documentDate: null },
        });
      });

      const lease = await claimRevisionForTest(revision.id);

      // Run main-currency change and activateRevision concurrently.
      const results = await Promise.allSettled([
        updateLedger(ledgerId, { settings: { mainCurrency: "USD" } }),
        activateRevision({
          lease,
          ledgerId,
          sourceDocumentId,
          revisionId: revision.id,
          entries: [
            {
              categoryId: null,
              amount: "80.00",
              currency: "CNY",
              itemName: "Race entry",
              description: null,
            },
          ],
        }),
      ]);

      // The lock serialises the two operations — no deadlock, no partial state.
      const ledger = await db.query.ledgers.findFirst({
        where: eq(ledgers.id, ledgerId),
      });
      const activeEntries = await db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.ledgerId, ledgerId),
      });
      expect(ledger).not.toBeNull();

      // Verify main-currency/entry consistency invariant.
      const [settingsResult, activateResult] = results;
      const mainCurrency = ledger?.mainCurrency;

      if (activateResult.status === "fulfilled" && activateResult.value === true) {
        // activateRevision succeeded — entries were created.
        if (settingsResult.status === "fulfilled" && settingsResult.value != null) {
          // Settings succeeded: must have run before activate, so mainCurrency is "USD"
          expect(mainCurrency).toBe("USD");
          expect(activeEntries.length).toBeGreaterThan(0);
          expect(activeEntries.every((e) => e.currency === "CNY")).toBe(true);
        } else {
          // Settings was rejected: entries existed first, mainCurrency unchanged.
          expect(mainCurrency).toBe("CNY");
          expect(activeEntries.length).toBeGreaterThan(0);
        }
      } else if (settingsResult.status === "fulfilled" && settingsResult.value != null) {
        // Only settings succeeded — no entries created.
        expect(mainCurrency).toBe("USD");
        expect(activeEntries).toHaveLength(0);
      }

      // Clean up
      if (activateResult.status === "fulfilled" && activateResult.value === true) {
        // Deleting the documents takes their entries with them.
        await db.delete(sourceDocuments).where(eq(sourceDocuments.ledgerId, ledgerId));
      }
      if (settingsResult.status === "fulfilled" && settingsResult.value != null) {
        await db.update(ledgers).set({ mainCurrency: "CNY" }).where(eq(ledgers.id, ledgerId));
      }
    }
  });
});
