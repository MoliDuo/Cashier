import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIContext } from "@/lib/tasks/types";

const {
  runParsePipelineMock,
  toOutputMock,
  loadContext,
  getSettings,
  loadStoredFiles,
  ensureRates,
  activateRevision,
  recordProcessingFailure,
} = vi.hoisted(() => ({
  runParsePipelineMock: vi.fn(),
  toOutputMock: vi.fn(),
  loadContext: vi.fn(),
  getSettings: vi.fn(),
  loadStoredFiles: vi.fn(),
  ensureRates: vi.fn(),
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
vi.mock("@/modules/currency/server/exchange-rates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/currency/server/exchange-rates")>()),
  ensureExchangeRates: ensureRates,
}));
vi.mock("@/modules/source-document/server/projections/writes", () => ({ activateRevision }));
vi.mock("@/modules/source-document/server/revisions", () => ({ recordProcessingFailure }));

const { processRevision } = await import("@/server/processing/revision-processor");

const processor = {
  process: (input: typeof request) =>
    processRevision(input, { createAIContext: () => ({}) as AIContext }),
};

function createProcessor(entryCount: number) {
  getSettings.mockResolvedValue({ mainCurrency: "CNY" });
  ensureRates.mockResolvedValue(undefined);
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
  return { processor, getSettings, ensureRates, activateRevision, recordProcessingFailure };
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

  it("caches the document day's rates once and stores amounts unconverted", async () => {
    const { processor, ensureRates, activateRevision } = createProcessor(100);

    await expect(processor.process(request)).resolves.toEqual({
      processingStatus: "completed",
    });

    expect(ensureRates).toHaveBeenCalledTimes(1);
    expect(ensureRates).toHaveBeenCalledWith(["2026-09-01"]);
    const entries = activateRevision.mock.calls[0]?.[0].entries;
    expect(entries).toHaveLength(100);
    expect(entries[0]).toMatchObject({ amount: "10.00", currency: "EUR" });
    expect(entries[0]).not.toHaveProperty("convertedAmount");
  });

  it("asks for the creation day's rates when the document has no date", async () => {
    const { processor, ensureRates } = createProcessor(1);
    loadContext.mockResolvedValue({
      revision: { inputText: "receipt", inputDocumentDate: null, processingStatus: "processing" },
      document: {
        activeRevisionId: null,
        latestSubmissionRevisionId: "revision-1",
        createdAt: new Date("2026-08-30T23:30:00Z"),
      },
      storedFileIds: [],
      categories: [],
    });

    await expect(processor.process(request)).resolves.toEqual({
      processingStatus: "completed",
    });
    expect(ensureRates).toHaveBeenCalledWith(["2026-08-30"]);
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
