import "server-only";
import { db } from "@/lib/db";
import { and, eq, sql } from "drizzle-orm";
import { objectCleanupJobs, uploadSessions } from "@/persistence";

type ClaimedObjectCleanup = Pick<
  typeof objectCleanupJobs.$inferSelect,
  "id" | "storageKey" | "uploadSessionId" | "attempts"
> & { claimToken: string; claimExpiresAt: Date };

export async function claimObjectCleanup(now: Date) {
  const token = crypto.randomUUID();
  const expires = new Date(now.getTime() + 300_000);
  const result = await db.execute<
    Omit<ClaimedObjectCleanup, "claimExpiresAt"> & {
      claimExpiresAt: string | Date;
    }
  >(sql`
    WITH candidates AS (
      SELECT id FROM ${objectCleanupJobs}
      WHERE next_attempt_at <= ${now}
        AND (claim_expires_at IS NULL OR claim_expires_at <= ${now})
      ORDER BY next_attempt_at, created_at
      LIMIT 25 FOR UPDATE SKIP LOCKED
    ) UPDATE ${objectCleanupJobs} AS jobs
      SET claim_token = ${token}, claim_expires_at = ${expires}
      FROM candidates WHERE jobs.id = candidates.id
      RETURNING jobs.id, jobs.storage_key AS "storageKey",
        jobs.upload_session_id AS "uploadSessionId", jobs.attempts,
        jobs.claim_token AS "claimToken", jobs.claim_expires_at AS "claimExpiresAt"
  `);
  return result.rows.map((row) => ({ ...row, claimExpiresAt: new Date(row.claimExpiresAt) }));
}

export async function acknowledgeObjectCleanup(
  job: ClaimedObjectCleanup,
  errorCode: string | null,
  now?: Date
): Promise<boolean> {
  const owned = and(
    eq(objectCleanupJobs.id, job.id),
    eq(objectCleanupJobs.claimToken, job.claimToken),
    sql`${objectCleanupJobs.claimExpiresAt} > ${now ?? sql`clock_timestamp()`}`
  );
  return db.transaction(async (tx) => {
    if (errorCode != null) {
      const attempts = job.attempts + 1;
      const backoff = Math.min(3_600_000, 1000 * 2 ** Math.min(attempts, 12));
      const updated = await tx
        .update(objectCleanupJobs)
        .set({
          attempts,
          nextAttemptAt: new Date((now ?? new Date()).getTime() + backoff),
          lastError: errorCode,
          claimToken: null,
          claimExpiresAt: null,
        })
        .where(owned)
        .returning({ id: objectCleanupJobs.id });
      return updated.length === 1;
    }
    // Serialize sibling acknowledgements before removing the last session reference.
    if (job.uploadSessionId != null) {
      await tx
        .select({ id: uploadSessions.id })
        .from(uploadSessions)
        .where(eq(uploadSessions.id, job.uploadSessionId))
        .for("update");
    }
    const deleted = await tx
      .delete(objectCleanupJobs)
      .where(owned)
      .returning({ id: objectCleanupJobs.id });
    if (deleted.length !== 1) return false;
    if (job.uploadSessionId != null) {
      const remaining = await tx
        .select({ id: objectCleanupJobs.id })
        .from(objectCleanupJobs)
        .where(eq(objectCleanupJobs.uploadSessionId, job.uploadSessionId))
        .limit(1);
      if (remaining.length === 0) {
        await tx.delete(uploadSessions).where(eq(uploadSessions.id, job.uploadSessionId));
      }
    }
    return true;
  });
}

export async function enqueueObjectCleanup(
  storageKey: string,
  uploadSessionId?: string
): Promise<void> {
  await db
    .insert(objectCleanupJobs)
    .values({
      storageKey,
      ...(uploadSessionId === undefined ? {} : { uploadSessionId }),
    })
    .onConflictDoNothing({ target: objectCleanupJobs.storageKey });
}
