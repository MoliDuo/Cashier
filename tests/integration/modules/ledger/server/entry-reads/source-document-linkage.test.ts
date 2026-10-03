import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import {
  createCategoryData,
  createLedgerData,
  createLedgerEntryData,
  createSourceDocumentData,
} from "tests/helpers/factories";
import { entryCategories, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { listLedgerEntryViewsBySourceDocumentIds } from "@/modules/ledger/server/entry-reads/list-ledger-entry-views-by-source-document-ids";

describe("ledger source-document linkage", () => {
  let sourceDocumentIds: string[] = [];

  beforeEach(async () => {
    const db = getTestDb();

    const ledger = createLedgerData();
    const category = createCategoryData();
    const firstDoc = createSourceDocumentData();
    const secondDoc = createSourceDocumentData();

    sourceDocumentIds = [firstDoc.id, secondDoc.id];

    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db);
    await db.insert(entryCategories).values(category);
    await db.insert(sourceDocuments).values([
      {
        ...firstDoc,
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      },
      {
        ...secondDoc,
        bookId: sql`(SELECT id FROM books ORDER BY sort_order LIMIT 1)`,
      },
    ]);
    await db.insert(ledgerEntries).values([
      createLedgerEntryData({
        sourceDocumentId: firstDoc.id,
        categoryId: category.id,
        itemName: "first entry",
      }),
      createLedgerEntryData({
        sourceDocumentId: secondDoc.id,
        categoryId: category.id,
        itemName: "second entry",
      }),
    ]);
    await activateTestSourceDocumentProjection(db, firstDoc.id);
    await activateTestSourceDocumentProjection(db, secondDoc.id);
  });

  it("returns an empty map when source document ids are empty", async () => {
    const result = await listLedgerEntryViewsBySourceDocumentIds({
      sourceDocumentIds: [],
    });

    expect(result.size).toBe(0);
  });

  it("groups active entries by source document id", async () => {
    const result = await listLedgerEntryViewsBySourceDocumentIds({
      sourceDocumentIds,
    });

    const firstEntries = result.get(sourceDocumentIds[0] ?? "");
    const secondEntries = result.get(sourceDocumentIds[1] ?? "");

    expect(firstEntries).toHaveLength(1);
    expect(firstEntries?.[0]?.itemName).toBe("first entry");
    expect(firstEntries?.[0]?.category?.name).toBe("餐饮");
    expect(secondEntries).toHaveLength(1);
    expect(secondEntries?.[0]?.itemName).toBe("second entry");
    expect(result.has(sourceDocumentIds[0] ?? "")).toBe(true);
    expect(result.has(sourceDocumentIds[1] ?? "")).toBe(true);
  });
});
