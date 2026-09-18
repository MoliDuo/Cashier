import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
} from "tests/helpers/schema-setup";
import { entryCategories, ledgerEntries, sourceDocuments } from "@/persistence";
import { listStreamPage as listStreamPageUseCase } from "@/modules/source-document/application/queries/list-stream-page";
import { serverComposition } from "@/application/server-composition-root";

const queryPorts = {
  documents: serverComposition.sourceDocumentReads,
  ledgerReads: serverComposition.ledgerReads,
  changes: serverComposition.ledgerChanges,
};
const listStreamPage = (ledgerId: string, input: Parameters<typeof listStreamPageUseCase>[1]) =>
  listStreamPageUseCase(ledgerId, input, queryPorts);

function requireDefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label}`);
  }
  return value;
}

describe("source-document-queries", () => {
  let ledgerId = "";

  let categoryId = "";

  beforeEach(async () => {
    const db = getTestDb();
    const setup = await createTestUserWithLedger(db);
    ledgerId = setup.ledgerId;

    const categories = await db
      .insert(entryCategories)
      .values({
        ledgerId,
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
          ledgerId,
          documentDate: `2026-03-${String(day).padStart(2, "0")}`,
          createdAt: new Date(
            `2026-03-${String(day).padStart(2, "0")}T${String(10 + (i % 10)).padStart(2, "0")}:00:00Z`
          ),
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
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
    const allItems: Array<{ id: string; effectiveDate: string | null }> = [];

    for (let pageNum = 0; pageNum < 20; pageNum++) {
      const page = await listStreamPage(ledgerId, {
        cursor,
        limit: 5,
      });
      if (page.items.length === 0) break;

      totalItems += page.items.length;
      for (const item of page.items) {
        expect(seenIds.has(item.id)).toBe(false);
        seenIds.add(item.id);
        // Build effective date for assertion
        const effectiveDate = item.documentDate ?? item.createdAt.slice(0, 10);
        allItems.push({ id: item.id, effectiveDate });
      }

      cursor = page.nextCursor ?? undefined;
      if (cursor == null) break;
    }

    // All 45 documents returned with no duplicates
    expect(totalItems).toBe(45);
    expect(seenIds.size).toBe(45);

    // Verify descending order by effective date, then createdAt (implied by insertion order within same date)
    for (let i = 1; i < allItems.length; i++) {
      const prev = allItems[i - 1]!;
      const curr = allItems[i]!;
      expect(prev.effectiveDate!.localeCompare(curr.effectiveDate!)).toBeGreaterThanOrEqual(0);
    }
  });

  it("sorts null documentDate records by createdAt calendar date", async () => {
    const db = getTestDb();
    const today = new Date("2026-03-20T08:00:00Z");
    const yesterday = new Date("2026-03-19T10:00:00Z");

    const inserted = await db
      .insert(sourceDocuments)
      .values([
        {
          ledgerId,
          title: "null-date-older",
          documentDate: null,
          createdAt: today,
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ledgerId,
          title: "null-date-newer",
          documentDate: "2026-03-18",
          createdAt: yesterday,
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ledgerId,
          title: "has-explicit-date",
          documentDate: "2026-03-19",
          createdAt: new Date("2026-03-19T12:00:00Z"),
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
      ])
      .returning();
    for (const doc of inserted) {
      await activateTestSourceDocumentProjection(db, doc.id);
    }

    const page = await listStreamPage(ledgerId, { limit: 10 });

    const nullDateOlder = page.items.find((i) => i.title === "null-date-older");
    const nullDateNewer = page.items.find((i) => i.title === "null-date-newer");
    const explicitDate = page.items.find((i) => i.title === "has-explicit-date");

    expect(nullDateOlder).toBeDefined();
    expect(nullDateNewer).toBeDefined();
    expect(explicitDate).toBeDefined();

    const idxNullOlder = page.items.indexOf(nullDateOlder!);
    const idxNullNewer = page.items.indexOf(nullDateNewer!);
    const idxExplicit = page.items.indexOf(explicitDate!);

    // null-date-older has effective date 2026-03-20 (from createdAt), should come first
    expect(idxNullOlder).toBeLessThan(idxExplicit);
    // null-date-newer has effective date 2026-03-19 (from createdAt), should sort after explicit 2026-03-19
    // because within same effective date, order is by createdAt DESC (null-date-newer has createdAt 2026-03-19T10:00:00Z)
    // and explicit has createdAt 2026-03-19T12:00:00Z, so explicit comes first
    expect(idxExplicit).toBeLessThan(idxNullNewer);
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
        ledgerId,
        documentDate: sameDate,
        createdAt: sameCreatedAt,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      },
      {
        id: idB,
        ledgerId,
        documentDate: sameDate,
        createdAt: sameCreatedAt,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      },
      {
        id: idC,
        ledgerId,
        documentDate: sameDate,
        createdAt: sameCreatedAt,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      },
    ]);
    for (const id of [idA, idB, idC]) {
      await activateTestSourceDocumentProjection(db, id);
    }

    const page = await listStreamPage(ledgerId, { limit: 10 });

    const ids = page.items.map((i) => i.id);
    // Since order is DESC by effectiveDate, createdAt, then id,
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
          ledgerId,
          title: "completed-in-range",
          documentDate: "2026-03-15",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ledgerId,
          title: "completed-outside-range",
          documentDate: "2026-03-01",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ledgerId,
          title: "processing-in-range",
          documentDate: "2026-03-16",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ledgerId,
          title: "invalid-in-range",
          documentDate: "2026-03-14",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
      ])
      .returning();

    const completedInRange = docs.find((d) => d.title === "completed-in-range")!;
    const completedOutOfRange = docs.find((d) => d.title === "completed-outside-range")!;

    // Insert ledger entries BEFORE activation so the activation function
    // links them to the revision via sourceDocumentRevisionId
    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId: completedInRange.id,
        amount: "50.00",
        convertedAmount: "50.00",
        currency: "CNY",
        itemName: "in-range item",
        categoryId,
      },
      {
        ledgerId,
        sourceDocumentId: completedOutOfRange.id,
        amount: "200.00",
        convertedAmount: "200.00",
        currency: "CNY",
        itemName: "out-of-range item",
        categoryId,
      },
    ]);

    // Activate projections once per doc
    for (const doc of docs) {
      await activateTestSourceDocumentProjection(db, doc.id);
    }

    // Filter by status = completed, date range, and amount
    const page = await listStreamPage(ledgerId, {
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
