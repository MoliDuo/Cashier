import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
} from "tests/helpers/schema-setup";
import {
  entryCategories,
  ledgerEntries,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";
import { eq } from "drizzle-orm";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";
import { getStreamTotal } from "@/modules/source-document/server/stream-total";

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

  it("excludes unconverted entries from amount filters while preserving details", async () => {
    const db = getTestDb();
    const [document] = await db
      .insert(sourceDocuments)
      .values({
        ledgerId,
        title: "Coffee and cake",
        documentDate: "2026-03-20",
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    const sourceDocument = requireDefined(document, "filtered subtotal document");
    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId: sourceDocument.id,
        amount: "20.00",
        // No USD rate is stored for the day, so the entry has no converted amount.
        currency: "USD",
        itemName: "Coffee",
        categoryId,
      },
      {
        ledgerId,
        sourceDocumentId: sourceDocument.id,
        amount: "80.00",
        currency: "CNY",
        itemName: "Cake",
        categoryId,
      },
    ]);
    await activateTestSourceDocumentProjection(db, sourceDocument.id);

    const stream = await listStreamPage(ledgerId, { maxAmount: "30", limit: 10 });
    expect(stream.items).toHaveLength(0);
    await expect(getStreamTotal(ledgerId, { maxAmount: "30" })).resolves.toEqual({
      total: "0",
      unconvertedCount: 0,
    });

    expect(
      await db.query.ledgerEntries.findMany({
        where: eq(ledgerEntries.sourceDocumentId, sourceDocument.id),
      })
    ).toHaveLength(2);
  });

  it("totals only completed documents across the full Stream filter", async () => {
    const db = getTestDb();
    const docs = await db
      .insert(sourceDocuments)
      .values([
        {
          ledgerId,
          title: "completed-total",
          documentDate: "2026-03-15",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ledgerId,
          title: "failed-with-active-result",
          documentDate: "2026-03-16",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
        {
          ledgerId,
          title: "completed-out-of-range",
          documentDate: "2026-02-01",
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        },
      ])
      .returning();
    const completed = requireDefined(docs[0], "completed total document");
    const failed = requireDefined(docs[1], "failed total document");
    const outOfRange = requireDefined(docs[2], "out of range total document");

    await db.insert(ledgerEntries).values([
      {
        ledgerId,
        sourceDocumentId: completed.id,
        amount: "125.25",
        currency: "CNY",
        itemName: "completed item",
        categoryId,
      },
      {
        ledgerId,
        sourceDocumentId: failed.id,
        amount: "75.00",
        currency: "CNY",
        itemName: "old active item",
        categoryId,
      },
      {
        ledgerId,
        sourceDocumentId: outOfRange.id,
        amount: "200.00",
        currency: "CNY",
        itemName: "out of range item",
        categoryId,
      },
    ]);

    for (const doc of docs) {
      await activateTestSourceDocumentProjection(db, doc.id, { parsed: doc.id !== failed.id });
    }

    const failedRevision = requireDefined(
      (
        await db
          .insert(sourceDocumentRevisions)
          .values({
            ledgerId,
            sourceDocumentId: failed.id,
            processingStatus: "failed",
            finishedAt: new Date(),
          })
          .returning()
      )[0],
      "failed pending revision"
    );
    await db
      .update(sourceDocuments)
      .set({ latestSubmissionRevisionId: failedRevision.id })
      .where(eq(sourceDocuments.id, failed.id));

    await expect(
      getStreamTotal(ledgerId, {
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      })
    ).resolves.toEqual({ total: "200.25", unconvertedCount: 0 });
    await expect(getStreamTotal(ledgerId, { statuses: ["processing"] })).resolves.toEqual({
      total: "0",
      unconvertedCount: 0,
    });
    await expect(getStreamTotal(ledgerId, { statuses: ["completed", "failed"] })).resolves.toEqual({
      total: "400.25",
      unconvertedCount: 0,
    });
    await expect(getStreamTotal(ledgerId, { minAmount: "100", maxAmount: "150" })).resolves.toEqual(
      {
        total: "125.25",
        unconvertedCount: 0,
      }
    );
  });
});
