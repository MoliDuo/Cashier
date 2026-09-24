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
  createTestUser,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { listLedgerEntryViewsBySourceDocumentIds } from "@/modules/ledger/server/entry-reads/list-ledger-entry-views-by-source-document-ids";

describe("ledger source-document linkage", () => {
  let ledgerId = "";
  let sourceDocumentIds: string[] = [];

  beforeEach(async () => {
    const db = getTestDb();
    const secondUserId = crypto.randomUUID();
    await createTestUser(db, undefined, secondUserId);

    const ledger = createLedgerData();
    ledgerId = ledger.id;
    const otherLedger = createLedgerData();
    const category = createCategoryData(ledgerId);
    const firstDoc = createSourceDocumentData(ledgerId);
    const secondDoc = createSourceDocumentData(ledgerId);
    const otherDoc = createSourceDocumentData(otherLedger.id);

    sourceDocumentIds = [firstDoc.id, secondDoc.id];

    await db.insert(ledgers).values([ledger, otherLedger]);
    await ensureTestLedgerBooks(db, ledger.id);
    await ensureTestLedgerBooks(db, otherLedger.id);
    await db.insert(entryCategories).values(category);
    await db.insert(sourceDocuments).values([
      {
        ...firstDoc,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${firstDoc.ledgerId} ORDER BY sort_order LIMIT 1)`,
      },
      {
        ...secondDoc,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${secondDoc.ledgerId} ORDER BY sort_order LIMIT 1)`,
      },
      {
        ...otherDoc,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${otherDoc.ledgerId} ORDER BY sort_order LIMIT 1)`,
      },
    ]);
    await db.insert(ledgerEntries).values([
      createLedgerEntryData(ledgerId, {
        sourceDocumentId: firstDoc.id,
        categoryId: category.id,
        itemName: "first entry",
      }),
      createLedgerEntryData(ledgerId, {
        sourceDocumentId: firstDoc.id,
        categoryId: category.id,
        itemName: "deleted entry",
        deletedAt: new Date(),
      } as never),
      createLedgerEntryData(ledgerId, {
        sourceDocumentId: secondDoc.id,
        categoryId: category.id,
        itemName: "second entry",
      }),
      createLedgerEntryData(otherLedger.id, {
        sourceDocumentId: otherDoc.id,
        itemName: "other ledger entry",
      }),
    ]);
    await activateTestSourceDocumentProjection(db, firstDoc.id);
    await activateTestSourceDocumentProjection(db, secondDoc.id);
    await activateTestSourceDocumentProjection(db, otherDoc.id);
  });

  it("returns an empty map when source document ids are empty", async () => {
    const result = await listLedgerEntryViewsBySourceDocumentIds({
      ledgerId,
      sourceDocumentIds: [],
    });

    expect(result.size).toBe(0);
  });

  it("groups active entries by source document id and excludes deleted or foreign-ledger entries", async () => {
    const result = await listLedgerEntryViewsBySourceDocumentIds({
      ledgerId,
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
