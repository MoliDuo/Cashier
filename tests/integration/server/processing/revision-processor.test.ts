import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { createPendingRevision, claimRevisionForTest } from "tests/helpers/processing-revision";
import { revisionProcessor } from "tests/helpers/processing-jobs";
import { ledgerEntries, ledgers, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import * as exchangeRates from "@/modules/currency/server/exchange-rates";

vi.mock("@/lib/tasks/ai-context", () => ({
  createAIContext: vi.fn(),
}));

type ModelEntry = { item_name: string; amount: string; currency: string };

function modelReply(
  reply:
    { outcome: "success"; entries: ModelEntry[] } | { outcome: "invalid"; invalid_reason: string }
) {
  const entries = reply.outcome === "success" ? reply.entries : [];
  return JSON.stringify({
    outcome: reply.outcome,
    invalid_reason: reply.outcome === "invalid" ? reply.invalid_reason : null,
    title: "Receipt",
    receipt_count: entries.length === 0 ? 0 : 1,
    receipt_totals: entries.map((entry) => ({
      receipt_index: 0,
      amount: entry.amount,
      currency: entry.currency,
    })),
    ledger_entries: entries.map((entry) => ({
      receipt_index: 0,
      category_index: 0,
      notes: null,
      ...entry,
    })),
    order_adjustments: [],
    reasoning: "test",
  });
}

describe("processRevision", () => {
  let ledgerId = "";
  let ensureRates: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers);
    ({ ledgerId } = await createTestUserWithLedger(db));
    // The day's rates come from the network; here only the day asked for matters.
    ensureRates = vi.spyOn(exchangeRates, "ensureExchangeRates").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function process(content: string, documentDate: string | null = "2026-09-01") {
    const db = getTestDb();
    const pending = await createPendingRevision({
      ledgerId,
      input: { text: "receipt", storedFileIds: [], documentDate },
      bookId: await testBookId(db, ledgerId),
    });
    const sourceDocumentId = pending.document.id;
    const revisionId = pending.revision.id;
    // Late on the 30th in UTC, already the 31st further east.
    await db
      .update(sourceDocuments)
      .set({ createdAt: new Date("2026-08-30T23:30:00Z") })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    const lease = await claimRevisionForTest(revisionId);
    const generate = vi.fn(async () => ({ content }));

    const outcome = await revisionProcessor(() => ({ generate })).process({
      signal: new AbortController().signal,
      ledgerId,
      sourceDocumentId,
      revisionId,
      lease,
    });
    const revision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, revisionId),
    });
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceDocumentId, sourceDocumentId));
    return { outcome, revision, entries };
  }

  it("records the AI's trimmed reason when it declares the document invalid", async () => {
    const { outcome, revision, entries } = await process(
      modelReply({ outcome: "invalid", invalid_reason: "  This is a refund, not an expense. " })
    );

    expect(outcome).toEqual({
      processingStatus: "failed",
      failureMessage: "This is a refund, not an expense.",
    });
    expect(revision).toMatchObject({
      processingStatus: "failed",
      failureKind: "invalid_input",
      failureCode: "ai_declared_invalid",
      failureMessage: "This is a refund, not an expense.",
    });
    expect(entries).toEqual([]);
    expect(ensureRates).not.toHaveBeenCalled();
  });

  it("keeps only the diagnostic when the parsed entries fail validation", async () => {
    // Positive as written, but nothing once rounded to the currency's cents.
    const { outcome, revision, entries } = await process(
      modelReply({
        outcome: "success",
        entries: [{ item_name: "Rounding", amount: "0.001", currency: "EUR" }],
      })
    );

    expect(outcome).toEqual({ processingStatus: "failed" });
    expect(revision).toMatchObject({
      processingStatus: "failed",
      failureKind: "invalid_input",
      failureCode: "entry_validation_failed",
      failureMessage: null,
    });
    expect(entries).toEqual([]);
  });

  it("stores foreign amounts as written and caches the document day's rates once", async () => {
    const { outcome, revision, entries } = await process(
      modelReply({
        outcome: "success",
        entries: [
          { item_name: "Croissant", amount: "10", currency: "EUR" },
          { item_name: "Coffee", amount: "3.5", currency: "EUR" },
        ],
      })
    );

    expect(outcome).toEqual({ processingStatus: "completed" });
    expect(revision?.processingStatus).toBe("completed");
    expect(entries.map(({ amount, currency }) => ({ amount, currency }))).toEqual(
      expect.arrayContaining([
        { amount: "10.000", currency: "EUR" },
        { amount: "3.500", currency: "EUR" },
      ])
    );
    expect(ensureRates).toHaveBeenCalledTimes(1);
    expect(ensureRates).toHaveBeenCalledWith(["2026-09-01"]);
  });

  it("asks for the creation day's rates when the document carries no date", async () => {
    await process(
      modelReply({
        outcome: "success",
        entries: [{ item_name: "Croissant", amount: "10", currency: "EUR" }],
      }),
      null
    );

    expect(ensureRates).toHaveBeenCalledWith(["2026-08-30"]);
  });
});
