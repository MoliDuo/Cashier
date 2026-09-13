import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import {
  entryCategories,
  ledgerEntries,
  ledgerSyncState,
  ledgers,
  revisionFiles,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";
import { postgresEntryCategoryAssignmentAdapter } from "@/application/adapters/postgres/ledger-entry-category-assignment";
import { getTestDb } from "../../setup";
import {
  createCategoryData,
  createLedgerData,
  createSourceDocumentData,
} from "../../helpers/factories";
import {
  activateTestSourceDocumentProjection,
  createTestSourceDocument,
  createTestUser,
} from "../../helpers/schema-setup";

/**
 * A live entry on the document's active projection, which is the only shape
 * `assign` will match. Each entry needs its own `position` inside the revision
 * (`uq_ledger_entries_revision_position`).
 */
async function seedProjectedEntry(input: {
  ledgerId: string;
  categoryId: string | null;
  documentId: string;
  revisionId?: string;
  position?: number;
  itemName?: string;
}): Promise<string> {
  const db = getTestDb();
  const id = crypto.randomUUID();
  await db.insert(ledgerEntries).values({
    id,
    ledgerId: input.ledgerId,
    sourceDocumentId: input.documentId,
    sourceDocumentRevisionId: input.revisionId ?? null,
    position: input.position ?? 0,
    amount: "10.00",
    currency: "CNY",
    itemName: input.itemName ?? "entry",
    categoryId: input.categoryId,
  });
  return id;
}

/** A second, completed revision the document has since moved past. */
async function createSupersededRevision(ledgerId: string, documentId: string): Promise<string> {
  const db = getTestDb();
  const [revision] = await db
    .insert(sourceDocumentRevisions)
    .values({
      ledgerId,
      sourceDocumentId: documentId,
      revisionNumber: 2,
      origin: "submission",
      processingStatus: "completed",
      finishedAt: new Date(),
    })
    .returning();
  if (revision == null) throw new Error("Expected a superseded revision fixture");
  return revision.id;
}

describe("entry category assignment", () => {
  beforeEach(() => {
    // Each test truncates and reseeds through the shared fixtures.
  });

  async function setupLedger() {
    const db = getTestDb();
    const ledger = createLedgerData();
    const target = createCategoryData(ledger.id, { name: "吃喝", sortOrder: 0 });
    const other = createCategoryData(ledger.id, { name: "居家", sortOrder: 1 });
    const document = createSourceDocumentData(ledger.id);
    await db.insert(ledgers).values(ledger);
    await db.insert(entryCategories).values([target, other]);
    await db.insert(sourceDocuments).values(document);
    const revisionId = await activateTestSourceDocumentProjection(db, document.id);
    return { ledger, target, other, document, revisionId };
  }

  it("moves an entry onto the decided category", async () => {
    const db = getTestDb();
    const { ledger, target, other, document, revisionId } = await setupLedger();
    const entryId = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: other.id,
      documentId: document.id,
      revisionId,
    });

    const result = await postgresEntryCategoryAssignmentAdapter.assign({
      ledgerId: ledger.id,
      decisions: [{ ledgerEntryId: entryId, categoryId: target.id }],
    });

    expect(result).toEqual({ appliedCount: 1 });
    const entry = await db.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.id, entryId) });
    expect(entry?.categoryId).toBe(target.id);
  });

  it("leaves an entry already in the decided category out of the count", async () => {
    const db = getTestDb();
    const { ledger, target, document, revisionId } = await setupLedger();
    const entryId = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: target.id,
      documentId: document.id,
      revisionId,
    });
    const before = await db.query.ledgerSyncState.findFirst({
      where: eq(ledgerSyncState.ledgerId, ledger.id),
    });

    const result = await postgresEntryCategoryAssignmentAdapter.assign({
      ledgerId: ledger.id,
      decisions: [{ ledgerEntryId: entryId, categoryId: target.id }],
    });

    expect(result).toEqual({ appliedCount: 0 });
    // A no-op write must not advance the ledger's sync version.
    const after = await db.query.ledgerSyncState.findFirst({
      where: eq(ledgerSyncState.ledgerId, ledger.id),
    });
    expect(after?.version).toBe(before?.version);
  });

  it("ignores entries, categories, and projections that are not live and owned", async () => {
    const db = getTestDb();
    const secondUserId = crypto.randomUUID();
    await createTestUser(db, undefined, secondUserId);
    const { ledger, target, document, revisionId } = await setupLedger();

    const foreignLedger = createLedgerData({ userId: secondUserId });
    const foreignCategory = createCategoryData(foreignLedger.id, { name: "别人的", sortOrder: 0 });
    const foreignDocument = createSourceDocumentData(foreignLedger.id);
    await db.insert(ledgers).values(foreignLedger);
    await db.insert(entryCategories).values(foreignCategory);
    await db.insert(sourceDocuments).values(foreignDocument);
    const foreignRevisionId = await activateTestSourceDocumentProjection(db, foreignDocument.id);

    const keptId = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: null,
      documentId: document.id,
      revisionId,
      position: 0,
    });
    const deletedEntryId = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: null,
      documentId: document.id,
      revisionId,
      position: 1,
    });
    const staleEntryId = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: null,
      documentId: document.id,
      // A real revision, but not the document's active one: the row is a
      // superseded projection, not a live one.
      revisionId: await createSupersededRevision(ledger.id, document.id),
      position: 0,
    });
    const foreignEntryId = await seedProjectedEntry({
      ledgerId: foreignLedger.id,
      categoryId: null,
      documentId: foreignDocument.id,
      revisionId: foreignRevisionId,
    });
    await db
      .update(ledgerEntries)
      .set({ deletedAt: new Date() })
      .where(eq(ledgerEntries.id, deletedEntryId));
    // A category the user retired between the model call and the write.
    const retiredCategory = createCategoryData(ledger.id, { name: "已删除", sortOrder: 2 });
    await db.insert(entryCategories).values(retiredCategory);
    await db
      .update(entryCategories)
      .set({ deletedAt: new Date() })
      .where(eq(entryCategories.id, retiredCategory.id));

    const result = await postgresEntryCategoryAssignmentAdapter.assign({
      ledgerId: ledger.id,
      decisions: [
        { ledgerEntryId: keptId, categoryId: target.id },
        { ledgerEntryId: deletedEntryId, categoryId: target.id },
        { ledgerEntryId: staleEntryId, categoryId: target.id },
        { ledgerEntryId: foreignEntryId, categoryId: target.id },
        { ledgerEntryId: keptId, categoryId: foreignCategory.id },
        { ledgerEntryId: keptId, categoryId: retiredCategory.id },
      ],
    });

    // Only the first decision matches every join.
    expect(result).toEqual({ appliedCount: 1 });
    const rows = await db
      .select({ id: ledgerEntries.id, categoryId: ledgerEntries.categoryId })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.ledgerId, ledger.id), isNull(ledgerEntries.deletedAt)));
    expect(rows.find((row) => row.id === keptId)?.categoryId).toBe(target.id);
    expect(rows.find((row) => row.id === staleEntryId)?.categoryId).toBeNull();
  });
});

describe("loadDocumentGroups", () => {
  async function setupEmptyLedger() {
    const db = getTestDb();
    const ledger = createLedgerData();
    await db.insert(ledgers).values(ledger);
    return ledger;
  }

  async function setupDocument(input: {
    ledgerId: string;
    title?: string | null;
    documentDate?: string | null;
    inputText?: string;
    imageUrls?: string[];
  }): Promise<{ documentId: string; revisionId: string }> {
    const db = getTestDb();
    const documentId = await createTestSourceDocument(db, input.ledgerId, {
      title: input.title ?? null,
      entryDate: input.documentDate ?? null,
      ...(input.inputText == null ? {} : { text: input.inputText }),
      imageUrls: input.imageUrls ?? [],
    });
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, documentId),
    });
    if (document?.activeRevisionId == null) {
      throw new Error("Expected an active revision fixture");
    }
    return { documentId, revisionId: document.activeRevisionId };
  }

  it("groups one document's entries together and carries the document's own evidence", async () => {
    const db = getTestDb();
    const ledger = await setupEmptyLedger();
    const { documentId, revisionId } = await setupDocument({
      ledgerId: ledger.id,
      title: "全家便利店",
      documentDate: "2026-09-10",
      inputText: "楼下买的",
      imageUrls: ["a", "b", "c"],
    });
    const second = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: null,
      documentId,
      revisionId,
      position: 1,
      itemName: "面包",
    });
    const first = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: null,
      documentId,
      revisionId,
      position: 0,
      itemName: "可乐",
    });

    const groups = await postgresEntryCategoryAssignmentAdapter.loadDocumentGroups({
      ledgerId: ledger.id,
      // A dead id and an out-of-order pair: the grouping must survive both.
      ledgerEntryIds: [second, crypto.randomUUID(), first],
    });

    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group).toMatchObject({
      sourceDocumentId: documentId,
      title: "全家便利店",
      documentDate: "2026-09-10",
      inputText: "楼下买的",
    });
    expect(group!.subjects.map((subject) => subject.itemName)).toEqual(["可乐", "面包"]);

    const files = await db
      .select({ storedFileId: revisionFiles.storedFileId })
      .from(revisionFiles)
      .where(eq(revisionFiles.revisionId, revisionId))
      .orderBy(revisionFiles.position);
    expect(files).toHaveLength(3);
    expect(group!.storedFileIds).toEqual(files.map((file) => file.storedFileId));
  });

  it("keeps a text-only document in the run without any evidence attached", async () => {
    const ledger = await setupEmptyLedger();
    const { documentId, revisionId } = await setupDocument({
      ledgerId: ledger.id,
      inputText: "打车 18 元",
    });
    const entryId = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: null,
      documentId,
      revisionId,
      itemName: "打车",
    });

    const groups = await postgresEntryCategoryAssignmentAdapter.loadDocumentGroups({
      ledgerId: ledger.id,
      ledgerEntryIds: [entryId],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      sourceDocumentId: documentId,
      title: null,
      documentDate: null,
      inputText: "打车 18 元",
      storedFileIds: [],
    });
    expect(groups[0]!.subjects).toHaveLength(1);
  });

  it("puts entries from different documents in their own groups", async () => {
    const ledger = await setupEmptyLedger();
    const receipt = await setupDocument({ ledgerId: ledger.id, imageUrls: ["a"] });
    const note = await setupDocument({ ledgerId: ledger.id, inputText: "一张手写便签" });
    const receiptEntry = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: null,
      documentId: receipt.documentId,
      revisionId: receipt.revisionId,
    });
    const noteEntry = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: null,
      documentId: note.documentId,
      revisionId: note.revisionId,
    });

    const groups = await postgresEntryCategoryAssignmentAdapter.loadDocumentGroups({
      ledgerId: ledger.id,
      ledgerEntryIds: [noteEntry, receiptEntry],
    });

    expect(groups).toHaveLength(2);
    const byDocument = new Map(groups.map((group) => [group.sourceDocumentId, group]));
    expect(byDocument.get(receipt.documentId)?.storedFileIds).toHaveLength(1);
    expect(byDocument.get(note.documentId)?.storedFileIds).toEqual([]);
    expect(byDocument.get(note.documentId)?.subjects[0]?.ledgerEntryId).toBe(noteEntry);
    expect(byDocument.get(receipt.documentId)?.subjects[0]?.ledgerEntryId).toBe(receiptEntry);
  });

  it("leaves out entries whose document is not the live one", async () => {
    const ledger = await setupEmptyLedger();
    const { documentId, revisionId } = await setupDocument({ ledgerId: ledger.id });
    const liveEntryId = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: null,
      documentId,
      revisionId,
    });
    const supersededEntryId = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: null,
      documentId,
      revisionId: await createSupersededRevision(ledger.id, documentId),
    });
    const orphanEntryId = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: null,
      documentId,
    });

    const groups = await postgresEntryCategoryAssignmentAdapter.loadDocumentGroups({
      ledgerId: ledger.id,
      ledgerEntryIds: [liveEntryId, supersededEntryId, orphanEntryId],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.subjects.map((subject) => subject.ledgerEntryId)).toEqual([liveEntryId]);
  });

  it("still reports where each entry sits today", async () => {
    const db = getTestDb();
    const ledger = await setupEmptyLedger();
    const category = createCategoryData(ledger.id, { name: "吃喝", sortOrder: 0 });
    await db.insert(entryCategories).values(category);
    const { documentId, revisionId } = await setupDocument({ ledgerId: ledger.id });
    const entryId = await seedProjectedEntry({
      ledgerId: ledger.id,
      categoryId: category.id,
      documentId,
      revisionId,
    });

    const groups = await postgresEntryCategoryAssignmentAdapter.loadDocumentGroups({
      ledgerId: ledger.id,
      ledgerEntryIds: [entryId],
    });

    expect(groups[0]!.subjects[0]).toMatchObject({
      currentCategoryId: category.id,
      currentCategoryName: "吃喝",
    });
  });
});
