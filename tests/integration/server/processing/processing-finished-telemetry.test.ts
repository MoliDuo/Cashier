import { createPendingAttempt } from "tests/helpers/processing-attempt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { executeProcessingJob } from "@/server/processing/execute-job";
import { AppError } from "@/lib/errors";
import type { ProcessingJobContract } from "@/server/processing/types";

const { sendServerEventMock } = vi.hoisted(() => ({ sendServerEventMock: vi.fn() }));

vi.mock("@/lib/telemetry/server", () => ({ sendServerEvent: sendServerEventMock }));
vi.mock("@/lib/tasks/ai-context", () => ({ createAIContext: vi.fn() }));
import { createAIContext } from "@/lib/tasks/ai-context";

const CORRELATION_ID = "6c411660-27ff-4712-ae1d-6eba4ae19c48";

async function pendingJob(correlationId?: string): Promise<ProcessingJobContract> {
  const db = getTestDb();
  await createTestUserWithLedger(db, undefined, undefined, crypto.randomUUID());
  const pending = await createPendingAttempt({
    input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
    bookId: await testBookId(db),
  });
  return {
    sourceDocumentId: pending.document.id,
    attemptId: pending.attempt.id,
    requestedAt: new Date(Date.now() - 1500).toISOString(),
    ...(correlationId == null ? {} : { correlationId }),
  };
}

const parsedLunch = {
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
};

describe("processing.finished telemetry", () => {
  beforeEach(() => {
    sendServerEventMock.mockReset();
    vi.mocked(createAIContext).mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("reports a completed attempt with the browser's correlation id and no record content", async () => {
    const job = await pendingJob(CORRELATION_ID);
    vi.mocked(createAIContext).mockReturnValue({
      generate: vi.fn(async () => ({ content: JSON.stringify(parsedLunch) })),
    });

    await expect(executeProcessingJob(job)).resolves.toBe(true);

    expect(sendServerEventMock).toHaveBeenCalledTimes(1);
    const [name, props, correlationId] = sendServerEventMock.mock.calls[0]!;
    expect(name).toBe("processing.finished");
    expect(correlationId).toBe(CORRELATION_ID);
    expect(props).toMatchObject({ outcome: "completed", runs: 1 });
    expect(props.ms).toBeGreaterThanOrEqual(1500);
    expect(props).not.toHaveProperty("errorKind");
    expect(JSON.stringify(sendServerEventMock.mock.calls)).not.toMatch(/Lunch|12\.50/);
  });

  it("reports a job queued without a correlation id as such, e.g. one from recovery", async () => {
    const job = await pendingJob();
    vi.mocked(createAIContext).mockReturnValue({
      generate: vi.fn(async () => ({ content: JSON.stringify(parsedLunch) })),
    });

    await executeProcessingJob(job);

    expect(sendServerEventMock).toHaveBeenCalledTimes(1);
    expect(sendServerEventMock.mock.calls[0]![2]).toBeUndefined();
  });

  it("reports an attempt the model could not read as failed, with a code and not the reason", async () => {
    const job = await pendingJob(CORRELATION_ID);
    vi.mocked(createAIContext).mockReturnValue({
      generate: vi.fn(async () => ({
        content: JSON.stringify({
          ...parsedLunch,
          outcome: "invalid",
          invalid_reason: "this is a private grocery list",
          ledger_entries: [],
          receipt_totals: [],
          receipt_count: 0,
        }),
      })),
    });

    await executeProcessingJob(job);

    expect(sendServerEventMock).toHaveBeenCalledTimes(1);
    expect(sendServerEventMock.mock.calls[0]![1]).toMatchObject({
      outcome: "failed",
      errorKind: "invalid_input",
    });
    expect(JSON.stringify(sendServerEventMock.mock.calls)).not.toContain("grocery");
  });

  it("reports nothing while a transient failure is waiting to be retried", async () => {
    const job = await pendingJob(CORRELATION_ID);
    vi.mocked(createAIContext).mockReturnValue({
      generate: vi.fn().mockRejectedValue(new AppError("timeout", "ai_timeout", 504)),
    });

    await executeProcessingJob(job);

    expect(sendServerEventMock).not.toHaveBeenCalled();
  });

  it("reports nothing for a job another execution holds or a superseded attempt", async () => {
    const job = await pendingJob(CORRELATION_ID);
    vi.mocked(createAIContext).mockReturnValue({
      generate: vi.fn(async () => ({ content: JSON.stringify(parsedLunch) })),
    });
    await executeProcessingJob(job);
    sendServerEventMock.mockClear();

    // The attempt is finished: a second execution finds nothing to claim.
    await expect(executeProcessingJob(job)).resolves.toBe(false);

    expect(sendServerEventMock).not.toHaveBeenCalled();
  });
});
