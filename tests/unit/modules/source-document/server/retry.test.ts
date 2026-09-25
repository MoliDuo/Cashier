import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/lib/errors";

const { submit, scheduleProcessing } = vi.hoisted(() => ({
  submit: vi.fn(),
  scheduleProcessing: vi.fn(),
}));

vi.mock("@/modules/source-document/server/submissions", () => ({
  submitSourceDocument: submit,
}));
vi.mock("@/server/processing/schedule", () => ({
  scheduleProcessingAfter: scheduleProcessing,
}));

import { retrySourceDocument } from "@/modules/source-document/server/retry";

const ledger = {
  id: "ledger-1",
  userId: "user-1",
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

describe("retrySourceDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submit.mockResolvedValue({
      document: { id: "doc-1", version: 2 },
      revision: { id: "revision-2" },
      job: { id: "job-2" },
    });
  });

  it("propagates missing-document failures without dispatch", async () => {
    submit.mockRejectedValueOnce(new NotFoundError("Source document"));
    await expect(
      retrySourceDocument({ ledgerId: ledger.id, sourceDocumentId: "missing" })
    ).rejects.toThrow(NotFoundError);
    expect(scheduleProcessing).not.toHaveBeenCalled();
  });

  it("creates a new revision under the stable document identity and inherits evidence", async () => {
    const result = await retrySourceDocument({
      ledgerId: ledger.id,
      sourceDocumentId: "doc-1",
    });
    expect(submit).toHaveBeenCalledWith({
      ledgerId: ledger.id,
      sourceDocumentId: "doc-1",
      inheritInput: true,
      supersedeProcessing: true,
    });
    expect(scheduleProcessing).toHaveBeenCalledWith({ id: "job-2" });
    // ordering: scheduleProcessing must be called AFTER submit completes
    expect(submit.mock.invocationCallOrder[0]).toBeLessThan(
      scheduleProcessing.mock.invocationCallOrder[0]!
    );
    expect(result).toEqual({ status: "processing" });
  });

  it("creates immutable edit-retry evidence from finalized file identities", async () => {
    await retrySourceDocument({
      ledgerId: ledger.id,
      sourceDocumentId: "doc-1",
      input: {
        text: "corrected",
        documentDate: "2026-07-16",
        storedFileIds: ["00000000-0000-4000-8000-000000000001"],
      },
    });
    expect(submit).toHaveBeenCalledWith({
      ledgerId: ledger.id,
      sourceDocumentId: "doc-1",
      inheritInput: false,
      supersedeProcessing: true,
      input: {
        text: "corrected",
        documentDate: "2026-07-16",
        storedFileIds: ["00000000-0000-4000-8000-000000000001"],
      },
    });
  });
});
