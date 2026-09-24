import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ValidationError } from "@/lib/errors";
import { getTestDb } from "tests/setup";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
} from "tests/helpers/schema-setup";
import {
  currencyRates,
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";
import {
  getEnhancedStats,
  getEnhancedStatsQuery,
} from "@/modules/stats/application/queries/get-enhanced-stats";
import { serverComposition } from "@/application/server-composition-root";

async function getTargetEnhancedStatsQuery({
  ledgerId,
  ...input
}: Parameters<typeof getEnhancedStatsQuery>[1] & { ledgerId: string }): ReturnType<
  typeof getEnhancedStatsQuery
> {
  const db = getTestDb();
  const documents = await db.query.sourceDocuments.findMany({
    where: (documents, { eq }) => eq(documents.ledgerId, ledgerId),
    columns: { id: true },
  });
  for (const document of documents) {
    await activateTestSourceDocumentProjection(db, document.id);
  }
  return getEnhancedStatsQuery(ledgerId, input, serverComposition.stats);
}

function requireFirst<T>(rows: readonly T[], label: string): T {
  const first = rows[0];
  if (first == null) {
    throw new Error(`Expected ${label}`);
  }
  return first;
}

describe("getEnhancedStatsQuery", () => {
  let ledgerId = "";
  let categoryId = "";

  beforeEach(async () => {
    const db = getTestDb();
    const setup = await createTestUserWithLedger(db);
    ledgerId = setup.ledgerId;

    const insertedCategories = await db
      .insert(entryCategories)
      .values({
        ledgerId,
        name: "餐饮",
        sortOrder: 1,
      })
      .returning();
    categoryId = requireFirst(insertedCategories, "category").id;
  });

  it("validates public query inputs before executing", async () => {
    await expect(
      getEnhancedStats(
        ledgerId,
        {
          queryRange: { from: "2024-03-31", to: "2024-03-01" },
          compareRange: { from: "2024-02-29", to: "2024-02-01" },
        },
        serverComposition.stats
      )
    ).rejects.toThrow(ValidationError);
  });

  it("converts mixed currencies by effective date using ledger main currency", async () => {
    const db = getTestDb();
    await db.update(ledgers).set({ mainCurrency: "CNY" }).where(eq(ledgers.id, ledgerId));

    await db.insert(currencyRates).values([
      {
        date: "2024-03-01",
        base: "EUR",
        rates: { USD: 2, CNY: 4 },
      },
      {
        date: "2024-03-02",
        base: "EUR",
        rates: { USD: 2, CNY: 4 },
      },
    ]);

    const insertedDocs = await db
      .insert(sourceDocuments)
      .values([
        {
          ledgerId,
          documentDate: "2024-03-01",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ledgerId,
          documentDate: "2024-03-02",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
      ])
      .returning();

    const firstDoc = requireFirst(insertedDocs, "first document");
    const secondDoc = insertedDocs[1];
    if (secondDoc == null) {
      throw new Error("Expected second document");
    }

    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId: firstDoc.id,
        amount: "20",
        convertedAmount: "40",
        exchangeRate: "2",
        currency: "USD",
        itemName: "USD item",
        categoryId,
      },
      {
        ledgerId,
        sourceDocumentId: secondDoc.id,
        amount: "30",
        convertedAmount: "30",
        exchangeRate: "1",
        currency: "CNY",
        itemName: "CNY item",
        categoryId,
      },
    ]);

    const result = await getTargetEnhancedStatsQuery({
      ledgerId,
      queryRange: { from: "2024-03-01", to: "2024-03-31" },
      compareRange: { from: "2024-02-01", to: "2024-02-29" },
    });

    expect(result.summary.currency).toBe("CNY");
    expect(result.summary.total).toBe("70");
    expect(result.summary.comparison).toMatchObject({
      mode: "same_period",
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(result.chart).toEqual([
      { date: "2024-03-01", total: "40" },
      { date: "2024-03-02", total: "30" },
    ]);
    // Nothing was recorded in February, so the comparison series is empty
    // rather than echoing the current window back.
    expect(result.previousChart).toEqual([]);
  });

  it("counts documents with a null entry date by their effective date", async () => {
    const db = getTestDb();

    const insertedDoc = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: null,
        createdAt: new Date("2024-03-10T12:00:00Z"),
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const doc = requireFirst(insertedDoc, "document");

    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: doc.id,
      amount: "40",
      convertedAmount: "40",
      currency: "CNY",
      itemName: "null entry date item",
      categoryId,
    });

    const result = await getTargetEnhancedStatsQuery({
      ledgerId,
      queryRange: { from: "2024-03-01", to: "2024-03-31" },
      compareRange: { from: "2024-02-01", to: "2024-02-29" },
    });

    expect(result.summary.total).toBe("40");
    expect(result.chart).toEqual([{ date: "2024-03-10", total: "40" }]);
  });

  it("counts active projections even while the document is pending", async () => {
    const db = getTestDb();

    const insertedDoc = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: "2024-03-12",
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const doc = requireFirst(insertedDoc, "document");

    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: doc.id,
      amount: "55",
      convertedAmount: "55",
      currency: "CNY",
      itemName: "pending reprocess item",
      categoryId,
    });
    // Activate the projection, then simulate an in-flight reprocessing pass
    // that leaves the previous active projection in place.
    await activateTestSourceDocumentProjection(db, doc.id);
    const [latestSubmission] = await db
      .insert(sourceDocumentRevisions)
      .values({
        ledgerId,
        sourceDocumentId: doc.id,
        revisionNumber: 2,
        origin: "submission",
        processingStatus: "processing",
      })
      .returning({ id: sourceDocumentRevisions.id });
    await db
      .update(sourceDocuments)
      .set({ latestSubmissionRevisionId: latestSubmission!.id })
      .where(eq(sourceDocuments.id, doc.id));

    const result = await getTargetEnhancedStatsQuery({
      ledgerId,
      queryRange: { from: "2024-03-01", to: "2024-03-31" },
      compareRange: { from: "2024-02-01", to: "2024-02-29" },
    });

    expect(result.summary.total).toBe("55");
  });

  it("filters out entries linked to soft-deleted source documents", async () => {
    const db = getTestDb();

    const insertedDocs = await db
      .insert(sourceDocuments)
      .values([
        {
          ledgerId,
          documentDate: "2024-03-05",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ledgerId,
          documentDate: "2024-03-05",
          deletedAt: new Date(),
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
      ])
      .returning();

    const activeDoc = requireFirst(insertedDocs, "active document");
    const deletedDoc = insertedDocs[1];
    if (deletedDoc == null) {
      throw new Error("Expected deleted document");
    }

    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId: activeDoc.id,
        amount: "100",
        convertedAmount: "100",
        currency: "CNY",
        itemName: "active item",
        categoryId,
      },
      {
        ledgerId,
        sourceDocumentId: deletedDoc.id,
        amount: "999",
        convertedAmount: "999",
        currency: "CNY",
        itemName: "deleted item",
        categoryId,
      },
    ]);

    const result = await getTargetEnhancedStatsQuery({
      ledgerId,
      queryRange: { from: "2024-03-01", to: "2024-03-31" },
      compareRange: { from: "2024-02-01", to: "2024-02-29" },
    });

    expect(result.summary.total).toBe("100");
    expect(result.heatmap.days).toHaveLength(1);
    expect(result.heatmap.days[0]?.totalAmount).toBe("100");
  });

  it("excludes entries when rates are missing", async () => {
    const db = getTestDb();
    await db.update(ledgers).set({ mainCurrency: "USD" }).where(eq(ledgers.id, ledgerId));

    await db.insert(currencyRates).values({
      date: "2024-04-01",
      base: "EUR",
      rates: { CNY: 7.8 },
    });

    const insertedDoc = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: "2024-04-01",
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const doc = requireFirst(insertedDoc, "document");

    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId: doc.id,
        amount: "50",
        currency: "JPY",
        itemName: "missing rate",
        categoryId,
      },
      {
        ledgerId,
        sourceDocumentId: doc.id,
        amount: "25",
        currency: "USD",
        convertedAmount: "25",
        exchangeRate: "1",
        itemName: "main currency",
        categoryId,
      },
    ]);

    const result = await getTargetEnhancedStatsQuery({
      ledgerId,
      queryRange: { from: "2024-04-01", to: "2024-04-30" },
      compareRange: { from: "2024-03-01", to: "2024-03-31" },
    });

    expect(result.summary.currency).toBe("USD");
    expect(result.summary.total).toBe("25");
    expect(result.unconvertedCount).toBe(1);
  });

  it("defaults summary currency to CNY when ledger main currency is absent", async () => {
    const db = getTestDb();

    const insertedDoc = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: "2024-05-01",
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const doc = requireFirst(insertedDoc, "document");

    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: doc.id,
      amount: "10",
      convertedAmount: "10",
      currency: "CNY",
      itemName: "default currency item",
      categoryId,
    });

    const result = await getTargetEnhancedStatsQuery({
      ledgerId,
      queryRange: { from: "2024-05-01", to: "2024-05-31" },
      compareRange: { from: "2024-04-01", to: "2024-04-30" },
    });

    expect(result.summary.currency).toBe("CNY");
    expect(result.summary.total).toBe("10");
  });

  it("computes heatmap p80Amount using zero-based percentile indexing", async () => {
    const db = getTestDb();
    const dailyAmounts = [10, 20, 30, 40, 50];

    for (const [index, amount] of dailyAmounts.entries()) {
      const day = String(index + 1).padStart(2, "0");
      const [doc] = await db
        .insert(sourceDocuments)
        .values({
          ledgerId,
          documentDate: `2024-06-${day}`,
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning();

      await db.insert(ledgerEntries).values({
        ledgerId,
        sourceDocumentId: doc!.id,
        amount: String(amount),
        convertedAmount: String(amount),
        currency: "CNY",
        itemName: `item-${day}`,
        categoryId,
      });
    }

    const result = await getTargetEnhancedStatsQuery({
      ledgerId,
      queryRange: { from: "2024-06-01", to: "2024-06-30" },
      compareRange: { from: "2024-05-01", to: "2024-05-31" },
    });

    expect(result.heatmap.stats.p80Amount).toBe("40");
  });

  it("aggregates multiple entries with the same date, category, and currency", async () => {
    const db = getTestDb();

    // Create a second category to exercise multiple aggregate groups on the same date
    const insertedSecondCategory = await db
      .insert(entryCategories)
      .values({
        ledgerId,
        name: "交通",
        sortOrder: 2,
      })
      .returning();
    const secondCategoryId = requireFirst(insertedSecondCategory, "second category").id;

    const [doc] = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: "2024-07-01",
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();

    await db.insert(ledgerEntries).values([
      // 3 entries with first category
      {
        ledgerId,
        sourceDocumentId: doc!.id,
        amount: "100",
        convertedAmount: "100",
        currency: "CNY",
        itemName: "item 1",
        categoryId,
      },
      {
        ledgerId,
        sourceDocumentId: doc!.id,
        amount: "200",
        convertedAmount: "200",
        currency: "CNY",
        itemName: "item 2",
        categoryId,
      },
      {
        ledgerId,
        sourceDocumentId: doc!.id,
        amount: "300",
        convertedAmount: "300",
        currency: "CNY",
        itemName: "item 3",
        categoryId,
      },
      // 2 entries with second category (different aggregate group, same date)
      {
        ledgerId,
        sourceDocumentId: doc!.id,
        amount: "50",
        convertedAmount: "50",
        currency: "CNY",
        itemName: "item 4",
        categoryId: secondCategoryId,
      },
      {
        ledgerId,
        sourceDocumentId: doc!.id,
        amount: "150",
        convertedAmount: "150",
        currency: "CNY",
        itemName: "item 5",
        categoryId: secondCategoryId,
      },
    ]);

    const result = await getTargetEnhancedStatsQuery({
      ledgerId,
      queryRange: { from: "2024-07-01", to: "2024-07-31" },
      compareRange: { from: "2024-06-01", to: "2024-06-30" },
    });

    expect(result.summary.total).toBe("800");

    expect(result.categories).toHaveLength(2);

    const primaryCategory = result.categories.find((c) => c.id === categoryId);
    const secondaryCategory = result.categories.find((c) => c.id === secondCategoryId);
    expect(primaryCategory).toBeDefined();
    expect(secondaryCategory).toBeDefined();

    // Strict numeric type assertions on category counts
    expect(typeof primaryCategory!.count).toBe("number");
    expect(primaryCategory!.count).toBe(3);
    expect(primaryCategory!.totalConverted).toBe("600");

    expect(typeof secondaryCategory!.count).toBe("number");
    expect(secondaryCategory!.count).toBe(2);
    expect(secondaryCategory!.totalConverted).toBe("200");

    expect(result.chart).toHaveLength(1);
    expect(result.chart[0]?.date).toBe("2024-07-01");
    expect(result.chart[0]?.total).toBe("800");

    expect(result.heatmap.days).toHaveLength(1);

    // Strict numeric type assertion on heatmap entry count
    expect(typeof result.heatmap.days[0]!.entryCount).toBe("number");
    expect(result.heatmap.days[0]?.entryCount).toBe(5); // 3 + 2 across aggregate groups
    expect(result.heatmap.days[0]?.totalAmount).toBe("800");
    expect(result.heatmap.days[0]?.currencies).toEqual(["CNY"]);

    expect(result.heatmap.stats.minAmount).toBe("800");
    expect(result.heatmap.stats.maxAmount).toBe("800");
  });

  it("keeps full numeric precision beyond Number.MAX_SAFE_INTEGER", async () => {
    const db = getTestDb();
    const hugeA = "9007199254740993"; // 2^53 + 1
    const hugeB = "9007199254740994"; // 2^53 + 2

    const insertedSecondCategory = await db
      .insert(entryCategories)
      .values({
        ledgerId,
        name: "大额",
        sortOrder: 9,
      })
      .returning();
    const secondCategoryId = requireFirst(insertedSecondCategory, "second category").id;

    const insertedDoc = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: "2024-08-01",
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const doc = requireFirst(insertedDoc, "document");

    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId: doc.id,
        amount: hugeA,
        convertedAmount: hugeA,
        currency: "CNY",
        itemName: "huge A",
        categoryId,
      },
      {
        ledgerId,
        sourceDocumentId: doc.id,
        amount: hugeB,
        convertedAmount: hugeB,
        currency: "CNY",
        itemName: "huge B",
        categoryId: secondCategoryId,
      },
    ]);

    const result = await getTargetEnhancedStatsQuery({
      ledgerId,
      queryRange: { from: "2024-08-01", to: "2024-08-31" },
      compareRange: { from: "2024-07-01", to: "2024-07-31" },
    });

    expect(result.summary.total).toBe("18014398509481987");
    expect(result.summary.comparison.amountDelta).toBe("18014398509481987");
    // Decimal sort keeps the truly larger category first.
    expect(result.categories.map((category) => category.totalConverted)).toEqual([hugeB, hugeA]);
    expect(result.categories[0]?.trend.amount).toBe(hugeB);
  });
});
