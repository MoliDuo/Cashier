import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { listLedgerEntryPage } from "@/modules/ledger/server/entry-reads/list-ledger-entry-page";

const findVisibleEntry = async (id: string, ledgerId: string) => {
  const page = await listLedgerEntryPage({
    ledgerId,
    limit: 100,
    filters: {},
  });
  return page.items.find((entry) => entry.id === id) ?? null;
};

describe("visible ledger entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the entry does not exist", async () => {
    await expect(findVisibleEntry(crypto.randomUUID(), crypto.randomUUID())).resolves.toBeNull();
  });

  it("returns null when entry exists but belongs to a different ledger", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    const sourceDocument = createSourceDocumentData(ledger.id);
    const entry = createLedgerEntryData(ledger.id, { sourceDocumentId: sourceDocument.id });

    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(sourceDocuments).values({
      ...sourceDocument,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${sourceDocument.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await db.insert(ledgerEntries).values(entry);
    await activateTestSourceDocumentProjection(db, sourceDocument.id);

    // pass a different ledgerId — should return null, not throw
    await expect(findVisibleEntry(entry.id, crypto.randomUUID())).resolves.toBeNull();
  });

  it("returns detail while stripping heavy source-document fields", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    const category = createCategoryData(ledger.id);
    const sourceDocument = createSourceDocumentData(ledger.id, {
      imageUrls: ["https://example.com/a.png", "https://example.com/b.png"],
      metadata: {
        note: "keep-me",
        visionDescription: "remove-me",
        originalImageUrls: ["https://example.com/original.png"],
      },
    });
    const entry = createLedgerEntryData(ledger.id, {
      categoryId: category.id,
      sourceDocumentId: sourceDocument.id,
    });

    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(entryCategories).values(category);
    await db.insert(sourceDocuments).values({
      ...sourceDocument,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${sourceDocument.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await db.insert(ledgerEntries).values(entry);
    await activateTestSourceDocumentProjection(db, sourceDocument.id, {
      imageUrls: ["https://example.com/a.png", "https://example.com/b.png"],
    });

    const result = await findVisibleEntry(entry.id, ledger.id);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(entry.id);
    expect(result?.category?.id).toBe(category.id);
    expect(result?.sourceDocument).not.toHaveProperty("imageUrls");
    expect(result?.sourceDocument?.hasImages).toBe(true);
    expect(result?.sourceDocument).not.toHaveProperty("metadata");
  });
});
