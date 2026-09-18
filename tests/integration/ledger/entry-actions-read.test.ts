import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTestDb } from "../../setup";
import { ledgers, ledgerEntries, entryCategories } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";

const { getRatesMock, convertBatchMock } = vi.hoisted(() => ({
  getRatesMock: vi.fn(async () => ({
    base: "USD",
    date: "2026-01-01",
    rates: { CNY: 1 } as Record<string, number>,
  })),
  convertBatchMock: vi.fn(),
}));

vi.mock("@/application/adapters/postgres/exchange-rate", () => {
  const rateBook = {
    getRates: getRatesMock,
    convertBatch: convertBatchMock,
  };
  return { ExchangeRateService: rateBook, postgresFxRateBook: rateBook, fetchWithRetry: vi.fn() };
});
import { getLedgerEntriesAction } from "@/modules/ledger/server/list-entries";
import { UNCATEGORIZED_SENTINEL } from "@/modules/ledger/contract-schemas";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

async function seedDoc(db: ReturnType<typeof getTestDb>, ledgerId: string, entryDate?: string) {
  const [doc] = await db
    .insert(sourceDocuments)
    .values({
      id: uuidv4(),
      ledgerId,
      documentDate: entryDate ?? null,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    })
    .returning();
  expect(doc).toBeDefined();
  if (doc === undefined) {
    throw new Error("Expected source document insert to return a row");
  }
  await activateTestSourceDocumentProjection(db, doc.id);
  return doc;
}

async function getTargetLedgerEntriesAction(
  ledgerId: string,
  input: Parameters<typeof getLedgerEntriesAction>[1]
) {
  const db = getTestDb();
  const documents = await db.query.sourceDocuments.findMany({
    where: (documents, { eq }) => eq(documents.ledgerId, ledgerId),
    columns: { id: true },
  });
  for (const document of documents) {
    await activateTestSourceDocumentProjection(db, document.id);
  }
  return getLedgerEntriesAction(ledgerId, input);
}

describe("getLedgerEntriesAction", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    ledgerId = uuidv4();
    await db.insert(ledgers).values({
      id: ledgerId,
      userId: TEST_USER_ID,
    });
    await ensureTestLedgerBooks(db, ledgerId);
  });

  it("returns paginated entries", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, ledgerId);

    for (let i = 0; i < 5; i++) {
      await db.insert(ledgerEntries).values({
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: `Item ${i}`,
        amount: "10.00",
        currency: "CNY",
      });
    }

    const result = await getTargetLedgerEntriesAction(ledgerId, { limit: 3 });
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBeDefined();
  });

  it("paginates same-day same-timestamp documents without duplicates or gaps", async () => {
    const db = getTestDb();
    const createdAt = new Date("2026-05-15T08:00:00.000Z");
    const entriesByDoc: Array<{ a: string; b: string }> = [];

    for (let i = 0; i < 3; i++) {
      const doc = await seedDoc(db, ledgerId, "2026-05-15");
      await db.update(sourceDocuments).set({ createdAt }).where(eq(sourceDocuments.id, doc.id));
      const [a, b] = await db
        .insert(ledgerEntries)
        .values([
          {
            id: uuidv4(),
            ledgerId,
            sourceDocumentId: doc.id,
            itemName: `A-${i}`,
            amount: "10.00",
            currency: "CNY",
          },
          {
            id: uuidv4(),
            ledgerId,
            sourceDocumentId: doc.id,
            itemName: `B-${i}`,
            amount: "20.00",
            currency: "CNY",
          },
        ])
        .returning();
      if (a == null || b == null) {
        throw new Error("Expected two ledger entries per document");
      }
      entriesByDoc.push({ a: a.id, b: b.id });
    }

    const collected: string[] = [];
    let cursor: string | null | undefined;
    for (let pageNum = 0; pageNum < 10; pageNum++) {
      const result = await getTargetLedgerEntriesAction(ledgerId, {
        cursor: cursor ?? undefined,
        limit: 2,
      });
      collected.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor;
      if (cursor == null) break;
    }

    expect(collected).toHaveLength(6);
    expect(new Set(collected).size).toBe(6);
    // Within each document, position 0 must sort before position 1.
    for (const { a, b } of entriesByDoc) {
      const aIndex = collected.indexOf(a);
      const bIndex = collected.indexOf(b);
      expect(aIndex).toBeGreaterThanOrEqual(0);
      expect(bIndex).toBeGreaterThan(aIndex);
    }
  });

  it("rejects a cursor whose fingerprint does not match the query", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, ledgerId);
    await db.insert(ledgerEntries).values([
      {
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "First",
        amount: "10.00",
        currency: "CNY",
      },
      {
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Second",
        amount: "20.00",
        currency: "CNY",
      },
      {
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Third",
        amount: "30.00",
        currency: "CNY",
      },
    ]);

    const firstPage = await getTargetLedgerEntriesAction(ledgerId, { limit: 2 });
    expect(firstPage.nextCursor).toBeDefined();
    if (firstPage.nextCursor == null) {
      throw new Error("Expected a next cursor on the first page");
    }

    await expect(
      getTargetLedgerEntriesAction(ledgerId, {
        cursor: firstPage.nextCursor,
        categoryId: uuidv4(),
      })
    ).rejects.toThrow("Ledger entry cursor does not match the query");
  });

  it("includes undated documents on their effective (UTC creation) date", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, ledgerId);
    await db
      .update(sourceDocuments)
      .set({ createdAt: new Date("2026-06-12T18:00:00.000Z") })
      .where(eq(sourceDocuments.id, doc.id));
    await db.insert(ledgerEntries).values({
      id: uuidv4(),
      ledgerId,
      sourceDocumentId: doc.id,
      itemName: "Undated",
      amount: "10.00",
      currency: "CNY",
    });

    const inRange = await getTargetLedgerEntriesAction(ledgerId, {
      startDate: "2026-06-12",
      endDate: "2026-06-12",
    });
    expect(inRange.items.map((item) => item.itemName)).toEqual(["Undated"]);

    const outside = await getTargetLedgerEntriesAction(ledgerId, {
      startDate: "2026-06-13",
    });
    expect(outside.items).toHaveLength(0);
  });

  it("filters by categoryId", async () => {
    const db = getTestDb();
    const catId = uuidv4();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "餐饮",
      sortOrder: 1,
    });

    const doc = await seedDoc(db, ledgerId);
    await db.insert(ledgerEntries).values([
      {
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Categorized",
        amount: "10.00",
        currency: "CNY",
        categoryId: catId,
      },
      {
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Uncategorized",
        amount: "20.00",
        currency: "CNY",
      },
    ]);

    const result = await getTargetLedgerEntriesAction(ledgerId, { categoryId: catId });
    expect(result.items).toHaveLength(1);
    const categorizedEntry = result.items[0];
    expect(categorizedEntry).toBeDefined();
    expect(categorizedEntry?.itemName).toBe("Categorized");
  });

  it("filters uncategorized entries when using the __uncategorized__ sentinel", async () => {
    const db = getTestDb();
    const catId = uuidv4();
    await db.insert(entryCategories).values({
      id: catId,
      ledgerId,
      name: "餐饮",
      sortOrder: 1,
    });

    const doc = await seedDoc(db, ledgerId);

    const [categorizedEntry] = await db
      .insert(ledgerEntries)
      .values({
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Categorized",
        amount: "10.00",
        currency: "CNY",
        categoryId: catId,
      })
      .returning();
    expect(categorizedEntry).toBeDefined();
    if (categorizedEntry === undefined) {
      throw new Error("Expected ledger entry insert to return a row");
    }

    const [uncategorizedEntry] = await db
      .insert(ledgerEntries)
      .values({
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Uncategorized",
        amount: "20.00",
        currency: "CNY",
      })
      .returning();
    expect(uncategorizedEntry).toBeDefined();
    if (uncategorizedEntry === undefined) {
      throw new Error("Expected ledger entry insert to return a row");
    }

    const result = await getTargetLedgerEntriesAction(ledgerId, {
      categoryId: UNCATEGORIZED_SENTINEL,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(uncategorizedEntry.id);
  });

  it("filters by currency", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, ledgerId);
    await db.insert(ledgerEntries).values([
      {
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "CNY item",
        amount: "10.00",
        currency: "CNY",
      },
      {
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "USD item",
        amount: "20.00",
        currency: "USD",
      },
    ]);

    const result = await getTargetLedgerEntriesAction(ledgerId, { currency: "USD" });
    expect(result.items).toHaveLength(1);
    const usdEntry = result.items[0];
    expect(usdEntry).toBeDefined();
    expect(usdEntry?.itemName).toBe("USD item");
  });

  it("filters by date range via sourceDocument.entryDate", async () => {
    const db = getTestDb();
    const doc1 = await seedDoc(db, ledgerId, "2024-01-01");
    const doc2 = await seedDoc(db, ledgerId, "2024-06-01");
    const doc3 = await seedDoc(db, ledgerId, "2024-12-01");

    for (const [doc, name] of [
      [doc1, "Jan"],
      [doc2, "Jun"],
      [doc3, "Dec"],
    ] as const) {
      await db.insert(ledgerEntries).values({
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: name,
        amount: "10.00",
        currency: "CNY",
      });
    }

    const result = await getTargetLedgerEntriesAction(ledgerId, {
      startDate: "2024-02-01",
      endDate: "2024-11-01",
    });
    expect(result.items).toHaveLength(1);
    const juneEntry = result.items[0];
    expect(juneEntry).toBeDefined();
    expect(juneEntry?.itemName).toBe("Jun");
  });

  it("filters by entryDate not createdAt", async () => {
    const db = getTestDb();

    // Create doc with entryDate in Jan but created in March
    const [docA] = await db
      .insert(sourceDocuments)
      .values({
        id: uuidv4(),
        ledgerId,
        documentDate: "2024-01-15",
        createdAt: new Date("2024-03-01"),
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    expect(docA).toBeDefined();
    if (docA === undefined) {
      throw new Error("Expected source document insert to return a row");
    }

    // Create doc with entryDate in March but created in January
    const [docB] = await db
      .insert(sourceDocuments)
      .values({
        id: uuidv4(),
        ledgerId,
        documentDate: "2024-03-15",
        createdAt: new Date("2024-01-01"),
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
      })
      .returning();
    expect(docB).toBeDefined();
    if (docB === undefined) {
      throw new Error("Expected source document insert to return a row");
    }

    await db.insert(ledgerEntries).values({
      id: uuidv4(),
      ledgerId,
      sourceDocumentId: docA.id,
      itemName: "Jan Item",
      amount: "10.00",
      currency: "CNY",
    });

    await db.insert(ledgerEntries).values({
      id: uuidv4(),
      ledgerId,
      sourceDocumentId: docB.id,
      itemName: "Mar Item",
      amount: "10.00",
      currency: "CNY",
    });

    // Filter for January 2024
    const result = await getTargetLedgerEntriesAction(ledgerId, {
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    });

    // Should only return entry from docA (entryDate in January)
    expect(result.items).toHaveLength(1);
    const januaryEntry = result.items[0];
    expect(januaryEntry).toBeDefined();
    expect(januaryEntry?.itemName).toBe("Jan Item");
  });

  it("filters by minAmount and maxAmount", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, ledgerId);
    await db.insert(ledgerEntries).values([
      {
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Cheap",
        amount: "10.00",
        currency: "CNY",
        convertedAmount: "10.00",
      },
      {
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Mid",
        amount: "50.00",
        currency: "CNY",
        convertedAmount: "50.00",
      },
      {
        id: uuidv4(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Expensive",
        amount: "200.00",
        currency: "CNY",
        convertedAmount: "200.00",
      },
    ]);

    const result = await getTargetLedgerEntriesAction(ledgerId, {
      minAmount: "20",
      maxAmount: "100",
    });
    expect(result.items).toHaveLength(1);
    const midEntry = result.items[0];
    expect(midEntry).toBeDefined();
    expect(midEntry?.itemName).toBe("Mid");
  });

  it("excludes soft-deleted entries", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, ledgerId);
    await db.insert(ledgerEntries).values({
      id: uuidv4(),
      ledgerId,
      sourceDocumentId: doc.id,
      itemName: "Deleted",
      amount: "10.00",
      currency: "CNY",
      deletedAt: new Date(),
    });

    const result = await getTargetLedgerEntriesAction(ledgerId, {});
    expect(result.items).toHaveLength(0);
  });
});
