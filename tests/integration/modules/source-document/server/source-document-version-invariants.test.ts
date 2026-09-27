/**
 * Canonical suite for the source-document version rule: `version` advances by
 * exactly one when, and only when, the record's content changes (title,
 * document date, entries). Every other write leaves it alone. No command takes
 * an expected version; each states its own preconditions.
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { books, entryCategories, ledgerEntries, sourceDocuments } from "@/persistence";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { claimAttemptForTest } from "tests/helpers/processing-attempt";
import { getTestDb } from "tests/setup";
import {
  addLedgerEntry,
  batchDeleteLedgerEntries,
  batchUpdateLedgerEntries,
  deleteLedgerEntry,
} from "@/modules/source-document/server/entry-commands";
import {
  applyDateOrganization,
  dismissDateOrganization,
} from "@/modules/source-document/server/date-organization";
import {
  assignSourceDocumentBook,
  updateLedgerEntryDates,
  updateSourceDocuments,
} from "@/modules/source-document/server/updates";
import { cancelSourceDocumentProcessing } from "@/modules/source-document/server/cancel-processing";
import { createManualDocument } from "@/modules/source-document/server/projections/writes";
import { deleteSourceDocumentAtomically } from "@/modules/source-document/server/delete";
import { splitSourceDocumentAtomically } from "@/modules/source-document/server/split";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";
import { recordProcessingFailure } from "@/modules/source-document/server/extraction-attempts";
import { applyCategoryAssignments } from "@/modules/source-document/server/category-assignments";
import {
  claimCategoryAssignmentJob,
  nextCategoryAssignmentDocument,
  releaseCategoryAssignmentJob,
  startCategoryAssignment,
} from "@/server/category-assignment/assignments";
import { saveEntryCategories } from "@/modules/ledger/server/categories";
import { computeCategoryCollectionRevision } from "@/modules/ledger/category-collection-revision";

const entry = {
  categoryId: null,
  amount: "12.00",
  currency: "CNY",
  itemName: "Item",
  description: null,
} as const;

async function newLedger() {
  const { ledgerId } = await createTestUserWithLedger(
    getTestDb(),
    `version-invariants-${crypto.randomUUID()}`
  );
  return ledgerId;
}

async function readDocument(sourceDocumentId: string) {
  const row = await getTestDb().query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
    columns: { version: true, title: true, bookId: true },
  });
  if (row == null) throw new Error("Source document not found");
  return row;
}

async function currentVersion(sourceDocumentId: string): Promise<number> {
  return (await readDocument(sourceDocumentId)).version;
}

async function readEntry(ledgerEntryId: string) {
  const row = await getTestDb().query.ledgerEntries.findFirst({
    where: eq(ledgerEntries.id, ledgerEntryId),
    columns: { categoryId: true, itemName: true, amount: true },
  });
  if (row == null) throw new Error("Ledger entry not found");
  return row;
}

/** An active, completed document with `count` entries — version 1. */
async function createActiveDocument(ledgerId: string, count = 1) {
  const created = await createManualDocument({
    ledgerId,
    bookId: await testBookId(getTestDb(), ledgerId),
    title: "Original",
    entryDate: "2026-08-01",
    entries: Array.from({ length: count }, (_, index) => ({
      ...entry,
      itemName: `Item ${index + 1}`,
    })),
  });
  const entries = await getTestDb().query.ledgerEntries.findMany({
    where: (row, { eq: eqOp, and }) => and(eqOp(row.sourceDocumentId, created.sourceDocumentId)),
    orderBy: (row, { asc }) => [asc(row.position)],
  });
  return { sourceDocumentId: created.sourceDocumentId, entryIds: entries.map((row) => row.id) };
}

async function insertCategory(ledgerId: string, name: string) {
  const id = crypto.randomUUID();
  await getTestDb().insert(entryCategories).values({ id, ledgerId, name, sortOrder: 0 });
  return id;
}

async function setDateSuggestion(sourceDocumentId: string, entryIds: string[]) {
  const suggestionId = crypto.randomUUID();
  const db = getTestDb();
  const rows = await db.query.ledgerEntries.findMany({
    where: (row, { inArray }) => inArray(row.id, entryIds),
  });
  await db
    .update(sourceDocuments)
    .set({
      dateOrganizationSuggestion: {
        schemaVersion: 1,
        id: suggestionId,
        referenceDate: "2026-08-02",
        sourceDocumentDate: "2026-08-02",
        items: rows.map((row) => ({
          ledgerEntryId: row.id,
          dateHint: { kind: "relative", value: "yesterday", sourceText: "昨天" },
          resolvedDate: "2026-08-01",
          sourceText: "昨天",
          snapshot: {
            itemName: row.itemName,
            amount: String(Number(row.amount)),
            currency: row.currency ?? "CNY",
          },
        })),
      },
    })
    .where(eq(sourceDocuments.id, sourceDocumentId));
  return suggestionId;
}

/** Runs a category-assignment job that moves `ledgerEntryId` into `categoryId`. */
async function runCategoryAssignment(input: {
  ledgerId: string;
  sourceDocumentId: string;
  ledgerEntryId: string;
  categoryId: string;
}) {
  const started = await startCategoryAssignment({
    ledgerId: input.ledgerId,
    requestKey: crypto.randomUUID(),
    mode: { kind: "assign", categoryId: input.categoryId },
    ledgerEntryIds: [input.ledgerEntryId],
    candidates: [],
    customPrompt: null,
  });
  const job = await claimCategoryAssignmentJob({ jobId: started.id });
  const next = await nextCategoryAssignmentDocument(job!);
  expect(next).toMatchObject({ kind: "document" });
  const result = await applyCategoryAssignments({
    lease: job!,
    sourceDocumentId: input.sourceDocumentId,
  });
  await releaseCategoryAssignmentJob(job!);
  return result;
}

describe("source document version — content writes advance it by one", () => {
  it("title and date together: +1 once, a replay of applied values is a no-op", async () => {
    const ledgerId = await newLedger();
    const { sourceDocumentId } = await createActiveDocument(ledgerId);
    const edit = () =>
      updateSourceDocuments({
        ledgerId,
        sourceDocumentIds: [sourceDocumentId],
        data: { title: "Updated", documentDate: "2026-08-03" },
      });

    expect(await edit()).toMatchObject({ updatedCount: 1 });
    expect(await edit()).toMatchObject({ updatedCount: 0 });
    expect(await readDocument(sourceDocumentId)).toMatchObject({ title: "Updated", version: 2 });
  });

  it("batch title and date: +1 on change, unchanged values write nothing", async () => {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId);
    const retitle = () =>
      updateSourceDocuments({
        ledgerId,
        sourceDocumentIds: [sourceDocumentId],
        data: { title: "Batch title" },
      });

    expect(await retitle()).toMatchObject({ updatedCount: 1 });
    expect(await retitle()).toMatchObject({ updatedCount: 0 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    const redate = () =>
      updateLedgerEntryDates({
        ledgerId,
        sourceDocumentIds: [sourceDocumentId],
        ledgerEntryIds: entryIds,
        entryDate: "2026-08-02",
      });
    await redate();
    expect(await currentVersion(sourceDocumentId)).toBe(3);
    await redate();
    expect(await currentVersion(sourceDocumentId)).toBe(3);
  });

  it("entry add, edit and delete: +1 each, an edit to applied values is a no-op", async () => {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId, 3);

    await addLedgerEntry({ ledgerId, sourceDocumentId, amount: "5.00", itemName: "New item" });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    const rename = () =>
      batchUpdateLedgerEntries({
        ledgerId,
        sourceDocumentIds: [sourceDocumentId],
        ledgerEntryIds: [entryIds[0]!],
        itemName: "Renamed",
      });
    expect(await rename()).toMatchObject({ affectedCount: 1 });
    expect(await rename()).toMatchObject({ affectedCount: 0 });
    expect(await currentVersion(sourceDocumentId)).toBe(3);

    await deleteLedgerEntry({ ledgerId, sourceDocumentId, ledgerEntryId: entryIds[1]! });
    expect(await currentVersion(sourceDocumentId)).toBe(4);

    const deleted = await batchDeleteLedgerEntries({
      ledgerId,
      sourceDocumentIds: [sourceDocumentId],
      ledgerEntryIds: [entryIds[2]!],
    });
    expect(deleted).toEqual({ succeeded: [{ id: entryIds[2], sourceDocumentId }], failed: [] });
    expect(await currentVersion(sourceDocumentId)).toBe(5);
  });

  it("split and date organization: +1 on the source document", async () => {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId, 3);

    const split = await splitSourceDocumentAtomically({
      ledgerId,
      sourceDocumentId,
      ledgerEntryIds: [entryIds[0]!],
      entryDate: "2026-08-05",
    });
    expect(split).toMatchObject({ splitVersion: 1, movedEntryCount: 1 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    const remaining = entryIds.slice(1);
    const suggestionId = await setDateSuggestion(sourceDocumentId, remaining);
    await applyDateOrganization({
      ledgerId,
      sourceDocumentId,
      suggestionId,
      groups: [{ id: "yesterday", entryDate: "2026-08-01", ledgerEntryIds: [remaining[0]!] }],
      appliedGroupIds: ["yesterday"],
    });
    expect(await currentVersion(sourceDocumentId)).toBe(3);
  });
});

describe("source document version — other writes leave it alone", () => {
  it("book assignment moves the record without a bump and refuses an archived book", async () => {
    const ledgerId = await newLedger();
    const { sourceDocumentId } = await createActiveDocument(ledgerId);
    const db = getTestDb();
    const targetBookId = crypto.randomUUID();
    const archivedBookId = crypto.randomUUID();
    await db.insert(books).values([
      { id: targetBookId, ledgerId, name: "梁梁的", sortOrder: 2 },
      { id: archivedBookId, ledgerId, name: "已归档的", sortOrder: 3, archivedAt: new Date() },
    ]);

    expect(
      await assignSourceDocumentBook({ ledgerId, sourceDocumentId, bookId: targetBookId })
    ).toEqual({ ok: true });
    // A book archived while the form sat open must not receive the record: the
    // composite key would accept it, so the check has to be here.
    expect(
      await assignSourceDocumentBook({ ledgerId, sourceDocumentId, bookId: archivedBookId })
    ).toEqual({ ok: false, reason: "book_unavailable" });
    expect(await readDocument(sourceDocumentId)).toMatchObject({
      bookId: targetBookId,
      version: 1,
    });
  });

  it("dismissing a date suggestion clears it without a bump", async () => {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId);
    const suggestionId = await setDateSuggestion(sourceDocumentId, entryIds);

    expect(await dismissDateOrganization({ ledgerId, sourceDocumentId, suggestionId })).toEqual({
      dismissed: true,
    });
    const row = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
      columns: { version: true, dateOrganizationSuggestion: true },
    });
    expect(row).toEqual({ version: 1, dateOrganizationSuggestion: null });
  });

  it("retry submission, processing failure and cancel leave it alone", async () => {
    const ledgerId = await newLedger();
    const { sourceDocumentId } = await createActiveDocument(ledgerId);

    const failed = await submitSourceDocument({
      ledgerId,
      sourceDocumentId,
      inheritInput: false,
      input: { text: "retry", storedFileIds: [], documentDate: null },
      supersedeProcessing: true,
    });
    expect(await currentVersion(sourceDocumentId)).toBe(1);
    expect(
      await recordProcessingFailure({
        lease: await claimAttemptForTest(failed.attempt.id),
        ledgerId,
        sourceDocumentId,
        attemptId: failed.attempt.id,
        failureKind: "processing_error",
        failureMessage: "processing failed",
      })
    ).toBe(true);
    expect(await currentVersion(sourceDocumentId)).toBe(1);

    await submitSourceDocument({
      ledgerId,
      sourceDocumentId,
      inheritInput: true,
      supersedeProcessing: true,
    });
    expect(await cancelSourceDocumentProcessing(ledgerId, sourceDocumentId)).toEqual({
      processingStatus: "cancelled",
    });
    expect(await currentVersion(sourceDocumentId)).toBe(1);
  });

  it("delete removes the document and a replay is not found", async () => {
    const ledgerId = await newLedger();
    const { sourceDocumentId } = await createActiveDocument(ledgerId);

    expect(await deleteSourceDocumentAtomically({ ledgerId, sourceDocumentId })).toEqual({
      sourceDocumentId,
      deleted: true,
    });
    await expect(deleteSourceDocumentAtomically({ ledgerId, sourceDocumentId })).rejects.toThrow(
      "not found"
    );
  });

  it("an AI category assignment leaves it alone and survives a later entry edit", async () => {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId, 2);
    const categoryId = await insertCategory(ledgerId, "Meals");

    expect(
      await runCategoryAssignment({
        ledgerId,
        sourceDocumentId,
        ledgerEntryId: entryIds[0]!,
        categoryId,
      })
    ).toMatchObject({ status: "applied", appliedCount: 1 });
    expect(await currentVersion(sourceDocumentId)).toBe(1);

    // Neither edit names a category, so the assigned one survives.
    await batchUpdateLedgerEntries({
      ledgerId,
      sourceDocumentIds: [sourceDocumentId],
      ledgerEntryIds: [entryIds[0]!],
      itemName: "Edited lunch",
    });
    await batchUpdateLedgerEntries({
      ledgerId,
      sourceDocumentIds: [sourceDocumentId],
      ledgerEntryIds: [entryIds[1]!],
      amount: "20",
    });
    expect(await currentVersion(sourceDocumentId)).toBe(3);
    expect(await readEntry(entryIds[0]!)).toMatchObject({ categoryId, itemName: "Edited lunch" });
    const edited = await readEntry(entryIds[1]!);
    expect(edited.categoryId).toBeNull();
    expect(Number(edited.amount)).toBe(20);
  });

  it("a category deletion leaves it alone and the entry stays uncategorized", async () => {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId);
    const categoryId = await insertCategory(ledgerId, "Retired");
    const db = getTestDb();
    await db.update(ledgerEntries).set({ categoryId }).where(eq(ledgerEntries.id, entryIds[0]!));

    await saveEntryCategories(ledgerId, {
      expectedRevision: await computeCategoryCollectionRevision(
        await db.query.entryCategories.findMany({
          where: eq(entryCategories.ledgerId, ledgerId),
        })
      ),
      categories: [],
    });
    expect(await currentVersion(sourceDocumentId)).toBe(1);

    await batchUpdateLedgerEntries({
      ledgerId,
      sourceDocumentIds: [sourceDocumentId],
      ledgerEntryIds: [entryIds[0]!],
      itemName: "Edited",
    });
    expect(await currentVersion(sourceDocumentId)).toBe(2);
    expect(await readEntry(entryIds[0]!)).toMatchObject({ categoryId: null, itemName: "Edited" });
  });
});
