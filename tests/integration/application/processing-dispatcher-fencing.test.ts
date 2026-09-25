import { createPendingRevision } from "tests/helpers/processing-revision";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import type { ProcessingJobContract } from "@/server/processing/types";
import { ledgerEntries, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import { processingJobs, revisionProcessor } from "tests/helpers/processing-jobs";

vi.mock("@/lib/tasks/ai-context", () => ({
  createAIContext: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

describe("leased processor fencing", () => {
  async function reclaimedLease(job: ProcessingJobContract) {
    const db = getTestDb();
    const adapter = processingJobs();
    const first = await adapter.claim(job.revisionId);
    expect(first).not.toBeNull();
    // Expire the first claim and let a second worker reclaim the attempt.
    await db
      .update(sourceDocumentRevisions)
      .set({ claimExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sourceDocumentRevisions.id, job.revisionId));
    const second = await adapter.claim(job.revisionId);
    expect(second).not.toBeNull();
    return { adapter, firstToken: first!.claimToken, secondToken: second!.claimToken };
  }

  it("does not commit a projection after the worker lease is reclaimed", async () => {
    const db = getTestDb();
    const { ledgerId, job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());
    const { firstToken } = await reclaimedLease(job);

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
    const processor = revisionProcessor(() => ({ generate }));

    await expect(
      processor.process({
        signal: new AbortController().signal,
        ledgerId,
        sourceDocumentId: job.sourceDocumentId,
        revisionId: job.revisionId,
        lease: { revisionId: job.revisionId, claimToken: firstToken },
      })
    ).rejects.toThrow("Processing cancelled");

    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, job.revisionId),
    });
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, job.sourceDocumentId),
    });
    expect(revision?.processingStatus).toBe("processing");
    expect(document?.activeRevisionId).toBeNull();
    expect(document?.latestSubmissionRevisionId).toBe(job.revisionId);
    expect(document?.version).toBe(1);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("does not persist a terminal outcome after the worker lease is reclaimed", async () => {
    const db = getTestDb();
    const { ledgerId, job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());
    const { firstToken } = await reclaimedLease(job);

    const generate = vi.fn(async () => ({
      content: JSON.stringify({
        processingStatus: "invalid",
        invalid_reason: "Image too blurry",
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
        reasoning: "blurry image",
      }),
    }));
    const processor = revisionProcessor(() => ({ generate }));

    await expect(
      processor.process({
        signal: new AbortController().signal,
        ledgerId,
        sourceDocumentId: job.sourceDocumentId,
        revisionId: job.revisionId,
        lease: { revisionId: job.revisionId, claimToken: firstToken },
      })
    ).rejects.toThrow("Processing cancelled");

    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, job.revisionId),
    });
    const document = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, job.sourceDocumentId),
    });
    expect(revision?.processingStatus).toBe("processing");
    expect(revision?.failureMessage).toBeNull();
    expect(document?.version).toBe(1);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });
});
