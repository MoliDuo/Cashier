import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ValidationError } from "@/lib/errors";

const { requireLedgerAccessMock, retrySourceDocumentMock, deleteDocumentsMock } = vi.hoisted(
  () => ({
    requireLedgerAccessMock: vi.fn(),
    retrySourceDocumentMock: vi.fn(),
    deleteDocumentsMock: vi.fn(),
  })
);

vi.mock("@/modules/ledger/access", () => ({
  requireLedgerAccess: requireLedgerAccessMock,
}));

vi.mock("@/modules/source-document/server/retry", () => ({
  retrySourceDocument: retrySourceDocumentMock,
}));

vi.mock("@/modules/source-document/server/delete", () => ({
  deleteSourceDocumentAtomically: deleteDocumentsMock,
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

    const result = await batchDeleteSourceDocumentsAction([sourceDocumentId]);

    expect(result).toEqual({
      succeeded: [],
      failed: [{ id: sourceDocumentId, code: "INTERNAL" }],
    });
    expect(JSON.stringify(result)).not.toContain("database unavailable");
  });

  it("classifies infrastructure AppErrors as processing_unavailable", async () => {
    retrySourceDocumentMock.mockRejectedValueOnce(
      new AppError("storage provider unavailable", "STORAGE_UNAVAILABLE")
    );

    const result = await batchRetrySourceDocumentsAction([sourceDocumentId]);

    expect(result.failed).toEqual([{ id: sourceDocumentId, code: "PROCESSING_UNAVAILABLE" }]);
    expect(JSON.stringify(result)).not.toContain("storage provider unavailable");
  });

  it("classifies every item separately in sorted document order", async () => {
    const failedId = "00000000-0000-4000-8000-000000000004";
    deleteDocumentsMock
      .mockResolvedValueOnce({ sourceDocumentId, deleted: true })
      .mockRejectedValueOnce(new Error("database unavailable"));

    const result = await batchDeleteSourceDocumentsAction([failedId, sourceDocumentId]);

    expect(deleteDocumentsMock.mock.calls.map(([input]) => input)).toEqual([
      { ledgerId, sourceDocumentId },
      { ledgerId, sourceDocumentId: failedId },
    ]);
    expect(result).toEqual({
      succeeded: [{ id: sourceDocumentId, sourceDocumentId }],
      failed: [{ id: failedId, code: "INTERNAL" }],
    });
  });

  it("keeps retrying later items after one of them fails", async () => {
    const laterId = "00000000-0000-4000-8000-000000000004";
    retrySourceDocumentMock.mockImplementation(async (input: { sourceDocumentId: string }) => {
      if (input.sourceDocumentId === sourceDocumentId) {
        throw new AppError("storage provider unavailable", "STORAGE_UNAVAILABLE");
      }
      return { status: "processing" };
    });

    const result = await batchRetrySourceDocumentsAction([sourceDocumentId, laterId]);

    expect(retrySourceDocumentMock).toHaveBeenCalledTimes(2);
    expect(result.succeeded).toEqual([{ id: laterId, sourceDocumentId: laterId }]);
    expect(result.failed).toEqual([{ id: sourceDocumentId, code: "PROCESSING_UNAVAILABLE" }]);
  });

  it("refuses an empty batch and runs a duplicated target once", async () => {
    await expect(batchDeleteSourceDocumentsAction([])).rejects.toThrow(ValidationError);
    expect(deleteDocumentsMock).not.toHaveBeenCalled();

    deleteDocumentsMock.mockResolvedValueOnce({ sourceDocumentId, deleted: true });
    const result = await batchDeleteSourceDocumentsAction([sourceDocumentId, sourceDocumentId]);

    expect(deleteDocumentsMock).toHaveBeenCalledTimes(1);
    expect(result.succeeded).toEqual([{ id: sourceDocumentId, sourceDocumentId }]);
  });
});
