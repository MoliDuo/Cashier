import { describe, expect, it, vi } from "vitest";
import { MAX_FILES } from "@/lib/storage/upload-policy";
import { uploadSourceDocumentSubmissionImages } from "@/modules/source-document/hooks/source-document-submission-upload";

function imageFile(byteSize = 1): File {
  return new File([new Uint8Array(byteSize)], "receipt.jpg", { type: "image/jpeg" });
}

function uploadImage(byteSize = 1) {
  return { file: imageFile(byteSize), mimeType: "image/jpeg" };
}

describe("source-document inline submission preparation", () => {
  it("leaves text-only submissions unchanged", async () => {
    await expect(
      uploadSourceDocumentSubmissionImages({
        documentDate: "2026-07-15",
        storedFileIds: [],
        text: "Lunch",
      })
    ).resolves.toEqual({ documentDate: "2026-07-15", text: "Lunch", storedFileIds: [] });
  });

  it("uploads compliant JPEG images without compressing them again", async () => {
    const compress = vi.fn().mockResolvedValue(uploadImage());
    const createPlan = vi.fn().mockResolvedValue({
      targets: [{ id: "target-1", url: "https://upload.test", requiredHeaders: {} }],
    });
    const put = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const finalize = vi.fn().mockResolvedValue(["file-1"]);
    const result = await uploadSourceDocumentSubmissionImages(
      {
        documentDate: "2026-07-15",
        text: null,
        storedFileIds: [],
        images: [uploadImage()],
      },
      { compress, createPlan, put, finalize }
    );

    expect(compress).not.toHaveBeenCalled();
    expect(result).toEqual({
      documentDate: "2026-07-15",
      text: null,
      storedFileIds: ["file-1"],
    });
    expect(put).toHaveBeenCalledWith(
      "https://upload.test",
      expect.objectContaining({ method: "PUT", body: expect.any(File) })
    );
    expect(finalize).toHaveBeenCalledWith({ storedFileIds: ["target-1"] });
  });

  it("rejects compression failures instead of returning original bytes", async () => {
    await expect(
      uploadSourceDocumentSubmissionImages(
        {
          documentDate: "2026-07-15",
          text: null,
          storedFileIds: [],
          images: [uploadImage(3 * 1024 * 1024 + 1)],
        },
        { compress: vi.fn().mockRejectedValue(new Error("decode failed")) }
      )
    ).rejects.toMatchObject({ stage: "prepare" });
  });

  it("rejects more images than the web upload policy allows, before compression", async () => {
    const compress = vi.fn();
    await expect(
      uploadSourceDocumentSubmissionImages(
        {
          documentDate: "2026-07-15",
          text: null,
          storedFileIds: [],
          images: Array.from({ length: MAX_FILES + 1 }, () => uploadImage()),
        },
        { compress }
      )
    ).rejects.toThrow(`Maximum ${MAX_FILES} images`);
    expect(compress).not.toHaveBeenCalled();
  });

  it("compresses every image in a batch concurrently before creating the plan", async () => {
    const resolvers: Array<(value: ReturnType<typeof uploadImage>) => void> = [];
    const compress = vi.fn(
      () =>
        new Promise<ReturnType<typeof uploadImage>>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const createPlan = vi.fn().mockResolvedValue({
      targets: Array.from({ length: 3 }, (_, index) => ({
        id: `target-${index}`,
        url: `https://upload.test/${index}`,
        requiredHeaders: {},
      })),
    });
    const put = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const finalize = vi.fn().mockResolvedValue(["file-1", "file-2", "file-3"]);
    const submission = uploadSourceDocumentSubmissionImages(
      {
        documentDate: "2026-07-15",
        text: null,
        storedFileIds: [],
        images: Array.from({ length: 3 }, () => uploadImage(1024 * 1024 + 1)),
      },
      { compress, createPlan, put, finalize }
    );

    await vi.waitFor(() => expect(compress).toHaveBeenCalledTimes(3));
    expect(createPlan).not.toHaveBeenCalled();
    resolvers.forEach((resolve) => resolve(uploadImage()));

    await expect(submission).resolves.toMatchObject({
      storedFileIds: ["file-1", "file-2", "file-3"],
    });
    expect(createPlan).toHaveBeenCalledTimes(1);
  });

  it("stops after a pending upload plan resolves when the batch was cancelled", async () => {
    const controller = new AbortController();
    const compress = vi.fn().mockResolvedValue(uploadImage());
    let resolvePlan!: (plan: {
      expiresAt: string;
      maxFiles: number;
      maxBytesPerFile: number;
      targets: {
        id: string;
        method: "PUT";
        url: string;
        requiredHeaders: Record<string, string>;
      }[];
    }) => void;
    const createPlan = vi.fn(
      () =>
        new Promise<{
          expiresAt: string;
          maxFiles: number;
          maxBytesPerFile: number;
          targets: {
            id: string;
            method: "PUT";
            url: string;
            requiredHeaders: Record<string, string>;
          }[];
        }>((resolve) => {
          resolvePlan = resolve;
        })
    );
    const put = vi.fn();
    const finalize = vi.fn();
    const submission = uploadSourceDocumentSubmissionImages(
      {
        documentDate: "2026-07-15",
        text: null,
        storedFileIds: [],
        images: [uploadImage()],
      },
      { compress, createPlan, put, finalize, signal: controller.signal }
    );

    await vi.waitFor(() => expect(createPlan).toHaveBeenCalledTimes(1));
    controller.abort();
    resolvePlan({
      expiresAt: "2026-07-15T01:00:00.000Z",
      maxFiles: 3,
      maxBytesPerFile: 10_000_000,
      targets: [
        {
          id: "target-1",
          method: "PUT",
          url: "https://upload.test",
          requiredHeaders: {},
        },
      ],
    });

    await expect(submission).rejects.toMatchObject({ name: "AbortError" });
    expect(put).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("aborts an in-flight direct upload without finalizing the batch", async () => {
    const controller = new AbortController();
    const compress = vi.fn().mockResolvedValue(uploadImage());
    const createPlan = vi.fn().mockResolvedValue({
      expiresAt: "2026-07-15T01:00:00.000Z",
      maxFiles: 3,
      maxBytesPerFile: 10_000_000,
      targets: [
        {
          id: "target-1",
          method: "PUT",
          url: "https://upload.test",
          requiredHeaders: {},
        },
      ],
    });
    const put = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Upload aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const finalize = vi.fn();
    const submission = uploadSourceDocumentSubmissionImages(
      {
        documentDate: "2026-07-15",
        text: null,
        storedFileIds: [],
        images: [uploadImage()],
      },
      { compress, createPlan, put, finalize, signal: controller.signal }
    );

    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(submission).rejects.toMatchObject({ name: "AbortError" });
    expect(finalize).not.toHaveBeenCalled();
  });
});
