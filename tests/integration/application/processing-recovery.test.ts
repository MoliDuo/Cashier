import { createPendingRevision } from "tests/helpers/processing-revision";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import type { ProcessingJobContract } from "@/server/processing/types";
import { sourceDocuments, sourceDocumentRevisions } from "@/persistence";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";
import { processingJobs } from "tests/helpers/processing-jobs";
import { BACKGROUND_MAX_ATTEMPTS } from "@/config/tuning";
import { AppError } from "@/lib/errors";
import { ProcessingFailure } from "@/modules/source-document/domain/parse/contracts";

vi.mock("@/lib/tasks/ai-context", () => ({
  createAIContext: vi.fn(),
}));
import { createAIContext } from "@/lib/tasks/ai-context";
import { executeProcessingJob } from "@/server/processing/execute-job";

/**
 * Creates a processing attempt for a single source document.
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
      sourceDocumentId: pending.document.id,
      revisionId: pending.revision.id,
      requestedAt,
    },
  };
}

async function setAttempt(
  revisionId: string,
  values: Partial<typeof sourceDocumentRevisions.$inferInsert>
) {
  await getTestDb()
    .update(sourceDocumentRevisions)
    .set(values)
    .where(eq(sourceDocumentRevisions.id, revisionId));
}

function findRevision(revisionId: string) {
  return getTestDb().query.sourceDocumentRevisions.findFirst({
    where: eq(sourceDocumentRevisions.id, revisionId),
  });
}

async function supersede(ledgerId: string, job: ProcessingJobContract) {
  const db = getTestDb();
  // A retry cancels the attempt it replaces; one document processes one attempt at a time.
  await setAttempt(job.revisionId, { processingStatus: "cancelled", finishedAt: new Date() });
  const newRevision = await db
    .insert(sourceDocumentRevisions)
    .values({
      ledgerId,
      sourceDocumentId: job.sourceDocumentId,
      processingStatus: "processing",
    })
    .returning()
    .then((rows) => rows[0]);
  await db
    .update(sourceDocuments)
    .set({ latestSubmissionRevisionId: newRevision!.id })
    .where(eq(sourceDocuments.id, job.sourceDocumentId));
  return newRevision!;
}

describe("Processing Recovery", () => {
  const maxBatch = 3;

  it("recovers an attempt that was submitted but never claimed (missed after())", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();

    const recoverable = await adapter.recoverBatch(ledgerId, maxBatch);

    expect(recoverable.map((candidate) => candidate.revisionId)).toEqual([job.revisionId]);
    // Recovery only reads; a run counts the attempt when it claims it.
    const row = await findRevision(job.revisionId);
    expect(row?.attemptCount).toBe(0);
    expect(row?.claimToken).toBeNull();
  });

  it("re-selects an attempt with an expired claim", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await setAttempt(job.revisionId, {
      claimToken: "stale-token",
      claimExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    const recoverable = await adapter.recoverBatch(ledgerId, maxBatch);

    expect(recoverable.map((candidate) => candidate.revisionId)).toEqual([job.revisionId]);
  });

  it("leaves an attempt alone while its claim is live", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await expect(adapter.claim(job.revisionId)).resolves.not.toBeNull();

    await expect(adapter.recoverBatch(ledgerId, maxBatch)).resolves.toHaveLength(0);
    await expect(adapter.claim(job.revisionId)).resolves.toBeNull();
  });

  it("does not double-process under concurrent requests", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();

    // Two requests may both schedule the attempt; only one run can claim it.
    const [first, second] = await Promise.all([
      adapter.recoverBatch(ledgerId, maxBatch),
      adapter.recoverBatch(ledgerId, maxBatch),
    ]);
    expect([...first, ...second].map((candidate) => candidate.revisionId)).toEqual([
      job.revisionId,
      job.revisionId,
    ]);
    const claims = await Promise.all([
      adapter.claim(job.revisionId),
      adapter.claim(job.revisionId),
    ]);

    expect(claims.filter((claim) => claim != null)).toHaveLength(1);
    expect((await findRevision(job.revisionId))!.attemptCount).toBe(1);
    await expect(adapter.recoverBatch(ledgerId, maxBatch)).resolves.toHaveLength(0);
  });

  it("skips recovery when the source document has been deleted", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();

    const db = getTestDb();
    await db.delete(sourceDocuments).where(eq(sourceDocuments.id, job.sourceDocumentId));

    const recoverable = await adapter.recoverBatch(ledgerId, maxBatch);
    expect(recoverable).toHaveLength(0);
  });

  it("recovers only the attempt that replaced an earlier one", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    const newRevision = await supersede(ledgerId, job);

    const recoverable = await adapter.recoverBatch(ledgerId, maxBatch);
    expect(recoverable.map((candidate) => candidate.revisionId)).toEqual([newRevision.id]);
    await expect(adapter.claim(job.revisionId)).resolves.toBeNull();
    const oldRevision = await findRevision(job.revisionId);
    expect(oldRevision?.processingStatus).toBe("cancelled");
    expect(oldRevision?.failureCode).toBeNull();
  });

  it("skips an attempt that already finished", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await setAttempt(job.revisionId, { processingStatus: "completed", finishedAt: new Date() });

    await expect(adapter.recoverBatch(ledgerId, maxBatch)).resolves.toHaveLength(0);
    await expect(adapter.claim(job.revisionId)).resolves.toBeNull();
    expect((await findRevision(job.revisionId))?.processingStatus).toBe("completed");
  });

  it("does not recover intents from other ledgers", async () => {
    await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());
    const { ledgerId: ledgerB, job: intentB } = await pendingIntent(
      "2026-07-15T00:00:00.000Z",
      crypto.randomUUID()
    );

    const adapter = processingJobs();
    const recoverable = await adapter.recoverBatch(ledgerB, maxBatch);
    expect(recoverable.map((candidate) => candidate.revisionId)).toEqual([intentB.revisionId]);
  });

  it("counts an attempt each time a run claims the job, not when it is scheduled", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();

    await adapter.recoverBatch(ledgerId, maxBatch);
    await expect(adapter.claim(job.revisionId)).resolves.toMatchObject({ attempt: 1 });
    await adapter.expireLease(job.revisionId);
    await expect(adapter.claim(job.revisionId)).resolves.toMatchObject({ attempt: 2 });
  });

  it("does not hand out an attempt before its retry is due", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await setAttempt(job.revisionId, { nextAvailableAt: new Date(Date.now() + 60_000) });

    await expect(adapter.recoverBatch(ledgerId, maxBatch)).resolves.toHaveLength(0);
    await expect(adapter.claim(job.revisionId)).resolves.toBeNull();
  });

  it("fails an exhausted job under its lease when a run claims it", async () => {
    const { ledgerId, job } = await pendingIntent();
    const adapter = processingJobs();
    await setAttempt(job.revisionId, { attemptCount: BACKGROUND_MAX_ATTEMPTS });
    const db = getTestDb();
    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, job.sourceDocumentId),
    });

    // Recovery still schedules it; the claim is where exhaustion is decided.
    await expect(adapter.recoverBatch(ledgerId, maxBatch)).resolves.toHaveLength(1);
    await expect(executeProcessingJob(job)).resolves.toBe(true);

    expect(createAIContext).not.toHaveBeenCalled();
    await expect(findRevision(job.revisionId)).resolves.toMatchObject({
      processingStatus: "failed",
      failureCode: "request_bound_retry_exhausted",
      attemptCount: BACKGROUND_MAX_ATTEMPTS + 1,
      claimToken: null,
    });
    // A failure writes nothing a whole save could, so the version stays put.
    await expect(
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, job.sourceDocumentId) })
    ).resolves.toMatchObject({ version: before!.version });
  });

  it("gives a transiently failed attempt back to the queue with a backoff", async () => {
    const { ledgerId, job } = await pendingIntent();
    const rateLimited = new AppError("limited", "ai_rate_limited", 503, { retryAfterMs: 5_000 });
    vi.mocked(createAIContext).mockReturnValue({
      generate: vi.fn().mockRejectedValue(rateLimited),
    } as never);

    await expect(executeProcessingJob(job)).resolves.toBe(true);

    const row = await findRevision(job.revisionId);
    expect(row).toMatchObject({
      processingStatus: "processing",
      failureCode: null,
      attemptCount: 1,
      claimToken: null,
    });
    // The provider asked for 5s, longer than the first backoff of 2s.
    expect(row!.nextAvailableAt.getTime()).toBeGreaterThan(Date.now() + 3_000);
    await expect(processingJobs().recoverBatch(ledgerId, maxBatch)).resolves.toHaveLength(0);
  });

  it("fails a transient failure on its last attempt with the provider's code", async () => {
    const { job } = await pendingIntent();
    await setAttempt(job.revisionId, { attemptCount: BACKGROUND_MAX_ATTEMPTS - 1 });
    vi.mocked(createAIContext).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new AppError("down", "ai_provider_unavailable", 503)),
    } as never);

    await executeProcessingJob(job);

    await expect(findRevision(job.revisionId)).resolves.toMatchObject({
      processingStatus: "failed",
      failureCode: "ai_provider_unavailable",
      attemptCount: BACKGROUND_MAX_ATTEMPTS,
    });
  });

  it("fails at once when the provider configuration is invalid", async () => {
    const { job } = await pendingIntent();
    const invalid = new AppError("bad key", "ai_configuration_invalid", 500);
    vi.mocked(createAIContext).mockReturnValue({
      generate: vi
        .fn()
        .mockRejectedValue(
          new ProcessingFailure("ai_provider_unavailable", "wrapped", { cause: invalid })
        ),
    } as never);

    await executeProcessingJob(job);

    await expect(findRevision(job.revisionId)).resolves.toMatchObject({
      processingStatus: "failed",
      failureCode: "ai_provider_unavailable",
      attemptCount: 1,
    });
  });

  it("returns at most maxBatch intents", async () => {
    const { ledgerId } = await pendingIntent();
    const bookId = await testBookId(getTestDb(), ledgerId);
    await createPendingRevision({
      ledgerId,
      input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
      bookId,
    });
    await createPendingRevision({
      ledgerId,
      input: { text: "Coffee 5.00 CNY", storedFileIds: [], documentDate: null },
      bookId,
    });

    const recoverable = await processingJobs().recoverBatch(ledgerId, 2);

    // maxBatch=2 limits the result even though 3 intents are eligible
    expect(recoverable).toHaveLength(2);
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
    const oldClaim = await processing.claim(first.job.revisionId);
    expect(oldClaim).not.toBeNull();

    const second = await submitSourceDocument({
      ledgerId,
      sourceDocumentId: first.document.id,
      inheritInput: true,
      supersedeProcessing: true,
      bookId: await testBookId(db, ledgerId),
    });

    const [document, oldRevision] = await Promise.all([
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, first.document.id) }),
      db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.id, first.revision.id),
      }),
    ]);

    expect(document?.latestSubmissionRevisionId).toBe(second.revision.id);
    expect(oldRevision?.processingStatus).toBe("cancelled");
    await expect(processing.renew(first.job.revisionId, oldClaim!.claimToken)).resolves.toBeNull();
  });
});
