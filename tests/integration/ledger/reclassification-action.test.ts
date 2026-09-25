import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import {
  beginCategoryAssignmentAction,
  appendCategoryAssignmentSelectionAction,
  commitCategoryAssignmentSelectionAction,
} from "@/modules/ledger/server-actions/reclassification";
import { getCategoryReclassificationJobAction } from "@/modules/ledger/server/get-category-reclassification-job";
import { entryCategories, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getTestDb } from "../../setup";
import {
  createCategoryData,
  createLedgerData,
  createSourceDocumentData,
} from "../../helpers/factories";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";
import { flushAfterCallbacks } from "../../setup.common";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ai/openai-client", () => ({
  getOpenAIClient: () => ({ generateContent }),
}));

const userId = "00000000-0000-0000-0000-000000000000";

/** Entries the model can be asked about, each on the document's live revision. */
async function seedEntries(input: {
  ledgerId: string;
  documentId: string;
  revisionId: string;
  categoryId: string | null;
  count: number;
}): Promise<string[]> {
  const db = getTestDb();
  const ids = Array.from({ length: input.count }, () => crypto.randomUUID());
  await db.insert(ledgerEntries).values(
    ids.map((id, position) => ({
      id,
      ledgerId: input.ledgerId,
      categoryId: input.categoryId,
      sourceDocumentId: input.documentId,
      sourceDocumentRevisionId: input.revisionId,
      position,
      amount: "10.00",
      currency: "CNY",
      itemName: `Item ${position + 1}`,
    }))
  );
  return ids;
}

async function setupLedger() {
  const db = getTestDb();
  const ledger = createLedgerData();
  const food = createCategoryData(ledger.id, { name: "吃喝", sortOrder: 0 });
  const home = createCategoryData(ledger.id, { name: "居家", sortOrder: 1 });
  const document = createSourceDocumentData(ledger.id);
  await db.insert(ledgers).values(ledger);
  await ensureTestLedgerBooks(db, ledger.id);
  await db.insert(entryCategories).values([food, home]);
  await db.insert(sourceDocuments).values({
    ...document,
    bookId: sql`(SELECT id FROM books WHERE ledger_id = ${document.ledgerId} ORDER BY sort_order LIMIT 1)`,
  });
  const revisionId = await activateTestSourceDocumentProjection(db, document.id);
  return { ledger, food, home, document, revisionId };
}

async function submitSelection(
  ledgerId: string,
  input: { ledgerEntryIds: string[]; candidateCategoryIds: string[] }
) {
  const job = await beginCategoryAssignmentAction({
    requestKey: crypto.randomUUID(),
    mode: { kind: "ai", candidateCategoryIds: input.candidateCategoryIds },
    expectedEntryCount: input.ledgerEntryIds.length,
  });
  const entries = await getTestDb()
    .select({
      ledgerEntryId: ledgerEntries.id,
      sourceDocumentId: sourceDocuments.id,
    })
    .from(ledgerEntries)
    .innerJoin(sourceDocuments, eq(ledgerEntries.sourceDocumentId, sourceDocuments.id))
    .where(
      and(eq(ledgerEntries.ledgerId, ledgerId), inArray(ledgerEntries.id, input.ledgerEntryIds))
    );
  await appendCategoryAssignmentSelectionAction({
    jobId: job.id,
    chunkIndex: 0,
    entries,
  });
  return commitCategoryAssignmentSelectionAction({
    jobId: job.id,
    expectedEntryCount: entries.length,
  });
}

describe("submitSelection", () => {
  beforeEach(() => {
    vi.mocked(
      auth as unknown as () => Promise<{
        user: { id: string; email: string };
        expires: string;
      } | null>
    ).mockResolvedValue({
      user: { id: userId, email: "reclassify@example.com" },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    });
    vi.clearAllMocks();
  });

  it("runs the whole chain and reports what it moved", async () => {
    const db = getTestDb();
    const { ledger, food, home, document, revisionId } = await setupLedger();
    const entryIds = await seedEntries({
      ledgerId: ledger.id,
      documentId: document.id,
      revisionId,
      categoryId: null,
      count: 2,
    });
    generateContent.mockResolvedValue({
      content: JSON.stringify({
        decisions: [
          { entry_index: 1, category_index: 1 },
          { entry_index: 2, category_index: 1 },
        ],
      }),
    });

    const job = await submitSelection(ledger.id, {
      ledgerEntryIds: entryIds,
      candidateCategoryIds: [food.id, home.id],
    });
    await flushAfterCallbacks();

    expect(job).toMatchObject({ total: 2, appliedCount: 0 });
    const stored = await getCategoryReclassificationJobAction();
    expect(stored).toMatchObject({
      status: "succeeded",
      total: 2,
      appliedCount: 2,
      confirmedCount: 0,
      processedCount: 2,
    });
    const rows = await db
      .select({ id: ledgerEntries.id, categoryId: ledgerEntries.categoryId })
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.ledgerId, ledger.id), isNull(ledgerEntries.deletedAt)));
    expect(rows.every((row) => row.categoryId === food.id)).toBe(true);
  });

  it("fails incomplete model output instead of leaving entries undecided", async () => {
    const { ledger, food, home, document, revisionId } = await setupLedger();
    const entryIds = await seedEntries({
      ledgerId: ledger.id,
      documentId: document.id,
      revisionId,
      categoryId: home.id,
      count: 3,
    });
    generateContent.mockResolvedValue({
      content: JSON.stringify({
        decisions: [
          { entry_index: 1, category_index: 1 },
          { entry_index: 2, category_index: 0 },
          // Missing: the third entry is never mentioned.
        ],
      }),
    });

    await submitSelection(ledger.id, {
      ledgerEntryIds: entryIds,
      candidateCategoryIds: [food.id, home.id],
    });
    await flushAfterCallbacks(15_000);

    await expect(getCategoryReclassificationJobAction()).resolves.toMatchObject({
      status: "failed",
      appliedCount: 0,
      confirmedCount: 0,
      failedCount: 3,
      processedCount: 3,
    });
  });

  it("counts an entry the model left in place as confirmed", async () => {
    const { ledger, food, home, document, revisionId } = await setupLedger();
    const entryIds = await seedEntries({
      ledgerId: ledger.id,
      documentId: document.id,
      revisionId,
      categoryId: food.id,
      count: 1,
    });
    generateContent.mockResolvedValue({
      content: JSON.stringify({ decisions: [{ entry_index: 1, category_index: 1 }] }),
    });

    await submitSelection(ledger.id, {
      ledgerEntryIds: entryIds,
      candidateCategoryIds: [food.id, home.id],
    });
    await flushAfterCallbacks();

    await expect(getCategoryReclassificationJobAction()).resolves.toMatchObject({
      status: "succeeded",
      appliedCount: 0,
      confirmedCount: 1,
    });
  });

  it("accepts selections above 100 but rejects a candidate set that is too small", async () => {
    const { ledger, food, document, revisionId } = await setupLedger();
    const entryIds = await seedEntries({
      ledgerId: ledger.id,
      documentId: document.id,
      revisionId,
      categoryId: null,
      count: 3,
    });
    await expect(
      submitSelection(ledger.id, {
        ledgerEntryIds: entryIds,
        candidateCategoryIds: [food.id],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a candidate category that is not in the ledger", async () => {
    const { ledger, food, document, revisionId } = await setupLedger();
    const entryIds = await seedEntries({
      ledgerId: ledger.id,
      documentId: document.id,
      revisionId,
      categoryId: null,
      count: 1,
    });

    await expect(
      submitSelection(ledger.id, {
        ledgerEntryIds: entryIds,
        candidateCategoryIds: [food.id, crypto.randomUUID()],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(getCategoryReclassificationJobAction()).resolves.toBeNull();
  });

  it("rejects a candidate set that is no longer live before registering anything", async () => {
    const db = getTestDb();
    const { ledger, food, home, document, revisionId } = await setupLedger();
    const entryIds = await seedEntries({
      ledgerId: ledger.id,
      documentId: document.id,
      revisionId,
      categoryId: null,
      count: 1,
    });
    await db
      .update(entryCategories)
      .set({ deletedAt: new Date() })
      .where(eq(entryCategories.id, home.id));

    await expect(
      submitSelection(ledger.id, {
        ledgerEntryIds: entryIds,
        candidateCategoryIds: [food.id, home.id],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(getCategoryReclassificationJobAction()).resolves.toBeNull();
  });

  it("reports a provider failure without losing the run", async () => {
    const { ledger, food, home, document, revisionId } = await setupLedger();
    const entryIds = await seedEntries({
      ledgerId: ledger.id,
      documentId: document.id,
      revisionId,
      categoryId: null,
      count: 1,
    });
    generateContent.mockResolvedValue({ content: "not json at all" });

    await submitSelection(ledger.id, {
      ledgerEntryIds: entryIds,
      candidateCategoryIds: [food.id, home.id],
    });
    await flushAfterCallbacks(15_000);

    await expect(getCategoryReclassificationJobAction()).resolves.toMatchObject({
      status: "failed",
      failedCount: 1,
    });
  });

  it("refuses a second run while one is active", async () => {
    const { ledger, food, home, document, revisionId } = await setupLedger();
    const entryIds = await seedEntries({
      ledgerId: ledger.id,
      documentId: document.id,
      revisionId,
      categoryId: null,
      count: 1,
    });
    // A run already in flight, registered without going through the action so
    // no model call is left pending.
    await beginCategoryAssignmentAction({
      requestKey: crypto.randomUUID(),
      mode: { kind: "ai", candidateCategoryIds: [food.id, home.id] },
      expectedEntryCount: entryIds.length,
    });

    await expect(
      submitSelection(ledger.id, {
        ledgerEntryIds: entryIds,
        candidateCategoryIds: [food.id, home.id],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
