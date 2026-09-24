import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type {
  DirectUploadPlanContract,
  LedgerId,
  UploadFileRequestContract,
  UploadPlanContract,
} from "@/application/contracts";
import { enqueueObjectCleanup } from "@/server/maintenance/object-cleanup";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import {
  MAX_FILES,
  MAX_NORMALIZED_BYTES_PER_REVISION,
  MAX_ORIGINAL_BYTES_PER_FILE,
  DIRECT_UPLOAD_FINALIZE_BUFFER_MS,
  UPLOAD_SESSION_EXPIRY_MS,
} from "@/lib/storage/upload-policy";
import { uploadSessionFiles, uploadSessions } from "@/persistence";
import {
  type ResolvedStoredFileAdapterDependencies,
  temporaryKey,
  tokenHash,
  validateRequests,
} from "./shared";

export function createUploadPlanOperations(dependencies: ResolvedStoredFileAdapterDependencies) {
  const { storage, now, uploadSessions: uploadSessionRepository } = dependencies;

  async function createUploadPlan(
    ledgerId: LedgerId,
    files: readonly UploadFileRequestContract[] = []
  ): Promise<UploadPlanContract> {
    validateRequests(files);
    const sessionId = crypto.randomUUID();
    const finalizationToken = crypto.randomBytes(32).toString("base64url");
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + UPLOAD_SESSION_EXPIRY_MS);
    const targetIds = files.map(() => crypto.randomUUID());

    await uploadSessionRepository.create({
      id: sessionId,
      ledgerId,
      finalizationTokenHash: tokenHash(finalizationToken),
      transport: "proxy",
      expiresAt,
      createdAt,
      targets: files.map((file, position) => ({
        id: targetIds[position]!,
        position,
        contentType: file.contentType,
        byteSize: file.byteSize,
        originalFilename: file.originalFilename,
        checksum: file.checksum ?? null,
      })),
    });

    return {
      id: sessionId,
      expiresAt: expiresAt.toISOString(),
      targets: targetIds.map((id) => ({ id })),
      finalizationToken,
      maxFiles: MAX_FILES,
      maxBytesPerFile: MAX_ORIGINAL_BYTES_PER_FILE,
    };
  }

  async function createDirectUploadPlan(
    ledgerId: LedgerId,
    files: readonly UploadFileRequestContract[]
  ): Promise<DirectUploadPlanContract> {
    validateRequests(files);
    if (files.some((file) => file.checksum == null || !/^[a-f\d]{64}$/.test(file.checksum))) {
      throw new ValidationError("Direct uploads require a lowercase SHA-256 checksum");
    }
    if (
      files.reduce((total, file) => total + file.byteSize, 0) > MAX_NORMALIZED_BYTES_PER_REVISION
    ) {
      throw new ValidationError("Direct upload batch exceeds the configured total byte limit");
    }

    const sessionId = crypto.randomUUID();
    const finalizationToken = crypto.randomBytes(32).toString("base64url");
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + UPLOAD_SESSION_EXPIRY_MS);
    const targetIds = files.map(() => crypto.randomUUID());

    await uploadSessionRepository.create({
      id: sessionId,
      ledgerId,
      finalizationTokenHash: tokenHash(finalizationToken),
      transport: "direct",
      expiresAt,
      createdAt,
      targets: files.map((file, position) => ({
        id: targetIds[position]!,
        position,
        contentType: file.contentType,
        byteSize: file.byteSize,
        originalFilename: file.originalFilename,
        checksum: file.checksum!.toLowerCase(),
      })),
    });

    try {
      const targets = await Promise.all(
        files.map(async (file, position) => {
          const targetId = targetIds[position]!;
          const signed = await storage.presignUpload(
            temporaryKey(ledgerId, sessionId, targetId),
            file.contentType,
            file.checksum!,
            Math.floor((UPLOAD_SESSION_EXPIRY_MS - DIRECT_UPLOAD_FINALIZE_BUFFER_MS) / 1000)
          );
          return { id: targetId, ...signed };
        })
      );
      return {
        id: sessionId,
        expiresAt: expiresAt.toISOString(),
        targets,
        finalizationToken,
        maxFiles: MAX_FILES,
        maxBytesPerFile: MAX_ORIGINAL_BYTES_PER_FILE,
      };
    } catch (error) {
      await db
        .update(uploadSessions)
        .set({ status: "cancelled" })
        .where(and(eq(uploadSessions.id, sessionId), eq(uploadSessions.status, "open")));
      throw error;
    }
  }

  async function abandonUploadSession(ledgerId: LedgerId, uploadSessionId: string): Promise<void> {
    const targets = await db.transaction(async (tx) => {
      const cancelled = await tx
        .update(uploadSessions)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(uploadSessions.id, uploadSessionId),
            eq(uploadSessions.ledgerId, ledgerId),
            inArray(uploadSessions.status, ["open", "finalizing", "finalized"])
          )
        )
        .returning({ id: uploadSessions.id });
      if (cancelled.length === 0) return [];
      return tx
        .select({ targetId: uploadSessionFiles.targetId })
        .from(uploadSessionFiles)
        .where(
          and(
            eq(uploadSessionFiles.ledgerId, ledgerId),
            eq(uploadSessionFiles.uploadSessionId, uploadSessionId)
          )
        );
    });
    await Promise.all(
      targets.map((target) =>
        enqueueObjectCleanup(
          temporaryKey(ledgerId, uploadSessionId, target.targetId),
          uploadSessionId
        )
      )
    );
  }

  return { createUploadPlan, createDirectUploadPlan, abandonUploadSession };
}
