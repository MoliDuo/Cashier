import { sql } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  categoryReclassificationJobEntries,
  categoryReclassificationJobDocuments,
  categoryReclassificationJobs,
  entryCategories,
  ledgerEntries,
  ledgers,
  sourceDocuments,
} from "@/persistence";
import { getTestDb } from "tests/setup";
import {
  createCategoryData,
  createLedgerData,
  createSourceDocumentData,
} from "tests/helpers/factories";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import { applyCategoryAssignments } from "@/modules/source-document/server/category-assignments";
import { deleteSourceDocumentAtomically } from "@/modules/source-document/server/delete";
import {
  cancelCategoryAssignment,
  claimCategoryAssignmentJob,
  failCategoryAssignmentDocument,
  nextCategoryAssignmentDocument,
  persistCategoryAssignmentDecisions,
  releaseCategoryAssignmentJob,
  renewCategoryAssignmentLease,
  rescheduleCategoryAssignmentDocument,
  resolveLatestConflictSelection,
  startCategoryAssignment,
  yieldCategoryAssignmentDocument,
} from "@/server/category-reclassification/assignments";
import { getCategoryReclassificationJob } from "@/server/category-reclassification/jobs";

async function addDocument(ledgerId: string, itemNames: string[]) {
  const db = getTestDb();
  const document = createSourceDocumentData(ledgerId);
  await db.insert(sourceDocuments).values({
    ...document,
    bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
  });
  await activateTestSourceDocumentProjection(db, document.id);
  const entryIds = itemNames.map(() => crypto.randomUUID());
  await db.insert(ledgerEntries).values(
    itemNames.map((itemName, position) => ({
      id: entryIds[position]!,
      ledgerId,
      sourceDocumentId: document.id,
      position,
      amount: "12.00",
      currency: "CNY",
      itemName,
    }))
  );
  return { documentId: document.id, entryIds };
}

async function seedLedger() {
  const db = getTestDb();
  const ledger = createLedgerData();
  const category = createCategoryData(ledger.id, { name: "Meals", sortOrder: 0 });
  await db.insert(ledgers).values(ledger);
  await ensureTestLedgerBooks(db, ledger.id);
  await db.insert(entryCategories).values(category);
  const document = await addDocument(ledger.id, ["Lunch"]);
  return { ledger, category, ...document };
}

async function startAssign(
  fixture: { ledger: { id: string }; category: { id: string } },
  ledgerEntryIds: string[],
  requestKey: string = crypto.randomUUID()
) {
  return startCategoryAssignment({
    ledgerId: fixture.ledger.id,
    requestKey,
    mode: { kind: "assign", categoryId: fixture.category.id },
    ledgerEntryIds,
    candidates: [],
    customPrompt: null,
  });
}

/** Moves the job's lease into the past, as if its worker had died. */
async function expireJobLease(jobId: string) {
  await getTestDb()
    .update(categoryReclassificationJobs)
    .set({ claimExpiresAt: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(categoryReclassificationJobs.id, jobId));
}

async function storedJob(jobId: string) {
  return getTestDb().query.categoryReclassificationJobs.findFirst({
    where: eq(categoryReclassificationJobs.id, jobId),
  });
}

describe("starting a category assignment", () => {
  it("registers the job, its documents and its entries in one call", async () => {
    const fixture = await seedLedger();
    const second = await addDocument(fixture.ledger.id, ["Coffee", "Tea"]);
    const started = await startAssign(fixture, [
      second.entryIds[1]!,
      fixture.entryIds[0]!,
      second.entryIds[0]!,
    ]);

    const db = getTestDb();
    const documents = await db
      .select({
        sourceDocumentId: categoryReclassificationJobDocuments.sourceDocumentId,
        firstSelectionOrder: categoryReclassificationJobDocuments.firstSelectionOrder,
        status: categoryReclassificationJobDocuments.status,
      })
      .from(categoryReclassificationJobDocuments)
      .where(eq(categoryReclassificationJobDocuments.jobId, started.id));
    expect(documents).toEqual(
      expect.arrayContaining([
        { sourceDocumentId: second.documentId, firstSelectionOrder: 0, status: "pending" },
        { sourceDocumentId: fixture.documentId, firstSelectionOrder: 1, status: "pending" },
      ])
    );
    const entries = await db
      .select({
        id: categoryReclassificationJobEntries.ledgerEntryId,
        order: categoryReclassificationJobEntries.selectionOrder,
        target: categoryReclassificationJobEntries.targetCategoryId,
        decided: categoryReclassificationJobEntries.decisionPersisted,
      })
      .from(categoryReclassificationJobEntries)
      .where(eq(categoryReclassificationJobEntries.jobId, started.id))
      .orderBy(categoryReclassificationJobEntries.selectionOrder);
    expect(entries).toEqual([
      { id: second.entryIds[1], order: 0, target: fixture.category.id, decided: true },
      { id: fixture.entryIds[0], order: 1, target: fixture.category.id, decided: true },
      { id: second.entryIds[0], order: 2, target: fixture.category.id, decided: true },
    ]);
    await expect(
      getCategoryReclassificationJob({ ledgerId: fixture.ledger.id, jobId: started.id })
    ).resolves.toMatchObject({
      status: "pending",
      entryCount: 3,
      documentTotal: 2,
      documentCompleted: 0,
      activeDocumentCount: 0,
    });
  });

  it("returns the same job for a replay and refuses the key for another selection", async () => {
    const fixture = await seedLedger();
    const requestKey = crypto.randomUUID();
    const started = await startAssign(fixture, fixture.entryIds, requestKey);

    await expect(startAssign(fixture, fixture.entryIds, requestKey)).resolves.toEqual(started);
    const other = await addDocument(fixture.ledger.id, ["Dinner"]);
    await expect(startAssign(fixture, other.entryIds, requestKey)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const rows = await getTestDb()
      .select()
      .from(categoryReclassificationJobEntries)
      .where(eq(categoryReclassificationJobEntries.jobId, started.id));
    expect(rows).toHaveLength(1);
  });

  it("refuses entries the ledger does not hold and a second active run", async () => {
    const fixture = await seedLedger();
    await expect(startAssign(fixture, [crypto.randomUUID()])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await startAssign(fixture, fixture.entryIds);
    await expect(startAssign(fixture, fixture.entryIds)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("running a category assignment", () => {
  it("leases a job to one worker until the lease expires", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);

    const first = await claimCategoryAssignmentJob({ jobId: started.id });
    expect(first).toMatchObject({ jobId: started.id, ledgerId: fixture.ledger.id });
    await expect(claimCategoryAssignmentJob({ jobId: started.id })).resolves.toBeNull();
    await expect(
      getCategoryReclassificationJob({ ledgerId: fixture.ledger.id, jobId: started.id })
    ).resolves.toMatchObject({ status: "running", activeDocumentCount: 1 });

    await expireJobLease(started.id);
    await expect(renewCategoryAssignmentLease(first!)).resolves.toBe(false);
    const second = await claimCategoryAssignmentJob({ ledgerId: fixture.ledger.id });
    expect(second?.claimToken).not.toBe(first!.claimToken);
    await expect(renewCategoryAssignmentLease(second!)).resolves.toBe(true);
  });

  it("rejects writes from a worker whose lease was taken over", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);
    const first = await claimCategoryAssignmentJob({ jobId: started.id });
    await nextCategoryAssignmentDocument(first!);
    await expireJobLease(started.id);
    const second = await claimCategoryAssignmentJob({ jobId: started.id });

    await expect(
      applyCategoryAssignments({ lease: first!, sourceDocumentId: fixture.documentId })
    ).resolves.toEqual({ status: "claim_lost" });
    await expect(
      persistCategoryAssignmentDecisions({
        lease: first!,
        sourceDocumentId: fixture.documentId,
        decisions: [],
        completedChunkCount: 1,
      })
    ).resolves.toBe(false);
    await expect(nextCategoryAssignmentDocument(first!)).resolves.toEqual({ kind: "lost" });
    const [unchanged] = await getTestDb()
      .select({ categoryId: ledgerEntries.categoryId })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, fixture.entryIds[0]!));
    expect(unchanged?.categoryId).toBeNull();

    await expect(
      applyCategoryAssignments({ lease: second!, sourceDocumentId: fixture.documentId })
    ).resolves.toEqual({ status: "applied", appliedCount: 1, confirmedCount: 0, conflictCount: 0 });
    const document = await getTestDb().query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, fixture.documentId),
    });
    expect(document?.version).toBe(1);
  });

  it("stops a running worker when the run is cancelled", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await nextCategoryAssignmentDocument(job!);

    await expect(
      cancelCategoryAssignment({ ledgerId: fixture.ledger.id, jobId: started.id })
    ).resolves.toBe(true);
    await expect(
      applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId })
    ).resolves.toEqual({ status: "claim_lost" });
    await releaseCategoryAssignmentJob(job!);
    await expect(
      getCategoryReclassificationJob({ ledgerId: fixture.ledger.id, jobId: started.id })
    ).resolves.toMatchObject({ status: "cancelled", cancelledCount: 1, documentCompleted: 1 });
  });

  it("waits out a transient failure and counts only real attempts", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await expect(nextCategoryAssignmentDocument(job!)).resolves.toMatchObject({
      kind: "document",
      document: { attempt: 1, lastErrorCode: null },
    });

    await expect(
      rescheduleCategoryAssignmentDocument({
        lease: job!,
        sourceDocumentId: fixture.documentId,
        errorCode: "ai_rate_limited",
        delayMs: 60_000,
      })
    ).resolves.toBe(true);
    const waiting = await nextCategoryAssignmentDocument(job!);
    expect(waiting.kind).toBe("wait");
    expect(waiting.kind === "wait" && waiting.delayMs).toBeGreaterThan(55_000);
    await expect(
      getCategoryReclassificationJob({ ledgerId: fixture.ledger.id, jobId: started.id })
    ).resolves.toMatchObject({ retryingDocumentCount: 1, activeDocumentCount: 0 });

    // Not due: released, the job is not claimable until the retry comes due.
    await releaseCategoryAssignmentJob(job!);
    await expect(claimCategoryAssignmentJob({ jobId: started.id })).resolves.toBeNull();
    await getTestDb()
      .update(categoryReclassificationJobDocuments)
      .set({ nextAttemptAt: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(categoryReclassificationJobDocuments.jobId, started.id));
    const again = await claimCategoryAssignmentJob({ jobId: started.id });
    await expect(nextCategoryAssignmentDocument(again!)).resolves.toMatchObject({
      kind: "document",
      document: { attempt: 2, lastErrorCode: "ai_rate_limited" },
    });
    // Running out of budget hands the document back without spending the attempt.
    await yieldCategoryAssignmentDocument(again!, fixture.documentId);
    await expect(nextCategoryAssignmentDocument(again!)).resolves.toMatchObject({
      kind: "document",
      document: { attempt: 2 },
    });
  });

  it("settles the job when its last document gets an outcome", async () => {
    const fixture = await seedLedger();
    const second = await addDocument(fixture.ledger.id, ["Coffee"]);
    const started = await startAssign(fixture, [fixture.entryIds[0]!, second.entryIds[0]!]);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });

    const first = await nextCategoryAssignmentDocument(job!);
    expect(first).toMatchObject({ document: { sourceDocumentId: fixture.documentId } });
    await applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId });
    const last = await nextCategoryAssignmentDocument(job!);
    expect(last).toMatchObject({ document: { sourceDocumentId: second.documentId } });
    await failCategoryAssignmentDocument({
      lease: job!,
      sourceDocumentId: second.documentId,
      errorCode: "ai_schema_invalid",
    });
    await expect(nextCategoryAssignmentDocument(job!)).resolves.toEqual({ kind: "done" });

    await releaseCategoryAssignmentJob(job!);
    expect(await storedJob(started.id)).toMatchObject({
      status: "partial",
      claimToken: null,
      claimExpiresAt: null,
    });
    await expect(
      getCategoryReclassificationJob({ ledgerId: fixture.ledger.id, jobId: started.id })
    ).resolves.toMatchObject({
      entryCount: 2,
      appliedCount: 1,
      failedCount: 1,
      documentTotal: 2,
      documentCompleted: 2,
      activeDocumentCount: 0,
    });
  });

  it("claims a job left without its final status so the status is written", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await nextCategoryAssignmentDocument(job!);
    await applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId });
    // The worker dies before releasing the job.
    await expireJobLease(started.id);

    const recovered = await claimCategoryAssignmentJob({ ledgerId: fixture.ledger.id });
    await expect(nextCategoryAssignmentDocument(recovered!)).resolves.toEqual({ kind: "done" });
    await releaseCategoryAssignmentJob(recovered!);
    expect(await storedJob(started.id)).toMatchObject({ status: "succeeded" });
  });

  it("drops a document deleted mid-run and settles the job on what is left", async () => {
    const fixture = await seedLedger();
    const second = await addDocument(fixture.ledger.id, ["Coffee"]);
    const started = await startAssign(fixture, [fixture.entryIds[0]!, second.entryIds[0]!]);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await expect(nextCategoryAssignmentDocument(job!)).resolves.toMatchObject({
      document: { sourceDocumentId: fixture.documentId },
    });

    await deleteSourceDocumentAtomically({
      ledgerId: fixture.ledger.id,
      sourceDocumentId: fixture.documentId,
    });
    await expect(
      applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId })
    ).resolves.toEqual({ status: "skipped" });
    await expect(nextCategoryAssignmentDocument(job!)).resolves.toMatchObject({
      document: { sourceDocumentId: second.documentId },
    });
    await applyCategoryAssignments({ lease: job!, sourceDocumentId: second.documentId });
    await releaseCategoryAssignmentJob(job!);

    expect(await storedJob(started.id)).toMatchObject({ status: "succeeded" });
    await expect(
      getCategoryReclassificationJob({ ledgerId: fixture.ledger.id, jobId: started.id })
    ).resolves.toMatchObject({ entryCount: 1, appliedCount: 1, documentTotal: 1 });
  });

  it("marks only an entry recategorized after selection as a conflict", async () => {
    const fixture = await seedLedger();
    const db = getTestDb();
    const [other] = await db
      .insert(entryCategories)
      .values(createCategoryData(fixture.ledger.id, { name: "Travel", sortOrder: 1 }))
      .returning();
    const secondEntryId = crypto.randomUUID();
    await db.insert(ledgerEntries).values({
      id: secondEntryId,
      ledgerId: fixture.ledger.id,
      sourceDocumentId: fixture.documentId,
      position: 1,
      amount: "8.00",
      currency: "CNY",
      itemName: "Coffee",
    });
    const started = await startAssign(fixture, [fixture.entryIds[0]!, secondEntryId]);
    await db
      .update(ledgerEntries)
      .set({ categoryId: other!.id })
      .where(eq(ledgerEntries.id, secondEntryId));
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await nextCategoryAssignmentDocument(job!);

    await expect(
      applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId })
    ).resolves.toEqual({ status: "applied", appliedCount: 1, confirmedCount: 0, conflictCount: 1 });
    await releaseCategoryAssignmentJob(job!);

    const entries = await db
      .select({ id: ledgerEntries.id, categoryId: ledgerEntries.categoryId })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceDocumentId, fixture.documentId));
    expect(new Map(entries.map((entry) => [entry.id, entry.categoryId]))).toEqual(
      new Map([
        [fixture.entryIds[0]!, fixture.category.id],
        [secondEntryId, other!.id],
      ])
    );
    const outcomes = await db
      .select({
        id: categoryReclassificationJobEntries.ledgerEntryId,
        outcome: categoryReclassificationJobEntries.outcome,
        errorCode: categoryReclassificationJobEntries.errorCode,
      })
      .from(categoryReclassificationJobEntries)
      .where(eq(categoryReclassificationJobEntries.jobId, started.id));
    expect(outcomes).toEqual(
      expect.arrayContaining([
        { id: fixture.entryIds[0], outcome: "applied", errorCode: null },
        { id: secondEntryId, outcome: "conflict", errorCode: "entry_changed" },
      ])
    );
    expect(await storedJob(started.id)).toMatchObject({ status: "partial" });

    await expect(
      resolveLatestConflictSelection({ ledgerId: fixture.ledger.id, jobId: started.id })
    ).resolves.toEqual({
      mode: { kind: "assign", categoryId: fixture.category.id },
      parentJobId: started.id,
      ledgerEntryIds: [secondEntryId],
    });
  });

  it("refuses to categorize conflicts again for a run that had none", async () => {
    const fixture = await seedLedger();
    const started = await startAssign(fixture, fixture.entryIds);
    const job = await claimCategoryAssignmentJob({ jobId: started.id });
    await nextCategoryAssignmentDocument(job!);
    await applyCategoryAssignments({ lease: job!, sourceDocumentId: fixture.documentId });
    await releaseCategoryAssignmentJob(job!);

    await expect(
      resolveLatestConflictSelection({ ledgerId: fixture.ledger.id, jobId: started.id })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const stored = await getTestDb()
      .select({ outcome: categoryReclassificationJobEntries.outcome })
      .from(categoryReclassificationJobEntries)
      .where(
        and(
          eq(categoryReclassificationJobEntries.jobId, started.id),
          eq(categoryReclassificationJobEntries.ledgerId, fixture.ledger.id)
        )
      );
    expect(stored).toEqual([{ outcome: "applied" }]);
  });
});
