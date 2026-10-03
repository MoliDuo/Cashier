import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestLedger, testBookId } from "tests/helpers/schema-setup";
import { createPendingAttempt } from "tests/helpers/processing-attempt";
import { extractionAttempts } from "@/persistence";
import { AppError } from "@/lib/errors";
import { createBackgroundWorker } from "@/server/background/worker";
import { requestBackgroundWork } from "@/server/background/wake";

vi.mock("@/lib/tasks/ai-context", () => ({ createAIContext: vi.fn() }));
import { createAIContext } from "@/lib/tasks/ai-context";

const workers: Array<ReturnType<typeof createBackgroundWorker>> = [];

function worker(pollIntervalMs = 60_000) {
  const created = createBackgroundWorker({ pollIntervalMs });
  workers.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map((created) => created.stop({ graceMs: 100 })));
  vi.restoreAllMocks();
});

async function pendingAttempt() {
  const db = getTestDb();
  await createTestLedger(db);
  const pending = await createPendingAttempt({
    input: { text: "Lunch 12.50 CNY", storedFileIds: [], documentDate: null },
    bookId: await testBookId(db),
  });
  return pending.attempt.id;
}

function findAttempt(attemptId: string) {
  return getTestDb().query.extractionAttempts.findFirst({
    where: eq(extractionAttempts.id, attemptId),
  });
}

/** A model call that never settles on its own and rejects when the run is aborted. */
function hangingModel() {
  const started = Promise.withResolvers<void>();
  vi.mocked(createAIContext).mockImplementation(({ signal }) => ({
    generate: () => {
      started.resolve();
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  }));
  return started.promise;
}

function failingModel() {
  const generate = vi.fn(async () => {
    throw new AppError("bad output", "ai_schema_invalid", 502);
  });
  vi.mocked(createAIContext).mockReturnValue({ generate });
  return generate;
}

describe("background worker", () => {
  it("runs the work that is due and reports how much", async () => {
    const attemptId = await pendingAttempt();
    failingModel();

    await expect(worker().drain()).resolves.toBe(1);

    const attempt = await findAttempt(attemptId);
    expect(attempt?.status).toBe("failed");
    expect(attempt?.claimToken).toBeNull();
    await expect(worker().runOnce()).resolves.toBe(0);
  });

  it("wakes at once when work is requested, without waiting for the poll", async () => {
    const running = worker(60_000);
    failingModel();
    running.start();
    // Let both lanes find nothing and go to sleep.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const attemptId = await pendingAttempt();
    requestBackgroundWork();

    await vi.waitFor(async () => expect((await findAttempt(attemptId))?.status).toBe("failed"));
  });

  it("finds work nobody announced on its next poll", async () => {
    const attemptId = await pendingAttempt();
    failingModel();

    worker(20).start();

    await vi.waitFor(async () => expect((await findAttempt(attemptId))?.status).toBe("failed"));
  });

  it("hands the attempt back uncounted when stopped mid-run", async () => {
    const attemptId = await pendingAttempt();
    const started = hangingModel();
    const running = worker();
    running.start();
    requestBackgroundWork();
    await started;
    expect((await findAttempt(attemptId))?.attemptCount).toBe(1);

    await running.stop({ graceMs: 50 });

    const attempt = await findAttempt(attemptId);
    expect(attempt).toMatchObject({ status: "processing", claimToken: null, attemptCount: 0 });
  });

  it("lets two workers share a queue without running anything twice", async () => {
    await pendingAttempt();
    await pendingAttempt();
    await pendingAttempt();
    const generate = failingModel();

    const ran = await Promise.all([worker().drain(), worker().drain()]);

    expect(ran[0]! + ran[1]!).toBe(3);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("picks up an attempt whose earlier holder died with its lease expired", async () => {
    const attemptId = await pendingAttempt();
    await getTestDb()
      .update(extractionAttempts)
      .set({
        claimToken: crypto.randomUUID(),
        claimExpiresAt: new Date("2020-01-01T00:00:00.000Z"),
        attemptCount: 1,
      })
      .where(eq(extractionAttempts.id, attemptId));
    failingModel();

    await worker().drain();

    expect((await findAttempt(attemptId))?.status).toBe("failed");
  });
});
