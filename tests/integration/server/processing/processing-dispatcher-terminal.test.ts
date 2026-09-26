import { createPendingRevision } from "tests/helpers/processing-revision";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { executeProcessingJob } from "@/server/processing/execute-job";
import { renewProcessingJobLease } from "@/server/processing/jobs";
import type { ProcessingJobContract } from "@/server/processing/types";
import { ledgerEntries, sourceDocumentRevisions, sourceDocuments } from "@/persistence";

vi.mock("@/lib/tasks/ai-context", () => ({
  createAIContext: vi.fn(),
}));
vi.mock("@/server/processing/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/processing/jobs")>();
  return { ...actual, renewProcessingJobLease: vi.fn(actual.renewProcessingJobLease) };
});
import { createAIContext } from "@/lib/tasks/ai-context";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(renewProcessingJobLease).mockReset();
});

/**
 * Creates a pending revision + job for a single source document.
 * Each call uses a fresh user+ledger pair to avoid unique-constraint collisions
 * when called multiple times within one test.
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

describe("executeProcessingJob — standalone function with real adapter/processor", () => {
  it.each([
    ["returns null", "null"],
    ["throws", "throw"],
  ] as const)("aborts the worker when lease renewal %s", async (_label, mode) => {
    vi.useFakeTimers();
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());

    let releaseGeneration!: (value: { content: string }) => void;
    let markGenerationStarted!: () => void;
    const generationStarted = new Promise<void>((resolve) => {
      markGenerationStarted = resolve;
    });
    const generation = new Promise<{ content: string }>((resolve) => {
      releaseGeneration = resolve;
    });
    const generate = vi.fn(() => {
      markGenerationStarted();
      return generation;
    });
    let processingSignal: AbortSignal | undefined;
    vi.mocked(createAIContext).mockImplementation(({ signal }) => {
      processingSignal = signal;
      return { generate };
    });

    const renew = vi.mocked(renewProcessingJobLease).mockImplementation(async () => {
      if (mode === "null") return null;
      throw new Error("lease backend unavailable");
    });
    const execution = executeProcessingJob(job);
    await generationStarted;
    await vi.advanceTimersByTimeAsync(15_000);

    expect(renew).toHaveBeenCalledTimes(1);
    expect(processingSignal?.aborted).toBe(true);

    releaseGeneration({
      content: JSON.stringify({
        processingStatus: "success",
        invalid_reason: null,
        title: "Lunch",
        receipt_count: 1,
        receipt_totals: [{ receipt_index: 0, amount: "12.50", currency: "CNY" }],
        ledger_entries: [
          {
            receipt_index: 0,
            item_name: "Lunch",
            amount: "12.50",
            currency: "CNY",
            category_index: 0,
            notes: null,
          },
        ],
        order_adjustments: [],
        reasoning: "single item",
      }),
    });

    await expect(execution).resolves.toBe(true);
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, job.sourceDocumentId),
    });
    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, job.revisionId),
    });
    expect(document?.latestSubmissionRevisionId).toBe(job.revisionId);
    expect(revision?.processingStatus).toBe("processing");
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("processes successfully, completing the revision and releasing its claim", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());

    const generate = vi.fn(async () => ({
      content: JSON.stringify({
        processingStatus: "success",
        invalid_reason: null,
        title: "Lunch",
        receipt_count: 1,
        receipt_totals: [{ receipt_index: 0, amount: "12.50", currency: "CNY" }],
        ledger_entries: [
          {
            receipt_index: 0,
            item_name: "Lunch",
            amount: "12.50",
            currency: "CNY",
            category_index: 0,
            notes: null,
          },
        ],
        order_adjustments: [],
        reasoning: "single item",
      }),
    }));
    vi.mocked(createAIContext).mockReturnValue({ generate });

    const result = await executeProcessingJob(job);
    expect(result).toBe(true);

    const doc = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, job.sourceDocumentId),
    });
    expect(doc?.latestSubmissionRevisionId).toBe(job.revisionId);
    expect(doc?.version).toBe(2);

    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, job.revisionId),
    });
    expect(revision).toMatchObject({
      processingStatus: "completed",
      attemptCount: 1,
      claimToken: null,
      claimExpiresAt: null,
    });

    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it("does not run a job whose revision was superseded", async () => {
    const db = getTestDb();
    const { ledgerId, job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());

    const generate = vi.fn().mockRejectedValue(new Error("AI service unavailable"));
    vi.mocked(createAIContext).mockReturnValue({ generate });

    // Simulate a retry: it cancels the attempt it replaces and points the
    // document at the new one.
    await db
      .update(sourceDocumentRevisions)
      .set({ processingStatus: "cancelled", finishedAt: new Date() })
      .where(eq(sourceDocumentRevisions.id, job.revisionId));
    const newRevisionId = crypto.randomUUID();
    await db.insert(sourceDocumentRevisions).values({
      id: newRevisionId,
      ledgerId,
      sourceDocumentId: job.sourceDocumentId,
      processingStatus: "processing",
    });
    await db
      .update(sourceDocuments)
      .set({ latestSubmissionRevisionId: newRevisionId })
      .where(eq(sourceDocuments.id, job.sourceDocumentId));

    const result = await executeProcessingJob(job);
    expect(result).toBe(false);
    expect(generate).not.toHaveBeenCalled();

    // The claim refuses the superseded revision without counting a run.
    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, job.revisionId),
    });
    expect(revision).toMatchObject({
      processingStatus: "cancelled",
      attemptCount: 0,
      claimToken: null,
    });

    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });
});
