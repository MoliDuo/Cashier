import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import { activateTestSourceDocumentProjection, createTestLedger } from "tests/helpers/schema-setup";
import { entryCategories, ledgerEntries, extractionAttempts, sourceDocuments } from "@/persistence";
import { eq } from "drizzle-orm";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";
import { getStreamTotal } from "@/modules/source-document/server/stream-total";

function requireDefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label}`);
  }
  return value;
}

describe("source-document-queries", () => {
  let categoryId = "";

  beforeEach(async () => {
    const db = getTestDb();
    await createTestLedger(db);

    const categories = await db
      .insert(entryCategories)
      .values({
        name: "Food",
        sortOrder: 1,
      })
      .returning();
    categoryId = requireDefined(categories[0], "category").id;
  });

  it("excludes unconverted entries from amount filters while preserving details", async () => {
    const db = getTestDb();
    const [document] = await db
      .insert(sourceDocuments)
      .values({
        title: "Coffee and cake",
        documentDate: "2026-03-20",
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const sourceDocument = requireDefined(document, "filtered subtotal document");
    await db.insert(ledgerEntries).values([
      {
        sourceDocumentId: sourceDocument.id,
        amount: "20.00",
        // No USD rate is stored for the day, so the entry has no converted amount.
        currency: "USD",
        itemName: "Coffee",
        categoryId,
      },
      {
        sourceDocumentId: sourceDocument.id,
        amount: "80.00",
        currency: "CNY",
        itemName: "Cake",
        categoryId,
      },
    ]);
    await activateTestSourceDocumentProjection(db, sourceDocument.id);

    const stream = await listStreamPage({ maxAmount: "30", limit: 10 });
    expect(stream.items).toHaveLength(0);
    await expect(getStreamTotal({ maxAmount: "30" })).resolves.toEqual({
      total: "0",
      unconvertedCount: 0,
    });

    expect(
      await db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.sourceDocumentId, sourceDocument.id),
      })
    ).toHaveLength(2);
  });

  it("narrows bills and their shown entries by category and currency, on one entry", async () => {
    const db = getTestDb();
    const bookId = sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`;
    const docs = await db
      .insert(sourceDocuments)
      .values([
        { title: "Mixed", documentDate: "2026-03-20", bookId },
        { title: "Plain", documentDate: "2026-03-21", bookId },
      ])
      .returning();
    const mixed = requireDefined(docs[0], "mixed document");
    const plain = requireDefined(docs[1], "plain document");
    await db.insert(ledgerEntries).values([
      {
        sourceDocumentId: mixed.id,
        amount: "30.00",
        currency: "CNY",
        itemName: "Noodles",
        categoryId,
      },
      {
        sourceDocumentId: mixed.id,
        amount: "5.00",
        currency: "CNY",
        itemName: "Bag",
      },
      {
        sourceDocumentId: plain.id,
        amount: "12.00",
        currency: "CNY",
        itemName: "Tape",
      },
    ]);
    await activateTestSourceDocumentProjection(db, mixed.id);
    await activateTestSourceDocumentProjection(db, plain.id);

    // A bill matches when one of its entries does, and shows only those entries.
    const byCategory = await listStreamPage({ categoryId, limit: 10 });
    expect(byCategory.items.map((item) => item.id)).toEqual([mixed.id]);
    expect(byCategory.items[0]?.ledgerEntries?.map((entry) => entry.itemName)).toEqual(["Noodles"]);
    await expect(getStreamTotal({ categoryId })).resolves.toMatchObject({
      total: "30",
    });

    const uncategorized = await listStreamPage({
      categoryId: "__uncategorized__",
      limit: 10,
    });
    expect(uncategorized.items.map((item) => item.id).sort()).toEqual([mixed.id, plain.id].sort());
    await expect(getStreamTotal({ categoryId: "__uncategorized__" })).resolves.toMatchObject({
      total: "17",
    });

    // Every entry filter applies to the same entry, as the entry view reads them.
    const noMatch = await listStreamPage({
      categoryId,
      currency: "USD",
      limit: 10,
    });
    expect(noMatch.items).toEqual([]);
    const byCurrency = await listStreamPage({
      currency: "CNY",
      search: "tape",
      limit: 10,
    });
    expect(byCurrency.items.map((item) => item.id)).toEqual([plain.id]);
  });

  it("totals only completed documents across the full Stream filter", async () => {
    const db = getTestDb();
    const docs = await db
      .insert(sourceDocuments)
      .values([
        {
          title: "completed-total",
          documentDate: "2026-03-15",
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        },
        {
          title: "failed-with-active-result",
          documentDate: "2026-03-16",
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        },
        {
          title: "completed-out-of-range",
          documentDate: "2026-02-01",
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        },
      ])
      .returning();
    const completed = requireDefined(docs[0], "completed total document");
    const failed = requireDefined(docs[1], "failed total document");
    const outOfRange = requireDefined(docs[2], "out of range total document");

    await db.insert(ledgerEntries).values([
      {
        sourceDocumentId: completed.id,
        amount: "125.25",
        currency: "CNY",
        itemName: "completed item",
        categoryId,
      },
      {
        sourceDocumentId: failed.id,
        amount: "75.00",
        currency: "CNY",
        itemName: "old active item",
        categoryId,
      },
      {
        sourceDocumentId: outOfRange.id,
        amount: "200.00",
        currency: "CNY",
        itemName: "out of range item",
        categoryId,
      },
    ]);

    for (const doc of docs) {
      await activateTestSourceDocumentProjection(db, doc.id, { parsed: doc.id !== failed.id });
    }

    const failedAttempt = requireDefined(
      (
        await db
          .insert(extractionAttempts)
          .values({
            sourceDocumentId: failed.id,
            status: "failed",
            finishedAt: new Date(),
          })
          .returning()
      )[0],
      "failed pending attempt"
    );
    await db
      .update(sourceDocuments)
      .set({ latestAttemptId: failedAttempt.id })
      .where(eq(sourceDocuments.id, failed.id));

    await expect(
      getStreamTotal({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      })
    ).resolves.toEqual({ total: "200.25", unconvertedCount: 0 });
    await expect(getStreamTotal({ statuses: ["processing"] })).resolves.toEqual({
      total: "0",
      unconvertedCount: 0,
    });
    await expect(getStreamTotal({ statuses: ["completed", "failed"] })).resolves.toEqual({
      total: "400.25",
      unconvertedCount: 0,
    });
    await expect(getStreamTotal({ minAmount: "100", maxAmount: "150" })).resolves.toEqual({
      total: "125.25",
      unconvertedCount: 0,
    });
  });
});
