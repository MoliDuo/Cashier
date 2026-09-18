import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getSourceDocumentLightAction } from "@/modules/source-document/server/get-document-light";
import { getTestDb } from "../setup";
import {
  entryCategories,
  ledgerEntries,
  ledgers,
  revisionFiles,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import {
  createLedgerData,
  createSourceDocumentData,
  createCategoryData,
  createLedgerEntryData,
} from "../helpers/factories";
import { v4 as uuidv4 } from "uuid";
import { NotFoundError } from "@/lib/errors";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
  ensureTestLedgerBooks,
} from "../helpers/schema-setup";
import { getTargetSourceDocumentAccessContext } from "@/application/adapters/postgres/source-document-reads";
import { createProcessingRevisionInTransaction } from "@/application/adapters/postgres/revisions";

// Mock auth module
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/auth";

describe("getSourceDocumentLightAction", () => {
  const testUserId = "00000000-0000-0000-0000-000000000000";

  beforeEach(() => {
    vi.mocked(
      auth as unknown as () => Promise<{
        user: { id: string; email: string };
        expires: string;
      } | null>
    ).mockResolvedValue({
      user: { id: testUserId, email: "test@example.com" },
      expires: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
  });

  it("should return source document with basic data", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData({ userId: testUserId });
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

    const result = await getSourceDocumentLightAction(ledgerData.id, docData.id);

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
    const ledgerData = createLedgerData({ userId: testUserId });
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

    const result = await getSourceDocumentLightAction(ledgerData.id, docData.id);

    expect(result).not.toBeNull();
    expect(result!.hasImages).toBe(true);
    expect(result!.files).toEqual([
      expect.objectContaining({ id: expect.any(String), contentType: "image/jpeg" }),
    ]);
    expect(result).not.toHaveProperty("imageUrls");
  });

  it("ignores soft-deleted files in the access context", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData({ userId: testUserId });
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db, ledgerData.id);

    const docData = createSourceDocumentData(ledgerData.id);
    await db.insert(sourceDocuments).values({
      ...docData,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${docData.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    const revisionId = await activateTestSourceDocumentProjection(db, docData.id, {
      imageUrls: ["data:image/jpeg;base64,/9j/4AAQ..."],
    });

    expect(await getTargetSourceDocumentAccessContext(docData.id)).toEqual({
      ledgerId: ledgerData.id,
      hasImages: true,
    });

    const fileLink = await db.query.revisionFiles.findFirst({
      where: eq(revisionFiles.revisionId, revisionId),
      columns: { storedFileId: true },
    });
    expect(fileLink).not.toBeUndefined();
    await db
      .update(storedFiles)
      .set({ deletedAt: new Date() })
      .where(eq(storedFiles.id, fileLink!.storedFileId));

    expect(await getTargetSourceDocumentAccessContext(docData.id)).toEqual({
      ledgerId: ledgerData.id,
      hasImages: false,
    });
  });

  it("checks the pending revision before the active revision for image access", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData({ userId: testUserId });
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db, ledgerData.id);

    const docData = createSourceDocumentData(ledgerData.id);
    await db.insert(sourceDocuments).values({
      ...docData,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${docData.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await activateTestSourceDocumentProjection(db, docData.id, {
      imageUrls: ["data:image/jpeg;base64,/9j/4AAQ..."],
    });
    await db.transaction((tx) =>
      createProcessingRevisionInTransaction(tx, {
        ledgerId: ledgerData.id,
        sourceDocumentId: docData.id,
        input: {
          text: "replacement without images",
          storedFileIds: [],
          documentDate: null,
        },
      })
    );

    expect(await getTargetSourceDocumentAccessContext(docData.id)).toEqual({
      ledgerId: ledgerData.id,
      hasImages: false,
    });
  });

  it("should include associated ledgerEntries", async () => {
    const db = getTestDb();
    const ledgerData = createLedgerData({ userId: testUserId });
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

    const result = await getSourceDocumentLightAction(ledgerData.id, docData.id);

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
    const ledgerData = createLedgerData({ userId: testUserId });
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db, ledgerData.id);

    const result = await getSourceDocumentLightAction(ledgerData.id, uuidv4());
    expect(result).toBeNull();
  });

  it("surfaces NotFoundError for a ledger that is not the single live one", async () => {
    const db = getTestDb();
    const { ledgerId: liveLedgerId } = await createTestUserWithLedger(db);
    await ensureTestLedgerBooks(db, liveLedgerId);

    // A second ledger row that is not live: the access wrapper answers NotFound
    // rather than revealing that the row (and its documents) exist.
    const otherLedgerId = uuidv4();
    await db.insert(ledgers).values({ id: otherLedgerId, userId: testUserId });
    await ensureTestLedgerBooks(db, otherLedgerId);
    const docData = createSourceDocumentData(otherLedgerId);
    await db.insert(sourceDocuments).values({
      ...docData,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${docData.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });

    await expect(getSourceDocumentLightAction(otherLedgerId, docData.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(getSourceDocumentLightAction(uuidv4(), docData.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
