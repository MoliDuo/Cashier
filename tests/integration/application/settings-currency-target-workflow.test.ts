import { claimRevisionForTest } from "tests/helpers/processing-revision";
import { sql } from "drizzle-orm";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postgresLedgerProjectionAdapter } from "@/application/adapters/postgres";
import { LedgerMainCurrencyChangedError } from "@/application/contracts";
import { updateLedger as updateLedgerUseCase } from "@/modules/ledger/application/use-cases/update-ledger";
import { serverComposition } from "@/application/server-composition-root";
import {
  currencyRates,
  ledgerEntries,
  ledgers,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";
import { TEST_USER_ID, createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { getTestDb } from "../../setup";

type UpdateLedgerData = Omit<Parameters<typeof updateLedgerUseCase>[2], "expectedUpdatedAt">;

const updateLedger = async (userId: string, ledgerId: string, data: UpdateLedgerData) => {
  const current = await getTestDb().query.ledgers.findFirst({ where: eq(ledgers.id, ledgerId) });
  if (current == null) throw new Error("Expected ledger fixture");
  return updateLedgerUseCase(
    userId,
    ledgerId,
    { ...data, expectedUpdatedAt: current.updatedAt.toISOString() },
    serverComposition.settings,
    serverComposition.exchangeRates
  );
};

describe("target Settings currency workflow", () => {
  let ledgerId = "";
  let sourceDocumentId: string;

  async function createEntry() {
    const result = await postgresLedgerProjectionAdapter.createManual({
      expectedMainCurrency: "CNY",
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
          convertedAmount: "80.00",
          exchangeRate: "1.000000",
        },
      ],
      bookId: await testBookId(getTestDb(), ledgerId),
    });
    sourceDocumentId = result.sourceDocumentId;
  }

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers).where(eq(ledgers.userId, TEST_USER_ID));
    ({ ledgerId } = await createTestUserWithLedger(db));
    await db
      .update(ledgers)
      .set({ preferredCurrencies: ["CNY", "USD"] })
      .where(eq(ledgers.id, ledgerId));
    await db.insert(currencyRates).values({
      date: "2026-07-15",
      base: "EUR",
      rates: { CNY: 8, USD: 1 },
    });
  });

  it("allows main currency change on empty ledger", async () => {
    const updated = await updateLedger(TEST_USER_ID, ledgerId, {
      settings: { mainCurrency: "USD" },
    });
    expect(updated.settings.mainCurrency).toBe("USD");
  });

  it("changes main currency and recalculates active entries atomically", async () => {
    await createEntry();

    const before = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });

    const updated = await updateLedger(TEST_USER_ID, ledgerId, {
      settings: { mainCurrency: "USD" },
    });
    const [entry, document] = await Promise.all([
      getTestDb().query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.ledgerId, ledgerId),
      }),
      getTestDb().query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      }),
    ]);

    expect(updated.settings.mainCurrency).toBe("USD");
    expect(entry?.amount).toBe("80.000");
    expect(entry?.currency).toBe("CNY");
    expect(entry?.convertedAmount).toBe("10.000");
    expect(entry?.exchangeRate).toBe("0.125000000000");
    expect(document?.version).toBe(before!.version + 1);
  });

  it("recalculates only active revision entries", async () => {
    const db = getTestDb();
    const sourceDocumentId = crypto.randomUUID();
    const activeRevisionId = crypto.randomUUID();
    const latestSubmissionRevisionId = crypto.randomUUID();
    await db.insert(sourceDocuments).values({
      id: sourceDocumentId,
      ledgerId,
      documentDate: "2026-07-15",
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await db.insert(sourceDocumentRevisions).values([
      {
        id: activeRevisionId,
        ledgerId,
        sourceDocumentId,
        revisionNumber: 1,
        processingStatus: "completed",
        finishedAt: new Date(),
      },
      {
        id: latestSubmissionRevisionId,
        ledgerId,
        sourceDocumentId,
        revisionNumber: 2,
        processingStatus: "processing",
      },
    ]);
    await db
      .update(sourceDocuments)
      .set({ activeRevisionId, latestSubmissionRevisionId })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId,
        sourceDocumentRevisionId: activeRevisionId,
        amount: "80.00",
        currency: "CNY",
        itemName: "Active",
        convertedAmount: "80.00",
        exchangeRate: "1.000000",
      },
      {
        ledgerId,
        sourceDocumentId,
        sourceDocumentRevisionId: latestSubmissionRevisionId,
        amount: "40.00",
        currency: "CNY",
        itemName: "Pending",
        convertedAmount: "40.00",
        exchangeRate: "1.000000",
      },
    ]);

    await updateLedger(TEST_USER_ID, ledgerId, { settings: { mainCurrency: "USD" } });

    const [entries, document] = await Promise.all([
      db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.ledgerId, ledgerId),
      }),
      db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, sourceDocumentId),
      }),
    ]);
    expect(entries.map((entry) => entry.convertedAmount).sort()).toEqual(["10.000", "40.000"]);
    expect(
      entries.find((entry) => entry.sourceDocumentRevisionId === activeRevisionId)
    ).toMatchObject({
      exchangeRate: "0.125000000000",
    });
    expect(
      entries.find((entry) => entry.sourceDocumentRevisionId === latestSubmissionRevisionId)
    ).toMatchObject({ exchangeRate: "1.000000000000" });
    expect(document?.version).toBe(2);
  });

  it("allows other setting changes when entries exist", async () => {
    await createEntry();

    const updated = await updateLedger(TEST_USER_ID, ledgerId, {
      settings: { aiLanguage: "en" },
    });
    expect(updated.settings.aiLanguage).toBe("en");
    expect(updated.settings.mainCurrency).toBe("CNY");
  });

  it("hasActiveEntries returns false for empty ledger", async () => {
    expect(await serverComposition.ledgerReads.hasActiveEntries(ledgerId)).toBe(false);
  });

  it("hasActiveEntries returns true after entry creation", async () => {
    await createEntry();
    expect(await serverComposition.ledgerReads.hasActiveEntries(ledgerId)).toBe(true);
  });

  it("hasActiveEntries returns false after source document is soft-deleted", async () => {
    await createEntry();
    expect(await serverComposition.ledgerReads.hasActiveEntries(ledgerId)).toBe(true);

    // Soft-delete the source document so its entries are no longer active
    const db = getTestDb();
    await db
      .update(sourceDocuments)
      .set({ deletedAt: new Date() })
      .where(eq(sourceDocuments.id, sourceDocumentId));

    expect(await serverComposition.ledgerReads.hasActiveEntries(ledgerId)).toBe(false);
  });

  it("allows main currency change after source document is soft-deleted", async () => {
    await createEntry();

    const db = getTestDb();
    await db
      .update(sourceDocuments)
      .set({ deletedAt: new Date() })
      .where(eq(sourceDocuments.id, sourceDocumentId));

    const updated = await updateLedger(TEST_USER_ID, ledgerId, {
      settings: { mainCurrency: "USD" },
    });
    expect(updated.settings.mainCurrency).toBe("USD");
  });

  it("rolls back settings and conversions when a required rate is unavailable", async () => {
    await createEntry();

    await expect(
      updateLedger(TEST_USER_ID, ledgerId, { settings: { mainCurrency: "ZZZ" } })
    ).rejects.toThrow("Currency not found: ZZZ");

    const [ledger, entry] = await Promise.all([
      getTestDb().query.ledgers.findFirst({ where: eq(ledgers.id, ledgerId) }),
      getTestDb().query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.ledgerId, ledgerId),
      }),
    ]);
    expect(ledger?.mainCurrency).toBe("CNY");
    expect(entry?.convertedAmount).toBe("80.000");
    expect(entry?.exchangeRate).toBe("1.000000000000");
  });

  describe("historical rate gaps", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /**
     * Inserts a second, main-currency-only entry dated `entryDate`, which by
     * construction has no currency_rates row (rates are only ever cached as
     * a side effect of a *cross-currency* conversion — see entry-builder.ts
     * and ExchangeRateService.getRates), then attempts the main-currency
     * change.
     */
    async function addMainCurrencyOnlyEntry(entryDate: string) {
      const db = getTestDb();
      const sourceDocumentId = crypto.randomUUID();
      const activeRevisionId = crypto.randomUUID();
      await db.insert(sourceDocuments).values({
        id: sourceDocumentId,
        ledgerId,
        documentDate: entryDate,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      });
      await db.insert(sourceDocumentRevisions).values({
        id: activeRevisionId,
        ledgerId,
        sourceDocumentId,
        revisionNumber: 1,
        processingStatus: "completed",
        finishedAt: new Date(),
      });
      await db
        .update(sourceDocuments)
        .set({ activeRevisionId })
        .where(eq(sourceDocuments.id, sourceDocumentId));
      await db.insert(ledgerEntries).values({
        ledgerId,
        sourceDocumentId,
        sourceDocumentRevisionId: activeRevisionId,
        amount: "40.00",
        currency: "CNY",
        itemName: "Main-currency-only entry",
        convertedAmount: "40.00",
        exchangeRate: "1.000000",
      });
    }

    it("auto-fetches a missing but available historical rate instead of rejecting the change", async () => {
      await createEntry();
      await addMainCurrencyOnlyEntry("2026-07-14");
      const db = getTestDb();

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ base: "EUR", date: "2026-07-14", rates: { CNY: 8, USD: 1 } }),
      } as Response);

      const updated = await updateLedger(TEST_USER_ID, ledgerId, {
        settings: { mainCurrency: "USD" },
      });

      expect(updated.settings.mainCurrency).toBe("USD");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("2026-07-14"),
        expect.anything()
      );
      const storedRate = await db.query.currencyRates.findFirst({
        where: eq(currencyRates.date, "2026-07-14"),
      });
      expect(storedRate).not.toBeNull();
      const entries = await db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.ledgerId, ledgerId),
      });
      expect(entries.map((entry) => entry.convertedAmount).sort()).toEqual(["10.000", "5.000"]);
    });

    it("rolls back the entire main-currency change when the provider genuinely has no rate", async () => {
      await createEntry();
      // Before the ECB reference series' earliest date: the provider returns
      // 404 for this regardless of network availability.
      await addMainCurrencyOnlyEntry("1990-01-01");
      const db = getTestDb();

      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({}),
      } as Response);

      await expect(
        updateLedger(TEST_USER_ID, ledgerId, { settings: { mainCurrency: "USD" } })
      ).rejects.toMatchObject({ code: "EXCHANGE_RATES_UNAVAILABLE" });

      const [storedLedger, entries] = await Promise.all([
        db.query.ledgers.findFirst({ where: eq(ledgers.id, ledgerId) }),
        db.query.ledgerEntries.findMany({ where: eq(ledgerEntries.ledgerId, ledgerId) }),
      ]);
      expect(storedLedger?.mainCurrency).toBe("CNY");
      expect(entries.map((entry) => entry.convertedAmount).sort()).toEqual(["40.000", "80.000"]);
      expect(entries.every((entry) => entry.exchangeRate === "1.000000000000")).toBe(true);
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
      updateLedgerUseCase(
        TEST_USER_ID,
        ledgerId,
        input,
        serverComposition.settings,
        serverComposition.exchangeRates
      ),
      updateLedgerUseCase(
        TEST_USER_ID,
        ledgerId,
        input,
        serverComposition.settings,
        serverComposition.exchangeRates
      ),
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
  it("rejects first activation when conversion used a stale main currency", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db, "settings-stale-activation");
    const sourceDocumentId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    await db.insert(sourceDocuments).values({
      id: sourceDocumentId,
      ledgerId,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await db.insert(sourceDocumentRevisions).values({
      id: revisionId,
      ledgerId,
      sourceDocumentId,
      revisionNumber: 1,
      processingStatus: "processing",
    });
    await db
      .update(sourceDocuments)
      .set({ latestSubmissionRevisionId: revisionId })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    await db.update(ledgers).set({ mainCurrency: "USD" }).where(eq(ledgers.id, ledgerId));

    await expect(
      postgresLedgerProjectionAdapter.activateRevision({
        ledgerId,
        expectedMainCurrency: "CNY",
        sourceDocumentId,
        revisionId,
        lease: await claimRevisionForTest(revisionId),
        entries: [
          {
            categoryId: null,
            amount: "80.00",
            currency: "CNY",
            itemName: "Stale conversion",
            description: null,
            convertedAmount: "80.00",
            exchangeRate: "1",
          },
        ],
      })
    ).rejects.toBeInstanceOf(LedgerMainCurrencyChangedError);

    const [document, revision, entries] = await Promise.all([
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, sourceDocumentId) }),
      db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.id, revisionId),
      }),
      db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.sourceDocumentId, sourceDocumentId),
      }),
    ]);
    expect(document).toMatchObject({
      activeRevisionId: null,
      latestSubmissionRevisionId: revisionId,
    });
    expect(revision?.processingStatus).toBe("processing");
    expect(entries).toHaveLength(0);
  });

  it("concurrent main-currency change and first createManual are serialised by the ledger lock", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db, "settings-race-create-manual");

    for (let i = 0; i < 5; i++) {
      // Run main-currency change and first entry creation concurrently on a fresh ledger.
      const results = await Promise.allSettled([
        updateLedger(TEST_USER_ID, ledgerId, { settings: { mainCurrency: "USD" } }),
        postgresLedgerProjectionAdapter.createManual({
          expectedMainCurrency: "CNY",
          ledgerId,
          entryDate: "2026-07-15",
          entries: [
            {
              categoryId: null,
              amount: "80.00",
              currency: "CNY",
              itemName: "Race entry",
              description: null,
              convertedAmount: "80.00",
              exchangeRate: "1.000000",
            },
          ],
          bookId: await testBookId(getTestDb(), ledgerId),
        }),
      ]);

      // The lock serialises operations: either settings changes first (then entries are
      // created with the new currency) or entries are created first (then settings throws).
      // Neither deadlock should occur.
      const ledger = await db.query.ledgers.findFirst({
        where: eq(ledgers.id, ledgerId),
      });
      const activeEntries = await db.query.ledgerEntries.findMany({
        where: and(eq(ledgerEntries.ledgerId, ledgerId), isNull(ledgerEntries.deletedAt)),
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
        await db.transaction(async (tx) => {
          await tx
            .update(sourceDocuments)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(sourceDocuments.ledgerId, ledgerId));
          await tx
            .update(ledgerEntries)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(ledgerEntries.ledgerId, ledgerId));
        });
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
          await import("@/application/adapters/postgres/revisions");
        return createProcessingRevision(tx, {
          ledgerId,
          sourceDocumentId,
          input: { text: "Race test", storedFileIds: [], documentDate: null },
        });
      });

      const lease = await claimRevisionForTest(revision.id);

      // Run main-currency change and activateRevision concurrently.
      const results = await Promise.allSettled([
        updateLedger(TEST_USER_ID, ledgerId, { settings: { mainCurrency: "USD" } }),
        postgresLedgerProjectionAdapter.activateRevision({
          lease,
          ledgerId,
          expectedMainCurrency: "CNY",
          sourceDocumentId,
          revisionId: revision.id,
          entries: [
            {
              categoryId: null,
              amount: "80.00",
              currency: "CNY",
              itemName: "Race entry",
              description: null,
              convertedAmount: "80.00",
              exchangeRate: "1.000000",
            },
          ],
        }),
      ]);

      // The lock serialises the two operations — no deadlock, no partial state.
      const ledger = await db.query.ledgers.findFirst({
        where: eq(ledgers.id, ledgerId),
      });
      const activeEntries = await db.query.ledgerEntries.findMany({
        where: and(eq(ledgerEntries.ledgerId, ledgerId), isNull(ledgerEntries.deletedAt)),
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
        await db.transaction(async (tx) => {
          await tx
            .update(sourceDocuments)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(sourceDocuments.ledgerId, ledgerId));
          await tx
            .update(ledgerEntries)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(eq(ledgerEntries.ledgerId, ledgerId));
        });
      }
      if (settingsResult.status === "fulfilled" && settingsResult.value != null) {
        await db.update(ledgers).set({ mainCurrency: "CNY" }).where(eq(ledgers.id, ledgerId));
      }
    }
  });
});
