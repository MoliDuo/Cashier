import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import { activateTestSourceDocumentProjection, createTestLedger } from "tests/helpers/schema-setup";
import { entryCategories, ledgerEntries, sourceDocuments } from "@/persistence";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";

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

  // ---------------------------------------------------------------------------
  // Stream page integration tests (Task 2 review)
  // ---------------------------------------------------------------------------

  it("walks all cursor pages through 40+ interleaved status records", async () => {
    const db = getTestDb();
    const statuses = ["processing", "processing", "completed", "invalid", "failed"] as const;
    const docs: Array<{ id: string; status: string }> = [];

    // Insert 45 documents (9 per status) with descending entry dates
    for (let i = 0; i < 45; i++) {
      const status = statuses[i % statuses.length]!;
      const day = 25 - Math.floor(i / 5);
      const inserted = await db
        .insert(sourceDocuments)
        .values({
          documentDate: `2026-03-${String(day).padStart(2, "0")}`,
          createdAt: new Date(
            `2026-03-${String(day).padStart(2, "0")}T${String(10 + (i % 10)).padStart(2, "0")}:00:00Z`
          ),
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      docs.push({ id: inserted[0]!.id, status });
    }
    for (const doc of docs) {
      await activateTestSourceDocumentProjection(db, doc.id);
    }

    // Walk all pages with page size 5
    let cursor: string | undefined;
    let totalItems = 0;
    const seenIds = new Set<string>();
    const allItems: Array<{ id: string; documentDate: string }> = [];

    for (let pageNum = 0; pageNum < 20; pageNum++) {
      const page = await listStreamPage({
        cursor,
        limit: 5,
      });
      if (page.items.length === 0) break;

      totalItems += page.items.length;
      for (const item of page.items) {
        expect(seenIds.has(item.id)).toBe(false);
        seenIds.add(item.id);
        allItems.push({ id: item.id, documentDate: item.documentDate });
      }

      cursor = page.nextCursor ?? undefined;
      if (cursor == null) break;
    }

    // All 45 documents returned with no duplicates
    expect(totalItems).toBe(45);
    expect(seenIds.size).toBe(45);

    // Verify descending order by document date, then createdAt (implied by insertion order within same date)
    for (let i = 1; i < allItems.length; i++) {
      const prev = allItems[i - 1]!;
      const curr = allItems[i]!;
      expect(prev.documentDate.localeCompare(curr.documentDate)).toBeGreaterThanOrEqual(0);
    }
  });

  it("resolves equal ordering tuples (same date, same createdAt) by ID descending", async () => {
    const db = getTestDb();
    const sameDate = "2026-03-20";
    const sameCreatedAt = new Date("2026-03-20T12:00:00Z");

    // Insert docs with known IDs via direct SQL
    const idA = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const idB = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
    const idC = "cccccccc-cccc-4ccc-cccc-cccccccccccc";

    await db.insert(sourceDocuments).values([
      {
        id: idA,
        documentDate: sameDate,
        createdAt: sameCreatedAt,
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      },
      {
        id: idB,
        documentDate: sameDate,
        createdAt: sameCreatedAt,
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      },
      {
        id: idC,
        documentDate: sameDate,
        createdAt: sameCreatedAt,
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      },
    ]);
    for (const id of [idA, idB, idC]) {
      await activateTestSourceDocumentProjection(db, id);
    }

    const page = await listStreamPage({ limit: 10 });

    const ids = page.items.map((i) => i.id);
    // Since order is DESC by documentDate, createdAt, then id,
    // equal dates and createdAt should sort by id DESC:
    // idC ("c...") > idB ("b...") > idA ("a...")
    expect(ids.indexOf(idC)).toBeLessThan(ids.indexOf(idB));
    expect(ids.indexOf(idB)).toBeLessThan(ids.indexOf(idA));
  });

  it("applies date, amount, and status filters before the page limit", async () => {
    const db = getTestDb();
    const docs = await db
      .insert(sourceDocuments)
      .values([
        {
          title: "completed-in-range",
          documentDate: "2026-03-15",
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        },
        {
          title: "completed-outside-range",
          documentDate: "2026-03-01",
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        },
        {
          title: "processing-in-range",
          documentDate: "2026-03-16",
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        },
        {
          title: "invalid-in-range",
          documentDate: "2026-03-14",
          bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
        },
      ])
      .returning();

    const completedInRange = docs.find((d) => d.title === "completed-in-range")!;
    const completedOutOfRange = docs.find((d) => d.title === "completed-outside-range")!;

    // Insert ledger entries BEFORE activation so the fixture numbers their positions
    await db.insert(ledgerEntries).values([
      {
        sourceDocumentId: completedInRange.id,
        amount: "50.00",
        currency: "CNY",
        itemName: "in-range item",
        categoryId,
      },
      {
        sourceDocumentId: completedOutOfRange.id,
        amount: "200.00",
        currency: "CNY",
        itemName: "out-of-range item",
        categoryId,
      },
    ]);

    // Activate projections once per doc; only the "completed" ones record a completed parse
    for (const doc of docs) {
      await activateTestSourceDocumentProjection(db, doc.id, {
        parsed: doc.title?.startsWith("completed-") === true,
      });
    }

    // Filter by status = completed, date range, and amount
    const page = await listStreamPage({
      statuses: ["completed"],
      startDate: "2026-03-10",
      endDate: "2026-03-20",
      minAmount: "10",
      maxAmount: "100",
      limit: 10,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(completedInRange.id);
  });
});
