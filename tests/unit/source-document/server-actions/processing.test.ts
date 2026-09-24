import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { StaleSourceDocumentVersionError } from "@/lib/errors";

const { cancelProcessingMock } = vi.hoisted(() => ({
  cancelProcessingMock: vi.fn(),
}));

vi.mock("@/modules/source-document/server-actions/access", () => ({
  withSourceDocumentLedgerAccess:
    <TArgs extends unknown[], TResult>(
      handler: (access: { ledgerId: string }, ...args: TArgs) => TResult
    ) =>
    (...args: TArgs) =>
      handler({ ledgerId: "ledger-1" }, ...args),
}));

vi.mock("@/application/server-composition-root", () => ({
  serverComposition: {
    sourceDocumentAggregate: {
      cancelProcessing: cancelProcessingMock,
    },
  },
}));

import { cancelSourceDocumentProcessingAction } from "@/modules/source-document/server-actions/processing";

const sourceDocumentId = "11111111-1111-4111-8111-111111111111";

describe("cancelSourceDocumentProcessingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the cancelled version and processing status", async () => {
    cancelProcessingMock.mockResolvedValueOnce({ version: 4, processingStatus: "cancelled" });

    await expect(cancelSourceDocumentProcessingAction(sourceDocumentId, 3)).resolves.toEqual({
      ok: true,
      sourceDocumentId,
      version: 4,
      data: { processingStatus: "cancelled" },
    });
    expect(cancelProcessingMock).toHaveBeenCalledWith("ledger-1", sourceDocumentId, 3);
  });

  it("maps a stale version to the existing stale result", async () => {
    cancelProcessingMock.mockRejectedValueOnce(
      new StaleSourceDocumentVersionError(sourceDocumentId, 2, 5)
    );

    await expect(cancelSourceDocumentProcessingAction(sourceDocumentId, 2)).resolves.toEqual({
      ok: false,
      reason: "stale",
      sourceDocumentId,
      expectedVersion: 2,
      currentVersion: 5,
    });
  });

  it("propagates every other failure", async () => {
    cancelProcessingMock.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(cancelSourceDocumentProcessingAction(sourceDocumentId, 3)).rejects.toThrow(
      "database unavailable"
    );
  });

  it("validates the source document id and expected version", async () => {
    await expect(cancelSourceDocumentProcessingAction("not-a-uuid", 3)).rejects.toThrow(ZodError);
    await expect(cancelSourceDocumentProcessingAction(sourceDocumentId, 0)).rejects.toThrow(
      ZodError
    );
    expect(cancelProcessingMock).not.toHaveBeenCalled();
  });
});
