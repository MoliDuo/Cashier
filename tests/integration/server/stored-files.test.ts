import { createPendingRevision } from "tests/helpers/processing-revision";
import type { ObjectStore } from "@/lib/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq, sql } from "drizzle-orm";
import { getTestDb } from "../../setup";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { uploadTarget } from "@/server/stored-files/proxy-uploads";
import { readAuthorizedFile } from "@/server/stored-files/reads";
import { finalizeDirectUpload, finalizeUpload } from "@/server/stored-files/upload-finalization";
import { createDirectUploadPlan, createUploadPlan } from "@/server/stored-files/upload-plans";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import {
  DIRECT_UPLOAD_FINALIZE_BUFFER_MS,
  MAX_FILES,
  MAX_NORMALIZED_BYTES_PER_REVISION,
  MAX_ORIGINAL_BYTES_PER_FILE,
  UPLOAD_SESSION_EXPIRY_MS,
} from "@/lib/storage/upload-policy";
import { sourceDocuments, uploadSessions } from "@/persistence";

const objectStore = vi.hoisted(() => ({ current: undefined as ObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

class CoordinatedObjectStore extends MemoryObjectStore {
  readonly deletedKeys: string[] = [];
  private uploadCount = 0;
  private releaseUploads: (() => void) | null = null;
  private readonly uploadsReady = new Promise<void>((resolve) => {
    this.releaseUploads = resolve;
  });

  override async upload(key: string, data: Buffer): Promise<string> {
    this.files.set(key, Buffer.from(data));
    this.uploadCount += 1;
    if (this.uploadCount === 2) this.releaseUploads?.();
    await this.uploadsReady;
    return `/private/${key}`;
  }

  override async delete(key: string): Promise<{ success: boolean }> {
    this.deletedKeys.push(key);
    this.files.delete(key);
    return { success: true };
  }
}

class DirectMemoryObjectStore extends MemoryObjectStore {
  readonly metadata = new Map<
    string,
    { byteSize: number; contentType: string; metadata: Record<string, string> }
  >();
  readonly presignTtlSeconds: number[] = [];

  async presignUpload(key: string, contentType: string, sha256: string, expiresInSeconds: number) {
    this.presignTtlSeconds.push(expiresInSeconds);
    return {
      url: `https://r2.test/${key}`,
      requiredHeaders: { "Content-Type": contentType, "x-amz-meta-sha256": sha256 },
    };
  }

  readonly readKeys: string[] = [];
  async readObject(key: string) {
    this.readKeys.push(key);
    const value = this.metadata.get(key);
    if (value == null) throw new Error("missing object");
    return { bytes: await this.download(key), metadata: value };
  }
}

describe("stored-file uploads and reads", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("plans, validates, finalizes, expires, and authorizes R2 stored files", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const { ledgerId: otherLedgerId } = await createTestUserWithLedger(
      db,
      undefined,
      undefined,
      crypto.randomUUID()
    );
    const storage = new MemoryObjectStore();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-15T00:00:00.000Z") });
    objectStore.current = storage;
    const bytes = Buffer.from("image-bytes");
    const plan = await createUploadPlan(ledgerId, [
      {
        contentType: "image/jpeg",
        byteSize: bytes.length,
        originalFilename: "receipt.jpg",
      },
    ]);
    const uploaded = await uploadTarget({
      ledgerId,
      uploadSessionId: plan.id,
      targetId: plan.targets[0]!.id,
      contentType: "image/jpeg",
      body: bytes,
    });
    const [finalized] = await finalizeUpload({
      ledgerId,
      uploadSessionId: plan.id,
      finalizationToken: plan.finalizationToken,
      targetIds: [plan.targets[0]!.id],
    });
    expect(finalized).toMatchObject({ id: uploaded.id });
    await expect(
      finalizeUpload({
        ledgerId,
        uploadSessionId: plan.id,
        finalizationToken: plan.finalizationToken,
        targetIds: [plan.targets[0]!.id],
      })
    ).resolves.toMatchObject([{ id: uploaded.id }]);
    const concurrentFinalize = () =>
      finalizeUpload({
        ledgerId,
        uploadSessionId: plan.id,
        finalizationToken: plan.finalizationToken,
        targetIds: [plan.targets[0]!.id],
      });
    const concurrentResults = await Promise.all([concurrentFinalize(), concurrentFinalize()]);
    expect(concurrentResults).toEqual([
      [expect.objectContaining({ id: uploaded.id })],
      [expect.objectContaining({ id: uploaded.id })],
    ]);
    await expect(
      finalizeUpload({
        ledgerId: otherLedgerId,
        uploadSessionId: plan.id,
        finalizationToken: plan.finalizationToken,
        targetIds: [plan.targets[0]!.id],
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const pending = await createPendingRevision({
      ledgerId,
      input: { text: null, storedFileIds: [uploaded.id], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    expect(
      await db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, pending.document.id),
      })
    ).not.toHaveProperty("imageUrls");
    await expect(readAuthorizedFile(ledgerId, uploaded.id)).resolves.toMatchObject({
      file: { id: uploaded.id },
    });
    await expect(readAuthorizedFile(otherLedgerId, uploaded.id)).resolves.toBeNull();
    expect(pending.document.latestSubmissionRevisionId).toBe(pending.revision.id);

    await expect(
      createUploadPlan(
        ledgerId,
        Array.from({ length: MAX_FILES + 1 }, () => ({
          contentType: "image/jpeg",
          byteSize: 1,
          originalFilename: null,
        }))
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      createUploadPlan(ledgerId, [
        { contentType: "text/plain", byteSize: 1, originalFilename: null },
      ])
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      createUploadPlan(ledgerId, [
        {
          contentType: "image/jpeg",
          byteSize: MAX_ORIGINAL_BYTES_PER_FILE + 1,
          originalFilename: null,
        },
      ])
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const expiring = await createUploadPlan(ledgerId, [
      { contentType: "image/png", byteSize: 1, originalFilename: null },
    ]);
    vi.setSystemTime(Date.parse(expiring.expiresAt) + 1);
    await expect(
      uploadTarget({
        ledgerId,
        uploadSessionId: expiring.id,
        targetId: expiring.targets[0]!.id,
        contentType: "image/png",
        body: new Uint8Array([1]),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.query.uploadSessions.findFirst({ where: eq(uploadSessions.id, expiring.id) })
    ).toMatchObject({ status: "expired" });
  });

  it("cleans up the R2 object when a concurrent target claim loses its transaction", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const storage = new CoordinatedObjectStore();
    objectStore.current = storage;
    const bytes = Buffer.from("same-target");
    const plan = await createUploadPlan(ledgerId, [
      { contentType: "image/jpeg", byteSize: bytes.length, originalFilename: "receipt.jpg" },
    ]);
    const upload = () =>
      uploadTarget({
        ledgerId,
        uploadSessionId: plan.id,
        targetId: plan.targets[0]!.id,
        contentType: "image/jpeg",
        body: bytes,
      });

    const results = await Promise.allSettled([upload(), upload()]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(storage.deletedKeys).toHaveLength(1);
    expect(storage.files.size).toBe(1);
  });

  it("presigns, verifies, promotes, and idempotently finalizes direct uploads", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    objectStore.current = storage;
    const bytes = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const digest = createHash("sha256").update(bytes).digest("hex");
    const plan = await createDirectUploadPlan(ledgerId, [
      {
        contentType: "image/jpeg",
        byteSize: bytes.length,
        originalFilename: "receipt.jpg",
        checksum: digest,
      },
    ]);
    const target = plan.targets[0]!;
    expect(storage.presignTtlSeconds).toEqual([
      Math.floor((UPLOAD_SESSION_EXPIRY_MS - DIRECT_UPLOAD_FINALIZE_BUFFER_MS) / 1000),
    ]);
    const temporaryKey = `temporary/${ledgerId}/${plan.id}/${target.id}`;
    storage.files.set(temporaryKey, bytes);
    storage.metadata.set(temporaryKey, {
      byteSize: bytes.length,
      contentType: "image/jpeg",
      metadata: { sha256: digest },
    });

    const input = {
      ledgerId,
      uploadSessionId: plan.id,
      finalizationToken: plan.finalizationToken,
      targetIds: [target.id],
    };
    const [file] = await finalizeDirectUpload(input);
    const storedBytes = storage.files.get(`${ledgerId}/stored/${target.id}`);
    expect(storedBytes).toBeDefined();
    const storedDigest = createHash("sha256").update(storedBytes!).digest("hex");
    expect(file).toMatchObject({
      id: target.id,
      metadata: { checksum: storedDigest, contentType: "image/webp" },
    });
    expect(storedBytes).not.toEqual(bytes);
    expect(storage.files.has(temporaryKey)).toBe(false);
    expect(storage.readKeys).toEqual([temporaryKey]);
    const before = await db.execute(sql`SELECT tableoid::text, xmin::text FROM stored_files
      WHERE id = ${target.id} UNION ALL SELECT tableoid::text, xmin::text FROM upload_sessions
      WHERE id = ${plan.id} UNION ALL SELECT tableoid::text, xmin::text FROM upload_session_files
      WHERE upload_session_id = ${plan.id} ORDER BY 1`);
    await expect(finalizeDirectUpload(input)).resolves.toMatchObject([{ id: target.id }]);
    const after = await db.execute(sql`SELECT tableoid::text, xmin::text FROM stored_files
      WHERE id = ${target.id} UNION ALL SELECT tableoid::text, xmin::text FROM upload_sessions
      WHERE id = ${plan.id} UNION ALL SELECT tableoid::text, xmin::text FROM upload_session_files
      WHERE upload_session_id = ${plan.id} ORDER BY 1`);
    expect(after.rows).toEqual(before.rows);
    expect(storage.readKeys).toEqual([temporaryKey]);
    expect(
      await db.query.uploadSessions.findFirst({ where: eq(uploadSessions.id, plan.id) })
    ).toMatchObject({ transport: "direct", status: "finalized" });
  });

  it("rejects oversized direct batches, target reordering, and mismatched metadata", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    objectStore.current = storage;
    const checksum = "a".repeat(64);
    await expect(
      createDirectUploadPlan(
        ledgerId,
        Array.from(
          {
            length: Math.floor(MAX_NORMALIZED_BYTES_PER_REVISION / MAX_ORIGINAL_BYTES_PER_FILE) + 1,
          },
          () => ({
            contentType: "image/jpeg",
            byteSize: MAX_ORIGINAL_BYTES_PER_FILE,
            originalFilename: null,
            checksum,
          })
        )
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const plan = await createDirectUploadPlan(ledgerId, [
      { contentType: "image/jpeg", byteSize: 1, originalFilename: null, checksum },
      { contentType: "image/png", byteSize: 1, originalFilename: null, checksum },
    ]);
    const [first, second] = plan.targets;
    await expect(
      finalizeDirectUpload({
        ledgerId,
        uploadSessionId: plan.id,
        finalizationToken: plan.finalizationToken,
        targetIds: [second!.id, first!.id],
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    for (const target of plan.targets) {
      const key = `temporary/${ledgerId}/${plan.id}/${target.id}`;
      storage.files.set(key, Buffer.from([1]));
      storage.metadata.set(key, {
        byteSize: 1,
        contentType: target.id === first!.id ? "image/webp" : "image/png",
        metadata: { sha256: checksum },
      });
    }
    await expect(
      finalizeDirectUpload({
        ledgerId,
        uploadSessionId: plan.id,
        finalizationToken: plan.finalizationToken,
        targetIds: plan.targets.map((target) => target.id),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      await db.query.uploadSessions.findFirst({ where: eq(uploadSessions.id, plan.id) })
    ).toMatchObject({ status: "cancelled" });
  });

  it("rejects direct upload bytes that disagree with trusted-looking checksum metadata", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const storage = new DirectMemoryObjectStore();
    objectStore.current = storage;
    const expectedBytes = Buffer.from("expected");
    const actualBytes = Buffer.from("tampered");
    const checksum = createHash("sha256").update(expectedBytes).digest("hex");
    const plan = await createDirectUploadPlan(ledgerId, [
      {
        contentType: "image/jpeg",
        byteSize: actualBytes.length,
        originalFilename: null,
        checksum,
      },
    ]);
    const target = plan.targets[0]!;
    const key = `temporary/${ledgerId}/${plan.id}/${target.id}`;
    storage.files.set(key, actualBytes);
    storage.metadata.set(key, {
      byteSize: actualBytes.length,
      contentType: "image/jpeg",
      metadata: { sha256: checksum },
    });

    await expect(
      finalizeDirectUpload({
        ledgerId,
        uploadSessionId: plan.id,
        finalizationToken: plan.finalizationToken,
        targetIds: [target.id],
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(storage.files.has(`${ledgerId}/stored/${target.id}`)).toBe(false);
  });

  it("rejects normalized aggregate overflow before promoting direct-upload objects", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
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
    const digest = createHash("sha256").update(bytes).digest("hex");
    const plan = await createDirectUploadPlan(
      ledgerId,
      Array.from({ length: 3 }, () => ({
        contentType: "image/jpeg",
        byteSize: bytes.length,
        originalFilename: null,
        checksum: digest,
      }))
    );
    for (const target of plan.targets) {
      const key = `temporary/${ledgerId}/${plan.id}/${target.id}`;
      storage.files.set(key, bytes);
      storage.metadata.set(key, {
        byteSize: bytes.length,
        contentType: "image/jpeg",
        metadata: { sha256: digest },
      });
    }

    await expect(
      finalizeDirectUpload({
        ledgerId,
        uploadSessionId: plan.id,
        finalizationToken: plan.finalizationToken,
        targetIds: plan.targets.map((target) => target.id),
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(
      await db.query.uploadSessions.findFirst({ where: eq(uploadSessions.id, plan.id) })
    ).toMatchObject({ status: "open" });
    expect(
      plan.targets.some((target) => storage.files.has(`${ledgerId}/stored/${target.id}`))
    ).toBe(false);
  });
});
