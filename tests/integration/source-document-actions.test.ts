import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getSourceDocumentLightAction } from "@/modules/source-document/server/get-document-light";
import { getTestDb } from "../setup";
import {
  ledgers,
  sourceDocuments,
  users,
  ledgerEntries,
  entryCategories,
  revisionFiles,
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
  configureTestCoupleLedger,
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
    await configureTestCoupleLedger(db, ledgerData.id);

    const docData = createSourceDocumentData(ledgerData.id, {
      title: "Test Receipt",
      text: "Lunch for 25.50",
    });
    await db.insert(sourceDocuments).values({
      ...docData,
      attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${docData.ledgerId})`,
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
    await configureTestCoupleLedger(db, ledgerData.id);

    const docData = createSourceDocumentData(ledgerData.id, {
      imageUrls: ["data:image/jpeg;base64,/9j/4AAQ..."],
    });
    await db.insert(sourceDocuments).values({
      ...docData,
      attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${docData.ledgerId})`,
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
    await configureTestCoupleLedger(db, ledgerData.id);

    const docData = createSourceDocumentData(ledgerData.id);
    await db.insert(sourceDocuments).values({
      ...docData,
      attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${docData.ledgerId})`,
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
    await configureTestCoupleLedger(db, ledgerData.id);

    const docData = createSourceDocumentData(ledgerData.id);
    await db.insert(sourceDocuments).values({
      ...docData,
      attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${docData.ledgerId})`,
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
    await configureTestCoupleLedger(db, ledgerData.id);

    const categoryData = createCategoryData(ledgerData.id);
    await db.insert(entryCategories).values(categoryData);

    const docData = createSourceDocumentData(ledgerData.id);
    await db.insert(sourceDocuments).values({
      ...docData,
      attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${docData.ledgerId})`,
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
    await configureTestCoupleLedger(db, ledgerData.id);

    const result = await getSourceDocumentLightAction(ledgerData.id, uuidv4());
    expect(result).toBeNull();
  });

  it("documents that inaccessible ledgers surface NotFoundError semantics", async () => {
    const db = getTestDb();
    const otherUserId = "33333333-3333-3333-3333-333333333333";
    await db
      .insert(users)
      .values({
        id: otherUserId,
        email: "other3@example.com",
        name: "Other User 3",
        nickname: "B",
        gender: "female",
        emailVerified: new Date(),
      })
      .onConflictDoNothing();

    const ledgerData = createLedgerData({ userId: otherUserId });
    await db.insert(ledgers).values(ledgerData);

    const docData = createSourceDocumentData(ledgerData.id);
    await db.insert(sourceDocuments).values({
      ...docData,
      attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${docData.ledgerId})`,
    });

    // withSourceDocumentLedgerAccess preserves ledger-not-found semantics for inaccessible ledgers.
    await expect(getSourceDocumentLightAction(ledgerData.id, docData.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
