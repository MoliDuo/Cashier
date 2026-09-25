import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import { getTestDb } from "../../setup";
import { entryCategories, ledgerEntries, ledgers } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { randomUUID } from "node:crypto";

import { getEntryCategoriesAction } from "@/modules/ledger/server/list-categories";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";

async function getTargetEntryCategoriesAction(ledgerId: string) {
  const db = getTestDb();
  const documents = await db.query.sourceDocuments.findMany({
    where: (documents, { eq }) => eq(documents.ledgerId, ledgerId),
    columns: { id: true },
  });
  for (const document of documents) {
    await activateTestSourceDocumentProjection(db, document.id);
  }
  return getEntryCategoriesAction();
}

describe("getEntryCategoriesAction", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    ledgerId = randomUUID();
    await db.insert(ledgers).values({
      id: ledgerId,
    });
    await ensureTestLedgerBooks(db, ledgerId);
  });

  it("returns categories sorted by sortOrder", async () => {
    const db = getTestDb();
    await db.insert(entryCategories).values([
      { id: randomUUID(), ledgerId, name: "B", sortOrder: 2 },
      { id: randomUUID(), ledgerId, name: "A", sortOrder: 1 },
      { id: randomUUID(), ledgerId, name: "C", sortOrder: 3 },
    ]);

    const result = await getTargetEntryCategoriesAction(ledgerId);
    expect(result.map((c) => c.name)).toEqual(["A", "B", "C"]);
  });

  it("includes entry count per category", async () => {
    const db = getTestDb();
    const catId = randomUUID();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "餐饮",
      sortOrder: 1,
    });

    const [doc] = await db
      .insert(sourceDocuments)
      .values({
        id: randomUUID(),
        ledgerId,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    expect(doc).toBeDefined();
    if (doc === undefined) {
      throw new Error("Expected source document insert to return a row");
    }

    await db.insert(ledgerEntries).values([
      {
        id: randomUUID(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Item 1",
        amount: "10.00",
        currency: "CNY",
        categoryId: catId,
      },
      {
        id: randomUUID(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Item 2",
        amount: "20.00",
        currency: "CNY",
        categoryId: catId,
      },
    ]);

    const result = await getTargetEntryCategoriesAction(ledgerId);
    const firstCategory = result[0];
    expect(firstCategory).toBeDefined();
    expect(firstCategory?.entryCount).toBe(2);
  });
});
