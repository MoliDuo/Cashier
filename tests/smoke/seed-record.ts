import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import pg from "pg";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value === "") throw new Error(`${name} is not set`);
  return value;
}

/**
 * Files one record into `book` by writing it to the database, then reloads so
 * the page shows it.
 *
 * The AI stub answers every submission with the same bill, so a spec that
 * needs a record with a name or an amount of its own writes it here, the way
 * sign-in.ts writes the session. The record is dated today in the ledger's
 * zone and carries no parse attempt, which is how a bill split off another
 * one is stored.
 */
export async function seedRecord(
  page: Page,
  { item, amount, book }: { item: string; amount: string; book?: string }
): Promise<void> {
  const client = new pg.Client({ connectionString: requiredEnv("DATABASE_URL") });
  await client.connect();
  try {
    await client.query("BEGIN");
    const ledger = await client.query<{ id: string; today: string }>(
      `SELECT id, (now() AT TIME ZONE time_zone)::date::text AS today FROM ledgers LIMIT 1`
    );
    const ledgerId = ledger.rows[0]?.id;
    if (ledgerId == null) throw new Error("The smoke ledger is not seeded");
    const books = await client.query<{ id: string }>(
      `SELECT id FROM books
       WHERE ledger_id = $1 AND archived_at IS NULL AND ($2::text IS NULL OR name = $2)
       ORDER BY sort_order LIMIT 1`,
      [ledgerId, book ?? null]
    );
    const bookId = books.rows[0]?.id;
    if (bookId == null) throw new Error(`The book ${book ?? ""} does not exist`);
    const categories = await client.query<{ id: string }>(
      `SELECT id FROM entry_categories WHERE ledger_id = $1 ORDER BY sort_order LIMIT 1`,
      [ledgerId]
    );
    const documentId = randomUUID();
    await client.query(
      `INSERT INTO source_documents (id, ledger_id, book_id, title, document_date)
       VALUES ($1, $2, $3, $4, $5)`,
      [documentId, ledgerId, bookId, item, ledger.rows[0]!.today]
    );
    await client.query(
      `INSERT INTO ledger_entries
         (id, ledger_id, category_id, source_document_id, position, amount, currency, item_name)
       VALUES ($1, $2, $3, $4, 0, $5, 'CNY', $6)`,
      [randomUUID(), ledgerId, categories.rows[0]?.id ?? null, documentId, amount, item]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  await page.reload();
}
