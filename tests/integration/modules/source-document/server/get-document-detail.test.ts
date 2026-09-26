import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getSourceDocumentDetailAction } from "@/modules/source-document/server/get-document-detail";
import { getTestDb } from "tests/setup";
import { entryCategories, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import {
  createLedgerData,
  createSourceDocumentData,
  createCategoryData,
  createLedgerEntryData,
} from "tests/helpers/factories";
import { randomUUID } from "node:crypto";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "tests/helpers/session";

describe("getSourceDocumentDetailAction", () => {
  const testUserId = "00000000-0000-0000-0000-000000000000";

  beforeEach(() => {
    vi.mocked(getCurrentSession).mockResolvedValue(
      testSession(testUserId, { email: "test@example.com" })
    );
  });

  it("should return source document with basic data", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData();
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db, ledgerData.id);

    const docData = createSourceDocumentData(ledgerData.id, {
      title: "Test Receipt",
      text: "Lunch for 25.50",
    });
    await db.insert(sourceDocuments).values({
      ...docData,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${docData.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await activateTestSourceDocumentProjection(db, docData.id, { text: "Lunch for 25.50" });

    const result = await getSourceDocumentDetailAction(docData.id);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(docData.id);
    expect(result!.ledgerId).toBe(ledgerData.id);
    expect(result!.title).toBe("Test Receipt");
    expect(result!.text).toBe("Lunch for 25.50");
    expect(result!.hasImages).toBe(false);
    expect(result).not.toHaveProperty("metadata");
  });

  it("should include stored-file identities in the normalized light response", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData();
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db, ledgerData.id);

    const docData = createSourceDocumentData(ledgerData.id, {
      imageUrls: ["data:image/jpeg;base64,/9j/4AAQ..."],
    });
    await db.insert(sourceDocuments).values({
      ...docData,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${docData.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await activateTestSourceDocumentProjection(db, docData.id, {
      imageUrls: ["data:image/jpeg;base64,/9j/4AAQ..."],
    });

    const result = await getSourceDocumentDetailAction(docData.id);

    expect(result).not.toBeNull();
    expect(result!.hasImages).toBe(true);
    expect(result!.files).toEqual([
      expect.objectContaining({ id: expect.any(String), contentType: "image/jpeg" }),
    ]);
    expect(result).not.toHaveProperty("imageUrls");
  });

  it("should include associated ledgerEntries", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData();
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db, ledgerData.id);

    const categoryData = createCategoryData(ledgerData.id);
    await db.insert(entryCategories).values(categoryData);

    const docData = createSourceDocumentData(ledgerData.id);
    await db.insert(sourceDocuments).values({
      ...docData,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${docData.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });

    const entryData = createLedgerEntryData(ledgerData.id, {
      sourceDocumentId: docData.id,
      categoryId: categoryData.id,
      itemName: "Test Entry",
    });
    await db.insert(ledgerEntries).values(entryData);
    await activateTestSourceDocumentProjection(db, docData.id);

    const result = await getSourceDocumentDetailAction(docData.id);

    expect(result).not.toBeNull();
    if (result == null) {
      throw new Error("Expected source document light result");
    }
    expect(result.ledgerEntries).toHaveLength(1);
    const firstEntry = result.ledgerEntries[0];
    expect(firstEntry).toBeDefined();
    if (firstEntry == null) {
      throw new Error("Expected source document ledger entry");
    }
    expect(firstEntry.itemName).toBe("Test Entry");
    expect(firstEntry.category?.name).toBe(categoryData.name);
  });

  it("should return null when document does not exist", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData();
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db, ledgerData.id);

    const result = await getSourceDocumentDetailAction(randomUUID());
    expect(result).toBeNull();
  });

  it("validates the document identity and requires a session", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);

    await expect(getSourceDocumentDetailAction("not-a-uuid")).rejects.toThrow("Validation failed");
    vi.mocked(getCurrentSession).mockResolvedValueOnce(null);
    await expect(getSourceDocumentDetailAction(randomUUID())).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  });

  it("surfaces NotFoundError for a ledger that is not the single live one", async () => {
    const db = getTestDb();
    const { ledgerId: liveLedgerId } = await createTestUserWithLedger(db);
    await ensureTestLedgerBooks(db, liveLedgerId);

    // A second ledger row that is not live: the access wrapper answers NotFound
    // rather than revealing that the row (and its documents) exist.
    const otherLedgerId = randomUUID();
    await db.insert(ledgers).values({ id: otherLedgerId });
    await ensureTestLedgerBooks(db, otherLedgerId);
    const docData = createSourceDocumentData(otherLedgerId);
    await db.insert(sourceDocuments).values({
      ...docData,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${docData.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });

    await expect(getSourceDocumentDetailAction(docData.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
