import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";

const {
  submit,
  submitIdempotently,
  scheduleProcessing,
  storeProcessedImages,
  discardUnusedFiles,
  processImage,
} = vi.hoisted(() => ({
  submit: vi.fn(),
  submitIdempotently: vi.fn(),
  scheduleProcessing: vi.fn(),
  storeProcessedImages: vi.fn(),
  discardUnusedFiles: vi.fn(),
  processImage: vi.fn(),
}));

vi.mock("@/modules/source-document/server/submissions", () => ({
  submitSourceDocument: submit,
  submitSourceDocumentIdempotently: submitIdempotently,
}));
vi.mock("@/server/processing/schedule", () => ({
  scheduleProcessingAfter: scheduleProcessing,
}));
vi.mock("@/server/stored-files/uploads", () => ({ storeProcessedImages, discardUnusedFiles }));
vi.mock("@/lib/storage/image-processing", () => ({ processImage }));

import { createAndQueueSourceDocument } from "@/modules/source-document/server/create-and-queue";

const job = {
  sourceDocumentId: "doc-1",
  revisionId: "revision-1",
  requestedAt: "2026-07-15T00:00:00.000Z",
};

describe("createAndQueueSourceDocument", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    submit.mockResolvedValue({
      document: { id: "doc-1" },
      revision: { id: "revision-1", processingStatus: "processing" },
      job,
    });
    processImage.mockImplementation(async (buffer: Buffer, mimeType: string) => ({
      buffer,
      mimeType,
    }));
  });

  it("rejects empty stored evidence before creating durable state", async () => {
    await expect(
      createAndQueueSourceDocument({
        ledgerId: "ledger-1",
        bookId: "user-1",
        input: { kind: "stored", storedFileIds: [] },
      })
    ).rejects.toThrow(ValidationError);
    expect(submit).not.toHaveBeenCalled();
  });

  it("creates stored evidence and schedules the attempt after it is durable", async () => {
    const result = await createAndQueueSourceDocument({
      ledgerId: "ledger-1",
      bookId: "user-1",
      input: { kind: "stored", text: "Lunch receipt", storedFileIds: ["file-1"] },
      documentDate: "2026-07-15",
    });

    expect(submit).toHaveBeenCalledWith({
      ledgerId: "ledger-1",
      bookId: "user-1",
      input: {
        text: "Lunch receipt",
        storedFileIds: ["file-1"],
        documentDate: "2026-07-15",
        dateReference: "2026-07-15",
      },
    });
    expect(scheduleProcessing.mock.calls[0]?.[0]).toEqual(job);
    expect(submit.mock.invocationCallOrder[0]).toBeLessThan(
      scheduleProcessing.mock.invocationCallOrder[0]!
    );
    expect(result).toEqual({
      sourceDocumentId: "doc-1",
      revisionId: "revision-1",
      processingStatus: "processing",
    });
  });

  it("uses the required idempotent path and skips preparation on replay", async () => {
    submitIdempotently.mockResolvedValue({
      document: { id: "doc-1" },
      revision: { id: "revision-1", processingStatus: "processing" },
      job,
      idempotencyReplay: true,
    });
    const idempotency = {
      principalType: "user" as const,
      principalId: "user-1",
      key: "submission-1",
      contentFingerprint: "fingerprint-1",
    };

    await createAndQueueSourceDocument({
      ledgerId: "ledger-1",
      bookId: "user-1",
      input: {
        kind: "inline",
        images: [{ bytes: Buffer.from("image"), mimeType: "image/jpeg", contentHash: "hash" }],
      },
      idempotency,
    });

    expect(submitIdempotently).toHaveBeenCalledWith(idempotency, expect.any(Function));
    expect(processImage).not.toHaveBeenCalled();
    expect(storeProcessedImages).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(scheduleProcessing).not.toHaveBeenCalled();
  });

  it("processes prepared inline images once and submits finalized file identities", async () => {
    storeProcessedImages.mockResolvedValue(["stored-1"]);
    const bytes = Buffer.from("prepared-image");

    await createAndQueueSourceDocument({
      ledgerId: "ledger-1",
      bookId: "user-1",
      input: {
        kind: "inline",
        images: [{ bytes, mimeType: "image/jpeg", contentHash: "hash" }],
      },
    });

    expect(processImage).toHaveBeenCalledOnce();
    expect(processImage).toHaveBeenCalledWith(bytes, "image/jpeg");
    expect(storeProcessedImages).toHaveBeenCalledWith("ledger-1", [
      { bytes, contentType: "image/jpeg" },
    ]);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ storedFileIds: ["stored-1"] }),
      })
    );
    expect(discardUnusedFiles).not.toHaveBeenCalled();
  });

  it("discards the stored images when durable submission fails", async () => {
    storeProcessedImages.mockResolvedValue(["stored-1"]);
    submit.mockRejectedValue(new Error("write failed"));

    await expect(
      createAndQueueSourceDocument({
        ledgerId: "ledger-1",
        bookId: "user-1",
        input: {
          kind: "inline",
          images: [{ bytes: Buffer.from("image"), mimeType: "image/jpeg", contentHash: "hash" }],
        },
      })
    ).rejects.toThrow("write failed");
    expect(discardUnusedFiles).toHaveBeenCalledWith("ledger-1", ["stored-1"]);
    expect(scheduleProcessing).not.toHaveBeenCalled();
  });
});
