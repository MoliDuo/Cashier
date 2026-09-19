import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import { getBookTotalsQuery } from "@/modules/stats/application/queries/get-book-totals";
import { serverComposition } from "@/application/server-composition-root";

const QUERY_RANGE = { from: "2024-03-01", to: "2024-03-31" };
const COMPARE_RANGE = { from: "2024-02-01", to: "2024-02-29" };

async function runBookTotals(ledgerId: string, queryRange = QUERY_RANGE) {
  return getBookTotalsQuery({ ledgerId, queryRange }, serverComposition.stats);
}

function requireFirst<T>(rows: readonly T[], label: string): T {
  const first = rows[0];
  if (first == null) throw new Error(`Expected ${label}`);
  return first;
}

describe("getBookTotalsQuery", () => {
  let ledgerId = "";
  let firstBookId = "";
  let secondBookId = "";

  beforeEach(async () => {
    const db = getTestDb();
    const setup = await createTestUserWithLedger(db, undefined, "Books Ledger");
    ledgerId = setup.ledgerId;
    // The fixture already created the first book; these two are the book under
    // test and one that is archived before a read.
    const existing = await ensureTestLedgerBooks(db, ledgerId);
    firstBookId = existing.get("共同支出")!;
    const rows = await db.execute<{ id: string; name: string }>(sql`
      INSERT INTO books (ledger_id, name, sort_order)
      VALUES
        (${ledgerId}, '旅行', 2),
        (${ledgerId}, '已归档的', 3)
      RETURNING id, name
    `);
    secondBookId = rows.rows.find((row) => row.name === "旅行")!.id;
  });

  async function insertEntry(input: {
    bookId: string;
    date: string;
    amount: string;
    archivedBook?: boolean;
    softDeleted?: boolean;
  }) {
    const db = getTestDb();
    const inserted = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: input.date,
        bookId: input.bookId,
        ...(input.softDeleted === true ? { deletedAt: new Date() } : {}),
        ...(input.archivedBook === true ? {} : {}),
      })
      .returning();
    const document = requireFirst(inserted, "source document");
    await db.insert(ledgerEntries).values({
      ledgerId,
      sourceDocumentId: document.id,
      amount: input.amount,
      convertedAmount: input.amount,
      currency: "CNY",
      itemName: `${input.date} row`,
    });
    await activateTestSourceDocumentProjection(db, document.id);
  }

  it("sums each book once and 总账 over all of them", async () => {
    await insertEntry({ bookId: firstBookId, date: "2024-03-02", amount: "40" });
    await insertEntry({ bookId: secondBookId, date: "2024-03-03", amount: "80" });

    const totals = await runBookTotals(ledgerId);

    expect(totals.currency).toBe("CNY");
    expect(totals.total).toBe("120");
    expect(totals.books).toEqual(
      expect.arrayContaining([
        { bookId: firstBookId, total: "40" },
        { bookId: secondBookId, total: "80" },
      ])
    );
  });

  it("counts an archived book's records in 总账 and still reports that book", async () => {
    const db = getTestDb();
    await db.execute(
      sql`UPDATE books SET archived_at = now() WHERE ledger_id = ${ledgerId} AND id = ${secondBookId}`
    );
    await insertEntry({ bookId: firstBookId, date: "2024-03-02", amount: "40" });
    await insertEntry({ bookId: secondBookId, date: "2024-03-03", amount: "80" });

    const totals = await runBookTotals(ledgerId);

    expect(totals.total).toBe("120");
    expect(totals.books).toEqual(expect.arrayContaining([{ bookId: secondBookId, total: "80" }]));
  });

  it("leaves out a book with no entries in the range instead of reporting a zero row", async () => {
    await insertEntry({ bookId: firstBookId, date: "2024-03-02", amount: "40" });

    const totals = await runBookTotals(ledgerId);

    expect(totals.books.map((row) => row.bookId)).toEqual([firstBookId]);
  });

  it("returns the ledger's own currency and a zero total for an empty range", async () => {
    const totals = await runBookTotals(ledgerId, { from: "2025-01-01", to: "2025-01-31" });

    expect(totals).toEqual({ currency: "CNY", total: "0", books: [] });
  });

  it("excludes soft-deleted records and dates outside the range from every row", async () => {
    await insertEntry({ bookId: firstBookId, date: "2024-03-02", amount: "40" });
    await insertEntry({
      bookId: firstBookId,
      date: "2024-03-02",
      amount: "999",
      softDeleted: true,
    });
    await insertEntry({ bookId: firstBookId, date: "2024-01-15", amount: "500" });

    const totals = await runBookTotals(ledgerId);

    expect(totals.total).toBe("40");
    expect(totals.books).toEqual([{ bookId: firstBookId, total: "40" }]);
  });

  it("matches the per-book enhanced stats total exactly", async () => {
    await insertEntry({ bookId: firstBookId, date: "2024-03-02", amount: "40" });
    await insertEntry({ bookId: secondBookId, date: "2024-03-03", amount: "80" });

    const totals = await runBookTotals(ledgerId);
    const { getEnhancedStatsQuery } =
      await import("@/modules/stats/application/queries/get-enhanced-stats");
    const stats = await getEnhancedStatsQuery(
      { ledgerId, bookId: secondBookId, queryRange: QUERY_RANGE, compareRange: COMPARE_RANGE },
      serverComposition.stats
    );

    expect(totals.books.find((row) => row.bookId === secondBookId)?.total).toBe(
      stats.summary.total
    );
  });
});
