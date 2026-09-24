import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ValidationError } from "@/lib/errors";

const {
  requireLedgerAccessMock,
  retrySourceDocumentMock,
  scheduleProcessingAfterMock,
  deleteDocumentsMock,
} = vi.hoisted(() => ({
  requireLedgerAccessMock: vi.fn(),
  retrySourceDocumentMock: vi.fn(),
  scheduleProcessingAfterMock: vi.fn(),
  deleteDocumentsMock: vi.fn(),
}));

vi.mock("@/modules/ledger/access", () => ({
  requireLedgerAccess: requireLedgerAccessMock,
}));

vi.mock("@/modules/source-document/application/use-cases/retry-source-document", () => ({
  retrySourceDocument: retrySourceDocumentMock,
}));

vi.mock("@/application/processing/schedule-processing", () => ({
  scheduleProcessingAfter: scheduleProcessingAfterMock,
}));

vi.mock("@/application/server-composition-root", () => ({
  serverComposition: {
    sourceDocumentAggregate: {
      deleteDocuments: deleteDocumentsMock,
      installRetry: vi.fn(),
    },
  },
}));

import {
  batchDeleteSourceDocumentsAction,
  batchRetrySourceDocumentsAction,
} from "@/modules/source-document/server-actions/batch";

const ledgerId = "00000000-0000-4000-8000-000000000001";
const sourceDocumentId = "00000000-0000-4000-8000-000000000002";

describe("source document batch server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireLedgerAccessMock.mockResolvedValue({ ledger: { id: ledgerId } });
  });

  it("returns a stable internal reason without exposing the original error", async () => {
    deleteDocumentsMock.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await batchDeleteSourceDocumentsAction([
      { sourceDocumentId, expectedVersion: 1 },
    ]);

    expect(result).toEqual({
      succeeded: [],
      stale: [],
      failed: [{ id: sourceDocumentId, code: "INTERNAL" }],
    });
    expect(JSON.stringify(result)).not.toContain("database unavailable");
  });

  it("classifies infrastructure AppErrors as processing_unavailable", async () => {
    retrySourceDocumentMock.mockRejectedValueOnce(
      new AppError("storage provider unavailable", "STORAGE_UNAVAILABLE")
    );

    const result = await batchRetrySourceDocumentsAction([
      { sourceDocumentId, expectedVersion: 1 },
    ]);

    expect(result.failed).toEqual([{ id: sourceDocumentId, code: "PROCESSING_UNAVAILABLE" }]);
    expect(JSON.stringify(result)).not.toContain("storage provider unavailable");
  });

  it("classifies every item separately and keeps the order it was given", async () => {
    const staleId = "00000000-0000-4000-8000-000000000003";
    const failedId = "00000000-0000-4000-8000-000000000004";
    deleteDocumentsMock
      .mockResolvedValueOnce({ ok: true, version: 2 })
      .mockResolvedValueOnce({
        ok: false,
        expectedVersion: 1,
        currentVersion: 3,
      })
      .mockRejectedValueOnce(new Error("database unavailable"));

    const result = await batchDeleteSourceDocumentsAction([
      { sourceDocumentId, expectedVersion: 1 },
      { sourceDocumentId: staleId, expectedVersion: 1 },
      { sourceDocumentId: failedId, expectedVersion: 1 },
    ]);

    expect(result).toEqual({
      succeeded: [{ id: sourceDocumentId, sourceDocumentId, version: 2 }],
      stale: [
        {
          id: staleId,
          sourceDocumentId: staleId,
          expectedVersion: 1,
          currentVersion: 3,
        },
      ],
      failed: [{ id: failedId, code: "INTERNAL" }],
    });
  });

  it("schedules a retry intent only after every item has been classified", async () => {
    const order: string[] = [];
    retrySourceDocumentMock.mockImplementation(
      async (
        input: { sourceDocumentId: string },
        dependencies: { scheduleProcessing: (job: unknown) => void }
      ) => {
        order.push(`item:${input.sourceDocumentId}`);
        if (input.sourceDocumentId === sourceDocumentId) {
          dependencies.scheduleProcessing({ id: `job:${input.sourceDocumentId}` });
          return { ok: true, version: 2 };
        }
        throw new AppError("storage provider unavailable", "STORAGE_UNAVAILABLE");
      }
    );
    scheduleProcessingAfterMock.mockImplementation(() => order.push("schedule"));
    const failedId = "00000000-0000-4000-8000-000000000004";

    const result = await batchRetrySourceDocumentsAction([
      { sourceDocumentId, expectedVersion: 1 },
      { sourceDocumentId: failedId, expectedVersion: 1 },
    ]);

    expect(order).toEqual([`item:${sourceDocumentId}`, `item:${failedId}`, "schedule"]);
    expect(scheduleProcessingAfterMock).toHaveBeenCalledTimes(1);
    expect(result.succeeded).toEqual([{ id: sourceDocumentId, sourceDocumentId, version: 2 }]);
    expect(result.failed).toEqual([{ id: failedId, code: "PROCESSING_UNAVAILABLE" }]);
  });

  it("refuses an empty batch and a duplicated target", async () => {
    await expect(batchDeleteSourceDocumentsAction([])).rejects.toThrow(ValidationError);
    await expect(
      batchDeleteSourceDocumentsAction([
        { sourceDocumentId, expectedVersion: 1 },
        { sourceDocumentId, expectedVersion: 2 },
      ])
    ).rejects.toThrow(ValidationError);
    expect(deleteDocumentsMock).not.toHaveBeenCalled();
  });
});
