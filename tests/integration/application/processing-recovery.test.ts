import { createPendingRevision } from "tests/helpers/processing-revision";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import type { ProcessingJobContract } from "@/server/processing/types";
import { processingOutbox, sourceDocuments, sourceDocumentRevisions } from "@/persistence";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";
import { processingJobs } from "tests/helpers/processing-jobs";
import { PROCESSING_MAX_ATTEMPTS } from "@/config/tuning";

vi.mock("@/lib/tasks/ai-context", () => ({
  createAIContext: vi.fn(),
}));
import { createAIContext } from "@/lib/tasks/ai-context";
import { executeProcessingJob } from "@/server/processing/execute-job";

/**
 * Creates a pending revision + job for a single source document.
 * Each call uses a fresh user+ledger pair to avoid unique-constraint collisions.
 */
async function pendingIntent(
  requestedAt = "2026-07-15T00:00:00.000Z",
  userId = crypto.randomUUID()
): Promise<{ ledgerId: string; job: ProcessingJobContract }> {
  const db = getTestDb();
  const { ledgerId } = await createTestUserWithLedger(db, undefined, undefined, userId);
  const bookId = await testBookId(db, ledgerId);
  const pending = await createPendingRevision({
    ledgerId,
    input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
    bookId: bookId,
  });
  return {
    ledgerId,
    job: {
      id: crypto.randomUUID(),
      sourceDocumentId: pending.document.id,
      revisionId: pending.revision.id,
      requestedAt,
    },
  };
}

/**
 * Advances an outbox row's nextAvailableAt to the past so it becomes eligible for recovery.
 */
async function expireNextAvailable(jobId: string) {
  const db = getTestDb();
  await db
    .update(processingOutbox)
    .set({ nextAvailableAt: new Date("2020-01-01T00:00:00.000Z") })
    .where(eq(processingOutbox.id, jobId));
}

/**
 * Sets an outbox row's scheduleAttemptCount to a specific value.
 */
async function setScheduleAttemptCount(jobId: string, count: number) {
  const db = getTestDb();
  await db
    .update(processingOutbox)
    .set({ scheduleAttemptCount: count })
    .where(eq(processingOutbox.id, jobId));
}

/**
 * Sets an outbox row's claimExpiresAt to a very old timestamp (expired claim).
 */
async function expireClaim(jobId: string) {
  const db = getTestDb();
  await db
    .update(processingOutbox)
    .set({
      status: "claimed",
      claimExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
      claimToken: "stale-token",
    })
    .where(eq(processingOutbox.id, jobId));
}

describe("Processing Recovery", () => {
  const config = { maxBatch: 3, cooldownSeconds: 60 };

  it("recovers an job that was dispatched but never claimed (missed after())", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // nextAvailableAt is in the past (defaults to requestedAt = "2026-07-15")
    const recoverable = await adapter.recoverBatch(ledgerId, config);

    // The job should be recovered and scheduled
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0]!.id).toBe(job.id);

    // Verify the outbox was updated
    const db = getTestDb();
    const row = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(row?.scheduleAttemptCount).toBe(0);
    expect(new Date(row!.nextAvailableAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("re-selects an job with an expired claim", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // Simulate an expired claim (status = claimed, claimExpiresAt in the past)
    await expireClaim(job.id);

    const recoverable = await adapter.recoverBatch(ledgerId, config);

    // The job should be recovered despite being in "claimed" status
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0]!.id).toBe(job.id);
  });

  it("does not double-process under concurrent requests", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // Two concurrent recovery calls — only one should succeed in scheduling
    const [first, second] = await Promise.all([
      adapter.recoverBatch(ledgerId, config),
      adapter.recoverBatch(ledgerId, config),
    ]);

    const recoveredIds = [...first, ...second].map((candidate) => candidate.id);
    expect(recoveredIds).toEqual([job.id]);

    // Scheduling pushes the next run out; only a claim counts an attempt.
    const db = getTestDb();
    const row = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(row!.scheduleAttemptCount).toBe(0);
    expect(new Date(row!.nextAvailableAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("skips recovery when the source document has been deleted", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // Soft-delete the source document
    const db = getTestDb();
    await db
      .update(sourceDocuments)
      .set({ deletedAt: new Date(), latestSubmissionRevisionId: null })
      .where(eq(sourceDocuments.id, job.sourceDocumentId));

    const recoverable = await adapter.recoverBatch(ledgerId, config);
    expect(recoverable).toHaveLength(0);
  });

  it("skips recovery when a newer pending revision exists (stale replacement)", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // Create a newer pending revision and point the document to it
    const db = getTestDb();
    const newRevision = await db
      .insert(sourceDocumentRevisions)
      .values({
        ledgerId,
        sourceDocumentId: job.sourceDocumentId,
        inputText: "Updated text",
        processingStatus: "processing",
      })
      .returning()
      .then((rows) => rows[0]);
    await db
      .update(sourceDocuments)
      .set({ latestSubmissionRevisionId: newRevision!.id })
      .where(eq(sourceDocuments.id, job.sourceDocumentId));

    // The old job's revision no longer matches the document's latestSubmissionRevisionId
    const recoverable = await adapter.recoverBatch(ledgerId, config);
    expect(recoverable).toHaveLength(0);
  });

  it("does not recover intents from other ledgers", async () => {
    const { job: intentA } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());
    const { ledgerId: ledgerB } = await pendingIntent(
      "2026-07-15T00:00:00.000Z",
      crypto.randomUUID()
    );

    const adapter = processingJobs();
    await adapter.dispatch(intentA);

    // Recover for ledgerB — should not pick up intentA
    const recoverable = await adapter.recoverBatch(ledgerB, config);
    expect(recoverable).toHaveLength(0);
  });

  it("counts an attempt each time a run claims the job, not when it is scheduled", async () => {
    let now = new Date("2026-07-15T00:00:00.000Z");
    const { ledgerId, job } = await pendingIntent(now.toISOString());
    const adapter = processingJobs({ leaseMs: 1_000, now: () => now });
    await adapter.dispatch(job);

    await adapter.recoverBatch(ledgerId, config);
    await expect(adapter.claim(job.id)).resolves.toMatchObject({ attempt: 1 });
    now = new Date(now.getTime() + 1_001);
    await expect(adapter.claim(job.id)).resolves.toMatchObject({ attempt: 2 });
  });

  it("fails an exhausted job under its lease when a run claims it", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);
    await setScheduleAttemptCount(job.id, PROCESSING_MAX_ATTEMPTS);
    const db = getTestDb();
    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, job.sourceDocumentId),
    });

    // Recovery still schedules it; the claim is where exhaustion is decided.
    await expect(adapter.recoverBatch(ledgerId, config)).resolves.toHaveLength(1);
    await expect(executeProcessingJob(job)).resolves.toBe(true);

    expect(createAIContext).not.toHaveBeenCalled();
    await expect(
      db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.id, job.revisionId),
      })
    ).resolves.toMatchObject({
      processingStatus: "failed",
      failureCode: "request_bound_retry_exhausted",
    });
    await expect(
      db.query.processingOutbox.findFirst({ where: eq(processingOutbox.id, job.id) })
    ).resolves.toMatchObject({
      status: "failed",
      diagnosticCode: "request_bound_retry_exhausted",
    });
    await expect(
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, job.sourceDocumentId) })
    ).resolves.toMatchObject({ version: before!.version + 1 });
  });

  it("returns at most maxBatch intents", async () => {
    const smallConfig = { maxBatch: 2, cooldownSeconds: 60 };

    // Create a single ledger and 3 source documents within it
    const { ledgerId, job: intent1 } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(intent1);

    // Create 2 more source documents in the same ledger
    const bookId = await testBookId(getTestDb(), ledgerId);
    const pending2 = await createPendingRevision({
      ledgerId,
      input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
      bookId,
    });
    const pending3 = await createPendingRevision({
      ledgerId,
      input: { text: "Coffee 5.00 CNY", storedFileIds: [], documentDate: null },
      bookId,
    });

    const intent2: ProcessingJobContract = {
      id: crypto.randomUUID(),
      sourceDocumentId: pending2.document.id,
      revisionId: pending2.revision.id,
      requestedAt: "2026-07-15T00:00:00.000Z",
    };
    const intent3: ProcessingJobContract = {
      id: crypto.randomUUID(),
      sourceDocumentId: pending3.document.id,
      revisionId: pending3.revision.id,
      requestedAt: "2026-07-15T00:00:00.000Z",
    };

    await adapter.dispatch(intent2);
    await adapter.dispatch(intent3);

    // expire all three
    await expireNextAvailable(intent1.id);
    await expireNextAvailable(intent2.id);
    await expireNextAvailable(intent3.id);

    const recoverable = await adapter.recoverBatch(ledgerId, smallConfig);

    // maxBatch=2 limits the result even though 3 intents are eligible
    expect(recoverable).toHaveLength(2);
  });

  it("maxBatch=1 still allows job to execute", async () => {
    const singleConfig = { maxBatch: 1, cooldownSeconds: 60 };
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    const recoverable = await adapter.recoverBatch(ledgerId, singleConfig);
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0]!.id).toBe(job.id);
  });

  it("closes a superseded job without touching its revision", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // Point the document at a newer revision so the job's revision is no longer current.
    const db = getTestDb();
    const newRevision = await db
      .insert(sourceDocumentRevisions)
      .values({
        ledgerId,
        sourceDocumentId: job.sourceDocumentId,
        inputText: "Updated text",
        processingStatus: "processing",
      })
      .returning()
      .then((rows) => rows[0]);
    await db
      .update(sourceDocuments)
      .set({ latestSubmissionRevisionId: newRevision!.id })
      .where(eq(sourceDocuments.id, job.sourceDocumentId));

    await adapter.recoverBatch(ledgerId, config);

    // Production recovery cancels superseded intents without changing their revision.
    const outboxRow = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(outboxRow?.status).toBe("cancelled");

    // But the OLD revision should NOT have been modified
    const oldRevision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, job.revisionId),
    });
    expect(oldRevision?.processingStatus).not.toBe("failed");
    expect(oldRevision?.failureCode).toBeNull();
  });

  it("closes a finished job without changing its revision's outcome", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // Simulate: the revision was already completed (e.g., by the executor)
    const db = getTestDb();
    await db
      .update(sourceDocumentRevisions)
      .set({ processingStatus: "completed", finishedAt: new Date() })
      .where(eq(sourceDocumentRevisions.id, job.revisionId));

    await adapter.recoverBatch(ledgerId, config);

    // Outbox should be closed (stale)
    const outboxRow = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(outboxRow?.status).toBe("completed");

    // Revision should remain "completed", NOT overwritten to "failed"
    const revisionRow = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, job.revisionId),
    });
    expect(revisionRow?.processingStatus).toBe("completed");
  });
});

describe("Processing retry supersession", () => {
  it("atomically cancels the old revision and invalidates its active claim", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const first = await submitSourceDocument({
      ledgerId,
      input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    const processing = processingJobs();
    const oldClaim = await processing.claim(first.job.id);
    expect(oldClaim).not.toBeNull();

    const second = await submitSourceDocument({
      ledgerId,
      sourceDocumentId: first.document.id,
      inheritInput: true,
      supersedeProcessing: true,
      bookId: await testBookId(db, ledgerId),
    });

    const [document, oldRevision, oldOutbox] = await Promise.all([
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, first.document.id) }),
      db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.id, first.revision.id),
      }),
      db.query.processingOutbox.findFirst({ where: eq(processingOutbox.id, first.job.id) }),
    ]);

    expect(document?.latestSubmissionRevisionId).toBe(second.revision.id);
    expect(oldRevision?.processingStatus).toBe("cancelled");
    expect(oldOutbox).toMatchObject({
      status: "cancelled",
      diagnosticCode: "superseded_by_retry",
    });
    await expect(processing.renew(first.job.id, oldClaim!.claimToken)).resolves.toBeNull();
  });
});
