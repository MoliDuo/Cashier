import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";
import { books, ledgers, sourceDocuments } from "@/persistence";

/** The data half of 0019: the statements that fill in the zone and the missing days. */
const backfill = readFileSync(
  "src/persistence/postgres-migrations/0019_ledger_time_zone.sql",
  "utf8"
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
  .filter((statement) => statement.startsWith("UPDATE"));

describe("0019 ledger time zone", () => {
  it("takes the first live book's zone and dates undated records in it", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const [first] = await db
      .select({ id: books.id })
      .from(books)
      .where(eq(books.ledgerId, ledgerId));
    await db.update(books).set({ timeZone: "America/Los_Angeles" }).where(eq(books.id, first!.id));
    await db
      .insert(books)
      .values({ ledgerId, name: "后来的", sortOrder: 9, timeZone: "Asia/Tokyo" });
    const [undated] = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        bookId: first!.id,
        documentDate: null,
        // Already the 1st in UTC, still the 30th in Los Angeles.
        createdAt: new Date("2026-10-01T03:00:00Z"),
      })
      .returning({ id: sourceDocuments.id });

    expect(backfill).toHaveLength(2);
    for (const statement of backfill) await db.execute(sql.raw(statement));

    const [ledger] = await db
      .select({ timeZone: ledgers.timeZone })
      .from(ledgers)
      .where(eq(ledgers.id, ledgerId));
    expect(ledger?.timeZone).toBe("America/Los_Angeles");
    const [document] = await db
      .select({ documentDate: sourceDocuments.documentDate })
      .from(sourceDocuments)
      .where(eq(sourceDocuments.id, undated!.id));
    expect(document?.documentDate).toBe("2026-09-30");
  });
});
