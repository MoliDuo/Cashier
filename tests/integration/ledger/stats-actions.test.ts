import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { entryCategories, ledgerEntries, ledgers, loginEmails, users } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { randomUUID } from "node:crypto";
import { getLedgerStatsAction } from "@/modules/ledger/server/stats";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";
const OTHER_USER_ID = "11111111-1111-1111-1111-111111111111";

async function seedEntry(
  db: ReturnType<typeof getTestDb>,
  ledgerId: string,
  opts: {
    amount: string;
    currency?: string;
    convertedAmount?: string | null;
    categoryId?: string;
    entryDate?: string;
  }
) {
  const [doc] = await db
    .insert(sourceDocuments)
    .values({
      id: randomUUID(),
      ledgerId,
      documentDate: opts.entryDate ?? null,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    })
    .returning();
  expect(doc).toBeDefined();
  if (doc === undefined) {
    throw new Error("Expected source document insert to return a row");
  }

  await db.insert(ledgerEntries).values({
    id: randomUUID(),
    ledgerId,
    sourceDocumentId: doc.id,
    itemName: "Test Item",
    amount: opts.amount,
    currency: opts.currency === undefined ? "CNY" : opts.currency,
    convertedAmount: opts.convertedAmount === undefined ? opts.amount : opts.convertedAmount,
    categoryId: opts.categoryId ?? null,
  });
  await activateTestSourceDocumentProjection(db, doc.id);

  return doc;
}

describe("getLedgerStatsAction", () => {
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

  it("returns zero values for empty ledger", async () => {
    const result = await getLedgerStatsAction({});
    expect(result.totals).toHaveLength(0);
    expect(result.trend).toHaveLength(0);
    expect(result.convertedTotal).not.toBeNull();
    expect(result.convertedTotal?.total).toBe("0");
    expect(result.convertedTotal?.currency).toBe("CNY");
  });

  it("groups totals by currency", async () => {
    const db = getTestDb();
    await seedEntry(db, ledgerId, { amount: "100.00", currency: "CNY" });
    await seedEntry(db, ledgerId, { amount: "50.00", currency: "CNY" });
    await seedEntry(db, ledgerId, { amount: "20.00", currency: "USD" });

    const result = await getLedgerStatsAction({});
    const cny = result.totals.find((t) => t.currency === "CNY");
    const usd = result.totals.find((t) => t.currency === "USD");

    expect(cny).toBeDefined();
    expect(cny!.total).toBe("150");
    expect(cny!.count).toBe(2);
    expect(usd).toBeDefined();
    expect(usd!.total).toBe("20");
    expect(usd!.count).toBe(1);
  });

  it("uses the persisted main currency for entries", async () => {
    const db = getTestDb();
    await db
      .update(ledgers)
      .set({ mainCurrency: "USD" })
      .where(sql`${ledgers.id} = ${ledgerId}`);
    await seedEntry(db, ledgerId, {
      amount: "12.50",
      currency: "USD",
      convertedAmount: "12.50",
    });

    const result = await getLedgerStatsAction({ currency: " usd " });

    expect(result.convertedTotal).toEqual({ total: "12.5", currency: "USD" });
    expect(result.totals).toEqual([{ currency: "USD", total: "12.5", count: 1 }]);
  });

  it("groups raw totals by category and effective currency", async () => {
    const db = getTestDb();
    const categoryId = randomUUID();
    await db.insert(entryCategories).values({
      id: categoryId,
      ledgerId,
      name: "Food",
      icon: "utensils",
      sortOrder: 1,
    });
    await seedEntry(db, ledgerId, {
      amount: "8.25",
      currency: "CNY",
      categoryId,
      convertedAmount: "8.25",
    });
    await seedEntry(db, ledgerId, {
      amount: "3.75",
      currency: "CNY",
      categoryId,
      convertedAmount: "3.75",
    });

    const result = await getLedgerStatsAction({});

    expect(result.byCategory).toContainEqual({
      categoryId,
      categoryName: "Food",
      categoryIcon: "utensils",
      currency: "CNY",
      total: "12",
      count: 2,
    });
  });

  it("returns trend sorted by date", async () => {
    const db = getTestDb();
    await seedEntry(db, ledgerId, { amount: "30.00", currency: "CNY", entryDate: "2024-01-03" });
    await seedEntry(db, ledgerId, { amount: "10.00", currency: "CNY", entryDate: "2024-01-01" });
    await seedEntry(db, ledgerId, { amount: "20.00", currency: "CNY", entryDate: "2024-01-02" });

    const result = await getLedgerStatsAction({});
    expect(result.trend).toHaveLength(3);
    const firstTrend = result.trend[0];
    const secondTrend = result.trend[1];
    const thirdTrend = result.trend[2];
    expect(firstTrend).toBeDefined();
    expect(secondTrend).toBeDefined();
    expect(thirdTrend).toBeDefined();
    expect(firstTrend?.date).toBe("2024-01-01");
    expect(secondTrend?.date).toBe("2024-01-02");
    expect(thirdTrend?.date).toBe("2024-01-03");
  });

  it("filters by startDate using the source document accounting date", async () => {
    const db = getTestDb();
    await seedEntry(db, ledgerId, { amount: "100.00", currency: "CNY", entryDate: "2024-01-01" });
    await seedEntry(db, ledgerId, { amount: "200.00", currency: "CNY", entryDate: "2024-02-01" });
    await seedEntry(db, ledgerId, { amount: "300.00", currency: "CNY", entryDate: "2024-03-01" });

    const result = await getLedgerStatsAction({ startDate: "2024-02-01" });
    const cny = result.totals.find((t) => t.currency === "CNY");
    expect(cny!.count).toBe(2);
    expect(cny!.total).toBe("500");
  });

  it("filters by endDate using the source document accounting date", async () => {
    const db = getTestDb();
    await seedEntry(db, ledgerId, { amount: "100.00", currency: "CNY", entryDate: "2024-01-01" });
    await seedEntry(db, ledgerId, { amount: "200.00", currency: "CNY", entryDate: "2024-02-01" });
    await seedEntry(db, ledgerId, { amount: "300.00", currency: "CNY", entryDate: "2024-03-01" });

    const result = await getLedgerStatsAction({ endDate: "2024-02-01" });
    const cny = result.totals.find((t) => t.currency === "CNY");
    expect(cny!.count).toBe(2);
    expect(cny!.total).toBe("300");
  });

  it("filters by categoryId", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "餐饮",
      sortOrder: 1,
    });

    await seedEntry(db, ledgerId, { amount: "100.00", currency: "CNY", categoryId: catId });
    await seedEntry(db, ledgerId, { amount: "200.00", currency: "CNY" }); // no category

    const result = await getLedgerStatsAction({
      categoryId: catId,
    });
    const cny = result.totals.find((t) => t.currency === "CNY");
    expect(cny!.count).toBe(1);
    expect(cny!.total).toBe("100");
  });

  it("filters by currency", async () => {
    const db = getTestDb();
    await seedEntry(db, ledgerId, { amount: "100.00", currency: "CNY" });
    await seedEntry(db, ledgerId, { amount: "50.00", currency: "USD" });

    const result = await getLedgerStatsAction({
      currency: "USD",
    });
    expect(result.totals).toHaveLength(1);
    const firstTotal = result.totals[0];
    expect(firstTotal).toBeDefined();
    expect(firstTotal?.currency).toBe("USD");
  });

  it("filters by minAmount using convertedAmount", async () => {
    const db = getTestDb();
    await seedEntry(db, ledgerId, { amount: "50.00", currency: "CNY", convertedAmount: "50.00" });
    await seedEntry(db, ledgerId, { amount: "200.00", currency: "CNY", convertedAmount: "200.00" });

    const result = await getLedgerStatsAction({
      minAmount: "100",
    });
    const cny = result.totals.find((t) => t.currency === "CNY");
    expect(cny!.count).toBe(1);
    expect(cny!.total).toBe("200");
  });

  it("filters by maxAmount using convertedAmount", async () => {
    const db = getTestDb();
    await seedEntry(db, ledgerId, { amount: "50.00", currency: "CNY", convertedAmount: "50.00" });
    await seedEntry(db, ledgerId, { amount: "200.00", currency: "CNY", convertedAmount: "200.00" });

    const result = await getLedgerStatsAction({
      maxAmount: "100",
    });
    const cny = result.totals.find((t) => t.currency === "CNY");
    expect(cny!.count).toBe(1);
    expect(cny!.total).toBe("50");
  });

  it("uses stored convertedAmount for convertedTotal", async () => {
    const db = getTestDb();

    // Entry with pre-calculated convertedAmount (e.g., from AI processing)
    // 110 USD converted to 720 CNY
    await seedEntry(db, ledgerId, {
      amount: "110.00",
      currency: "USD",
      convertedAmount: "720.00", // Pre-converted amount
      entryDate: "2024-01-15",
    });

    const result = await getLedgerStatsAction({});
    expect(result.convertedTotal).not.toBeNull();
    expect(result.convertedTotal?.currency).toBe("CNY");
    expect(result.convertedTotal?.total).toBe("720");
  });

  it("excludes unconverted entries from the main total but keeps original currency totals", async () => {
    const db = getTestDb();
    await seedEntry(db, ledgerId, {
      amount: "100.00",
      currency: "USD",
      convertedAmount: null,
      entryDate: "2024-01-15",
    });
    await seedEntry(db, ledgerId, {
      amount: "50.00",
      currency: "CNY",
      convertedAmount: "50.00",
      entryDate: "2024-01-15",
    });

    const result = await getLedgerStatsAction({});

    expect(result.convertedTotal?.total).toBe("50");
    expect(result.unconvertedCount).toBe(1);
    expect(result.totals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: "USD", total: "100", count: 1 }),
        expect.objectContaining({ currency: "CNY", total: "50", count: 1 }),
      ])
    );
  });

  it("single currency ledger: convertedTotal equals sum of amounts", async () => {
    const db = getTestDb();
    await seedEntry(db, ledgerId, { amount: "100.00", currency: "CNY" });
    await seedEntry(db, ledgerId, { amount: "50.00", currency: "CNY" });

    const result = await getLedgerStatsAction({});
    expect(result.convertedTotal).not.toBeNull();
    expect(result.convertedTotal?.total).toBe("150");
    expect(result.convertedTotal?.currency).toBe("CNY");
  });

  it("includes undated documents on their effective (UTC creation) date", async () => {
    const db = getTestDb();
    await seedEntry(db, ledgerId, { amount: "75.00", currency: "CNY" });
    // Point the undated document at a fixed UTC creation date.
    await db
      .update(sourceDocuments)
      .set({ createdAt: new Date("2024-04-08T20:00:00Z") })
      .where(sql`${sourceDocuments.ledgerId} = ${ledgerId}`);

    const unfiltered = await getLedgerStatsAction({});
    expect(unfiltered.convertedTotal?.total).toBe("75");
    expect(unfiltered.trend).toEqual([{ date: "2024-04-08", total: "75" }]);

    const filtered = await getLedgerStatsAction({
      startDate: "2024-04-08",
      endDate: "2024-04-08",
    });
    const cny = filtered.totals.find((total) => total.currency === "CNY");
    expect(cny?.count).toBe(1);

    const outside = await getLedgerStatsAction({ startDate: "2024-04-09" });
    expect(outside.totals).toHaveLength(0);
    expect(outside.trend).toHaveLength(0);
  });

  it("executes the summary as a single SQL statement", async () => {
    const db = getTestDb();
    await seedEntry(db, ledgerId, { amount: "10.00", currency: "CNY", entryDate: "2024-01-01" });
    await seedEntry(db, ledgerId, { amount: "20.00", currency: "USD", entryDate: "2024-01-02" });

    const dbWithClient = getTestDb() as unknown as {
      $client?: {
        query: (query: string | { text?: string }, ...args: unknown[]) => Promise<unknown>;
      };
    };
    const client = dbWithClient.$client;
    if (client == null) {
      throw new Error("Expected drizzle client to exist in integration tests");
    }
    const originalQuery = client.query.bind(client);
    const statements: string[] = [];
    client.query = ((query: string | { text?: string }, ...args: unknown[]) => {
      statements.push(typeof query === "string" ? query : (query.text ?? ""));
      return originalQuery(query, ...args);
    }) as typeof client.query;

    try {
      await getLedgerStatsAction({});
    } finally {
      client.query = originalQuery;
    }

    const summaryStatements = statements
      .map((statement) => statement.toLowerCase().replace(/\s+/g, " ").trim())
      .filter((statement) => statement.includes("visible_entries"));
    expect(summaryStatements).toHaveLength(1);
  });

  it("fails closed once another account's live ledger makes the single ledger ambiguous", async () => {
    const db = getTestDb();

    await db.insert(users).values({
      id: OTHER_USER_ID,
      name: "Other User",
    });

    await db.insert(loginEmails).values({
      userId: OTHER_USER_ID,
      email: "other@example.com",
      emailVerified: new Date(),
    });

    const otherLedgerId = randomUUID();
    await db.insert(ledgers).values({
      id: otherLedgerId,
      userId: OTHER_USER_ID,
    });

    await expect(getLedgerStatsAction({})).rejects.toThrow("Ledger not found");
  });
});
