import { beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerMainCurrencyChangedError } from "@/modules/source-document/server/projections/shared";
import type { AIContext } from "@/lib/tasks/types";
import { ProcessingFailure } from "@/modules/source-document/domain/parse/contracts";

const {
  runParsePipelineMock,
  toOutputMock,
  loadContext,
  getSettings,
  loadStoredFiles,
  getRates,
  activateRevision,
  recordProcessingFailure,
} = vi.hoisted(() => ({
  runParsePipelineMock: vi.fn(),
  toOutputMock: vi.fn(),
  loadContext: vi.fn(),
  getSettings: vi.fn(),
  loadStoredFiles: vi.fn(),
  getRates: vi.fn(),
  activateRevision: vi.fn(),
  recordProcessingFailure: vi.fn(),
}));

vi.mock("@/modules/source-document/domain/parse/pipeline", () => ({
  runParsePipeline: runParsePipelineMock,
}));
vi.mock("@/modules/source-document/domain/parse/result-mapper", () => ({
  toParseSourceDocumentOutput: toOutputMock,
}));
vi.mock("@/server/processing/context", () => ({ loadRevisionProcessingContext: loadContext }));
vi.mock("@/modules/ledger/server/settings", () => ({ getLedgerSettings: getSettings }));
vi.mock("@/server/processing/evidence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/processing/evidence")>()),
  loadStoredFilesForAI: loadStoredFiles,
}));
vi.mock("@/modules/currency/server/exchange-rates", () => ({ getExchangeRates: getRates }));
vi.mock("@/modules/source-document/server/projections/writes", () => ({ activateRevision }));
vi.mock("@/modules/source-document/server/revisions", () => ({ recordProcessingFailure }));

const { processRevision } = await import("@/server/processing/revision-processor");

const processor = {
  process: (input: typeof request) =>
    processRevision(input, { createAIContext: () => ({}) as AIContext }),
};

function createProcessor(entryCount: number) {
  getSettings.mockResolvedValue({ mainCurrency: "CNY" });
  getRates.mockResolvedValue({
    base: "EUR",
    date: "2026-09-01",
    rates: { EUR: 1, CNY: 8, USD: 1.2 },
  });
  activateRevision.mockResolvedValue(true);
  recordProcessingFailure.mockResolvedValue(true);
  loadStoredFiles.mockResolvedValue([]);
  loadContext.mockResolvedValue({
    revision: {
      inputText: "receipt",
      inputDocumentDate: "2026-09-01",
      processingStatus: "processing",
    },
    document: {
      activeRevisionId: null,
      latestSubmissionRevisionId: "revision-1",
      createdAt: new Date("2026-09-01T00:00:00Z"),
    },
    storedFileIds: [],
    categories: [],
  });
  toOutputMock.mockReturnValue({
    verificationStatus: "passed",
    title: "Parsed",
    ledgerEntries: Array.from({ length: entryCount }, (_, index) => ({
      itemName: `Item ${index}`,
      amount: "10",
      currency: "EUR",
      categoryIndex: 0,
      entryDate: "2026-09-01",
    })),
  });
  runParsePipelineMock.mockResolvedValue({});
  return { processor, getSettings, getRates, activateRevision, recordProcessingFailure };
}

const request = {
  ledgerId: "ledger-1",
  sourceDocumentId: "document-1",
  revisionId: "revision-1",
  signal: new AbortController().signal,
  lease: { jobId: "job-1", claimToken: "token-1" },
};

describe("processRevision", () => {
  beforeEach(() => vi.resetAllMocks());

  it("deduplicates concurrent exchange-rate reads within one processing request", async () => {
    const { processor, getRates, activateRevision } = createProcessor(100);

    await expect(processor.process(request)).resolves.toEqual({
      processingStatus: "completed",
      completion: "atomic",
    });

    expect(getRates).toHaveBeenCalledTimes(1);
    expect(activateRevision.mock.calls[0]?.[0].entries).toHaveLength(100);
  });

  it("rebuilds currency-dependent work after a commit conflict without reparsing", async () => {
    createProcessor(1);
    getSettings
      .mockResolvedValueOnce({ mainCurrency: "CNY" })
      .mockResolvedValueOnce({ mainCurrency: "USD" });
    activateRevision.mockRejectedValueOnce(new LedgerMainCurrencyChangedError());

    await expect(processor.process(request)).resolves.toEqual({
      processingStatus: "completed",
      completion: "atomic",
    });

    expect(runParsePipelineMock).toHaveBeenCalledTimes(1);
    expect(activateRevision).toHaveBeenCalledTimes(2);
    expect(activateRevision.mock.calls[0]?.[0]).toMatchObject({
      expectedMainCurrency: "CNY",
      entries: [expect.objectContaining({ convertedAmount: "80.00" })],
    });
    expect(activateRevision.mock.calls[1]?.[0]).toMatchObject({
      expectedMainCurrency: "USD",
      entries: [expect.objectContaining({ convertedAmount: "12.00" })],
    });
  });

  it("stops after three currency conflicts with the stable exchange-rate failure", async () => {
    createProcessor(1);
    activateRevision.mockRejectedValue(new LedgerMainCurrencyChangedError());

    const processing = processor.process(request);
    await expect(processing).rejects.toBeInstanceOf(ProcessingFailure);
    await expect(processing).rejects.toMatchObject({ code: "exchange_rate_failure" });
    expect(activateRevision).toHaveBeenCalledTimes(3);
    expect(getSettings).toHaveBeenCalledTimes(3);
    expect(runParsePipelineMock).toHaveBeenCalledTimes(1);
  });

  it("records the AI reason and the AI-declared diagnostic when the AI rejects the document", async () => {
    const { processor, recordProcessingFailure, activateRevision } = createProcessor(0);
    toOutputMock.mockReturnValue({
      verificationStatus: "invalid",
      title: "Blurred receipt",
      ledgerEntries: [],
      reason: "  This is a refund, not an expense. ",
      diagnostic: "ai_declared_invalid",
    });

    await expect(processor.process(request)).resolves.toEqual({
      processingStatus: "failed",
      failureMessage: "This is a refund, not an expense.",
      completion: "atomic",
    });

    expect(recordProcessingFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        failureKind: "invalid_input",
        failureCode: "ai_declared_invalid",
        failureMessage: "This is a refund, not an expense.",
      })
    );
    expect(activateRevision).not.toHaveBeenCalled();
  });

  it("records no user-facing reason when entry validation fails, keeping only the diagnostic", async () => {
    const { processor, recordProcessingFailure, activateRevision } = createProcessor(1);
    toOutputMock.mockReturnValue({
      verificationStatus: "passed",
      title: "Parsed",
      ledgerEntries: [
        {
          itemName: "Discount",
          amount: "0",
          currency: "EUR",
          categoryIndex: 0,
          entryDate: "2026-09-01",
        },
      ],
    });

    await expect(processor.process(request)).resolves.toEqual({
      processingStatus: "failed",
      completion: "atomic",
    });

    expect(recordProcessingFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        failureKind: "invalid_input",
        failureCode: "entry_validation_failed",
        failureMessage: null,
      })
    );
    expect(activateRevision).not.toHaveBeenCalled();
  });
});
