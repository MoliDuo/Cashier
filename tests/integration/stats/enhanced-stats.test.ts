import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import { getEnhancedStats } from "@/modules/stats/server/get-enhanced-stats";
import { ValidationError } from "@/lib/errors";
import { getTestDb } from "../../setup";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
} from "../../helpers/schema-setup";
import { sourceDocuments, ledgerEntries, entryCategories } from "@/persistence";

function requireFirst<T>(rows: readonly T[], label: string): T {
  const first = rows[0];
  if (first === undefined) {
    throw new Error(`Expected at least one ${label}`);
  }
  return first;
}

function normalizeSql(sqlStatement: string): string {
  return sqlStatement.toLowerCase().replace(/\s+/g, " ").trim();
}

async function getTargetEnhancedStats(
  input: Parameters<typeof getEnhancedStats>[0]
): ReturnType<typeof getEnhancedStats> {
  const db = getTestDb();
  const documents = await db.query.sourceDocuments.findMany({ columns: { id: true } });
  for (const document of documents) {
    await activateTestSourceDocumentProjection(db, document.id);
  }
  return getEnhancedStats(input);
}

async function captureSqlStatements<T>(
  fn: () => Promise<T>
): Promise<{ result: T; statements: string[] }> {
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
    const result = await fn();
    return { result, statements };
  } finally {
    client.query = originalQuery;
  }
}

describe("Enhanced Stats Actions", () => {
  let testLedgerId: string;
  let testCategoryId: string;
  let otherCategoryId: string;

  beforeEach(async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db, undefined, "Test Ledger");
    testLedgerId = ledgerId;

    // Create test categories
    const createdCategory1 = await db
      .insert(entryCategories)
      .values({
        name: "餐饮",
        description: "餐饮消费",
        sortOrder: 1,
        ledgerId: testLedgerId,
      })
      .returning();
    const category1 = requireFirst(createdCategory1, "category");
    testCategoryId = category1.id;

    const createdCategory2 = await db
      .insert(entryCategories)
      .values({
        name: "交通",
        description: "交通费用",
        sortOrder: 2,
        ledgerId: testLedgerId,
      })
      .returning();
    const category2 = requireFirst(createdCategory2, "category");
    otherCategoryId = category2.id;
  });

  describe("getEnhancedStats", () => {
    it("rejects invalid date ranges", async () => {
      await expect(
        getTargetEnhancedStats({
          queryRange: { from: "bad", to: "bad" },
          compareRange: { from: "bad", to: "bad" },
        })
      ).rejects.toThrow(ValidationError);
    });

    it("rejects reversed date ranges", async () => {
      await expect(
        getTargetEnhancedStats({
          queryRange: { from: "2024-03-31", to: "2024-03-01" },
          compareRange: { from: "2024-02-29", to: "2024-02-01" },
        })
      ).rejects.toThrow(ValidationError);
    });

    it("fails closed once a second live ledger makes the single ledger ambiguous", async () => {
      const db = getTestDb();
      await createTestUserWithLedger(
        db,
        undefined,
        undefined,
        "11111111-1111-4111-8111-111111111111"
      );

      await expect(
        getTargetEnhancedStats({
          queryRange: { from: "2024-01-01", to: "2024-01-31" },
          compareRange: { from: "2023-12-01", to: "2023-12-31" },
        })
      ).rejects.toThrow("Ledger");
    });

    it("should filter by effective date (entry date with createdAt fallback)", async () => {
      const db = getTestDb();

      // Create source document with documentDate in Jan but created in March
      const createdDocA = await db
        .insert(sourceDocuments)
        .values({
          ledgerId: testLedgerId,
          documentDate: "2024-01-15",
          createdAt: new Date("2024-03-01"),
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      const docA = requireFirst(createdDocA, "source document");

      // Create source document with documentDate in March but created in January
      const createdDocB = await db
        .insert(sourceDocuments)
        .values({
          ledgerId: testLedgerId,
          documentDate: "2024-03-15",
          createdAt: new Date("2024-01-01"),
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      const docB = requireFirst(createdDocB, "source document");

      await db.insert(ledgerEntries).values({
        ledgerId: testLedgerId,
        sourceDocumentId: docA.id,
        amount: "100",
        currency: "CNY",
        itemName: "Jan Item",
        categoryId: testCategoryId,
      });

      await db.insert(ledgerEntries).values({
        ledgerId: testLedgerId,
        sourceDocumentId: docB.id,
        amount: "200",
        currency: "CNY",
        itemName: "Mar Item",
        categoryId: testCategoryId,
      });

      // Query for January 2024
      const result = await getTargetEnhancedStats({
        queryRange: { from: "2024-01-01", to: "2024-01-31" },
        compareRange: { from: "2023-12-01", to: "2023-12-31" },
      });

      // Should only include data from docA (documentDate in January)
      expect(result.summary.total).toBe("100");
      expect(result.chart).toHaveLength(1);
      const januaryPoint = requireFirst(result.chart, "chart point");
      expect(januaryPoint.date).toBe("2024-01-15");
      expect(januaryPoint.total).toBe("100");
    });

    it("keeps ledger/date constraints inside SQL for entry fetches", async () => {
      const db = getTestDb();
      const createdDoc = await db
        .insert(sourceDocuments)
        .values({
          ledgerId: testLedgerId,
          documentDate: "2024-03-05",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      const doc = requireFirst(createdDoc, "source document");

      await db.insert(ledgerEntries).values({
        ledgerId: testLedgerId,
        sourceDocumentId: doc.id,
        amount: "10",
        currency: "CNY",
        itemName: "Filter Item",
        categoryId: testCategoryId,
      });
      await activateTestSourceDocumentProjection(db, doc.id);

      const { statements } = await captureSqlStatements(() =>
        getEnhancedStats({
          queryRange: { from: "2024-03-01", to: "2024-03-31" },
          compareRange: { from: "2024-02-01", to: "2024-02-29" },
        })
      );

      const entryQueries = statements
        .map(normalizeSql)
        .filter((sqlStatement) => sqlStatement.includes("with ranges"));

      expect(entryQueries).toHaveLength(1);
      const query = entryQueries[0]!;
      expect(query).toContain("entries.ledger_id = documents.ledger_id");
      expect(query).toContain("documents.ledger_id = $");
      expect(query).toContain(
        "documents.effective_date between ranges.from_date and ranges.to_date"
      );
    });

    it("includes undated documents on their effective (UTC creation) date", async () => {
      const db = getTestDb();

      // No explicit entry_date: effective_date falls back to the UTC creation date.
      const createdDoc = await db
        .insert(sourceDocuments)
        .values({
          ledgerId: testLedgerId,
          documentDate: null,
          createdAt: new Date("2024-03-10T22:30:00Z"),
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      const doc = requireFirst(createdDoc, "source document");

      await db.insert(ledgerEntries).values({
        ledgerId: testLedgerId,
        sourceDocumentId: doc.id,
        amount: "120",
        currency: "CNY",
        itemName: "Undated Item",
        categoryId: testCategoryId,
      });

      const result = await getTargetEnhancedStats({
        queryRange: { from: "2024-03-01", to: "2024-03-31" },
        compareRange: { from: "2024-02-01", to: "2024-02-29" },
      });

      expect(result.summary.total).toBe("120");
      expect(result.chart).toHaveLength(1);
      expect(requireFirst(result.chart, "chart point").date).toBe("2024-03-10");

      const outside = await getTargetEnhancedStats({
        queryRange: { from: "2024-03-11", to: "2024-03-31" },
        compareRange: { from: "2024-02-01", to: "2024-02-29" },
      });
      expect(outside.summary.total).toBe("0");
    });

    it("keeps current and previous range boundaries inclusive", async () => {
      const db = getTestDb();

      for (const [date, amount] of [
        ["2024-03-01", "10"],
        ["2024-03-31", "20"],
        ["2024-02-01", "30"],
        ["2024-02-29", "40"],
      ] as const) {
        const createdDoc = await db
          .insert(sourceDocuments)
          .values({
            ledgerId: testLedgerId,
            documentDate: date,
            bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
          })
          .returning();
        const doc = requireFirst(createdDoc, "source document");
        await db.insert(ledgerEntries).values({
          ledgerId: testLedgerId,
          sourceDocumentId: doc.id,
          amount,
          currency: "CNY",
          itemName: `${date} Boundary`,
          categoryId: testCategoryId,
        });
      }

      const result = await getTargetEnhancedStats({
        queryRange: { from: "2024-03-01", to: "2024-03-31" },
        compareRange: { from: "2024-02-01", to: "2024-02-29" },
      });

      expect(result.summary.total).toBe("30");
      expect(result.summary.comparison.previousTotal).toBe("70");
      expect(result.chart).toEqual([
        { date: "2024-03-01", total: "10" },
        { date: "2024-03-31", total: "20" },
      ]);
      // The comparison window's own boundary days survive the read, so last
      // period can be drawn day by day rather than only summed.
      expect(result.previousChart).toEqual([
        { date: "2024-02-01", total: "30" },
        { date: "2024-02-29", total: "40" },
      ]);
    });

    it("should calculate correct summary totals", async () => {
      const db = getTestDb();

      // Create entries across different dates
      const dates = ["2024-03-01", "2024-03-05", "2024-03-10"];
      for (const date of dates) {
        const createdDoc = await db
          .insert(sourceDocuments)
          .values({
            ledgerId: testLedgerId,
            documentDate: date,
            bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
          })
          .returning();
        const doc = requireFirst(createdDoc, "source document");

        await db.insert(ledgerEntries).values({
          ledgerId: testLedgerId,
          sourceDocumentId: doc.id,
          amount: "100",
          currency: "CNY",
          itemName: `${date} Item`,
          categoryId: testCategoryId,
        });
      }

      const result = await getTargetEnhancedStats({
        queryRange: { from: "2024-03-01", to: "2024-03-31" },
        compareRange: { from: "2024-02-01", to: "2024-02-29" },
      });

      expect(result.summary.total).toBe("300");
      expect(result.summary.currency).toBe("CNY");
      expect(result.chart).toHaveLength(3);
    });

    it("should calculate category breakdown correctly", async () => {
      const db = getTestDb();

      const createdDoc = await db
        .insert(sourceDocuments)
        .values({
          ledgerId: testLedgerId,
          documentDate: "2024-03-01",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      const doc = requireFirst(createdDoc, "source document");

      // Add entries with different categories
      await db.insert(ledgerEntries).values({
        ledgerId: testLedgerId,
        sourceDocumentId: doc.id,
        amount: "100",
        currency: "CNY",
        itemName: "Food Item",
        categoryId: testCategoryId,
      });

      await db.insert(ledgerEntries).values({
        ledgerId: testLedgerId,
        sourceDocumentId: doc.id,
        amount: "50",
        currency: "CNY",
        itemName: "Transport Item",
        categoryId: otherCategoryId,
      });

      const result = await getTargetEnhancedStats({
        queryRange: { from: "2024-03-01", to: "2024-03-31" },
        compareRange: { from: "2024-02-01", to: "2024-02-29" },
      });

      expect(result.categories).toHaveLength(2);

      const foodCategory = result.categories.find((c) => c.name === "餐饮");
      const transportCategory = result.categories.find((c) => c.name === "交通");

      expect(foodCategory).toBeDefined();
      expect(foodCategory?.totalConverted).toBe("100");
      expect(foodCategory?.percent).toBeCloseTo((100 / 150) * 100, 10);
      expect(foodCategory?.count).toBe(1);

      expect(transportCategory).toBeDefined();
      expect(transportCategory?.totalConverted).toBe("50");
      expect(transportCategory?.percent).toBeCloseTo((50 / 150) * 100, 10);
    });

    it("should calculate trend correctly", async () => {
      const db = getTestDb();

      // Create entries for current period (March)
      const createdCurrentDoc = await db
        .insert(sourceDocuments)
        .values({
          ledgerId: testLedgerId,
          documentDate: "2024-03-15",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      const currentDoc = requireFirst(createdCurrentDoc, "source document");

      await db.insert(ledgerEntries).values({
        ledgerId: testLedgerId,
        sourceDocumentId: currentDoc.id,
        amount: "200",
        currency: "CNY",
        itemName: "Current Item",
        categoryId: testCategoryId,
      });

      // Create entries for previous period (February)
      const createdPrevDoc = await db
        .insert(sourceDocuments)
        .values({
          ledgerId: testLedgerId,
          documentDate: "2024-02-15",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      const prevDoc = requireFirst(createdPrevDoc, "source document");

      await db.insert(ledgerEntries).values({
        ledgerId: testLedgerId,
        sourceDocumentId: prevDoc.id,
        amount: "100",
        currency: "CNY",
        itemName: "Previous Item",
        categoryId: testCategoryId,
      });

      const result = await getTargetEnhancedStats({
        queryRange: { from: "2024-03-01", to: "2024-03-31" },
        compareRange: { from: "2024-02-01", to: "2024-02-29" },
      });

      // Trend from 100 to 200 is 100% increase
      expect(result.summary.comparison.amountDelta).toBe("100");
      expect(result.summary.comparison.percent).toBe(100);
    });

    it("should calculate daily average correctly", async () => {
      const db = getTestDb();

      // Create multiple entries on the same day
      const createdDoc = await db
        .insert(sourceDocuments)
        .values({
          ledgerId: testLedgerId,
          documentDate: "2024-03-01",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      const doc = requireFirst(createdDoc, "source document");

      await db.insert(ledgerEntries).values({
        ledgerId: testLedgerId,
        sourceDocumentId: doc.id,
        amount: "300",
        currency: "CNY",
        itemName: "Items",
        categoryId: testCategoryId,
      });

      const result = await getTargetEnhancedStats({
        queryRange: { from: "2024-03-01", to: "2024-03-31" },
        compareRange: { from: "2024-02-01", to: "2024-02-29" },
      });

      // Daily average = Total / Days in range = 300 / 31
      expect(result.summary.dailyAverage).toBeCloseTo(300 / 31, 2);
    });

    it("should generate correct heatmap data", async () => {
      const db = getTestDb();

      // Create entries across different dates
      const entries = [
        { date: "2024-03-01", amount: "50" },
        { date: "2024-03-05", amount: "100" },
        { date: "2024-03-10", amount: "200" },
      ];

      for (const entry of entries) {
        const createdDoc = await db
          .insert(sourceDocuments)
          .values({
            ledgerId: testLedgerId,
            documentDate: entry.date,
            bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
          })
          .returning();
        const doc = requireFirst(createdDoc, "source document");

        await db.insert(ledgerEntries).values({
          ledgerId: testLedgerId,
          sourceDocumentId: doc.id,
          amount: entry.amount,
          currency: "CNY",
          itemName: `${entry.date} Item`,
          categoryId: testCategoryId,
        });
      }

      const result = await getTargetEnhancedStats({
        queryRange: { from: "2024-03-01", to: "2024-03-31" },
        compareRange: { from: "2024-02-01", to: "2024-02-29" },
      });

      expect(result.heatmap.days).toHaveLength(3);
      expect(result.heatmap.stats.minAmount).toBe("50");
      expect(result.heatmap.stats.maxAmount).toBe("200");
      expect(result.heatmap.stats.avgAmount).toBe("116.66666666666666667");
    });

    it("should handle uncategorized entries", async () => {
      const db = getTestDb();

      const createdDoc = await db
        .insert(sourceDocuments)
        .values({
          ledgerId: testLedgerId,
          documentDate: "2024-03-01",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${testLedgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      const doc = requireFirst(createdDoc, "source document");

      await db.insert(ledgerEntries).values({
        ledgerId: testLedgerId,
        sourceDocumentId: doc.id,
        amount: "100",
        currency: "CNY",
        itemName: "Uncategorized Item",
        categoryId: null, // No category
      });

      const result = await getTargetEnhancedStats({
        queryRange: { from: "2024-03-01", to: "2024-03-31" },
        compareRange: { from: "2024-02-01", to: "2024-02-29" },
      });

      expect(result.categories).toHaveLength(1);
      const uncategorizedCategory = requireFirst(result.categories, "category");
      expect(uncategorizedCategory.name).toBe("Uncategorized");
      expect(uncategorizedCategory.totalConverted).toBe("100");
    });
  });
});
