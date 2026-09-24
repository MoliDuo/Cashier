import "server-only";
import crypto from "node:crypto";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { LedgerId } from "@/application/contracts";
import type {
  DirectUploadPlanContract,
  UploadFileRequestContract,
  UploadPlanContract,
} from "./types";
import { enqueueObjectCleanup } from "@/server/maintenance/object-cleanup";
import { db } from "@/lib/db";
import { getS3Storage } from "@/lib/storage/s3";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  UPLOAD_DAILY_BYTES_LIMIT,
  UPLOAD_OPEN_SESSION_LIMIT,
  UPLOAD_PLAN_LIMIT_PER_15_MIN,
} from "@/config/tuning";
import {
  MAX_FILES,
  MAX_NORMALIZED_BYTES_PER_REVISION,
  MAX_ORIGINAL_BYTES_PER_FILE,
  DIRECT_UPLOAD_FINALIZE_BUFFER_MS,
  UPLOAD_SESSION_EXPIRY_MS,
} from "@/lib/storage/upload-policy";
import { ledgers, uploadSessionFiles, uploadSessions } from "@/persistence";
import { temporaryKey, tokenHash, validateRequests } from "./shared";

export async function createUploadPlan(
  ledgerId: LedgerId,
  files: readonly UploadFileRequestContract[] = []
): Promise<UploadPlanContract> {
  validateRequests(files);
  const sessionId = crypto.randomUUID();
  const finalizationToken = crypto.randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + UPLOAD_SESSION_EXPIRY_MS);
  const targetIds = files.map(() => crypto.randomUUID());

  await reserveUploadSession({
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

export async function createDirectUploadPlan(
  ledgerId: LedgerId,
  files: readonly UploadFileRequestContract[]
): Promise<DirectUploadPlanContract> {
  validateRequests(files);
  if (files.some((file) => file.checksum == null || !/^[a-f\d]{64}$/.test(file.checksum))) {
    throw new ValidationError("Direct uploads require a lowercase SHA-256 checksum");
  }
  if (files.reduce((total, file) => total + file.byteSize, 0) > MAX_NORMALIZED_BYTES_PER_REVISION) {
    throw new ValidationError("Direct upload batch exceeds the configured total byte limit");
  }

  const sessionId = crypto.randomUUID();
  const finalizationToken = crypto.randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + UPLOAD_SESSION_EXPIRY_MS);
  const targetIds = files.map(() => crypto.randomUUID());

  await reserveUploadSession({
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
        const signed = await getS3Storage().presignUpload(
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

export async function abandonUploadSession(
  ledgerId: LedgerId,
  uploadSessionId: string
): Promise<void> {
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

interface CreateUploadSessionInput {
  id: string;
  ledgerId: string;
  finalizationTokenHash: string;
  transport: "proxy" | "direct";
  expiresAt: Date;
  createdAt: Date;
  targets: readonly {
    id: string;
    position: number;
    contentType: string;
    byteSize: number;
    originalFilename: string | null;
    checksum: string | null;
  }[];
}

/** Reserve quota and create the session rows under a ledger row lock. */
async function reserveUploadSession(input: CreateUploadSessionInput): Promise<void> {
  await db.transaction(async (tx) => {
    const ledger = await tx
      .select({ id: ledgers.id })
      .from(ledgers)
      .where(and(eq(ledgers.id, input.ledgerId), isNull(ledgers.deletedAt)))
      .for("update")
      .then((rows) => rows[0]);
    if (ledger == null) throw new NotFoundError("Ledger");
    const fifteenMinutesAgo = new Date(input.createdAt.getTime() - 15 * 60 * 1000);
    const utcDayStart = new Date(input.createdAt);
    utcDayStart.setUTCHours(0, 0, 0, 0);
    const recentPlans = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.ledgerId, input.ledgerId),
          gte(uploadSessions.createdAt, fifteenMinutesAgo)
        )
      )
      .then((rows) => rows[0]?.count ?? 0);
    const openSessions = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.ledgerId, input.ledgerId),
          inArray(uploadSessions.status, ["open", "finalizing"])
        )
      )
      .then((rows) => rows[0]?.count ?? 0);
    const dailyBytes = await tx
      .select({
        bytes: sql<number>`coalesce(sum(${uploadSessionFiles.expectedByteSize}), 0)::bigint`,
      })
      .from(uploadSessionFiles)
      .innerJoin(uploadSessions, eq(uploadSessions.id, uploadSessionFiles.uploadSessionId))
      .where(
        and(
          eq(uploadSessions.ledgerId, input.ledgerId),
          gte(uploadSessions.createdAt, utcDayStart),
          inArray(uploadSessions.status, ["open", "finalizing", "finalized"])
        )
      )
      .then((rows) => Number(rows[0]?.bytes ?? 0));
    const reservedBytes = input.targets.reduce((sum, target) => sum + target.byteSize, 0);
    if (
      recentPlans >= UPLOAD_PLAN_LIMIT_PER_15_MIN ||
      openSessions >= UPLOAD_OPEN_SESSION_LIMIT ||
      dailyBytes + reservedBytes > UPLOAD_DAILY_BYTES_LIMIT
    ) {
      throw new AppError("Upload quota exceeded", "UPLOAD_QUOTA_EXCEEDED", 429);
    }
    await tx.insert(uploadSessions).values({
      id: input.id,
      ledgerId: input.ledgerId,
      finalizationTokenHash: input.finalizationTokenHash,
      transport: input.transport,
      status: "open",
      expiresAt: input.expiresAt,
      createdAt: input.createdAt,
    });
    if (input.targets.length > 0) {
      await tx.insert(uploadSessionFiles).values(
        input.targets.map((target) => ({
          ledgerId: input.ledgerId,
          uploadSessionId: input.id,
          targetId: target.id,
          position: target.position,
          expectedContentType: target.contentType,
          expectedByteSize: target.byteSize,
          originalFilename: target.originalFilename,
          expectedChecksum: target.checksum,
          status: "planned" as const,
        }))
      );
    }
  });
}
