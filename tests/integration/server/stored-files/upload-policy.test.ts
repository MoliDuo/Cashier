import type { ObjectStore } from "@/lib/storage";
/**
 * Upload Policy Integration Tests
 *
 * Covers boundary enforcement across the full upload -> finalize -> attempt-attach
 * pipeline, using the real Postgres adapters with an in-memory R2 store.
 * Every test verifies that policy violations terminate before durable state
 * is created and that internal keys are never leaked.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  finalizeDirectUpload,
  planDirectUpload,
  storeProcessedImages,
} from "@/server/stored-files/uploads";
import { DirectMemoryObjectStore, MemoryObjectStore } from "tests/helpers/memory-object-store";
import { createProcessingAttemptInTransaction } from "@/modules/source-document/server/extraction-attempts";
import { ConflictError, ValidationError } from "@/lib/errors";
import {
  MAX_NORMALIZED_BYTES_PER_ATTEMPT,
  MAX_ORIGINAL_BYTES_PER_FILE,
  MAX_FILES,
} from "@/lib/storage/upload-policy";
import { extractionAttempts, storedFiles } from "@/persistence";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

const objectStore = vi.hoisted(() => ({ current: undefined as ObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

/** A ready stored file holding `body`, as the server stores an image it already holds. */
async function finalizedFile(body: Buffer): Promise<{ id: string }> {
  const [id] = await storeProcessedImages([{ bytes: body, contentType: "image/jpeg" }]);
  return { id: id! };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("upload policy integration", () => {
  describe("invalid uploads produce no source document", () => {
    it("rejects upload plan with unsupported MIME type before any durable state", async () => {
      await createTestUserWithLedger(getTestDb());
      objectStore.current = new MemoryObjectStore();

      await expect(
        planDirectUpload([
          {
            contentType: "image/bmp",
            byteSize: 1024,
            originalFilename: null,
            checksum: "a".repeat(64),
          },
        ])
      ).rejects.toThrow(ValidationError);

      expect(await getTestDb().select().from(storedFiles)).toHaveLength(0);
    });

    it("rejects upload plan with oversized file before any durable state", async () => {
      await createTestUserWithLedger(getTestDb());
      objectStore.current = new MemoryObjectStore();

      await expect(
        planDirectUpload([
          {
            contentType: "image/jpeg",
            byteSize: MAX_ORIGINAL_BYTES_PER_FILE + 1,
            originalFilename: null,
            checksum: "a".repeat(64),
          },
        ])
      ).rejects.toThrow(ValidationError);

      expect(await getTestDb().select().from(storedFiles)).toHaveLength(0);
    });

    it("rejects upload plan with too many files before any durable state", async () => {
      await createTestUserWithLedger(getTestDb());
      objectStore.current = new MemoryObjectStore();
      const files = Array.from({ length: MAX_FILES + 1 }, () => ({
        contentType: "image/jpeg" as const,
        byteSize: 1024,
        originalFilename: null as string | null,
        checksum: "a".repeat(64),
      }));

      await expect(planDirectUpload(files)).rejects.toThrow(ValidationError);

      expect(await getTestDb().select().from(storedFiles)).toHaveLength(0);
    });
  });

  describe("checksum mismatch at finalization", () => {
    it("rejects uploaded bytes that do not match the planned checksum", async () => {
      await createTestUserWithLedger(getTestDb());
      const storage = new DirectMemoryObjectStore();
      objectStore.current = storage;

      const body = Buffer.from("receipt-image-data");
      // Plan a checksum that does NOT match the bytes the browser sends.
      const wrongChecksum = "a".repeat(64);
      const plan = await planDirectUpload([
        {
          contentType: "image/jpeg",
          byteSize: body.length,
          originalFilename: null,
          checksum: wrongChecksum,
        },
      ]);
      const id = plan.targets[0]!.id;
      storage.put(`temporary/${id}`, body, "image/jpeg", wrongChecksum);

      await expect(finalizeDirectUpload({ storedFileIds: [id] })).rejects.toThrow(ConflictError);

      // The planned file is discarded rather than left usable.
      expect(await getTestDb().select().from(storedFiles)).toHaveLength(0);
    });

    it("accepts uploaded bytes when the checksum matches", async () => {
      await createTestUserWithLedger(getTestDb());
      const storage = new DirectMemoryObjectStore();
      objectStore.current = storage;

      const body = await sharp({
        create: { width: 1, height: 1, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer();
      const plan = await planDirectUpload([
        {
          contentType: "image/jpeg",
          byteSize: body.length,
          originalFilename: null,
          checksum: sha256(body),
        },
      ]);
      const id = plan.targets[0]!.id;
      storage.put(`temporary/${id}`, body, "image/jpeg", sha256(body));

      await expect(finalizeDirectUpload({ storedFileIds: [id] })).resolves.toEqual([
        expect.objectContaining({ id }),
      ]);
    });
  });

  describe("aggregate byte overflow at attempt attachment", () => {
    it("rejects attempt attachment when total bytes exceed MAX_NORMALIZED_BYTES_PER_ATTEMPT", async () => {
      const db = getTestDb();
      await createTestUserWithLedger(db);
      const bookId = await testBookId(db);
      objectStore.current = new MemoryObjectStore();

      // Create enough finalized stored files to overflow the attempt aggregate limit.
      // Each file must be below MAX_ORIGINAL_BYTES_PER_FILE (4 MB), but their sum
      // must exceed MAX_NORMALIZED_BYTES_PER_ATTEMPT (20 MB).
      const fileSize = Math.floor(MAX_ORIGINAL_BYTES_PER_FILE * 0.9); // ~3.6 MB per file
      const fileCount = Math.ceil(MAX_NORMALIZED_BYTES_PER_ATTEMPT / fileSize) + 1; // enough to exceed
      const totalBytes = fileSize * fileCount;
      expect(totalBytes).toBeGreaterThan(MAX_NORMALIZED_BYTES_PER_ATTEMPT);
      expect(fileSize).toBeLessThanOrEqual(MAX_ORIGINAL_BYTES_PER_FILE);

      const files = await Promise.all(
        Array.from({ length: fileCount }, () => finalizedFile(Buffer.alloc(fileSize, 0xff)))
      );

      // Try to create a pending attempt linking both files — must run inside a
      // db.transaction since createProcessingAttemptInTransaction expects a tx handle.
      await expect(
        db.transaction(async (tx) =>
          createProcessingAttemptInTransaction(tx, {
            bookId,
            input: {
              text: null,
              storedFileIds: files.map((f) => f.id),
              documentDate: "2026-07-15",
            },
          })
        )
      ).rejects.toThrow(ValidationError);

      // No attempt rows were created in the database
      const attempts = await db.select().from(extractionAttempts);
      expect(attempts).toHaveLength(0);
    });

    it("accepts attempt attachment when total bytes are within limit", async () => {
      const db = getTestDb();
      await createTestUserWithLedger(db);
      const bookId = await testBookId(db);
      objectStore.current = new MemoryObjectStore();

      const body = Buffer.from("small-file");
      const file = await finalizedFile(body);

      const result = await db.transaction(async (tx) =>
        createProcessingAttemptInTransaction(tx, {
          bookId,
          input: { text: null, storedFileIds: [file.id], documentDate: "2026-07-15" },
        })
      );

      expect(result.document).toBeDefined();
      expect(result.attempt).toBeDefined();
    });
  });

  describe("aggregate file count at attempt boundary", () => {
    it("rejects attempt attachment when file count exceeds MAX_FILES", async () => {
      const db = getTestDb();
      await createTestUserWithLedger(db);
      const bookId = await testBookId(db);
      objectStore.current = new MemoryObjectStore();

      // Create MAX_FILES + 1 finalized stored files
      const body = Buffer.from("tiny");
      const files = await Promise.all(
        Array.from({ length: MAX_FILES + 1 }, () => finalizedFile(body))
      );

      await expect(
        db.transaction(async (tx) =>
          createProcessingAttemptInTransaction(tx, {
            bookId,
            input: {
              text: null,
              storedFileIds: files.map((f) => f.id),
              documentDate: "2026-07-15",
            },
          })
        )
      ).rejects.toThrow(ValidationError);

      // No attempt was created
      const attempts = await db.select().from(extractionAttempts);
      expect(attempts).toHaveLength(0);
    });

    it("accepts attempt attachment at exactly MAX_FILES", async () => {
      const db = getTestDb();
      await createTestUserWithLedger(db);
      const bookId = await testBookId(db);
      objectStore.current = new MemoryObjectStore();

      const body = Buffer.from("tiny");
      const files = await Promise.all(Array.from({ length: MAX_FILES }, () => finalizedFile(body)));

      const result = await db.transaction(async (tx) =>
        createProcessingAttemptInTransaction(tx, {
          bookId,
          input: {
            text: null,
            storedFileIds: files.map((f) => f.id),
            documentDate: "2026-07-15",
          },
        })
      );

      expect(result.document).toBeDefined();
      expect(result.attempt).toBeDefined();
    });

    it("rejects attempt with duplicate stored-file IDs", async () => {
      const db = getTestDb();
      await createTestUserWithLedger(db);
      const bookId = await testBookId(db);
      objectStore.current = new MemoryObjectStore();

      const file = await finalizedFile(Buffer.from("tiny"));

      await expect(
        db.transaction(async (tx) =>
          createProcessingAttemptInTransaction(tx, {
            bookId,
            input: {
              text: null,
              storedFileIds: [file.id, file.id],
              documentDate: "2026-07-15",
            },
          })
        )
      ).rejects.toThrow(ValidationError);

      const attempts = await db.select().from(extractionAttempts);
      expect(attempts).toHaveLength(0);
    });
  });

  describe("R2 storage keys are never exposed in responses", () => {
    it("does not return storageKey in stored file query results", async () => {
      const db = getTestDb();
      await createTestUserWithLedger(db);
      objectStore.current = new MemoryObjectStore();

      const storage = new DirectMemoryObjectStore();
      objectStore.current = storage;
      const body = await sharp({
        create: { width: 1, height: 1, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer();
      const plan = await planDirectUpload([
        {
          contentType: "image/jpeg",
          byteSize: body.length,
          originalFilename: null,
          checksum: sha256(body),
        },
      ]);
      storage.put(`temporary/${plan.targets[0]!.id}`, body, "image/jpeg", sha256(body));
      const [file] = await finalizeDirectUpload({
        storedFileIds: [plan.targets[0]!.id],
      });
      if (file == null) throw new Error("Expected a finalized file");

      // The StoredFileContract returned by the adapter should not contain storageKey
      expect(file).not.toHaveProperty("storageKey");
      expect(file).not.toHaveProperty("storageProvider");

      // The metadata on the contract should not contain storageKey
      if (file.metadata && typeof file.metadata === "object") {
        expect(file.metadata).not.toHaveProperty("storageKey");
      }

      // Verify the raw database row does have storageKey (it exists in the DB)
      const rawRow = await db
        .select({
          storageKey: storedFiles.storageKey,
        })
        .from(storedFiles)
        .where(eq(storedFiles.id, file.id))
        .then((rows) => rows[0]);
      expect(rawRow).toBeDefined();
      expect(rawRow!.storageKey).toBe(`stored/${file.id}`);
    });
  });
});
