import { describe, expect, it, vi } from "vitest";
import { createAuthorizedFileReadOperations } from "@/application/adapters/storage/stored-files/authorized-file-reads";
import type { AuthorizedFileRepository } from "@/application/adapters/postgres/authorized-files";
import type { ObjectStore } from "@/lib/storage";

function fixture() {
  const row = {
    id: "file",
    ledgerId: "ledger",
    storageProvider: "s3",
    storageKey: "ledger/stored/file",
    contentType: "image/png",
    byteSize: 3,
    originalFilename: null,
    checksum: null,
    createdAt: new Date("2026-09-24T00:00:00Z"),
    finalizedAt: null,
    deletedAt: null,
  };
  const body = new ReadableStream<Uint8Array>();
  const storage = {
    upload: vi.fn<ObjectStore["upload"]>(),
    download: vi.fn<ObjectStore["download"]>(),
    stream: vi.fn<ObjectStore["stream"]>().mockResolvedValue(body),
    delete: vi.fn<ObjectStore["delete"]>(),
    presignUpload: vi.fn<ObjectStore["presignUpload"]>(),
    readObject: vi.fn<ObjectStore["readObject"]>(),
  } satisfies ObjectStore;
  const authorizedFiles = {
    findForLedger: vi.fn<AuthorizedFileRepository["findForLedger"]>(),
    findForUser: vi.fn<AuthorizedFileRepository["findForUser"]>().mockResolvedValue(row),
  };
  const reads = createAuthorizedFileReadOperations({ storage, authorizedFiles });
  return { reads, storage, authorizedFiles, row, body };
}

describe("authorized streaming reads", () => {
  it("returns the storage stream after authorization without buffering", async () => {
    const { reads, storage, authorizedFiles, body } = fixture();
    const result = await reads.readAuthorizedStreamForUser("user", "file");
    expect(authorizedFiles.findForUser).toHaveBeenCalledWith("user", "file");
    expect(storage.stream).toHaveBeenCalledWith("ledger/stored/file");
    expect(result?.body).toBe(body);
    expect(result?.file.id).toBe("file");
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("does not access storage when authorization finds no file", async () => {
    const { reads, storage, authorizedFiles } = fixture();
    authorizedFiles.findForUser.mockResolvedValue(null);
    await expect(reads.readAuthorizedStreamForUser("user", "file")).resolves.toBeNull();
    expect(storage.stream).not.toHaveBeenCalled();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("rejects unsupported providers before reading storage", async () => {
    const { reads, storage, row } = fixture();
    row.storageProvider = "unknown";
    await expect(reads.readAuthorizedStreamForUser("user", "file")).rejects.toMatchObject({
      code: "UNSUPPORTED_STORAGE_PROVIDER",
    });
    expect(storage.stream).not.toHaveBeenCalled();
  });
});
