import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { GetBookTotalsInput } from "@/modules/stats/contract-schemas";
import type { BookTotalsDto } from "@/modules/stats/contracts";
import { normalize as decimalNormalize } from "@/lib/money/decimal";

interface BookTotalRow {
  bookId: string | null;
  totalAmount: string | null;
  mainCurrency: string;
}

/**
 * The per-book totals for one period, in a single grouped read. 总账 is the row
 * whose `book_id` is null — `GROUPING SETS` is what produces it alongside the
 * per-book groups in one scan. It sums every book, archived ones included,
 * exactly as the strip's 总账 option does, and the per-book sums match
 * getEnhancedStats for the same book because the source predicate (live
 * revision, non-deleted entry) is identical.
 */
export async function getBookTotalsQuery({
  ledgerId,
  queryRange,
}: GetBookTotalsInput): Promise<BookTotalsDto> {
  const result = await db.execute<BookTotalRow & Record<string, unknown>>(sql`
    SELECT documents.book_id AS "bookId",
      sum(entries.converted_amount)::text AS "totalAmount",
      (SELECT main_currency FROM ledgers
        WHERE id = ${ledgerId} AND deleted_at IS NULL) AS "mainCurrency"
    FROM source_documents documents
    JOIN ledger_entries entries
      ON entries.ledger_id = documents.ledger_id
      AND entries.source_document_id = documents.id
      AND entries.source_document_revision_id = documents.active_revision_id
      AND entries.deleted_at IS NULL
    WHERE documents.ledger_id = ${ledgerId}
      AND documents.deleted_at IS NULL
      AND documents.effective_date BETWEEN ${queryRange.from}::date AND ${queryRange.to}::date
    GROUP BY GROUPING SETS ((documents.book_id), ())
  `);

  const mainCurrency = result.rows[0]?.mainCurrency ?? "CNY";
  const allRow = result.rows.find((row) => row.bookId == null);
  const books: BookTotalsDto["books"] = [];
  for (const row of result.rows) {
    if (row.bookId == null) continue;
    books.push({ bookId: row.bookId, total: decimalNormalize(row.totalAmount ?? "0") });
  }

  return {
    currency: mainCurrency,
    total: decimalNormalize(allRow?.totalAmount ?? "0"),
    books,
  };
}
