import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";

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

vi.mock("@/modules/source-document/server/cancel-processing", () => ({
  cancelSourceDocumentProcessing: cancelProcessingMock,
}));

import { cancelSourceDocumentProcessingAction } from "@/modules/source-document/server-actions/processing";

const sourceDocumentId = "11111111-1111-4111-8111-111111111111";

describe("cancelSourceDocumentProcessingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the cancelled processing status", async () => {
    cancelProcessingMock.mockResolvedValueOnce({ processingStatus: "cancelled" });

    await expect(cancelSourceDocumentProcessingAction(sourceDocumentId)).resolves.toEqual({
      processingStatus: "cancelled",
    });
    expect(cancelProcessingMock).toHaveBeenCalledWith("ledger-1", sourceDocumentId);
  });

  it("propagates every failure", async () => {
    cancelProcessingMock.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(cancelSourceDocumentProcessingAction(sourceDocumentId)).rejects.toThrow(
      "database unavailable"
    );
  });

  it("validates the source document id", async () => {
    await expect(cancelSourceDocumentProcessingAction("not-a-uuid")).rejects.toThrow(
      ValidationError
    );
    expect(cancelProcessingMock).not.toHaveBeenCalled();
  });
});
