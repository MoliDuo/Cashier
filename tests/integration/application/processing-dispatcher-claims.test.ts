import { claimRevisionForTest } from "tests/helpers/processing-revision";
import { createPendingRevision } from "tests/helpers/processing-revision";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import type { ProcessingJobContract } from "@/application/contracts";
import {
  ledgerEntries,
  ledgers,
  processingOutbox,
  currencyRates,
  sourceDocuments,
} from "@/persistence";

vi.mock("@/lib/tasks/ai-context", () => ({
  createAIContext: vi.fn(),
}));
import { createAIContext } from "@/lib/tasks/ai-context";
import { processingJobs, revisionProcessor } from "tests/helpers/processing-jobs";
import { executeProcessingJob } from "@/server/processing/execute-job";

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
      id: crypto.randomUUID(),
      sourceDocumentId: pending.document.id,
      revisionId: pending.revision.id,
      requestedAt,
      attemptNumber: 1,
    },
  };
}

describe("processing outbox jobs", () => {
  it("processes parser, reconciliation, exchange-rate facts, and result writes by revision identity", async () => {
    const db = getTestDb();
    const { ledgerId, job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());
    const generate = vi.fn(async () => ({
      content: JSON.stringify({
        outcome: "success",
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
    const lease = await claimRevisionForTest(job.revisionId);

    await expect(
      processor.process({
        ledgerId,
        sourceDocumentId: job.sourceDocumentId,
        revisionId: job.revisionId,
        lease,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({ processingStatus: "completed", completion: "atomic" });
    await expect(
      processor.process({
        ledgerId,
        sourceDocumentId: job.sourceDocumentId,
        revisionId: job.revisionId,
        lease,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({ processingStatus: "completed", completion: "residual" });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
    await expect(
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, job.sourceDocumentId) })
    ).resolves.toMatchObject({
      activeRevisionId: job.revisionId,
      latestSubmissionRevisionId: job.revisionId,
    });
  });

  it("processes with custom ledger prompt in AI generation request", async () => {
    const db = getTestDb();
    const { ledgerId, job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());

    // Update typed ledger settings with a custom prompt.
    const customPrompt = "Please categorize expenses as food or transport";
    await db
      .update(ledgers)
      .set({
        aiCustomPrompt: customPrompt,
        aiLanguage: "en",
        preferredCurrencies: ["CNY", "USD"],
      })
      .where(eq(ledgers.id, ledgerId));

    const generate = vi.fn(async () => ({
      content: JSON.stringify({
        outcome: "success",
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
    const lease = await claimRevisionForTest(job.revisionId);

    await processor.process({
      ledgerId,
      sourceDocumentId: job.sourceDocumentId,
      revisionId: job.revisionId,
      lease,
      signal: new AbortController().signal,
    });

    // Verify the custom prompt reaches the AI call
    expect(generate).toHaveBeenCalled();
    const callArgs = (generate.mock.calls as unknown[][]).reduce(
      (acc, call) => acc + JSON.stringify(call),
      ""
    );
    expect(callArgs).toContain(customPrompt);
  });

  it("retried revision uses current ledger settings", async () => {
    const db = getTestDb();
    await db.insert(currencyRates).values({
      date: new Date().toISOString().slice(0, 10),
      base: "EUR",
      rates: { EUR: 1, CNY: 8, USD: 1.2 },
    });
    const { ledgerId, job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());

    // Process once without custom prompt (successful first parse)
    const generate1 = vi.fn(async () => ({
      content: JSON.stringify({
        outcome: "success",
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

    const processor1 = revisionProcessor(() => ({ generate: generate1 }));

    await processor1.process({
      ledgerId,
      sourceDocumentId: job.sourceDocumentId,
      revisionId: job.revisionId,
      lease: await claimRevisionForTest(job.revisionId),
      signal: new AbortController().signal,
    });

    // Update typed settings after the first parse.
    const customPrompt = "Please focus on categorizing dining expenses";
    await db
      .update(ledgers)
      .set({
        aiCustomPrompt: customPrompt,
        aiLanguage: "en",
        preferredCurrencies: ["CNY", "USD"],
      })
      .where(eq(ledgers.id, ledgerId));

    // Create a second revision (retry) after the settings change
    const bookId = await testBookId(db, ledgerId);
    const pending2 = await createPendingRevision({
      ledgerId,
      input: { text: "Dinner 25.00 USD", storedFileIds: [], documentDate: null },
      bookId,
    });

    const generate2 = vi.fn(async () => ({
      content: JSON.stringify({
        outcome: "success",
        invalid_reason: null,
        title: "Dinner",
        receipt_count: 1,
        receipt_totals: [{ receipt_index: 0, amount: "25.00", currency: "USD" }],
        ledger_entries: [
          {
            receipt_index: 0,
            item_name: "Dinner",
            amount: "25.00",
            currency: "USD",
            category_index: 0,
            notes: null,
          },
        ],
        order_adjustments: [],
        reasoning: "single item",
      }),
    }));

    const processor2 = revisionProcessor(() => ({ generate: generate2 }));

    await processor2.process({
      ledgerId,
      sourceDocumentId: pending2.document.id,
      revisionId: pending2.revision.id,
      lease: await claimRevisionForTest(pending2.revision.id),
      signal: new AbortController().signal,
    });

    // Verify the new AI call used the updated custom prompt
    expect(generate2).toHaveBeenCalled();
    const callArgs = (generate2.mock.calls as unknown[][]).reduce(
      (acc, call) => acc + JSON.stringify(call),
      ""
    );
    expect(callArgs).toContain(customPrompt);
  });

  it("deduplicates dispatch and permits only one concurrent claim", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());
    const adapter = processingJobs();

    await Promise.all([adapter.dispatch(job), adapter.dispatch(job)]);
    const claims = await Promise.all([adapter.claim(job.id), adapter.claim(job.id)]);

    expect(claims.filter((claim) => claim != null)).toHaveLength(1);
    expect(claims.find((claim) => claim != null)?.ledgerId).toBeDefined();
    expect(await db.select().from(processingOutbox)).toHaveLength(1);
    expect(await db.select().from(processingOutbox)).toHaveLength(1);
  });

  it("reclaims an expired lease and rejects stale completion", async () => {
    let now = new Date("2026-07-15T00:00:00.000Z");
    const { job } = await pendingIntent(now.toISOString(), crypto.randomUUID());
    const adapter = processingJobs({ leaseMs: 1_000, now: () => now });
    await adapter.dispatch(job);

    const first = await adapter.claim(job.id);
    expect(first).not.toBeNull();
    now = new Date(now.getTime() + 500);
    const renewedUntil = await adapter.renew(job.id, first!.claimToken);
    expect(renewedUntil).toBe(new Date(now.getTime() + 1_000).toISOString());
    now = new Date(now.getTime() + 1_001);
    const second = await adapter.claim(job.id);
    expect(second).not.toBeNull();
    expect(second!.claimToken).not.toBe(first!.claimToken);

    await expect(
      adapter.complete({
        jobId: job.id,
        claimToken: first!.claimToken,
        processingStatus: "completed",
      })
    ).resolves.toBe(false);
    await expect(
      adapter.complete({
        jobId: job.id,
        claimToken: second!.claimToken,
        processingStatus: "failed",
      })
    ).resolves.toBe(true);
  });

  it("accepts a completion once and treats a repeated completion as a no-op", async () => {
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());
    const adapter = processingJobs();
    await adapter.dispatch(job);
    const claim = await adapter.claim(job.id);
    expect(claim).not.toBeNull();

    const complete = () =>
      adapter.complete({
        jobId: job.id,
        claimToken: claim!.claimToken,
        processingStatus: "completed",
      });
    await expect(complete()).resolves.toBe(true);
    await expect(complete()).resolves.toBe(false);
  });

  it("returns false on duplicate claim", async () => {
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());
    const adapter = processingJobs();
    await adapter.dispatch(job);

    // First claim succeeds
    const first = await adapter.claim(job.id);
    expect(first).not.toBeNull();

    // Second claim (same adapter, same DB) returns null since job is claimed
    const second = await adapter.claim(job.id);
    expect(second).toBeNull();
  });

  it("records failed outcome on processing error via executeProcessingJob", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());

    const generate = vi.fn().mockRejectedValue(new Error("AI service unavailable"));
    vi.mocked(createAIContext).mockReturnValue({ generate });

    const adapter = processingJobs();
    await adapter.dispatch(job);

    const result = await executeProcessingJob(job);
    expect(result).toBe(true);

    const row = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(row?.status).toBe("failed");
  });
});
