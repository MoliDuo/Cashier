import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { getTestDb } from "../setup";
import { createTestBooks, testBookId } from "../helpers/schema-setup";
import {
  currencyRates,
  exchangeRateRecalculationJobs,
  ledgerEntries,
  ledgers,
  sourceDocumentRevisions,
  sourceDocuments,
  loginEmails,
  users,
} from "@/persistence";
import {
  drainDueExchangeRateRecalculations,
  runBoundedExchangeRateRecalculation,
} from "@/application/orchestration/exchange-rate-ledger-recalculation";
import {
  claimExchangeRateRecalculations,
  completeExchangeRateRecalculation,
  failExchangeRateRecalculation,
} from "@/application/adapters/postgres/exchange-rate-recalculation-jobs";
import { runBoundedMaintenance } from "@/application/adapters/postgres/maintenance";
import { getExchangeRates } from "@/modules/currency/server/exchange-rates";
import * as recalculation from "@/application/orchestration/exchange-rate-ledger-recalculation";

const deleteObject = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/s3", () => ({
  getS3Storage: () => ({ delete: deleteObject }),
}));

const { recalculateLedgerForDateMock } = vi.hoisted(() => ({
  recalculateLedgerForDateMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/application/adapters/postgres/business-ports/currency", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/application/adapters/postgres/business-ports/currency")
    >();
  return {
    ...actual,
    postgresCurrencyAdapter: {
      ...actual.postgresCurrencyAdapter,
      recalculateLedgerForDate: recalculateLedgerForDateMock,
    },
  };
});

const { postgresCurrencyAdapter } = await vi.importActual<
  typeof import("@/application/adapters/postgres/business-ports/currency")
>("@/application/adapters/postgres/business-ports/currency");

async function seedLedgerWithEntry(input: {
  mainCurrency?: string;
  entryDate: string | null;
  deleted?: boolean;
  pendingOnly?: boolean;
}) {
  const db = getTestDb();
  const userId = crypto.randomUUID();
  const ledgerId = crypto.randomUUID();
  const sourceDocumentId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();

  await db.insert(users).values({ id: userId });
  await db.insert(loginEmails).values({
    userId: userId,
    email: `${userId}@example.com`,
    emailVerified: new Date(),
  });
  await db.insert(ledgers).values({
    id: ledgerId,
    userId,
    ...(input.mainCurrency != null ? { mainCurrency: input.mainCurrency } : {}),
    ...(input.deleted === true ? { deletedAt: new Date() } : {}),
  });
  // A soft-deleted ledger still needs its book: the document rows below are
  // inserted under the same ledger and the composite key must find one.
  await createTestBooks(db, ledgerId, ["共同支出"]);
  await db.insert(sourceDocuments).values({
    id: sourceDocumentId,
    ledgerId,
    documentDate: input.entryDate,
    ...(input.deleted === true ? { deletedAt: new Date() } : {}),
    bookId: await testBookId(db, ledgerId),
  });
  await db.insert(sourceDocumentRevisions).values({
    id: revisionId,
    ledgerId,
    sourceDocumentId,
    revisionNumber: 1,
  });
  await db
    .update(sourceDocuments)
    .set(
      input.pendingOnly === true
        ? { latestSubmissionRevisionId: revisionId }
        : { activeRevisionId: revisionId }
    )
    .where(eq(sourceDocuments.id, sourceDocumentId));
  await db.insert(ledgerEntries).values({
    ledgerId,
    sourceDocumentId,
    sourceDocumentRevisionId: revisionId,
    amount: "100.00",
    currency: "USD",
    itemName: "Rate event item",
  });
  return ledgerId;
}

async function seedRecalculationJobs(rateDate: string, ledgerIds: readonly string[]) {
  if (ledgerIds.length === 0) return;
  await getTestDb()
    .insert(exchangeRateRecalculationJobs)
    .values(ledgerIds.map((ledgerId) => ({ rateDate, ledgerId })));
}

describe("exchange-rate ledger recalculation orchestration", () => {
  beforeEach(async () => {
    recalculateLedgerForDateMock.mockReset().mockResolvedValue(undefined);
    deleteObject.mockReset().mockResolvedValue({ success: true });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("processes only one bounded batch of 25 jobs per run", async () => {
    const db = getTestDb();
    const ledgerIds: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      ledgerIds.push(await seedLedgerWithEntry({ entryDate: "2024-02-12" }));
    }

    await seedRecalculationJobs("2024-02-12", ledgerIds);
    await runBoundedExchangeRateRecalculation();

    expect(recalculateLedgerForDateMock).toHaveBeenCalledTimes(25);
    const remaining = await db.query.exchangeRateRecalculationJobs.findMany({
      where: eq(exchangeRateRecalculationJobs.status, "pending"),
    });
    expect(remaining).toHaveLength(5);

    await runBoundedExchangeRateRecalculation();
    expect(recalculateLedgerForDateMock).toHaveBeenCalledTimes(30);
    expect(await db.query.exchangeRateRecalculationJobs.findMany()).toEqual([]);
  });

  it("lets concurrent workers claim disjoint jobs", async () => {
    const ledgerIds = await Promise.all([
      seedLedgerWithEntry({ entryDate: "2024-02-13" }),
      seedLedgerWithEntry({ entryDate: "2024-02-13" }),
    ]);
    await seedRecalculationJobs("2024-02-13", ledgerIds);
    const now = new Date();

    const [first, second] = await Promise.all([
      claimExchangeRateRecalculations({ now, limit: 25, leaseMs: 300_000 }),
      claimExchangeRateRecalculations({ now, limit: 25, leaseMs: 300_000 }),
    ]);

    const claimedLedgerIds = new Set([...first, ...second].map((job) => job.ledgerId));
    expect(first.length + second.length).toBe(2);
    expect(claimedLedgerIds.size).toBe(2);
  });

  it("reclaims an expired claim and fences the old token", async () => {
    const db = getTestDb();
    const ledgerId = await seedLedgerWithEntry({ entryDate: "2024-02-14" });
    await seedRecalculationJobs("2024-02-14", [ledgerId]);
    const start = new Date();

    const first = await claimExchangeRateRecalculations({
      now: start,
      limit: 25,
      leaseMs: 300_000,
    });
    expect(first).toHaveLength(1);

    const expired = await claimExchangeRateRecalculations({
      now: new Date(start.getTime() + 300_001),
      limit: 25,
      leaseMs: 300_000,
    });
    expect(expired).toHaveLength(1);
    expect(expired[0]!.ledgerId).toBe(ledgerId);
    expect(expired[0]!.claimToken).not.toBe(first[0]!.claimToken);

    await expect(
      completeExchangeRateRecalculation({
        rateDate: "2024-02-14",
        ledgerId,
        claimToken: first[0]!.claimToken,
      })
    ).resolves.toBe(false);
    await expect(
      completeExchangeRateRecalculation({
        rateDate: "2024-02-14",
        ledgerId,
        claimToken: expired[0]!.claimToken,
      })
    ).resolves.toBe(true);
    expect(await db.query.exchangeRateRecalculationJobs.findMany()).toEqual([]);
  });

  it("backs off failed jobs and permanently fails after eight attempts", async () => {
    const db = getTestDb();
    const ledgerId = await seedLedgerWithEntry({ entryDate: "2024-02-15" });
    await seedRecalculationJobs("2024-02-15", [ledgerId]);
    let now = new Date();

    let job = (await claimExchangeRateRecalculations({ now, limit: 25, leaseMs: 300_000 }))[0]!;
    expect(job).toMatchObject({ rateDate: "2024-02-15", ledgerId, attempts: 0 });

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const outcome = await failExchangeRateRecalculation({
        rateDate: job.rateDate,
        ledgerId: job.ledgerId,
        claimToken: job.claimToken,
        now,
        errorCode: "RecalculationFailed",
      });
      if (attempt < 8) {
        expect(outcome).toBe("retry_scheduled");
        const row = await db.query.exchangeRateRecalculationJobs.findFirst({
          where: eq(exchangeRateRecalculationJobs.ledgerId, ledgerId),
        });
        expect(row).toMatchObject({
          status: "pending",
          attempts: attempt,
          lastError: "RecalculationFailed",
        });
        if (attempt === 1) {
          expect(row!.nextAttemptAt.getTime()).toBe(now.getTime() + 10_000);
        }
        now = new Date(row!.nextAttemptAt.getTime());
        job = (await claimExchangeRateRecalculations({ now, limit: 25, leaseMs: 300_000 }))[0]!;
      } else {
        expect(outcome).toBe("permanently_failed");
      }
    }

    const finalRow = await db.query.exchangeRateRecalculationJobs.findFirst({
      where: eq(exchangeRateRecalculationJobs.ledgerId, ledgerId),
    });
    expect(finalRow).toMatchObject({ status: "failed", attempts: 8 });
  });

  it("recovers pending jobs through bounded maintenance", async () => {
    const db = getTestDb();
    const ledgerId = await seedLedgerWithEntry({ entryDate: "2024-02-16" });
    await seedRecalculationJobs("2024-02-16", [ledgerId]);

    const now = new Date();
    await runBoundedMaintenance(now);

    expect(recalculateLedgerForDateMock).toHaveBeenCalledWith(ledgerId, "2024-02-16");
    expect(await db.query.exchangeRateRecalculationJobs.findMany()).toEqual([]);
  });

  it("backfills historical gaps only in migration and never recreates completed jobs in maintenance", async () => {
    const db = getTestDb();
    const date = "2024-02-16";
    const ledgerId = await seedLedgerWithEntry({ entryDate: date });
    const failedLedger = await seedLedgerWithEntry({ entryDate: null });
    const claimedLedger = await seedLedgerWithEntry({ entryDate: date, pendingOnly: true });
    const deletedLedger = await seedLedgerWithEntry({ entryDate: date, deleted: true });
    await db.insert(currencyRates).values({ date, base: "EUR", rates: { USD: 1.1, CNY: 8 } });
    const claimToken = crypto.randomUUID();
    await db.insert(exchangeRateRecalculationJobs).values([
      { rateDate: date, ledgerId: failedLedger, status: "failed", attempts: 8 },
      {
        rateDate: date,
        ledgerId: claimedLedger,
        status: "claimed",
        claimToken,
        claimExpiresAt: new Date(Date.now() + 300_000),
      },
    ]);
    const migration = readFileSync(
      "src/persistence/postgres-migrations/0035_maintenance_work_lifecycle.sql",
      "utf8"
    );
    const backfill = migration
      .split("--> statement-breakpoint")
      .at(-1)!
      .replaceAll("documents.entry_date", "documents.document_date")
      .replace(
        "entries.source_document_revision_id IN (documents.active_revision_id, documents.pending_revision_id)",
        "entries.source_document_revision_id = documents.active_revision_id"
      );
    await db.execute(sql.raw(backfill));
    const rows = await db.query.exchangeRateRecalculationJobs.findMany();
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.ledgerId === ledgerId)?.status).toBe("pending");
    expect(rows.find((row) => row.ledgerId === failedLedger)).toMatchObject({
      status: "failed",
      attempts: 8,
    });
    expect(rows.find((row) => row.ledgerId === claimedLedger)).toMatchObject({
      status: "claimed",
      claimToken,
    });
    expect(rows.some((row) => row.ledgerId === deletedLedger)).toBe(false);
    const now = new Date();
    await runBoundedMaintenance(now);
    expect(recalculateLedgerForDateMock).toHaveBeenCalledTimes(1);
    await runBoundedMaintenance(new Date(now.getTime() + 60_000));
    expect(recalculateLedgerForDateMock).toHaveBeenCalledTimes(1);
    expect(
      await db.query.exchangeRateRecalculationJobs.findFirst({
        where: eq(exchangeRateRecalculationJobs.ledgerId, ledgerId),
      })
    ).toBeUndefined();
  });

  it("recalculates only ledgers with active/pending entries on the event date", async () => {
    const db = getTestDb();
    const eventDate = "2026-02-10";
    const ledgerWithEntries = await seedLedgerWithEntry({
      mainCurrency: "USD",
      entryDate: eventDate,
    });
    const ledgerWithPendingEntry = await seedLedgerWithEntry({
      entryDate: eventDate,
      pendingOnly: true,
    });
    const ledgerOnOtherDate = await seedLedgerWithEntry({ entryDate: "2026-02-09" });
    const deletedLedger = await seedLedgerWithEntry({
      mainCurrency: "EUR",
      entryDate: eventDate,
      deleted: true,
    });

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ base: "EUR", date: eventDate, rates: { USD: 1.08, CNY: 7.65 } }),
    } as Response);
    await getExchangeRates(eventDate);
    expect(recalculateLedgerForDateMock).not.toHaveBeenCalled();
    expect(await db.query.exchangeRateRecalculationJobs.findMany()).toHaveLength(2);
    await drainDueExchangeRateRecalculations();

    expect(recalculateLedgerForDateMock).toHaveBeenCalledTimes(2);
    expect(recalculateLedgerForDateMock).toHaveBeenCalledWith(ledgerWithEntries, eventDate);
    expect(recalculateLedgerForDateMock).toHaveBeenCalledWith(ledgerWithPendingEntry, eventDate);
    expect(recalculateLedgerForDateMock).not.toHaveBeenCalledWith(
      ledgerOnOtherDate,
      expect.anything()
    );
    expect(recalculateLedgerForDateMock).not.toHaveBeenCalledWith(deletedLedger, expect.anything());
    expect(await db.query.exchangeRateRecalculationJobs.findMany()).toEqual([]);
  });

  it("recalculates ledgers with undated entries when rates are stored", async () => {
    const db = getTestDb();
    const eventDate = "2026-05-01";
    const ledgerWithUndatedEntry = await seedLedgerWithEntry({
      mainCurrency: "USD",
      entryDate: null,
    });
    const ledgerOnOtherDate = await seedLedgerWithEntry({ entryDate: "2026-04-30" });

    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ base: "EUR", date: eventDate, rates: { USD: 1.08, CNY: 7.65 } }),
    } as Response);
    await getExchangeRates(eventDate);
    expect(recalculateLedgerForDateMock).not.toHaveBeenCalled();
    expect(await db.query.exchangeRateRecalculationJobs.findMany()).toHaveLength(1);
    await drainDueExchangeRateRecalculations();

    expect(recalculateLedgerForDateMock).toHaveBeenCalledTimes(1);
    expect(recalculateLedgerForDateMock).toHaveBeenCalledWith(ledgerWithUndatedEntry, eventDate);
    expect(recalculateLedgerForDateMock).not.toHaveBeenCalledWith(
      ledgerOnOtherDate,
      expect.anything()
    );
    expect(await db.query.exchangeRateRecalculationJobs.findMany()).toEqual([]);
  });

  it("stores durable jobs without spawning work until an explicit drain", async () => {
    const db = getTestDb();
    const ledgerId = await seedLedgerWithEntry({ mainCurrency: "CNY", entryDate: "2024-02-10" });
    const drainSpy = vi.spyOn(recalculation, "drainDueExchangeRateRecalculations");
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ base: "EUR", date: "2024-02-10", rates: { USD: 1.08, CNY: 7.65 } }),
    } as Response);
    const lookup = () => getExchangeRates("2024-02-10");

    await lookup();
    await lookup();
    expect(drainSpy).not.toHaveBeenCalled();
    expect(recalculateLedgerForDateMock).not.toHaveBeenCalled();
    const jobs = await db.query.exchangeRateRecalculationJobs.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      ledgerId,
      rateDate: "2024-02-10",
      status: "pending",
      claimToken: null,
    });
    expect(
      await db.query.currencyRates.findFirst({ where: eq(currencyRates.date, "2024-02-10") })
    ).toBeDefined();

    await recalculation.drainDueExchangeRateRecalculations();
    expect(drainSpy).toHaveBeenCalledTimes(1);
    expect(recalculateLedgerForDateMock).toHaveBeenCalledExactlyOnceWith(ledgerId, "2024-02-10");
    expect(await db.query.exchangeRateRecalculationJobs.findMany()).toEqual([]);
    await lookup();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(drainSpy).toHaveBeenCalledTimes(1);
    expect(await db.query.exchangeRateRecalculationJobs.findMany()).toEqual([]);
  });

  it("does not fail orchestration when a single recalculation throws", async () => {
    const db = getTestDb();
    const userId = crypto.randomUUID();
    const secondUserId = crypto.randomUUID();
    const ledgerId = crypto.randomUUID();
    const secondLedgerId = crypto.randomUUID();
    const sourceDocumentId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    const secondSourceDocumentId = crypto.randomUUID();
    const secondRevisionId = crypto.randomUUID();

    await db.insert(users).values({ id: userId });
    await db.insert(loginEmails).values({
      userId: userId,
      email: `${userId}@example.com`,
      emailVerified: new Date(),
    });
    await db.insert(users).values({ id: secondUserId });
    await db.insert(loginEmails).values({
      userId: secondUserId,
      email: `${secondUserId}@example.com`,
      emailVerified: new Date(),
    });
    await db.insert(ledgers).values([
      { id: ledgerId, userId, mainCurrency: "JPY" },
      { id: secondLedgerId, userId: secondUserId, mainCurrency: "USD" },
    ]);
    await createTestBooks(db, ledgerId, ["共同支出"]);
    await createTestBooks(db, secondLedgerId, ["共同支出"]);
    await db.insert(sourceDocuments).values([
      {
        id: sourceDocumentId,
        ledgerId,
        documentDate: "2026-03-01",
        bookId: await testBookId(db, ledgerId),
      },
      {
        id: secondSourceDocumentId,
        ledgerId: secondLedgerId,
        documentDate: "2026-03-01",
        bookId: await testBookId(db, secondLedgerId),
      },
    ]);
    await db.insert(sourceDocumentRevisions).values([
      {
        id: revisionId,
        ledgerId,
        sourceDocumentId,
        revisionNumber: 1,
      },
      {
        id: secondRevisionId,
        ledgerId: secondLedgerId,
        sourceDocumentId: secondSourceDocumentId,
        revisionNumber: 1,
      },
    ]);
    await db
      .update(sourceDocuments)
      .set({ activeRevisionId: revisionId })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    await db
      .update(sourceDocuments)
      .set({ activeRevisionId: secondRevisionId })
      .where(eq(sourceDocuments.id, secondSourceDocumentId));
    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId,
        sourceDocumentRevisionId: revisionId,
        amount: "10.00",
        currency: "USD",
        itemName: "A",
      },
      {
        ledgerId: secondLedgerId,
        sourceDocumentId: secondSourceDocumentId,
        sourceDocumentRevisionId: secondRevisionId,
        amount: "20.00",
        currency: "USD",
        itemName: "B",
      },
    ]);

    recalculateLedgerForDateMock.mockImplementation(async (id: string) => {
      if (id === ledgerId) {
        throw new Error("test recalculation error");
      }
    });

    await seedRecalculationJobs("2026-03-01", [ledgerId, secondLedgerId]);
    await expect(drainDueExchangeRateRecalculations()).resolves.toBeUndefined();
    expect(recalculateLedgerForDateMock).toHaveBeenCalledWith(ledgerId, "2026-03-01");
    expect(recalculateLedgerForDateMock).toHaveBeenCalledWith(secondLedgerId, "2026-03-01");

    const persisted = await db.query.exchangeRateRecalculationJobs.findFirst({
      where: eq(exchangeRateRecalculationJobs.ledgerId, ledgerId),
    });
    expect(persisted).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "Error",
    });
    expect(await db.query.ledgers.findFirst({ where: eq(ledgers.id, ledgerId) })).toBeDefined();
  });

  it("processes claimed recalculations sequentially without dropping jobs", async () => {
    const eventDate = "2026-04-01";
    const ledgerIds = await Promise.all(
      Array.from({ length: 7 }, () => seedLedgerWithEntry({ entryDate: eventDate }))
    );

    let active = 0;
    let maxActive = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    recalculateLedgerForDateMock.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
    });

    await seedRecalculationJobs(eventDate, ledgerIds);
    const pending = drainDueExchangeRateRecalculations();

    await vi.waitFor(
      () => {
        expect(maxActive).toBeGreaterThanOrEqual(1);
      },
      { timeout: 5_000 }
    );
    expect(maxActive).toBe(1);

    release();
    await pending;

    expect(recalculateLedgerForDateMock).toHaveBeenCalledTimes(ledgerIds.length);
  });

  it("recalculates dated and undated entries with recalculateLedgerForDate", async () => {
    const db = getTestDb();
    const userId = crypto.randomUUID();
    const ledgerId = crypto.randomUUID();
    const datedSourceDocumentId = crypto.randomUUID();
    const undatedSourceDocumentId = crypto.randomUUID();
    const datedRevisionId = crypto.randomUUID();
    const undatedRevisionId = crypto.randomUUID();

    await db.insert(users).values({ id: userId });
    await db.insert(loginEmails).values({
      userId: userId,
      email: `${userId}@example.com`,
      emailVerified: new Date(),
    });
    await db.insert(ledgers).values({ id: ledgerId, userId, mainCurrency: "CNY" });
    await createTestBooks(db, ledgerId, ["共同支出"]);

    // Older rates first: undated entries must use the newest stored date.
    await db.insert(currencyRates).values({
      date: "2026-05-01",
      base: "EUR",
      rates: { USD: 1.0, CNY: 7.0 },
    });
    await db.insert(currencyRates).values({
      date: "2026-06-01",
      base: "EUR",
      rates: { USD: 1.08, CNY: 7.65 },
    });

    await db.insert(sourceDocuments).values([
      {
        id: datedSourceDocumentId,
        ledgerId,
        documentDate: "2026-06-01",
        bookId: await testBookId(db, ledgerId),
      },
      {
        id: undatedSourceDocumentId,
        ledgerId,
        documentDate: null,
        bookId: await testBookId(db, ledgerId),
      },
    ]);
    await db.insert(sourceDocumentRevisions).values([
      {
        id: datedRevisionId,
        ledgerId,
        sourceDocumentId: datedSourceDocumentId,
        revisionNumber: 1,
      },
      {
        id: undatedRevisionId,
        ledgerId,
        sourceDocumentId: undatedSourceDocumentId,
        revisionNumber: 1,
      },
    ]);
    await db
      .update(sourceDocuments)
      .set({ activeRevisionId: datedRevisionId })
      .where(eq(sourceDocuments.id, datedSourceDocumentId));
    await db
      .update(sourceDocuments)
      .set({ activeRevisionId: undatedRevisionId })
      .where(eq(sourceDocuments.id, undatedSourceDocumentId));
    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId: datedSourceDocumentId,
        sourceDocumentRevisionId: datedRevisionId,
        amount: "100.00",
        currency: "USD",
        itemName: "Dated",
        convertedAmount: "0.00",
        exchangeRate: "0.000000",
      },
      {
        ledgerId,
        sourceDocumentId: undatedSourceDocumentId,
        sourceDocumentRevisionId: undatedRevisionId,
        amount: "200.00",
        currency: "USD",
        itemName: "Undated",
        convertedAmount: "0.00",
        exchangeRate: "0.000000",
      },
    ]);

    await expect(
      postgresCurrencyAdapter.recalculateLedgerForDate(ledgerId, "2026-06-01")
    ).resolves.toBe(2);

    const [entries, documentsAfterChange] = await Promise.all([
      db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.ledgerId, ledgerId),
      }),
      db.query.sourceDocuments.findMany({
        where: eq(sourceDocuments.ledgerId, ledgerId),
      }),
    ]);
    const byName = new Map(entries.map((entry) => [entry.itemName, entry]));

    // 100 USD * (7.65 / 1.08) = 708.33 CNY
    expect(byName.get("Dated")?.convertedAmount).toBe("708.330");
    expect(byName.get("Dated")?.exchangeRate).toBe("7.083333333333");
    // Undated entries use the latest stored rate (2026-06-01), not 7.0.
    expect(byName.get("Undated")?.convertedAmount).toBe("1416.670");
    expect(byName.get("Undated")?.exchangeRate).toBe("7.083333333333");
    expect(documentsAfterChange.every((document) => document.version === 2)).toBe(true);

    await expect(
      postgresCurrencyAdapter.recalculateLedgerForDate(ledgerId, "2026-06-01")
    ).resolves.toBe(0);
    const documentsAfterNoop = await db.query.sourceDocuments.findMany({
      where: eq(sourceDocuments.ledgerId, ledgerId),
    });
    expect(
      documentsAfterNoop.map((document) => ({
        id: document.id,
        version: document.version,
        updatedAt: document.updatedAt,
      }))
    ).toEqual(
      documentsAfterChange.map((document) => ({
        id: document.id,
        version: document.version,
        updatedAt: document.updatedAt,
      }))
    );
  });

  it("uses the shared zero-decimal precision for ISK recalculation", async () => {
    const db = getTestDb();
    const ledgerId = await seedLedgerWithEntry({
      mainCurrency: "ISK",
      entryDate: "2026-09-04",
    });
    await db.insert(currencyRates).values({
      date: "2026-09-04",
      base: "EUR",
      rates: { USD: 1, ISK: 1.405 },
    });

    await expect(
      postgresCurrencyAdapter.recalculateLedgerForDate(ledgerId, "2026-09-04")
    ).resolves.toBe(1);

    const entry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.ledgerId, ledgerId),
    });
    expect(entry?.convertedAmount).toBe("141.000");
  });
});
