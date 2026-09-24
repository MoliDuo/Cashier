import { createPendingRevision } from "tests/helpers/processing-revision";
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import type { ProcessingJobContract } from "@/server/processing/types";
import { processingOutbox, sourceDocuments, sourceDocumentRevisions } from "@/persistence";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";
import { processingJobs } from "tests/helpers/processing-jobs";

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
      attemptNumber: 1,
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
  const config = { maxBatch: 3, maxAttempts: 5, cooldownSeconds: 60 };

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
    expect(row?.scheduleAttemptCount).toBe(1);
    expect(row?.lastScheduledAt).not.toBeNull();
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

    // The job should have been incrementally scheduled
    const db = getTestDb();
    const row = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(row!.scheduleAttemptCount).toBe(1);
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
        revisionNumber: 2,
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

  // ── New/updated tests for Task 3 ──

  it("returns job for execution on last allowed attempt (scheduleAttemptCount reaches maxAttempts)", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // Set scheduleAttemptCount to one below maxAttempts — this is the last schedulable attempt
    await setScheduleAttemptCount(job.id, config.maxAttempts - 1);
    await expireNextAvailable(job.id);

    const recoverable = await adapter.recoverBatch(ledgerId, config);

    // The job should be returned for execution (this is its last allowed attempt)
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0]!.id).toBe(job.id);

    // scheduleAttemptCount should now be maxAttempts
    const db = getTestDb();
    const row = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(row?.scheduleAttemptCount).toBe(config.maxAttempts);
    // Outbox should NOT be exhausted yet — exhaustion only on next request
    expect(row?.status).toBe("pending");
  });

  it("exhausts job on next request after scheduleAttemptCount reaches maxAttempts and cooldown expires", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // Simulate: the job has already been scheduled maxAttempts times
    await setScheduleAttemptCount(job.id, config.maxAttempts);
    await expireNextAvailable(job.id);

    // This request should exhaust the job (not schedule it)
    const recoverable = await adapter.recoverBatch(ledgerId, config);
    expect(recoverable).toHaveLength(0);

    // Outbox should be marked as failed
    const db = getTestDb();
    const outboxRow = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(outboxRow?.status).toBe("failed");
    expect(outboxRow?.completedAt).not.toBeNull();

    // Revision should be marked as failed
    const revisionRow = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, job.revisionId),
    });
    expect(revisionRow?.processingStatus).toBe("failed");
    expect(revisionRow?.failureCode).toBe("request_bound_retry_exhausted");

    // Diagnostics live on the same durable job.
    expect(outboxRow?.retryClassification).toBe("permanent");
    expect(outboxRow?.diagnosticCode).toBe("request_bound_retry_exhausted");
  });

  it("respects maxBatch independent of maxAttempts (returns at most maxBatch intents)", async () => {
    const smallConfig = { maxBatch: 2, maxAttempts: 5, cooldownSeconds: 60 };

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
      attemptNumber: 1,
    };
    const intent3: ProcessingJobContract = {
      id: crypto.randomUUID(),
      sourceDocumentId: pending3.document.id,
      revisionId: pending3.revision.id,
      requestedAt: "2026-07-15T00:00:00.000Z",
      attemptNumber: 1,
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
    const singleConfig = { maxBatch: 1, maxAttempts: 3, cooldownSeconds: 60 };
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    const recoverable = await adapter.recoverBatch(ledgerId, singleConfig);
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0]!.id).toBe(job.id);
  });

  it("exhaustion CAS: stale outbox closed but revision untouched when newer pending exists", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // Set up: scheduleAttemptCount at maxAttempts, but then change the document's
    // latestSubmissionRevisionId so the outbox's revision is no longer current
    await setScheduleAttemptCount(job.id, config.maxAttempts);

    // Create a newer pending revision
    const db = getTestDb();
    const newRevision = await db
      .insert(sourceDocumentRevisions)
      .values({
        ledgerId,
        sourceDocumentId: job.sourceDocumentId,
        revisionNumber: 2,
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

  it("exhaustion CAS: full exhaustion when revision is still current pending", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // The revision IS still the current pending — exhaustion should fully update
    await setScheduleAttemptCount(job.id, config.maxAttempts);
    await expireNextAvailable(job.id);
    await adapter.recoverBatch(ledgerId, config);

    const db = getTestDb();

    // Outbox should be failed
    const outboxRow = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(outboxRow?.status).toBe("failed");

    // Revision should be marked as failed
    const revisionRow = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, job.revisionId),
    });
    expect(revisionRow?.processingStatus).toBe("failed");
    expect(revisionRow?.failureCode).toBe("request_bound_retry_exhausted");

    // Diagnostics live on the same durable job.
    expect(outboxRow?.retryClassification).toBe("permanent");
  });

  it("exhaustion CAS: does not modify completed revision's outcome", async () => {
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

  it("does not select an job with scheduleAttemptCount >= maxAttempts for recovery", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // Set scheduleAttemptCount to maxAttempts (exceeds threshold for selectRecoverable)
    await setScheduleAttemptCount(job.id, config.maxAttempts);
    await expireNextAvailable(job.id);

    // The job should NOT be selected for recovery (scheduleAttemptCount >= maxAttempts)
    // Instead, it should be exhausted
    const recoverable = await adapter.recoverBatch(ledgerId, config);
    expect(recoverable).toHaveLength(0);

    // Outbox should be exhausted
    const db = getTestDb();
    const row = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(row?.status).toBe("failed");
  });

  it("exhaustion only happens after cooldown expires", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // Set scheduleAttemptCount to maxAttempts and force nextAvailableAt to the future
    const db = getTestDb();
    await db
      .update(processingOutbox)
      .set({
        scheduleAttemptCount: config.maxAttempts,
        nextAvailableAt: new Date("2099-01-01T00:00:00.000Z"),
      })
      .where(eq(processingOutbox.id, job.id));

    // The job should not be exhausted because cooldown hasn't expired
    const recoverable = await adapter.recoverBatch(ledgerId, config);
    expect(recoverable).toHaveLength(0);

    // Outbox should still be pending (not yet exhausted because nextAvailableAt > now)
    const row = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(row?.status).toBe("pending");
    expect(row?.scheduleAttemptCount).toBe(config.maxAttempts);

    // Now expire nextAvailableAt and try again — should exhaust
    await expireNextAvailable(job.id);
    const recoverable2 = await adapter.recoverBatch(ledgerId, config);
    expect(recoverable2).toHaveLength(0);

    const row2 = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(row2?.status).toBe("failed");
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

    const [document, oldRevision, oldOutbox, oldAttempt] = await Promise.all([
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, first.document.id) }),
      db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.id, first.revision.id),
      }),
      db.query.processingOutbox.findFirst({ where: eq(processingOutbox.id, first.job.id) }),
      db.query.processingOutbox.findFirst({
        where: and(
          eq(processingOutbox.revisionId, first.revision.id),
          eq(processingOutbox.attemptNumber, 1)
        ),
      }),
    ]);

    expect(document?.latestSubmissionRevisionId).toBe(second.revision.id);
    expect(oldRevision?.processingStatus).toBe("cancelled");
    expect(oldOutbox?.status).toBe("cancelled");
    expect(oldAttempt).toMatchObject({
      status: "cancelled",
      diagnosticCode: "superseded_by_retry",
    });
    await expect(
      processing.complete({
        jobId: first.job.id,
        claimToken: oldClaim!.claimToken,
        processingStatus: "completed",
      })
    ).resolves.toBe(false);
  });
});
