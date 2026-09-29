import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocumentFiles,
  sourceDocuments,
} from "@/persistence";
import { getTestDb } from "tests/setup";
import { createCategoryData, createLedgerData } from "tests/helpers/factories";
import { createTestSourceDocument, ensureTestLedgerBooks } from "tests/helpers/schema-setup";
import { loadCategoryAssignmentDocumentGroups } from "@/server/category-assignment/document-groups";

/** A document entry used to verify evidence grouping, at its own `position`. */
async function seedProjectedEntry(input: {
  categoryId: string | null;
  documentId: string;
  position?: number;
  itemName?: string;
}): Promise<string> {
  const db = getTestDb();
  const id = crypto.randomUUID();
  await db.insert(ledgerEntries).values({
    id,
    sourceDocumentId: input.documentId,
    position: input.position ?? 0,
    amount: "10.00",
    currency: "CNY",
    itemName: input.itemName ?? "entry",
    categoryId: input.categoryId,
  });
  return id;
}

describe("loadDocumentGroups", () => {
  async function setupEmptyLedger() {
    const db = getTestDb();
    await db.insert(ledgers).values(createLedgerData());
    await ensureTestLedgerBooks(db);
  }

  async function setupDocument(
    input: {
      title?: string | null;
      documentDate?: string | null;
      inputText?: string;
      imageUrls?: string[];
    } = {}
  ): Promise<{ documentId: string }> {
    const db = getTestDb();
    const documentId = await createTestSourceDocument(db, {
      title: input.title ?? null,
      entryDate: input.documentDate ?? null,
      ...(input.inputText == null ? {} : { text: input.inputText }),
      imageUrls: input.imageUrls ?? [],
    });
    return { documentId };
  }

  it("groups one document's entries together and carries the document's own evidence", async () => {
    const db = getTestDb();
    await setupEmptyLedger();
    const { documentId } = await setupDocument({
      title: "全家便利店",
      documentDate: "2026-09-10",
      inputText: "楼下买的",
      imageUrls: ["a", "b", "c"],
    });
    const second = await seedProjectedEntry({
      categoryId: null,
      documentId,
      position: 1,
      itemName: "面包",
    });
    const first = await seedProjectedEntry({
      categoryId: null,
      documentId,
      position: 0,
      itemName: "可乐",
    });

    const groups = await loadCategoryAssignmentDocumentGroups({
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
      .select({ storedFileId: sourceDocumentFiles.storedFileId })
      .from(sourceDocumentFiles)
      .where(eq(sourceDocumentFiles.sourceDocumentId, documentId))
      .orderBy(sourceDocumentFiles.position);
    expect(files).toHaveLength(3);
    expect(group!.storedFileIds).toEqual(files.map((file) => file.storedFileId));
  });

  it("keeps a text-only document in the run without any evidence attached", async () => {
    await setupEmptyLedger();
    const { documentId } = await setupDocument({
      inputText: "打车 18 元",
    });
    const entryId = await seedProjectedEntry({
      categoryId: null,
      documentId,
      itemName: "打车",
    });

    const groups = await loadCategoryAssignmentDocumentGroups({
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
    await setupEmptyLedger();
    const receipt = await setupDocument({ imageUrls: ["a"] });
    const note = await setupDocument({ inputText: "一张手写便签" });
    const receiptEntry = await seedProjectedEntry({
      categoryId: null,
      documentId: receipt.documentId,
    });
    const noteEntry = await seedProjectedEntry({
      categoryId: null,
      documentId: note.documentId,
    });

    const groups = await loadCategoryAssignmentDocumentGroups({
      ledgerEntryIds: [noteEntry, receiptEntry],
    });

    expect(groups).toHaveLength(2);
    const byDocument = new Map(groups.map((group) => [group.sourceDocumentId, group]));
    expect(byDocument.get(receipt.documentId)?.storedFileIds).toHaveLength(1);
    expect(byDocument.get(note.documentId)?.storedFileIds).toEqual([]);
    expect(byDocument.get(note.documentId)?.subjects[0]?.ledgerEntryId).toBe(noteEntry);
    expect(byDocument.get(receipt.documentId)?.subjects[0]?.ledgerEntryId).toBe(receiptEntry);
  });

  it("leaves out deleted entries and the entries of a deleted document", async () => {
    const db = getTestDb();
    await setupEmptyLedger();
    const { documentId } = await setupDocument();
    const liveEntryId = await seedProjectedEntry({
      categoryId: null,
      documentId,
    });
    // A later parse deletes the entries it replaces.
    const replacedEntryId = await seedProjectedEntry({
      categoryId: null,
      documentId,
      position: 1,
    });
    await db.delete(ledgerEntries).where(eq(ledgerEntries.id, replacedEntryId));
    const deleted = await setupDocument();
    const deletedDocumentEntryId = await seedProjectedEntry({
      categoryId: null,
      documentId: deleted.documentId,
    });
    await db.delete(sourceDocuments).where(eq(sourceDocuments.id, deleted.documentId));

    const groups = await loadCategoryAssignmentDocumentGroups({
      ledgerEntryIds: [liveEntryId, replacedEntryId, deletedDocumentEntryId],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.subjects.map((subject) => subject.ledgerEntryId)).toEqual([liveEntryId]);
  });

  it("still reports where each entry sits today", async () => {
    const db = getTestDb();
    await setupEmptyLedger();
    const category = createCategoryData({ name: "吃喝", sortOrder: 0 });
    await db.insert(entryCategories).values(category);
    const { documentId } = await setupDocument();
    const entryId = await seedProjectedEntry({
      categoryId: category.id,
      documentId,
    });

    const groups = await loadCategoryAssignmentDocumentGroups({
      ledgerEntryIds: [entryId],
    });

    expect(groups[0]!.subjects[0]).toMatchObject({
      currentCategoryId: category.id,
      currentCategoryName: "吃喝",
    });
  });
});
