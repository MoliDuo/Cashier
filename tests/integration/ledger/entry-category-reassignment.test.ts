import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  entryCategories,
  ledgerEntries,
  ledgers,
  revisionFiles,
  sourceDocumentRevisions,
  sourceDocuments,
} from "@/persistence";
import { getTestDb } from "../../setup";
import { createCategoryData, createLedgerData } from "../../helpers/factories";
import { createTestSourceDocument, ensureTestLedgerBooks } from "../../helpers/schema-setup";
import { loadReclassificationDocumentGroups } from "@/server/category-reclassification/document-groups";

/**
 * A projected entry used to verify evidence grouping. Each entry needs its own
 * `position` inside the revision (`uq_ledger_entries_revision_position`).
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
      processingStatus: "completed",
      finishedAt: new Date(),
    })
    .returning();
  if (revision == null) throw new Error("Expected a superseded revision fixture");
  return revision.id;
}

describe("loadDocumentGroups", () => {
  async function setupEmptyLedger() {
    const db = getTestDb();
    const ledger = createLedgerData();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
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

    const groups = await loadReclassificationDocumentGroups({
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

    const groups = await loadReclassificationDocumentGroups({
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

    const groups = await loadReclassificationDocumentGroups({
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

    const groups = await loadReclassificationDocumentGroups({
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

    const groups = await loadReclassificationDocumentGroups({
      ledgerId: ledger.id,
      ledgerEntryIds: [entryId],
    });

    expect(groups[0]!.subjects[0]).toMatchObject({
      currentCategoryId: category.id,
      currentCategoryName: "吃喝",
    });
  });
});
