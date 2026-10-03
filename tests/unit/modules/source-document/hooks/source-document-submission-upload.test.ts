import { describe, expect, it, vi } from "vitest";
import { MAX_FILES, MAX_ORIGINAL_BYTES_PER_FILE } from "@/lib/storage/upload-policy";
import { uploadSourceDocumentSubmissionImages } from "@/modules/source-document/hooks/source-document-submission-upload";

function imageFile(byteSize = 1, name = "receipt.jpg"): File {
  return new File([new Uint8Array(byteSize)], name, { type: "image/jpeg" });
}

function uploadImage(byteSize = 1, name = "receipt.jpg") {
  return { file: imageFile(byteSize, name), mimeType: "image/jpeg" };
}

function stored(id: string): Response {
  return Response.json({ id }, { status: 201 });
}

const payload = (images: ReturnType<typeof uploadImage>[]) => ({
  documentDate: "2026-07-15",
  text: null,
  storedFileIds: [],
  images,
});

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

  it("posts each image raw to the app and returns the stored file ids in order", async () => {
    const compress = vi.fn();
    const post = vi
      .fn()
      .mockResolvedValueOnce(stored("file-1"))
      .mockResolvedValueOnce(stored("file-2"));
    const result = await uploadSourceDocumentSubmissionImages(
      payload([uploadImage(1, "a b.jpg"), uploadImage(1, "c.jpg")]),
      { compress, post }
    );

    expect(compress).not.toHaveBeenCalled();
    expect(result).toEqual({
      documentDate: "2026-07-15",
      text: null,
      storedFileIds: ["file-1", "file-2"],
    });
    expect(post).toHaveBeenCalledWith(
      "/api/stored-files",
      expect.objectContaining({
        method: "POST",
        body: expect.any(File),
        headers: { "Content-Type": "image/jpeg", "X-Filename": "a%20b.jpg" },
      })
    );
  });

  it("keeps ids already on the submission and adds the new ones after them", async () => {
    const post = vi.fn().mockResolvedValue(stored("file-2"));

    const result = await uploadSourceDocumentSubmissionImages(
      { ...payload([uploadImage()]), storedFileIds: ["file-1"] },
      { post }
    );

    expect(result.storedFileIds).toEqual(["file-1", "file-2"]);
  });

  it("shrinks a large photo once before sending it", async () => {
    const small = uploadImage(1024);
    const compress = vi.fn().mockResolvedValue(small);
    const post = vi.fn().mockResolvedValue(stored("file-1"));

    await uploadSourceDocumentSubmissionImages(payload([uploadImage(3 * 1024 * 1024)]), {
      compress,
      post,
    });

    expect(compress).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![1].body.size).toBe(1024);
  });

  it("sends the original when shrinking fails but it is within the server's limit", async () => {
    const post = vi.fn().mockResolvedValue(stored("file-1"));

    await uploadSourceDocumentSubmissionImages(payload([uploadImage(3 * 1024 * 1024)]), {
      compress: vi.fn().mockRejectedValue(new Error("decode failed")),
      post,
    });

    expect(post.mock.calls[0]![1].body.size).toBe(3 * 1024 * 1024);
  });

  it("rejects an image over the server's limit that cannot be shrunk", async () => {
    await expect(
      uploadSourceDocumentSubmissionImages(
        payload([uploadImage(MAX_ORIGINAL_BYTES_PER_FILE + 1)]),
        { compress: vi.fn().mockRejectedValue(new Error("decode failed")), post: vi.fn() }
      )
    ).rejects.toMatchObject({ stage: "prepare" });
  });

  it("rejects more images than the web upload policy allows, before any work", async () => {
    const compress = vi.fn();
    const post = vi.fn();
    await expect(
      uploadSourceDocumentSubmissionImages(
        payload(Array.from({ length: MAX_FILES + 1 }, () => uploadImage())),
        { compress, post }
      )
    ).rejects.toThrow(`Maximum ${MAX_FILES} images`);
    expect(compress).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("retries a failed request but not one the server refused", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(stored("file-1"));
    await expect(
      uploadSourceDocumentSubmissionImages(payload([uploadImage()]), { post })
    ).resolves.toMatchObject({ storedFileIds: ["file-1"] });
    expect(post).toHaveBeenCalledTimes(3);

    const refused = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    await expect(
      uploadSourceDocumentSubmissionImages(payload([uploadImage()]), { post: refused })
    ).rejects.toMatchObject({ stage: "upload" });
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("gives up as an upload failure after the last attempt", async () => {
    const post = vi.fn().mockResolvedValue(new Response(null, { status: 502 }));

    await expect(
      uploadSourceDocumentSubmissionImages(payload([uploadImage()]), { post })
    ).rejects.toMatchObject({ stage: "upload" });
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("uploads at most two images at a time", async () => {
    let active = 0;
    let peak = 0;
    const post = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return stored(crypto.randomUUID());
    });

    await uploadSourceDocumentSubmissionImages(
      payload(Array.from({ length: 4 }, () => uploadImage())),
      { post }
    );

    expect(peak).toBe(2);
  });

  it("aborts an in-flight upload", async () => {
    const controller = new AbortController();
    const post = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Upload aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const submission = uploadSourceDocumentSubmissionImages(payload([uploadImage()]), {
      post,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(submission).rejects.toMatchObject({ name: "AbortError" });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
