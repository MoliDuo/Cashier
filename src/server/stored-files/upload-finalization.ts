import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { StoredFileContract, UploadFinalizationContract } from "./types";
import { enqueueObjectCleanup } from "@/server/maintenance/object-cleanup";
import { db } from "@/lib/db";
import { getS3Storage } from "@/lib/storage/s3";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { processImage } from "@/lib/storage/image-processing";
import { MAX_NORMALIZED_BYTES_PER_REVISION } from "@/lib/storage/upload-policy";
import { storedFiles, uploadSessionFiles, uploadSessions } from "@/persistence";
import { checksum, durableKey, mapStoredFile, safeTokenMatches, temporaryKey } from "./shared";

/** Inspect, normalize, and promote the objects a browser uploaded straight to storage. */
export async function finalizeDirectUpload(
  input: UploadFinalizationContract
): Promise<readonly StoredFileContract[]> {
  const storage = getS3Storage();
  let session = await db.query.uploadSessions.findFirst({
    where: eq(uploadSessions.id, input.uploadSessionId),
  });
  if (
    session == null ||
    session.transport !== "direct" ||
    session.ledgerId !== input.ledgerId ||
    !safeTokenMatches(input.finalizationToken, session.finalizationTokenHash)
  ) {
    throw new NotFoundError("Upload session");
  }

  const targets = await db
    .select()
    .from(uploadSessionFiles)
    .where(
      and(
        eq(uploadSessionFiles.ledgerId, session.ledgerId),
        eq(uploadSessionFiles.uploadSessionId, session.id)
      )
    )
    .orderBy(asc(uploadSessionFiles.position));
  if (
    targets.length === 0 ||
    targets.length !== input.targetIds.length ||
    targets.some((target, position) => target.targetId !== input.targetIds[position])
  ) {
    throw new ValidationError("Upload targets must be complete and in planned order");
  }
  if (targets.some((target) => target.expectedChecksum == null)) {
    throw new ConflictError("Direct upload targets are incomplete");
  }

  const now = new Date();
  const activeSession = session;
  if (session.status === "open") {
    if (session.expiresAt.getTime() <= now.getTime()) {
      await db
        .update(uploadSessions)
        .set({ status: "expired" })
        .where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.status, "open")));
      await Promise.all(
        targets.map((target) =>
          enqueueObjectCleanup(
            temporaryKey(activeSession.ledgerId, activeSession.id, target.targetId),
            activeSession.id
          )
        )
      );
      throw new ConflictError("Upload plan has expired");
    }
    await db
      .update(uploadSessions)
      .set({ status: "finalizing" })
      .where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.status, "open")));
    session =
      (await db.query.uploadSessions.findFirst({
        where: eq(uploadSessions.id, session.id),
      })) ?? session;
  }
  if (session.status === "finalized") {
    return finalizeSession(input, session);
  }
  if (session.status !== "finalizing") {
    throw new ConflictError("Upload session cannot be finalized");
  }

  let inspected: Array<{
    bytes: Buffer;
    contentType: string;
    checksum: string;
  }>;
  try {
    const uploaded = await Promise.all(
      targets.map(async (target) => {
        const key = temporaryKey(session.ledgerId, session.id, target.targetId);
        const { metadata, bytes } = await storage.readObject(key);
        return { metadata, bytes, checksum: checksum(bytes) };
      })
    );
    for (const [position, target] of targets.entries()) {
      const actual = uploaded[position]!;
      if (
        actual.metadata.byteSize !== target.expectedByteSize ||
        actual.bytes.length !== target.expectedByteSize ||
        actual.metadata.contentType !== target.expectedContentType ||
        actual.checksum !== target.expectedChecksum
      ) {
        throw new ConflictError("Uploaded object does not match the upload plan");
      }
    }
    inspected = await Promise.all(
      uploaded.map(async (actual, position) => {
        const processed = await processImage(actual.bytes, targets[position]!.expectedContentType);
        return {
          bytes: processed.buffer,
          contentType: processed.mimeType,
          checksum: checksum(processed.buffer),
        };
      })
    );
    const normalizedTotalBytes = inspected.reduce((sum, file) => sum + file.bytes.length, 0);
    if (normalizedTotalBytes > MAX_NORMALIZED_BYTES_PER_REVISION) {
      throw new ValidationError(
        `Total stored bytes ${normalizedTotalBytes} exceeds revision limit of ${MAX_NORMALIZED_BYTES_PER_REVISION}`
      );
    }
  } catch (error) {
    if (error instanceof ConflictError) {
      await db.transaction(async (tx) => {
        await tx
          .update(uploadSessionFiles)
          .set({ status: "rejected" })
          .where(
            and(
              eq(uploadSessionFiles.uploadSessionId, session.id),
              eq(uploadSessionFiles.status, "planned")
            )
          );
        await tx
          .update(uploadSessions)
          .set({ status: "cancelled" })
          .where(eq(uploadSessions.id, session.id));
      });
      await Promise.all(
        targets.map((target) =>
          enqueueObjectCleanup(
            temporaryKey(session.ledgerId, session.id, target.targetId),
            session.id
          )
        )
      );
    } else {
      await db
        .update(uploadSessions)
        .set({ status: "open" })
        .where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.status, "finalizing")));
    }
    throw error;
  }

  await Promise.all(
    targets.map(async (target) => {
      if (target.status === "uploaded" || target.status === "finalized") return;
      const storedFileId = target.targetId;
      const storageKey = durableKey(session.ledgerId, storedFileId);
      const normalized = inspected[target.position]!;
      await storage.upload(storageKey, normalized.bytes, normalized.contentType);
      try {
        await db.transaction(async (tx) => {
          await tx
            .insert(storedFiles)
            .values({
              id: storedFileId,
              ledgerId: session.ledgerId,
              storageProvider: "s3",
              storageKey,
              contentType: normalized.contentType,
              byteSize: normalized.bytes.length,
              originalFilename: target.originalFilename,
              checksum: normalized.checksum,
              createdAt: now,
            })
            .onConflictDoNothing();
          const file = await tx.query.storedFiles.findFirst({
            where: and(
              eq(storedFiles.ledgerId, session.ledgerId),
              eq(storedFiles.id, storedFileId)
            ),
          });
          if (
            file == null ||
            file.storageKey !== storageKey ||
            file.contentType !== normalized.contentType ||
            file.byteSize !== normalized.bytes.length ||
            file.checksum !== normalized.checksum
          ) {
            throw new ConflictError("Stored file promotion conflicted with existing state");
          }
          await tx
            .update(uploadSessionFiles)
            .set({ storedFileId, status: "uploaded" })
            .where(
              and(
                eq(uploadSessionFiles.ledgerId, session.ledgerId),
                eq(uploadSessionFiles.uploadSessionId, session.id),
                eq(uploadSessionFiles.targetId, target.targetId),
                eq(uploadSessionFiles.status, "planned")
              )
            );
        });
      } catch (error) {
        const cleanup = await storage.delete(storageKey);
        if (!cleanup.success) await enqueueObjectCleanup(storageKey, session.id);
        throw error;
      }
    })
  );

  const files = await finalizeSession(input, session);
  const cleanupResults = await Promise.all(
    targets.map((target) =>
      storage.delete(temporaryKey(session.ledgerId, session.id, target.targetId))
    )
  );
  if (cleanupResults.some((result) => !result.success)) {
    await Promise.all(
      cleanupResults.flatMap((result, position) =>
        result.success
          ? []
          : [
              enqueueObjectCleanup(
                temporaryKey(session.ledgerId, session.id, targets[position]!.targetId),
                session.id
              ),
            ]
      )
    );
    logger.warn(
      { uploadSessionSubject: logIdentifier("upload-session", session.id) },
      "Temporary S3 upload cleanup was incomplete"
    );
  }
  return files;
}

/** Finalize a proxy upload whose targets the server already wrote. */
export async function finalizeUpload(
  input: UploadFinalizationContract
): Promise<readonly StoredFileContract[]> {
  const session = await db.query.uploadSessions.findFirst({
    where: eq(uploadSessions.id, input.uploadSessionId),
  });
  if (session == null) throw new NotFoundError("Upload session");
  return finalizeSession(input, session);
}

async function finalizeSession(
  input: UploadFinalizationContract,
  session: typeof uploadSessions.$inferSelect
): Promise<readonly StoredFileContract[]> {
  if (
    session.ledgerId !== input.ledgerId ||
    !safeTokenMatches(input.finalizationToken, session.finalizationTokenHash)
  ) {
    throw new NotFoundError("Upload session");
  }
  const targetIds = [...new Set(input.targetIds)];
  if (targetIds.length === 0 || targetIds.length !== input.targetIds.length) {
    throw new ValidationError("Finalization requires unique upload targets");
  }
  const now = new Date();
  if (session.expiresAt.getTime() <= now.getTime() && session.status === "open") {
    await db
      .update(uploadSessions)
      .set({ status: "expired" })
      .where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.status, "open")));
    throw new ConflictError("Upload plan has expired");
  }

  const { files, targets } = await db.transaction(async (tx) => {
    const lockedSession = await tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, input.uploadSessionId))
      .for("update")
      .then((rows) => rows[0]);
    if (
      lockedSession == null ||
      lockedSession.ledgerId !== input.ledgerId ||
      !safeTokenMatches(input.finalizationToken, lockedSession.finalizationTokenHash)
    ) {
      throw new NotFoundError("Upload session");
    }
    if (
      lockedSession.status !== "open" &&
      lockedSession.status !== "finalizing" &&
      lockedSession.status !== "finalized"
    ) {
      throw new ConflictError("Upload session cannot be finalized");
    }
    const targets = await tx
      .select()
      .from(uploadSessionFiles)
      .where(
        and(
          eq(uploadSessionFiles.ledgerId, session.ledgerId),
          eq(uploadSessionFiles.uploadSessionId, session.id),
          lockedSession.transport === "direct"
            ? undefined
            : inArray(uploadSessionFiles.targetId, targetIds)
        )
      )
      .orderBy(asc(uploadSessionFiles.position));
    if (
      lockedSession.transport === "direct" &&
      (targets.length !== input.targetIds.length ||
        targets.some((target, position) => target.targetId !== input.targetIds[position]))
    )
      throw new ValidationError("Upload targets must be complete and in planned order");
    if (lockedSession.status === "open" && lockedSession.expiresAt <= now) {
      throw new ConflictError("Upload plan has expired");
    }
    if (
      targets.length !== targetIds.length ||
      targets.some(
        (target) =>
          target.storedFileId == null ||
          (target.status !== "uploaded" && target.status !== "finalized")
      )
    ) {
      throw new ConflictError("Upload targets are incomplete");
    }
    // Validate unique display order: deduplicate on position since targets are unique
    const positionSet = new Set(targets.map((t) => t.position));
    if (positionSet.size !== targets.length) {
      throw new ValidationError("Upload targets have duplicate display positions");
    }
    const storedFileIds = targets.map((target) => target.storedFileId!);
    // Enforce total normalized bytes per revision
    const files = await tx
      .select()
      .from(storedFiles)
      .where(
        and(eq(storedFiles.ledgerId, session.ledgerId), inArray(storedFiles.id, storedFileIds))
      );
    const totalBytes = files.reduce((sum, f) => sum + f.byteSize, 0);
    if (totalBytes > MAX_NORMALIZED_BYTES_PER_REVISION) {
      throw new ValidationError(
        `Total stored bytes ${totalBytes} exceeds revision limit of ${MAX_NORMALIZED_BYTES_PER_REVISION}`
      );
    }
    if (lockedSession.status === "finalized") return { files, targets };
    await tx.execute(sql`
      UPDATE ${uploadSessionFiles} AS target
      SET expected_byte_size = file.byte_size
      FROM ${storedFiles} AS file
      WHERE target.ledger_id = ${session.ledgerId}
        AND target.upload_session_id = ${session.id}
        AND target.target_id IN (${sql.join(
          targetIds.map((targetId) => sql`${targetId}`),
          sql`, `
        )})
        AND file.ledger_id = target.ledger_id
        AND file.id = target.stored_file_id
    `);
    await tx
      .update(storedFiles)
      .set({ finalizedAt: now })
      .where(
        and(eq(storedFiles.ledgerId, session.ledgerId), inArray(storedFiles.id, storedFileIds))
      );
    await tx
      .update(uploadSessionFiles)
      .set({ status: "finalized" })
      .where(
        and(
          eq(uploadSessionFiles.uploadSessionId, session.id),
          inArray(uploadSessionFiles.targetId, targetIds)
        )
      );
    await tx
      .update(uploadSessions)
      .set({ status: "finalized", finalizedAt: now })
      .where(
        and(
          eq(uploadSessions.id, lockedSession.id),
          inArray(uploadSessions.status, ["open", "finalizing", "finalized"])
        )
      );
    return { files, targets };
  });
  // Preserve position order from the targets query, ensuring files are returned
  // in request order regardless of database default ordering
  const positionOrder = new Map(targets.map((t, i) => [t.storedFileId, i]));
  return files
    .sort((a, b) => (positionOrder.get(a.id) ?? 0) - (positionOrder.get(b.id) ?? 0))
    .map(mapStoredFile);
}
