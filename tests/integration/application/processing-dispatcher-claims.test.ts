import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger } from "../../helpers/schema-setup";
import {
  PostgresProcessingJobAdapter,
  postgresRevisionAdapter,
} from "@/application/adapters/postgres";
import { serverComposition } from "@/application/server-composition-root";
import type { ProcessingJobContract } from "@/application/contracts";
import {
  ledgerEntries,
  ledgers,
  processingAttempts,
  processingOutbox,
  currencyRates,
} from "@/persistence";

vi.mock("@/lib/tasks/ai-context", () => ({
  createAIContext: vi.fn(),
}));
import { createAIContext } from "@/lib/tasks/ai-context";

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
  const pending = await postgresRevisionAdapter.createProcessingRevision({
    ledgerId,
    input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
    attributedUserId: userId,
    createdByUserId: userId,
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

describe("PostgresProcessingJobAdapter", () => {
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
    const processor = serverComposition.createRevisionProcessor(() => ({ generate }));

    await expect(
      processor.process({
        ledgerId,
        sourceDocumentId: job.sourceDocumentId,
        revisionId: job.revisionId,
      })
    ).resolves.toEqual({ processingStatus: "completed", completion: "atomic" });
    await expect(
      processor.process({
        ledgerId,
        sourceDocumentId: job.sourceDocumentId,
        revisionId: job.revisionId,
      })
    ).resolves.toEqual({ processingStatus: "completed", completion: "residual" });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
    await expect(
      postgresRevisionAdapter.get(ledgerId, job.sourceDocumentId)
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

    const processor = serverComposition.createRevisionProcessor(() => ({ generate }));

    await processor.process({
      ledgerId,
      sourceDocumentId: job.sourceDocumentId,
      revisionId: job.revisionId,
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

    const processor1 = serverComposition.createRevisionProcessor(() => ({ generate: generate1 }));

    await processor1.process({
      ledgerId,
      sourceDocumentId: job.sourceDocumentId,
      revisionId: job.revisionId,
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
    const [ledgerOwner] = await db
      .select({ userId: ledgers.userId })
      .from(ledgers)
      .where(eq(ledgers.id, ledgerId));
    const pending2 = await postgresRevisionAdapter.createProcessingRevision({
      ledgerId,
      input: { text: "Dinner 25.00 USD", storedFileIds: [], documentDate: null },
      attributedUserId: ledgerOwner!.userId,
      createdByUserId: ledgerOwner!.userId,
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

    const processor2 = serverComposition.createRevisionProcessor(() => ({ generate: generate2 }));

    await processor2.process({
      ledgerId,
      sourceDocumentId: pending2.document.id,
      revisionId: pending2.revision.id,
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
    const adapter = new PostgresProcessingJobAdapter();

    await Promise.all([adapter.dispatch(job), adapter.dispatch(job)]);
    const claims = await Promise.all([adapter.claim(job.id), adapter.claim(job.id)]);

    expect(claims.filter((claim) => claim != null)).toHaveLength(1);
    expect(claims.find((claim) => claim != null)?.ledgerId).toBeDefined();
    expect(await db.select().from(processingOutbox)).toHaveLength(1);
    expect(await db.select().from(processingAttempts)).toHaveLength(1);
  });

  it("reclaims an expired lease and rejects stale completion", async () => {
    let now = new Date("2026-07-15T00:00:00.000Z");
    const { job } = await pendingIntent(now.toISOString(), crypto.randomUUID());
    const adapter = new PostgresProcessingJobAdapter({ leaseMs: 1_000, now: () => now });
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

  it("returns false on duplicate claim", async () => {
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());
    const adapter = new PostgresProcessingJobAdapter();
    await adapter.dispatch(job);

    // First claim succeeds
    const first = await adapter.claim(job.id);
    expect(first).not.toBeNull();

    // Second claim (same adapter, same DB) returns null since job is claimed
    const second = await adapter.claim(job.id);
    expect(second).toBeNull();
  });

  it("records failed outcome on processing error via executeSingleProcessingJob", async () => {
    const db = getTestDb();
    const { job } = await pendingIntent("2026-07-15T00:00:00.000Z", crypto.randomUUID());

    const generate = vi.fn().mockRejectedValue(new Error("AI service unavailable"));
    vi.mocked(createAIContext).mockReturnValue({ generate });

    const adapter = new PostgresProcessingJobAdapter();
    await adapter.dispatch(job);

    const result = await serverComposition.executeSingleProcessingJob(job);
    expect(result).toBe(true);

    const row = await db.query.processingOutbox.findFirst({
      where: eq(processingOutbox.id, job.id),
    });
    expect(row?.status).toBe("failed");
  });
});
