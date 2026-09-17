import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/errors";
import { createAndQueueSourceDocument } from "@/modules/source-document/application/use-cases/create-and-queue-source-document";
import type { InlineImageUploader } from "@/modules/source-document/application/use-cases/prepare-inline-images";

describe("createAndQueueSourceDocument", () => {
  const submit = vi.fn();
  const submitIdempotently = vi.fn();
  const scheduleProcessing = vi.fn();
  const createUploadPlan = vi.fn();
  const uploadTarget = vi.fn();
  const finalizeUpload = vi.fn();
  const abandonUploadSession = vi.fn();
  const processImage = vi.fn();
  const storedFiles: InlineImageUploader = {
    createUploadPlan,
    uploadTarget,
    finalizeUpload,
    abandonUploadSession,
  };
  const submissions = { submit, submitIdempotently };
  const dependencies = { submissions, storedFiles, processImage, scheduleProcessing };

  beforeEach(() => {
    vi.resetAllMocks();
    submit.mockResolvedValue({
      document: { id: "doc-1" },
      revision: { id: "revision-1", processingStatus: "processing" },
      job: { id: "job-1" },
    });
    processImage.mockImplementation(async (buffer: Buffer, mimeType: string) => ({
      buffer,
      mimeType,
    }));
  });

  it("rejects empty stored evidence before creating durable state", async () => {
    await expect(
      createAndQueueSourceDocument(
        {
          ledgerId: "ledger-1",
          attributedUserId: "user-1",
          createdByUserId: "user-1",
          input: { kind: "stored", storedFileIds: [] },
        },
        dependencies
      )
    ).rejects.toThrow(ValidationError);
    expect(submit).not.toHaveBeenCalled();
  });

  it("creates stored evidence and dispatches after durable job creation", async () => {
    const result = await createAndQueueSourceDocument(
      {
        ledgerId: "ledger-1",
        attributedUserId: "user-1",
        createdByUserId: "user-1",
        input: { kind: "stored", text: "Lunch receipt", storedFileIds: ["file-1"] },
        documentDate: "2026-07-15",
      },
      dependencies
    );

    expect(submit).toHaveBeenCalledWith({
      ledgerId: "ledger-1",
      attributedUserId: "user-1",
      createdByUserId: "user-1",
      input: {
        text: "Lunch receipt",
        storedFileIds: ["file-1"],
        documentDate: "2026-07-15",
        dateReference: "2026-07-15",
      },
    });
    expect(scheduleProcessing).toHaveBeenCalledWith({ id: "job-1" });
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
      job: { id: "job-1" },
      idempotencyReplay: true,
    });
    const idempotency = {
      principalType: "user" as const,
      principalId: "user-1",
      key: "submission-1",
      contentFingerprint: "fingerprint-1",
    };

    await createAndQueueSourceDocument(
      {
        ledgerId: "ledger-1",
        attributedUserId: "user-1",
        createdByUserId: "user-1",
        input: {
          kind: "inline",
          images: [{ bytes: Buffer.from("image"), mimeType: "image/jpeg", contentHash: "hash" }],
        },
        idempotency,
      },
      dependencies
    );

    expect(submitIdempotently).toHaveBeenCalledWith(idempotency, expect.any(Function));
    expect(processImage).not.toHaveBeenCalled();
    expect(createUploadPlan).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(scheduleProcessing).not.toHaveBeenCalled();
  });

  it("processes prepared inline images once and submits finalized file identities", async () => {
    createUploadPlan.mockResolvedValue({
      id: "session-1",
      targets: [{ id: "target-1" }],
      finalizationToken: "token-1",
    });
    uploadTarget.mockResolvedValue({ id: "stored-1" });
    finalizeUpload.mockResolvedValue([{ id: "stored-1" }]);
    const bytes = Buffer.from("prepared-image");

    await createAndQueueSourceDocument(
      {
        ledgerId: "ledger-1",
        attributedUserId: "user-1",
        createdByUserId: "user-1",
        input: {
          kind: "inline",
          images: [{ bytes, mimeType: "image/jpeg", contentHash: "hash" }],
        },
      },
      dependencies
    );

    expect(processImage).toHaveBeenCalledOnce();
    expect(processImage).toHaveBeenCalledWith(bytes, "image/jpeg");
    expect(uploadTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        ledgerId: "ledger-1",
        uploadSessionId: "session-1",
        targetId: "target-1",
      })
    );
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ storedFileIds: ["stored-1"] }),
      })
    );
  });

  it("abandons finalized upload state when durable submission fails", async () => {
    createUploadPlan.mockResolvedValue({
      id: "session-1",
      targets: [{ id: "target-1" }],
      finalizationToken: "token-1",
    });
    uploadTarget.mockResolvedValue({ id: "stored-1" });
    finalizeUpload.mockResolvedValue([{ id: "stored-1" }]);
    submit.mockRejectedValue(new Error("write failed"));

    await expect(
      createAndQueueSourceDocument(
        {
          ledgerId: "ledger-1",
          attributedUserId: "user-1",
          createdByUserId: "user-1",
          input: {
            kind: "inline",
            images: [{ bytes: Buffer.from("image"), mimeType: "image/jpeg", contentHash: "hash" }],
          },
        },
        dependencies
      )
    ).rejects.toThrow("write failed");
    expect(abandonUploadSession).toHaveBeenCalledWith("ledger-1", "session-1");
    expect(scheduleProcessing).not.toHaveBeenCalled();
  });
});
