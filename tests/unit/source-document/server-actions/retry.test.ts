import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";

const { retrySourceDocumentMock } = vi.hoisted(() => ({
  retrySourceDocumentMock: vi.fn(),
}));

vi.mock("@/modules/source-document/server-actions/access", () => ({
  withSourceDocumentLedgerAccess:
    <TArgs extends unknown[], TResult>(
      handler: (access: { ledgerId: string }, ...args: TArgs) => TResult
    ) =>
    (...args: TArgs) =>
      handler({ ledgerId: "ledger-1" }, ...args),
}));

vi.mock("@/modules/source-document/server/retry", () => ({
  retrySourceDocument: retrySourceDocumentMock,
}));

vi.mock("@/server/processing/recovery", () => ({
  scheduleProcessingRecoveryAfter: vi.fn(),
}));

import { retrySourceDocumentAction } from "@/modules/source-document/server-actions/retry";

const sourceDocumentId = "11111111-1111-4111-8111-111111111111";

describe("retrySourceDocumentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrySourceDocumentMock.mockResolvedValue({ status: "processing" });
  });

  it("passes the document identity without browser idempotency metadata", async () => {
    await expect(retrySourceDocumentAction(sourceDocumentId)).resolves.toEqual({
      status: "processing",
    });
    expect(retrySourceDocumentMock.mock.calls[0]?.[0]).toEqual({
      ledgerId: "ledger-1",
      sourceDocumentId,
    });
  });

  it("propagates submission failures", async () => {
    retrySourceDocumentMock.mockRejectedValueOnce(new Error("Source document is processing"));
    await expect(retrySourceDocumentAction(sourceDocumentId)).rejects.toThrow(
      "Source document is processing"
    );
  });

  it("validates the source document id", async () => {
    await expect(retrySourceDocumentAction("not-a-uuid")).rejects.toThrow(ValidationError);
    expect(retrySourceDocumentMock).not.toHaveBeenCalled();
  });
});
