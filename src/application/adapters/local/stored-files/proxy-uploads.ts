import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { StoredFileContract } from "@/application/contracts";
import { enqueueObjectCleanup } from "@/application/adapters/postgres/object-cleanup";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { MAX_ORIGINAL_BYTES_PER_FILE } from "@/lib/storage/upload-policy";
import { storedFiles, uploadSessionFiles, uploadSessions } from "@/persistence";
import {
  findSingleLiveLedgerId,
  postgresLedgerAdapter,
} from "@/application/adapters/postgres/business-ports/ledger";
import { checksum, mapStoredFile } from "./shared";
import type { ResolvedStoredFileAdapterDependencies } from "./shared";

export function createProxyUploadOperations(dependencies: ResolvedStoredFileAdapterDependencies) {
  const { storage, now } = dependencies;

  async function uploadTargetForUser(input: {
    userId: string;
    uploadSessionId: string;
    targetId: string;
    contentType: string;
    body: Uint8Array;
  }): Promise<StoredFileContract> {
    const ledgerId = await findSingleLiveLedgerId();
    if (ledgerId == null || !(await postgresLedgerAdapter.canAccess(ledgerId, input.userId)))
      throw new NotFoundError("Upload target");
    const ownership = await db
      .select({ ledgerId: uploadSessions.ledgerId })
      .from(uploadSessions)
      .where(
        and(eq(uploadSessions.id, input.uploadSessionId), eq(uploadSessions.ledgerId, ledgerId))
      )
      .limit(1);
    if (ownership.length === 0) throw new NotFoundError("Upload target");
    return uploadTarget({ ...input, ledgerId });
  }

  async function uploadTarget(input: {
    ledgerId: string;
    uploadSessionId: string;
    targetId: string;
    contentType: string;
    body: Uint8Array;
  }): Promise<StoredFileContract> {
    const session = await db.query.uploadSessions.findFirst({
      where: and(
        eq(uploadSessions.ledgerId, input.ledgerId),
        eq(uploadSessions.id, input.uploadSessionId)
      ),
    });
    const uploadedAt = now();
    if (session == null || session.transport !== "proxy" || session.status !== "open") {
      throw new NotFoundError("Upload target");
    }
    if (session.expiresAt.getTime() <= uploadedAt.getTime()) {
      await db
        .update(uploadSessions)
        .set({ status: "expired" })
        .where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.status, "open")));
      throw new ConflictError("Upload plan has expired");
    }
    const target = await db.query.uploadSessionFiles.findFirst({
      where: and(
        eq(uploadSessionFiles.ledgerId, input.ledgerId),
        eq(uploadSessionFiles.uploadSessionId, input.uploadSessionId),
        eq(uploadSessionFiles.targetId, input.targetId)
      ),
    });
    if (
      target == null ||
      target.status !== "planned" ||
      target.expectedContentType == null ||
      target.expectedByteSize == null
    ) {
      throw new NotFoundError("Upload target");
    }
    const bytes = Buffer.from(input.body);
    if (
      input.contentType !== target.expectedContentType ||
      bytes.length !== target.expectedByteSize ||
      bytes.length > MAX_ORIGINAL_BYTES_PER_FILE
    ) {
      throw new ValidationError("Uploaded bytes do not match the scoped target");
    }
    const actualChecksum = checksum(bytes);
    if (
      target.expectedChecksum != null &&
      actualChecksum !== target.expectedChecksum.toLowerCase()
    ) {
      throw new ValidationError("Uploaded bytes do not match the expected checksum");
    }

    const storedFileId = crypto.randomUUID();
    const storageKey = `${input.ledgerId}/stored/${storedFileId}`;
    await storage.upload(storageKey, bytes, input.contentType);
    try {
      const file = await db.transaction(async (tx) => {
        const insertedFile = await tx
          .insert(storedFiles)
          .values({
            id: storedFileId,
            ledgerId: input.ledgerId,
            storageProvider: "s3",
            storageKey,
            contentType: input.contentType,
            byteSize: bytes.length,
            originalFilename: target.originalFilename,
            checksum: actualChecksum,
            createdAt: uploadedAt,
          })
          .returning()
          .then((rows) => rows[0]);
        const claimed = await tx
          .update(uploadSessionFiles)
          .set({ storedFileId, status: "uploaded" })
          .where(
            and(
              eq(uploadSessionFiles.ledgerId, input.ledgerId),
              eq(uploadSessionFiles.uploadSessionId, input.uploadSessionId),
              eq(uploadSessionFiles.targetId, input.targetId),
              eq(uploadSessionFiles.status, "planned")
            )
          )
          .returning({ id: uploadSessionFiles.id });
        if (claimed.length === 0) throw new ConflictError("Upload target was already used");
        if (insertedFile == null) throw new ConflictError("Stored file was not created");
        return insertedFile;
      });
      return mapStoredFile(file);
    } catch (error) {
      const cleanup = await storage.delete(storageKey);
      if (!cleanup.success) {
        await enqueueObjectCleanup(storageKey);
        logger.error(
          { provider: "s3", storageKey, cleanupError: cleanup.error },
          "Failed to clean up S3 object after database transaction failure"
        );
      }
      throw error;
    }
  }

  return { uploadTargetForUser, uploadTarget };
}
