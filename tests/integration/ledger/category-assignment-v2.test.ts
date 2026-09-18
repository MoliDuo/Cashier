import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { postgresCategoryAssignmentV2Adapter } from "@/application/adapters/postgres/category-assignment-v2";
import { postgresSourceDocumentAggregateAdapter } from "@/application/adapters/postgres/source-document-aggregate";
import {
  categoryReclassificationJobEntries,
  categoryReclassificationJobDocuments,
  categoryReclassificationJobs,
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocuments,
} from "@/persistence";
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

const START = new Date("2030-01-01T00:00:00.000Z");
const AFTER_EXPIRY = new Date("2030-01-01T00:02:00.000Z");

async function seedSelection() {
  const db = getTestDb();
  const ledger = createLedgerData();
  const category = createCategoryData(ledger.id, { name: "Meals", sortOrder: 0 });
  const document = createSourceDocumentData(ledger.id);
  await db.insert(ledgers).values(ledger);
  await ensureTestLedgerBooks(db, ledger.id);
  await db.insert(entryCategories).values(category);
  await db.insert(sourceDocuments).values({
    ...document,
    bookId: sql`(SELECT id FROM books WHERE ledger_id = ${document.ledgerId} ORDER BY sort_order LIMIT 1)`,
  });
  const revisionId = await activateTestSourceDocumentProjection(db, document.id);
  const entryId = crypto.randomUUID();
  await db.insert(ledgerEntries).values({
    id: entryId,
    ledgerId: ledger.id,
    sourceDocumentId: document.id,
    sourceDocumentRevisionId: revisionId,
    position: 0,
    amount: "12.00",
    currency: "CNY",
    itemName: "Lunch",
  });
  return {
    ledger,
    category,
    document,
    selection: {
      ledgerEntryId: entryId,
      sourceDocumentId: document.id,
      expectedVersion: 1,
    },
  };
}

async function prepareAssignment() {
  const fixture = await seedSelection();
  const requestKey = crypto.randomUUID();
  const begun = await postgresCategoryAssignmentV2Adapter.begin({
    ledgerId: fixture.ledger.id,
    requestKey,
    mode: { kind: "assign", categoryId: fixture.category.id },
    expectedEntryCount: 1,
    candidates: [],
    customPrompt: null,
    now: START,
  });
  return { ...fixture, requestKey, begun };
}

describe("category assignment v2", () => {
  it("resolves conflicted entries against their current document version without widening scope", async () => {
    const fixture = await prepareAssignment();
    await postgresCategoryAssignmentV2Adapter.append({
      ledgerId: fixture.ledger.id,
      jobId: fixture.begun.id,
      chunkIndex: 0,
      entries: [fixture.selection],
      now: START,
    });
    await postgresCategoryAssignmentV2Adapter.commit({
      ledgerId: fixture.ledger.id,
      jobId: fixture.begun.id,
      expectedEntryCount: 1,
      now: START,
    });
    const db = getTestDb();
    await db
      .update(sourceDocuments)
      .set({ version: 2 })
      .where(eq(sourceDocuments.id, fixture.document.id));
    await db
      .update(categoryReclassificationJobDocuments)
      .set({ status: "conflict", errorCode: "document_changed" })
      .where(eq(categoryReclassificationJobDocuments.jobId, fixture.begun.id));
    await db
      .update(categoryReclassificationJobEntries)
      .set({ outcome: "conflict", errorCode: "document_changed" })
      .where(eq(categoryReclassificationJobEntries.jobId, fixture.begun.id));
    await db
      .update(categoryReclassificationJobs)
      .set({ status: "partial", conflictCount: 1, documentCompleted: 1 })
      .where(eq(categoryReclassificationJobs.id, fixture.begun.id));

    await expect(
      postgresCategoryAssignmentV2Adapter.resolveLatestConflictSelection({
        ledgerId: fixture.ledger.id,
        jobId: fixture.begun.id,
      })
    ).resolves.toEqual({
      mode: { kind: "assign", categoryId: fixture.category.id },
      parentJobId: fixture.begun.id,
      entries: [{ ...fixture.selection, expectedVersion: 2 }],
    });
  });

  it("counts the whole declared range when a partial selection upload is cancelled", async () => {
    const fixture = await seedSelection();
    const begun = await postgresCategoryAssignmentV2Adapter.begin({
      ledgerId: fixture.ledger.id,
      requestKey: crypto.randomUUID(),
      mode: { kind: "clear" },
      expectedEntryCount: 3,
      candidates: [],
      customPrompt: null,
      now: START,
    });
    await postgresCategoryAssignmentV2Adapter.append({
      ledgerId: fixture.ledger.id,
      jobId: begun.id,
      chunkIndex: 0,
      entries: [fixture.selection],
      now: START,
    });

    await expect(
      postgresCategoryAssignmentV2Adapter.cancel({
        ledgerId: fixture.ledger.id,
        jobId: begun.id,
        now: START,
      })
    ).resolves.toBe(true);
    const stored = await getTestDb()
      .select()
      .from(categoryReclassificationJobs)
      .where(
        and(
          eq(categoryReclassificationJobs.ledgerId, fixture.ledger.id),
          eq(categoryReclassificationJobs.id, begun.id)
        )
      )
      .then((rows) => rows[0]);
    expect(stored).toMatchObject({
      status: "cancelled",
      declaredEntryCount: 3,
      cancelledCount: 3,
    });
  });

  it("replays begin, append, and commit without duplicating the selection", async () => {
    const fixture = await prepareAssignment();
    const replay = await postgresCategoryAssignmentV2Adapter.begin({
      ledgerId: fixture.ledger.id,
      requestKey: fixture.requestKey,
      mode: { kind: "assign", categoryId: fixture.category.id },
      expectedEntryCount: 1,
      candidates: [],
      customPrompt: null,
      now: START,
    });
    expect(replay.id).toBe(fixture.begun.id);

    const chunk = {
      ledgerId: fixture.ledger.id,
      jobId: fixture.begun.id,
      chunkIndex: 0,
      entries: [fixture.selection],
      now: START,
    };
    await expect(postgresCategoryAssignmentV2Adapter.append(chunk)).resolves.toEqual({
      receivedEntryCount: 1,
    });
    await expect(postgresCategoryAssignmentV2Adapter.append(chunk)).resolves.toEqual({
      receivedEntryCount: 1,
    });
    await expect(
      postgresCategoryAssignmentV2Adapter.append({
        ...chunk,
        entries: [{ ...fixture.selection, expectedVersion: 2 }],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      postgresCategoryAssignmentV2Adapter.commit({
        ledgerId: fixture.ledger.id,
        jobId: fixture.begun.id,
        expectedEntryCount: 1,
        now: START,
      })
    ).resolves.toMatchObject({ status: "pending", receivedEntryCount: 1 });
    await expect(
      postgresCategoryAssignmentV2Adapter.commit({
        ledgerId: fixture.ledger.id,
        jobId: fixture.begun.id,
        expectedEntryCount: 1,
        now: START,
      })
    ).resolves.toMatchObject({ status: "pending", receivedEntryCount: 1 });

    const rows = await getTestDb()
      .select()
      .from(categoryReclassificationJobEntries)
      .where(eq(categoryReclassificationJobEntries.jobId, fixture.begun.id));
    expect(rows).toHaveLength(1);
  });

  it("fences an expired claim and commits category, version, and outcome together", async () => {
    const fixture = await prepareAssignment();
    await postgresCategoryAssignmentV2Adapter.append({
      ledgerId: fixture.ledger.id,
      jobId: fixture.begun.id,
      chunkIndex: 0,
      entries: [fixture.selection],
      now: START,
    });
    await postgresCategoryAssignmentV2Adapter.commit({
      ledgerId: fixture.ledger.id,
      jobId: fixture.begun.id,
      expectedEntryCount: 1,
      now: START,
    });

    const [first] = await postgresCategoryAssignmentV2Adapter.claimDocuments({
      jobId: fixture.begun.id,
      now: START,
      leaseMs: 60_000,
      concurrency: 1,
    });
    const [second] = await postgresCategoryAssignmentV2Adapter.claimDocuments({
      jobId: fixture.begun.id,
      now: AFTER_EXPIRY,
      leaseMs: 60_000,
      concurrency: 1,
    });
    expect(second!.claimToken).not.toBe(first!.claimToken);

    await expect(
      postgresSourceDocumentAggregateAdapter.applyCategoryAssignments({
        ledgerId: fixture.ledger.id,
        jobId: fixture.begun.id,
        sourceDocumentId: fixture.document.id,
        claimToken: first!.claimToken,
        now: AFTER_EXPIRY,
      })
    ).resolves.toEqual({ status: "claim_lost" });

    const unchanged = await getTestDb()
      .select({ categoryId: ledgerEntries.categoryId, version: sourceDocuments.version })
      .from(ledgerEntries)
      .innerJoin(
        sourceDocuments,
        and(
          eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
          eq(sourceDocuments.ledgerId, ledgerEntries.ledgerId)
        )
      )
      .where(eq(ledgerEntries.id, fixture.selection.ledgerEntryId))
      .then((rows) => rows[0]);
    expect(unchanged).toEqual({ categoryId: null, version: 1 });

    await expect(
      postgresSourceDocumentAggregateAdapter.applyCategoryAssignments({
        ledgerId: fixture.ledger.id,
        jobId: fixture.begun.id,
        sourceDocumentId: fixture.document.id,
        claimToken: second!.claimToken,
        now: AFTER_EXPIRY,
      })
    ).resolves.toMatchObject({ status: "applied", appliedCount: 1, version: 2 });

    const [entryRow] = await getTestDb()
      .select({ categoryId: ledgerEntries.categoryId })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, fixture.selection.ledgerEntryId));
    const [resultRow] = await getTestDb()
      .select({ outcome: categoryReclassificationJobEntries.outcome })
      .from(categoryReclassificationJobEntries)
      .where(eq(categoryReclassificationJobEntries.jobId, fixture.begun.id));
    expect(entryRow?.categoryId).toBe(fixture.category.id);
    expect(resultRow?.outcome).toBe("applied");
  });
});
