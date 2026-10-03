import { describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import { books, ledgers } from "@/persistence";
import { createInitialLedger } from "@/modules/ledger/server/initial-ledger";
import { getLedger } from "@/modules/ledger/server/live-ledger";

/** What `ledger:create` writes: the whole initial state, once. */
describe("createInitialLedger", () => {
  it("creates the ledger, its books and the default categories", async () => {
    const db = getTestDb();

    await createInitialLedger({ bookNames: ["共同支出", "哞哞的"] });

    expect(await db.select({ id: ledgers.id }).from(ledgers)).toHaveLength(1);
    expect(await getLedger()).not.toBeNull();
    const ledgerBooks = await db.query.books.findMany({ orderBy: [books.sortOrder] });
    expect(ledgerBooks.map((book) => book.name)).toEqual(["共同支出", "哞哞的"]);
    const categories = await db.query.entryCategories.findMany();
    expect(categories.length).toBeGreaterThan(0);
  });

  it("refuses a second ledger", async () => {
    await createInitialLedger({ bookNames: ["共同支出"] });

    await expect(createInitialLedger({ bookNames: ["另一个"] })).rejects.toThrow(
      /ledger already exists/
    );
    expect(await getTestDb().select({ id: ledgers.id }).from(ledgers)).toHaveLength(1);
  });

  it("writes nothing when a later step fails", async () => {
    await expect(createInitialLedger({ bookNames: ["共同支出", "共同支出"] })).rejects.toThrow(
      /unique/
    );
    await expect(createInitialLedger({ bookNames: ["x".repeat(200)] })).rejects.toThrow();

    expect(await getTestDb().select({ id: ledgers.id }).from(ledgers)).toHaveLength(0);
  });
});
