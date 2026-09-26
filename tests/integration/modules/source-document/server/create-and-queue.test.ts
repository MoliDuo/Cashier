import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { ledgers, sourceDocuments, storedFiles } from "@/persistence";
import { createAndQueueSourceDocument } from "@/modules/source-document/server/create-and-queue";

const objectStore = vi.hoisted(() => ({ current: undefined as MemoryObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

describe("createAndQueueSourceDocument", () => {
  let ledgerId = "";
  let storage: MemoryObjectStore;

  async function inlineImage() {
    const bytes = await sharp({
      create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    return { bytes, mimeType: "image/jpeg" as const, contentHash: "hash" };
  }

  beforeEach(async () => {
    storage = new MemoryObjectStore();
    objectStore.current = storage;
    const db = getTestDb();
    await db.delete(ledgers);
    ({ ledgerId } = await createTestUserWithLedger(db));
  });

  it("stores inline images once and files them with the new document", async () => {
    const db = getTestDb();

    const created = await createAndQueueSourceDocument({
      ledgerId,
      bookId: await testBookId(db, ledgerId),
      input: { kind: "inline", images: [await inlineImage()] },
    });

    expect(created).toMatchObject({ processingStatus: "processing" });
    const files = await db.select().from(storedFiles);
    expect(files).toHaveLength(1);
    expect(storage.files.has(files[0]!.storageKey)).toBe(true);
  });

  it("discards the images it stored when the submission itself fails", async () => {
    const db = getTestDb();

    // A book that does not exist fails the durable submission after the
    // images were already stored.
    await expect(
      createAndQueueSourceDocument({
        ledgerId,
        bookId: crypto.randomUUID(),
        input: { kind: "inline", images: [await inlineImage()] },
      })
    ).rejects.toThrow();

    expect(await db.select().from(sourceDocuments)).toEqual([]);
    expect(await db.select().from(storedFiles)).toEqual([]);
    expect([...storage.files.keys()]).toEqual([]);
  });
});
