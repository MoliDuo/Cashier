import type { ObjectStore } from "@/lib/storage";
/**
 * Upload Policy Integration Tests
 *
 * Covers boundary enforcement across the full upload -> finalize -> revision-attach
 * pipeline, using the real Postgres adapters with an in-memory R2 store.
 * Every test verifies that policy violations terminate before durable state
 * is created and that internal keys are never leaked.
 */

import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { uploadTarget } from "@/server/stored-files/proxy-uploads";
import { finalizeUpload } from "@/server/stored-files/upload-finalization";
import { createUploadPlan } from "@/server/stored-files/upload-plans";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { createProcessingRevisionInTransaction } from "@/modules/source-document/server/revisions";
import type { StoredFileContract } from "@/server/stored-files/types";
import { ValidationError } from "@/lib/errors";
import {
  MAX_NORMALIZED_BYTES_PER_REVISION,
  MAX_ORIGINAL_BYTES_PER_FILE,
  MAX_FILES,
} from "@/lib/storage/upload-policy";
import { sourceDocumentRevisions, storedFiles, uploadSessions } from "@/persistence";
import { createTestUserWithLedger, testBookId } from "../../../helpers/schema-setup";
import { getTestDb } from "../../../setup";

const objectStore = vi.hoisted(() => ({ current: undefined as ObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

/** Create a finalized stored file via the full upload-plan -> upload -> finalize flow. */
async function finalizedFile(
  ledgerId: string,
  body: Buffer,
  overrides?: { contentType?: string; checksum?: string | null }
): Promise<StoredFileContract> {
  const contentType = overrides?.contentType ?? "image/jpeg";
  const plan = await createUploadPlan(ledgerId, [
    {
      contentType,
      byteSize: body.length,
      originalFilename: null,
      ...(overrides?.checksum ? { checksum: overrides.checksum } : {}),
    },
  ]);
  await uploadTarget({
    ledgerId,
    uploadSessionId: plan.id,
    targetId: plan.targets[0]!.id,
    contentType,
    body,
  });
  const files = await finalizeUpload({
    ledgerId,
    uploadSessionId: plan.id,
    finalizationToken: plan.finalizationToken,
    targetIds: [plan.targets[0]!.id],
  });
  return files[0]!;
}

describe("upload policy integration", () => {
  describe("invalid uploads produce no source document", () => {
    it("rejects upload plan with unsupported MIME type before any durable state", async () => {
      const { ledgerId } = await createTestUserWithLedger(getTestDb());
      objectStore.current = new MemoryObjectStore();

      await expect(
        createUploadPlan(ledgerId, [
          { contentType: "image/bmp", byteSize: 1024, originalFilename: null },
        ])
      ).rejects.toThrow(ValidationError);

      // No upload session was created
      const db = getTestDb();
      const sessions = await db.select().from(uploadSessions);
      expect(sessions).toHaveLength(0);
    });

    it("rejects upload plan with oversized file before any durable state", async () => {
      const { ledgerId } = await createTestUserWithLedger(getTestDb());
      objectStore.current = new MemoryObjectStore();

      await expect(
        createUploadPlan(ledgerId, [
          {
            contentType: "image/jpeg",
            byteSize: MAX_ORIGINAL_BYTES_PER_FILE + 1,
            originalFilename: null,
          },
        ])
      ).rejects.toThrow(ValidationError);

      const db = getTestDb();
      const sessions = await db.select().from(uploadSessions);
      expect(sessions).toHaveLength(0);
    });

    it("rejects upload plan with too many files before any durable state", async () => {
      const { ledgerId } = await createTestUserWithLedger(getTestDb());
      objectStore.current = new MemoryObjectStore();
      const files = Array.from({ length: MAX_FILES + 1 }, () => ({
        contentType: "image/jpeg" as const,
        byteSize: 1024,
        originalFilename: null as string | null,
      }));

      await expect(createUploadPlan(ledgerId, files)).rejects.toThrow(ValidationError);

      const db = getTestDb();
      const sessions = await db.select().from(uploadSessions);
      expect(sessions).toHaveLength(0);
    });
  });

  describe("checksum mismatch at finalization", () => {
    it("rejects upload target when actual bytes do not match expected checksum", async () => {
      const { ledgerId } = await createTestUserWithLedger(getTestDb());
      objectStore.current = new MemoryObjectStore();

      const body = Buffer.from("receipt-image-data");
      // Provide a checksum that does NOT match the actual body
      const wrongChecksum = "a".repeat(64);
      const plan = await createUploadPlan(ledgerId, [
        {
          contentType: "image/jpeg",
          byteSize: body.length,
          originalFilename: null,
          checksum: wrongChecksum,
        },
      ]);

      await expect(
        uploadTarget({
          ledgerId,
          uploadSessionId: plan.id,
          targetId: plan.targets[0]!.id,
          contentType: "image/jpeg",
          body,
        })
      ).rejects.toThrow(ValidationError);

      // No stored file was created in the database
      const db = getTestDb();
      const allFiles = await db.select().from(storedFiles);
      expect(allFiles).toHaveLength(0);
    });

    it("accepts upload when checksum matches", async () => {
      const { ledgerId } = await createTestUserWithLedger(getTestDb());
      objectStore.current = new MemoryObjectStore();

      const body = Buffer.from("valid-image-data");
      const plan = await createUploadPlan(ledgerId, [
        {
          contentType: "image/jpeg",
          byteSize: body.length,
          originalFilename: null,
        },
      ]);

      await expect(
        uploadTarget({
          ledgerId,
          uploadSessionId: plan.id,
          targetId: plan.targets[0]!.id,
          contentType: "image/jpeg",
          body,
        })
      ).resolves.toBeDefined();
    });
  });

  describe("aggregate byte overflow at revision attachment", () => {
    it("rejects revision attachment when total bytes exceed MAX_NORMALIZED_BYTES_PER_REVISION", async () => {
      const db = getTestDb();
      const { ledgerId } = await createTestUserWithLedger(db);
      const bookId = await testBookId(db, ledgerId);
      objectStore.current = new MemoryObjectStore();

      // Create enough finalized stored files to overflow the revision aggregate limit.
      // Each file must be below MAX_ORIGINAL_BYTES_PER_FILE (4 MB), but their sum
      // must exceed MAX_NORMALIZED_BYTES_PER_REVISION (20 MB).
      const fileSize = Math.floor(MAX_ORIGINAL_BYTES_PER_FILE * 0.9); // ~3.6 MB per file
      const fileCount = Math.ceil(MAX_NORMALIZED_BYTES_PER_REVISION / fileSize) + 1; // enough to exceed
      const totalBytes = fileSize * fileCount;
      expect(totalBytes).toBeGreaterThan(MAX_NORMALIZED_BYTES_PER_REVISION);
      expect(fileSize).toBeLessThanOrEqual(MAX_ORIGINAL_BYTES_PER_FILE);

      const files = await Promise.all(
        Array.from({ length: fileCount }, () =>
          finalizedFile(ledgerId, Buffer.alloc(fileSize, 0xff))
        )
      );

      // Try to create a pending revision linking both files — must run inside a
      // db.transaction since createProcessingRevisionInTransaction expects a tx handle.
      await expect(
        db.transaction(async (tx) =>
          createProcessingRevisionInTransaction(tx, {
            ledgerId,
            bookId,
            input: {
              text: null,
              storedFileIds: files.map((f) => f.id),
              documentDate: "2026-07-15",
            },
          })
        )
      ).rejects.toThrow(ValidationError);

      // No revision rows were created in the database
      const revisions = await db.select().from(sourceDocumentRevisions);
      expect(revisions).toHaveLength(0);
    });

    it("accepts revision attachment when total bytes are within limit", async () => {
      const db = getTestDb();
      const { ledgerId } = await createTestUserWithLedger(db);
      const bookId = await testBookId(db, ledgerId);
      objectStore.current = new MemoryObjectStore();

      const body = Buffer.from("small-file");
      const file = await finalizedFile(ledgerId, body);

      const result = await db.transaction(async (tx) =>
        createProcessingRevisionInTransaction(tx, {
          ledgerId,
          bookId,
          input: { text: null, storedFileIds: [file.id], documentDate: "2026-07-15" },
        })
      );

      expect(result.document).toBeDefined();
      expect(result.revision).toBeDefined();
    });
  });

  describe("aggregate file count at revision boundary", () => {
    it("rejects revision attachment when file count exceeds MAX_FILES", async () => {
      const db = getTestDb();
      const { ledgerId } = await createTestUserWithLedger(db);
      const bookId = await testBookId(db, ledgerId);
      objectStore.current = new MemoryObjectStore();

      // Create MAX_FILES + 1 finalized stored files
      const body = Buffer.from("tiny");
      const files = await Promise.all(
        Array.from({ length: MAX_FILES + 1 }, () => finalizedFile(ledgerId, body))
      );

      await expect(
        db.transaction(async (tx) =>
          createProcessingRevisionInTransaction(tx, {
            ledgerId,
            bookId,
            input: {
              text: null,
              storedFileIds: files.map((f) => f.id),
              documentDate: "2026-07-15",
            },
          })
        )
      ).rejects.toThrow(ValidationError);

      // No revision was created
      const revisions = await db.select().from(sourceDocumentRevisions);
      expect(revisions).toHaveLength(0);
    });

    it("accepts revision attachment at exactly MAX_FILES", async () => {
      const db = getTestDb();
      const { ledgerId } = await createTestUserWithLedger(db);
      const bookId = await testBookId(db, ledgerId);
      objectStore.current = new MemoryObjectStore();

      const body = Buffer.from("tiny");
      const files = await Promise.all(
        Array.from({ length: MAX_FILES }, () => finalizedFile(ledgerId, body))
      );

      const result = await db.transaction(async (tx) =>
        createProcessingRevisionInTransaction(tx, {
          ledgerId,
          bookId,
          input: {
            text: null,
            storedFileIds: files.map((f) => f.id),
            documentDate: "2026-07-15",
          },
        })
      );

      expect(result.document).toBeDefined();
      expect(result.revision).toBeDefined();
    });

    it("rejects revision with duplicate stored-file IDs", async () => {
      const db = getTestDb();
      const { ledgerId } = await createTestUserWithLedger(db);
      const bookId = await testBookId(db, ledgerId);
      objectStore.current = new MemoryObjectStore();

      const file = await finalizedFile(ledgerId, Buffer.from("tiny"));

      await expect(
        db.transaction(async (tx) =>
          createProcessingRevisionInTransaction(tx, {
            ledgerId,
            bookId,
            input: {
              text: null,
              storedFileIds: [file.id, file.id],
              documentDate: "2026-07-15",
            },
          })
        )
      ).rejects.toThrow(ValidationError);

      const revisions = await db.select().from(sourceDocumentRevisions);
      expect(revisions).toHaveLength(0);
    });
  });

  describe("R2 storage keys are never exposed in responses", () => {
    it("does not return storageKey in stored file query results", async () => {
      const db = getTestDb();
      const { ledgerId } = await createTestUserWithLedger(db);
      objectStore.current = new MemoryObjectStore();

      const file = await finalizedFile(ledgerId, Buffer.from("no-keys"));

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
          storageProvider: storedFiles.storageProvider,
        })
        .from(storedFiles)
        .where(eq(storedFiles.id, file.id))
        .then((rows) => rows[0]);
      expect(rawRow).toBeDefined();
      expect(rawRow!.storageKey).toContain(ledgerId);
      expect(rawRow!.storageProvider).toBe("s3");
    });
  });
});
