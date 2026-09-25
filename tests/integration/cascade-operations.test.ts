import { listCategories } from "@/modules/ledger/server/categories";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";
import { getLedgerSettingsAction } from "@/modules/ledger/server/get-ledger-settings";
import { sql } from "drizzle-orm";
/**
 * Cascade Operations Integration Tests
 *
 * These tests verify that related entities are correctly updated
 * when a primary entity is modified or deleted.
 *
 * Test cases are designed from BUSINESS expectations, not implementation details.
 */

import { describe, it, expect, vi } from "vitest";
import { getTestDb } from "../setup";
import { ledgers, ledgerEntries, entryCategories, sourceDocuments } from "@/persistence";
import {
  createLedgerData,
  createCategoryData,
  createLedgerEntryData,
  createSourceDocumentData,
} from "../helpers/factories";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
  ensureTestLedgerBooks,
} from "../helpers/schema-setup";
import { eq, isNull, and } from "drizzle-orm";

vi.mock("next-intl/server", () => ({ getLocale: vi.fn().mockResolvedValue("zh") }));

// Import actions
import { saveEntryCategoriesAction } from "@/modules/ledger/server-actions/categories";
import { getEntryCategoriesAction } from "@/modules/ledger/server/list-categories";
import {
  deleteLedgerEntryAction,
  createLedgerEntryAction,
  batchUpdateLedgerEntriesAction,
} from "@/modules/ledger/server-actions/entries";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";

async function getTargetEntryCategoriesAction(ledgerId: string) {
  const db = getTestDb();
  const documents = await db.query.sourceDocuments.findMany({
    where: (documents, { eq }) => eq(documents.ledgerId, ledgerId),
    columns: { id: true, deletedAt: true },
  });
  for (const document of documents) {
    if (document.deletedAt == null) {
      await activateTestSourceDocumentProjection(db, document.id);
    }
  }
  return getEntryCategoriesAction();
}

/**
 * Helper function to create a complete test ledger with categories and entries
 * Creates a unique user for each ledger to avoid unique constraint violations
 */
async function createTestLedger(db: ReturnType<typeof getTestDb>, useCurrentUser = false) {
  if (useCurrentUser) {
    // Use the default test user (TEST_USER_ID)
    // First clean up any existing ledger for this user to avoid unique constraint
    await db.delete(ledgers);

    const ledgerData = createLedgerData();
    await db.insert(ledgers).values(ledgerData);
    await ensureTestLedgerBooks(db, ledgerData.id);
    const ledger = await db.query.ledgers.findFirst({
      where: eq(ledgers.id, ledgerData.id),
    });
    if (!ledger) throw new Error("Ledger not found after creation");
    return ledger;
  }

  // Create a unique user and ledger to avoid single-ledger-per-user constraint
  const { ledgerId } = await createTestUserWithLedger(db);
  const ledger = await db.query.ledgers.findFirst({
    where: eq(ledgers.id, ledgerId),
  });
  if (!ledger) throw new Error("Ledger not found after creation");
  return ledger;
}

async function createTestCategory(
  db: ReturnType<typeof getTestDb>,
  ledgerId: string,
  name = "餐饮"
) {
  const category = createCategoryData(ledgerId, { name });
  await db.insert(entryCategories).values(category);
  return category;
}

async function createTestEntry(
  db: ReturnType<typeof getTestDb>,
  ledgerId: string,
  opts: { categoryId?: string | null; sourceDocumentId?: string } = {}
) {
  // If no sourceDocumentId provided, create a source document
  let sourceDocumentId = opts.sourceDocumentId;
  if (sourceDocumentId == null) {
    const sourceDoc = await createTestSourceDocument(db, ledgerId);
    sourceDocumentId = sourceDoc.id;
  }

  const entry = createLedgerEntryData(ledgerId, { ...opts, sourceDocumentId });
  await db.insert(ledgerEntries).values(entry);
  await activateTestSourceDocumentProjection(db, sourceDocumentId);
  return entry;
}

async function createTestSourceDocument(db: ReturnType<typeof getTestDb>, ledgerId: string) {
  const doc = createSourceDocumentData(ledgerId);
  await db.insert(sourceDocuments).values({
    ...doc,
    bookId: sql`(SELECT id FROM books WHERE ledger_id = ${doc.ledgerId} ORDER BY sort_order LIMIT 1)`,
  });
  await activateTestSourceDocumentProjection(db, doc.id);
  return doc;
}

// ============================================================================
// C1: Delete Category → Entries Become Uncategorized
// ============================================================================

describe("C1: Delete Category → Entries Become Uncategorized", () => {
  it("should set entries categoryId to null when category is deleted", async () => {
    const db = getTestDb();

    // Setup: Ledger with category and 3 entries in that category
    // Use current user (TEST_USER_ID) because this test uses auth-dependent actions
    const ledger = await createTestLedger(db, true);
    const category = await createTestCategory(db, ledger.id);

    const entry1 = await createTestEntry(db, ledger.id, { categoryId: category.id });
    const entry2 = await createTestEntry(db, ledger.id, { categoryId: category.id });
    const entry3 = await createTestEntry(db, ledger.id, { categoryId: category.id });

    // Verify initial state
    const initialCount = await readUncategorizedCount();
    expect(initialCount).toBe(0);

    // Action: Delete the category
    await removeCategoryFromCollection(ledger.id, category.id);

    // Verify: Category no longer appears in list
    const categories = await getTargetEntryCategoriesAction(ledger.id);
    expect(categories.find((c) => c.id === category.id)).toBeUndefined();

    // Verify: All 3 entries now have categoryId = null (are "uncategorized")
    const updatedEntry1 = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entry1.id),
    });
    const updatedEntry2 = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entry2.id),
    });
    const updatedEntry3 = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entry3.id),
    });

    expect(updatedEntry1?.categoryId).toBeNull();
    expect(updatedEntry2?.categoryId).toBeNull();
    expect(updatedEntry3?.categoryId).toBeNull();

    // Verify: Uncategorized count increased by 3
    const finalCount = await readUncategorizedCount();
    expect(finalCount).toBe(3);
  });

  it("should not affect entries in other categories", async () => {
    const db = getTestDb();

    // Use current user (TEST_USER_ID) because this test uses auth-dependent actions
    const ledger = await createTestLedger(db, true);
    const categoryA = await createTestCategory(db, ledger.id, "餐饮");
    const categoryB = await createTestCategory(db, ledger.id, "交通");

    const entryInA = await createTestEntry(db, ledger.id, { categoryId: categoryA.id });
    const entryInB = await createTestEntry(db, ledger.id, { categoryId: categoryB.id });

    // Delete category A
    await removeCategoryFromCollection(ledger.id, categoryA.id);

    // Verify: Entry in category B is unchanged
    const updatedEntryInB = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryInB.id),
    });
    expect(updatedEntryInB?.categoryId).toBe(categoryB.id);

    // Entry in A is now uncategorized
    const updatedEntryInA = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entryInA.id),
    });
    expect(updatedEntryInA?.categoryId).toBeNull();
  });
});

// ============================================================================
// E1: Create Entry → Data Association Correct
// ============================================================================

describe("E1: Create Entry → Data Association Correct", () => {
  it("should correctly associate entry with ledger and category", async () => {
    const db = getTestDb();

    // Use current user (TEST_USER_ID) because this test uses auth-dependent actions
    const ledger = await createTestLedger(db, true);
    const category = await createTestCategory(db, ledger.id);
    const sourceDoc = await createTestSourceDocument(db, ledger.id);

    // Create entry via action (amount must be a number, sourceDocumentId is required)
    const entry = await createLedgerEntryAction({
      amount: "100.0",
      currency: "CNY",
      itemName: "测试条目",
      categoryId: category.id,
      sourceDocumentId: sourceDoc.id,
    });

    // Verify association
    const createdEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entry.ledgerEntryId),
    });
    expect(createdEntry?.ledgerId).toBe(ledger.id);
    expect(createdEntry?.categoryId).toBe(category.id);

    // Verify category entry count
    const categories = await getTargetEntryCategoriesAction(ledger.id);
    const targetCategory = categories.find((c) => c.id === category.id);
    expect(targetCategory?.entryCount).toBe(1);
  });

  it("should create uncategorized entry when no category specified", async () => {
    const db = getTestDb();

    // Use current user (TEST_USER_ID) because this test uses auth-dependent actions
    const ledger = await createTestLedger(db, true);
    const sourceDoc = await createTestSourceDocument(db, ledger.id);

    // Create entry without category (amount must be a number, sourceDocumentId is required)
    const entry = await createLedgerEntryAction({
      amount: "50.0",
      currency: "CNY",
      itemName: "无分类条目",
      sourceDocumentId: sourceDoc.id,
    });

    const createdEntry = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entry.ledgerEntryId),
    });
    expect(createdEntry?.categoryId).toBeNull();

    // Verify uncategorized count
    const count = await readUncategorizedCount();
    expect(count).toBe(1);
  });
});

// ============================================================================
// E2: Delete Entry → Related Counts Update
// ============================================================================

describe("E2: Delete Entry → Related Counts Update", () => {
  it("should decrease category entry count when entry is deleted", async () => {
    const db = getTestDb();

    // Use current user (TEST_USER_ID) because this test uses auth-dependent actions
    const ledger = await createTestLedger(db, true);
    const category = await createTestCategory(db, ledger.id);

    // Create 2 entries in the category
    const entry1 = await createTestEntry(db, ledger.id, { categoryId: category.id });
    await createTestEntry(db, ledger.id, { categoryId: category.id });

    // Verify initial count
    let categories = await getTargetEntryCategoriesAction(ledger.id);
    expect(categories.find((c) => c.id === category.id)?.entryCount).toBe(2);

    // Delete one entry
    await deleteLedgerEntryAction(entry1.sourceDocumentId!, entry1.id);

    // Verify count decreased
    categories = await getTargetEntryCategoriesAction(ledger.id);
    expect(categories.find((c) => c.id === category.id)?.entryCount).toBe(1);
  });

  it("should not affect source document when entry is deleted", async () => {
    const db = getTestDb();

    // Use current user (TEST_USER_ID) because this test uses auth-dependent actions
    const ledger = await createTestLedger(db, true);
    const sourceDoc = await createTestSourceDocument(db, ledger.id);
    const entry = await createTestEntry(db, ledger.id, { sourceDocumentId: sourceDoc.id });

    // Delete entry
    await deleteLedgerEntryAction(entry.sourceDocumentId!, entry.id);

    // Verify source document still exists and unchanged
    const doc = await db.query.sourceDocuments.findFirst({
      where: and(eq(sourceDocuments.id, sourceDoc.id), isNull(sourceDocuments.deletedAt)),
    });
    expect(doc).toBeDefined();
    expect(doc?.deletedAt).toBeNull();
  });
});

// ============================================================================
// E3: Update Entry Category → Counts Update Correctly
// ============================================================================

describe("E3: Update Entry Category → Counts Update Correctly", () => {
  it("should update both old and new category counts when entry category changes", async () => {
    const db = getTestDb();

    // Use current user (TEST_USER_ID) because this test uses auth-dependent actions
    const ledger = await createTestLedger(db, true);
    const categoryA = await createTestCategory(db, ledger.id, "餐饮");
    const categoryB = await createTestCategory(db, ledger.id, "交通");

    // Create entry in category A
    const entry = await createTestEntry(db, ledger.id, { categoryId: categoryA.id });

    // Verify initial counts
    let categories = await getTargetEntryCategoriesAction(ledger.id);
    expect(categories.find((c) => c.id === categoryA.id)?.entryCount).toBe(1);
    expect(categories.find((c) => c.id === categoryB.id)?.entryCount).toBe(0);

    // Move entry from A to B
    await batchUpdateLedgerEntriesAction([entry.sourceDocumentId!], [entry.id], {
      categoryId: categoryB.id,
    });

    // Verify counts updated
    categories = await getTargetEntryCategoriesAction(ledger.id);
    expect(categories.find((c) => c.id === categoryA.id)?.entryCount).toBe(0);
    expect(categories.find((c) => c.id === categoryB.id)?.entryCount).toBe(1);
  });

  it("should update uncategorized count when entry becomes uncategorized", async () => {
    const db = getTestDb();

    // Use current user (TEST_USER_ID) because this test uses auth-dependent actions
    const ledger = await createTestLedger(db, true);
    const category = await createTestCategory(db, ledger.id);
    const entry = await createTestEntry(db, ledger.id, { categoryId: category.id });

    // Initial state: 0 uncategorized
    expect(await readUncategorizedCount()).toBe(0);

    // Remove category from entry
    await batchUpdateLedgerEntriesAction([entry.sourceDocumentId!], [entry.id], {
      categoryId: null,
    });

    // Now 1 uncategorized
    expect(await readUncategorizedCount()).toBe(1);
  });
});

// ============================================================================
// D1: Delete Source Document → Related Entries Deleted
// ============================================================================

describe("D1: Delete Source Document → Related Entries Deleted", () => {
  it("should delete related entries when source document is deleted", async () => {
    const db = getTestDb();

    // Use current user (TEST_USER_ID) because this test uses auth-dependent actions
    const ledger = await createTestLedger(db, true);
    const sourceDoc = await createTestSourceDocument(db, ledger.id);

    // Create entries linked to this source document
    const entry1 = await createTestEntry(db, ledger.id, { sourceDocumentId: sourceDoc.id });
    const entry2 = await createTestEntry(db, ledger.id, { sourceDocumentId: sourceDoc.id });

    // Delete source document
    await deleteSourceDocumentAction(sourceDoc.id);

    // Verify: Source document is deleted (soft)
    // Note: findFirst returns undefined when not found, not null
    const deletedDoc = await db.query.sourceDocuments.findFirst({
      where: and(eq(sourceDocuments.id, sourceDoc.id), isNull(sourceDocuments.deletedAt)),
    });
    expect(deletedDoc).toBeUndefined();

    // Verify: Related entries are also deleted (soft)
    const deletedEntry1 = await db.query.ledgerEntries.findFirst({
      where: and(eq(ledgerEntries.id, entry1.id), isNull(ledgerEntries.deletedAt)),
    });
    const deletedEntry2 = await db.query.ledgerEntries.findFirst({
      where: and(eq(ledgerEntries.id, entry2.id), isNull(ledgerEntries.deletedAt)),
    });

    expect(deletedEntry1).toBeUndefined();
    expect(deletedEntry2).toBeUndefined();
  });

  it("should not affect entries from other source documents", async () => {
    const db = getTestDb();

    // Use current user (TEST_USER_ID) because this test uses auth-dependent actions
    const ledger = await createTestLedger(db, true);
    const docA = await createTestSourceDocument(db, ledger.id);
    const docB = await createTestSourceDocument(db, ledger.id);

    await createTestEntry(db, ledger.id, { sourceDocumentId: docA.id });
    const entryB = await createTestEntry(db, ledger.id, { sourceDocumentId: docB.id });

    // Delete only doc A
    await deleteSourceDocumentAction(docA.id);

    // Entry B should still exist
    const remainingEntryB = await db.query.ledgerEntries.findFirst({
      where: and(eq(ledgerEntries.id, entryB.id), isNull(ledgerEntries.deletedAt)),
    });
    expect(remainingEntryB).not.toBeNull();
  });
});

async function removeCategoryFromCollection(ledgerId: string, categoryId: string) {
  const categories = await listCategories(ledgerId);
  return saveEntryCategoriesAction({
    expectedRevision: await computeCategoryCollectionRevision(categories),
    categories: categories
      .filter((category) => category.id !== categoryId)
      .map(({ id, name, description, icon }) => ({ id, name, description, icon })),
  });
}
async function readUncategorizedCount() {
  return (await getLedgerSettingsAction()).uncategorizedCount;
}
