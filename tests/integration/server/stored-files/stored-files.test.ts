import { createPendingAttempt } from "tests/helpers/processing-attempt";
import type { ObjectStore } from "@/lib/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { readAuthorizedFile } from "@/server/stored-files/reads";
import {
  finalizeDirectUpload,
  planDirectUpload,
  storeProcessedImages,
} from "@/server/stored-files/uploads";
import { DirectMemoryObjectStore } from "tests/helpers/memory-object-store";
import {
  DIRECT_UPLOAD_FINALIZE_BUFFER_MS,
  MAX_FILES,
  MAX_NORMALIZED_BYTES_PER_ATTEMPT,
  MAX_ORIGINAL_BYTES_PER_FILE,
  UPLOAD_PLAN_EXPIRY_MS,
} from "@/lib/storage/upload-policy";
import { storedFiles } from "@/persistence";

const objectStore = vi.hoisted(() => ({ current: undefined as ObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

async function receiptJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
    .jpeg()
    .toBuffer();
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Plans one upload of `bytes` and puts them where the plan says. */
async function plannedUpload(
  storage: DirectMemoryObjectStore,
  bytes: Buffer,
  contentType = "image/jpeg"
) {
  const digest = sha256(bytes);
  const plan = await planDirectUpload([
    { contentType, byteSize: bytes.length, originalFilename: "receipt.jpg", checksum: digest },
  ]);
  const id = plan.targets[0]!.id;
  storage.put(`temporary/${id}`, bytes, contentType, digest);
  return { plan, id };
}

describe("stored-file uploads and reads", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("plans pending files that point the browser at a temporary object", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    objectStore.current = storage;
    const digest = "a".repeat(64);

    const plan = await planDirectUpload([
      {
        contentType: "image/jpeg",
        byteSize: 10,
        originalFilename: "receipt.jpg",
        checksum: digest,
      },
    ]);

    const target = plan.targets[0]!;
    expect(target.url).toBe(`https://r2.test/temporary/${target.id}`);
    expect(storage.presignTtlSeconds).toEqual([
      Math.floor((UPLOAD_PLAN_EXPIRY_MS - DIRECT_UPLOAD_FINALIZE_BUFFER_MS) / 1000),
    ]);
    expect(await db.select().from(storedFiles)).toEqual([
      expect.objectContaining({
        id: target.id,
        storageKey: `stored/${target.id}`,
        contentType: "image/jpeg",
        byteSize: 10,
        originalFilename: "receipt.jpg",
        checksum: digest,
        finalizedAt: null,
      }),
    ]);
  });

  it("refuses plans that break the upload policy before recording anything", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    objectStore.current = new DirectMemoryObjectStore();
    const checksum = "a".repeat(64);
    const file = { contentType: "image/jpeg", byteSize: 1, originalFilename: null, checksum };

    for (const files of [
      Array.from({ length: MAX_FILES + 1 }, () => file),
      [{ ...file, contentType: "text/plain" }],
      [{ ...file, byteSize: MAX_ORIGINAL_BYTES_PER_FILE + 1 }],
      [{ ...file, checksum: null }],
      Array.from(
        { length: Math.floor(MAX_NORMALIZED_BYTES_PER_ATTEMPT / MAX_ORIGINAL_BYTES_PER_FILE) + 1 },
        () => ({ ...file, byteSize: MAX_ORIGINAL_BYTES_PER_FILE })
      ),
    ]) {
      await expect(planDirectUpload(files)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    }
    expect(await db.select().from(storedFiles)).toEqual([]);
  });

  it("plans uploads without a quota", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    objectStore.current = new DirectMemoryObjectStore();
    const file = {
      contentType: "image/jpeg",
      byteSize: 1,
      originalFilename: null,
      checksum: "a".repeat(64),
    };
    // Well past the 20 pending files the removed quota allowed.
    for (let planned = 0; planned < 24; planned += MAX_FILES) {
      await planDirectUpload(Array.from({ length: MAX_FILES }, () => file));
    }

    expect(await db.select().from(storedFiles)).toHaveLength(24);
  });

  it("verifies, normalizes and readies uploaded files, and a retry changes nothing", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    objectStore.current = storage;
    const bytes = await receiptJpeg();
    const { id } = await plannedUpload(storage, bytes);

    await expect(
      finalizeDirectUpload({ storedFileIds: [crypto.randomUUID()] })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readAuthorizedFile(id)).resolves.toBeNull();

    const [file] = await finalizeDirectUpload({ storedFileIds: [id] });

    const storedBytes = storage.files.get(`stored/${id}`);
    expect(storedBytes).toBeDefined();
    expect(storedBytes).not.toEqual(bytes);
    expect(file).toMatchObject({
      id,
      metadata: {
        checksum: sha256(storedBytes!),
        contentType: "image/webp",
        byteSize: storedBytes!.length,
        originalFilename: "receipt.jpg",
      },
    });
    expect(file).not.toHaveProperty("storageKey");
    expect(storage.files.has(`temporary/${id}`)).toBe(false);

    const before = await db.execute(sql`SELECT xmin::text FROM stored_files WHERE id = ${id}`);
    await expect(finalizeDirectUpload({ storedFileIds: [id] })).resolves.toEqual([file]);
    const after = await db.execute(sql`SELECT xmin::text FROM stored_files WHERE id = ${id}`);
    expect(after.rows).toEqual(before.rows);
    expect(storage.readKeys).toEqual([`temporary/${id}`]);

    const pending = await createPendingAttempt({
      input: { text: null, storedFileIds: [id], documentDate: null },
      bookId: await testBookId(db),
    });
    expect(pending.document.latestAttemptId).toBe(pending.attempt.id);
    await expect(readAuthorizedFile(id)).resolves.toMatchObject({ file: { id } });
  });

  it("lets two finalizations of the same files agree on one result", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    objectStore.current = storage;
    const { id } = await plannedUpload(storage, await receiptJpeg());

    const results = await Promise.allSettled([
      finalizeDirectUpload({ storedFileIds: [id] }),
      finalizeDirectUpload({ storedFileIds: [id] }),
    ]);

    const settled = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    expect(settled.length).toBeGreaterThan(0);
    const row = await db.query.storedFiles.findFirst({ where: eq(storedFiles.id, id) });
    expect(row?.finalizedAt).not.toBeNull();
    for (const value of settled) {
      expect(value).toEqual([
        expect.objectContaining({
          id,
          metadata: expect.objectContaining({ checksum: row!.checksum }),
        }),
      ]);
    }
  });

  it("never lets a document take a file that is still pending", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    objectStore.current = storage;
    const { id } = await plannedUpload(storage, await receiptJpeg());

    await expect(
      createPendingAttempt({
        input: { text: null, storedFileIds: [id], documentDate: null },
        bookId: await testBookId(db),
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a plan finalized after it expired", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    objectStore.current = storage;
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-15T00:00:00.000Z") });
    const { id, plan } = await plannedUpload(storage, await receiptJpeg());
    expect(plan.expiresAt).toBe(
      new Date(Date.parse("2026-07-15T00:00:00.000Z") + UPLOAD_PLAN_EXPIRY_MS).toISOString()
    );

    vi.setSystemTime(Date.parse(plan.expiresAt));
    await expect(finalizeDirectUpload({ storedFileIds: [id] })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(storage.files.has(`stored/${id}`)).toBe(false);
  });

  it("discards files whose bytes break the plan", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    objectStore.current = storage;
    const expected = await receiptJpeg();
    const tampered = Buffer.concat([expected, Buffer.from([0])]);
    const plan = await planDirectUpload([
      {
        contentType: "image/jpeg",
        byteSize: tampered.length,
        originalFilename: null,
        checksum: sha256(expected),
      },
    ]);
    const id = plan.targets[0]!.id;
    // The browser's own checksum header claims the planned digest, but the
    // bytes are not the planned ones.
    storage.put(`temporary/${id}`, tampered, "image/jpeg", sha256(expected));

    await expect(finalizeDirectUpload({ storedFileIds: [id] })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect(await db.select().from(storedFiles)).toEqual([]);
    expect([...storage.files.keys()]).toEqual([]);
  });

  it("keeps files pending when their normalized total is over the attempt limit", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    objectStore.current = storage;
    const width = 1600;
    const height = 1600;
    const pixels = Buffer.allocUnsafe(width * height * 3);
    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = (index * 31 + Math.floor(index / 97) * 17) % 256;
    }
    const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 30 })
      .toBuffer();
    const digest = sha256(bytes);
    const plan = await planDirectUpload(
      Array.from({ length: 3 }, () => ({
        contentType: "image/jpeg",
        byteSize: bytes.length,
        originalFilename: null,
        checksum: digest,
      }))
    );
    for (const target of plan.targets) {
      storage.put(`temporary/${target.id}`, bytes, "image/jpeg", digest);
    }

    await expect(
      finalizeDirectUpload({ storedFileIds: plan.targets.map((target) => target.id) })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const rows = await db.select().from(storedFiles);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.finalizedAt == null)).toBe(true);
    expect(plan.targets.some((target) => storage.files.has(`stored/${target.id}`))).toBe(false);
  });

  it("stores server-held images as ready files without a temporary object", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    objectStore.current = storage;
    const bytes = Buffer.from("normalized-image");

    const [id] = await storeProcessedImages([{ bytes, contentType: "image/webp" }]);

    expect([...storage.files.keys()]).toEqual([`stored/${id}`]);
    expect(await db.query.storedFiles.findFirst({ where: eq(storedFiles.id, id!) })).toMatchObject({
      contentType: "image/webp",
      byteSize: bytes.length,
      checksum: sha256(bytes),
      finalizedAt: expect.any(Date),
    });
  });

  it("leaves nothing behind when a server-held image cannot be stored", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    storage.upload = async () => {
      throw new Error("storage unavailable");
    };
    objectStore.current = storage;

    await expect(
      storeProcessedImages([{ bytes: Buffer.from("image"), contentType: "image/webp" }])
    ).rejects.toThrow("storage unavailable");

    expect(await db.select().from(storedFiles)).toEqual([]);
  });
});
