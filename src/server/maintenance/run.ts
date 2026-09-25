import "server-only";
import { and, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  categoryReclassificationJobs,
  emailChangeChallenges,
  objectCleanupJobs,
  uploadSessionFiles,
  uploadSessions,
} from "@/persistence";
import { getS3Storage } from "@/lib/storage/s3";
import { logger } from "@/lib/logger";
import { runWithConcurrency } from "@/lib/concurrency";
import { refreshExchangeRates } from "@/modules/currency/server/exchange-rates";
import { drainDueCategoryReclassifications } from "@/server/category-reclassification/run";
import { acknowledgeObjectCleanup, claimObjectCleanup } from "./object-cleanup";

const LIMIT = 1000;
const MAINTENANCE_LOCK = 1_381_247_119;

export async function runBoundedMaintenance(now = new Date()): Promise<void> {
  const acquired = await db.transaction(async (tx) => {
    const lock = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${MAINTENANCE_LOCK}) AS acquired`
    );
    if (lock.rows?.[0]?.acquired !== true) return false;
    const cooldown = await tx.execute(sql`
      INSERT INTO rate_limit_buckets (bucket_key, count, window_start, created_at)
      VALUES ('maintenance:global', 1, ${now}, ${now})
      ON CONFLICT (bucket_key) DO UPDATE SET window_start = EXCLUDED.window_start
      WHERE rate_limit_buckets.window_start <= ${new Date(now.getTime() - 60_000)}
      RETURNING bucket_key
    `);
    if (cooldown.rows.length === 0) return false;
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    await tx.execute(sql`DELETE FROM rate_limit_buckets WHERE bucket_key IN (
      SELECT bucket_key FROM rate_limit_buckets WHERE window_start < ${twoDaysAgo} LIMIT ${LIMIT}
    )`);
    await tx.execute(sql`DELETE FROM idempotency_records WHERE (principal_type, principal_id, key) IN (
      SELECT principal_type, principal_id, key FROM idempotency_records
      WHERE expires_at < ${now} OR (status = 'completed' AND completed_at < ${dayAgo})
      LIMIT ${LIMIT}
    )`);
    await tx.execute(sql`DELETE FROM otp_tokens WHERE id IN (
      SELECT id FROM otp_tokens WHERE expires < ${now} LIMIT ${LIMIT}
    )`);
    await tx.execute(sql`DELETE FROM ${emailChangeChallenges} WHERE id IN (
      SELECT id FROM ${emailChangeChallenges} WHERE expires_at < ${now} LIMIT ${LIMIT}
    )`);
    // Result work rows cascade with the parent after the seven-day viewing window.
    await tx.execute(sql`DELETE FROM ${categoryReclassificationJobs} WHERE id IN (
      SELECT id FROM ${categoryReclassificationJobs}
      WHERE status IN ('succeeded', 'partial', 'failed', 'cancelled')
        AND updated_at < ${sevenDaysAgo}
      LIMIT ${LIMIT}
    )`);

    const staleSessions = await tx
      .select({ id: uploadSessions.id, ledgerId: uploadSessions.ledgerId })
      .from(uploadSessions)
      .where(
        and(
          or(
            inArray(uploadSessions.status, ["expired", "cancelled", "finalized"]),
            lt(uploadSessions.expiresAt, dayAgo)
          ),
          lt(uploadSessions.createdAt, dayAgo)
        )
      )
      .limit(LIMIT);
    const sessionIds = staleSessions.map((session) => session.id);
    if (sessionIds.length > 0) {
      const targets = await tx
        .select({
          uploadSessionId: uploadSessionFiles.uploadSessionId,
          targetId: uploadSessionFiles.targetId,
        })
        .from(uploadSessionFiles)
        .where(inArray(uploadSessionFiles.uploadSessionId, sessionIds));
      const ledgerBySession = new Map(
        staleSessions.map((session) => [session.id, session.ledgerId])
      );
      if (targets.length > 0) {
        await tx
          .insert(objectCleanupJobs)
          .values(
            targets.map((target) => ({
              storageKey: `temporary/${ledgerBySession.get(target.uploadSessionId)!}/${target.uploadSessionId}/${target.targetId}`,
              uploadSessionId: target.uploadSessionId,
              nextAttemptAt: now,
            }))
          )
          .onConflictDoNothing({ target: objectCleanupJobs.storageKey });
      }
      const sessionsWithoutTargets = sessionIds.filter(
        (id) => !targets.some((target) => target.uploadSessionId === id)
      );
      if (sessionsWithoutTargets.length > 0) {
        await tx.delete(uploadSessions).where(inArray(uploadSessions.id, sessionsWithoutTargets));
      }
    }

    return true;
  });
  if (!acquired) return;

  try {
    await refreshExchangeRates(now);
  } catch (error) {
    logger.warn(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Exchange rate refresh failed"
    );
  }
  await drainDueCategoryReclassifications();

  const jobs = await claimObjectCleanup(new Date());
  if (jobs.length === 0) return;
  const storage = getS3Storage();
  await runWithConcurrency(jobs, 4, async (job) => {
    let errorCode: string | null = null;
    try {
      const result = await storage.delete(job.storageKey);
      if (!result.success) errorCode = result.error?.name ?? "ObjectDeleteFailed";
    } catch (error) {
      errorCode = error instanceof Error ? error.name : "ObjectDeleteFailed";
    }
    const acknowledged = await acknowledgeObjectCleanup(job, errorCode);
    if (acknowledged && errorCode != null) {
      logger.warn(
        { cleanupJobId: job.id, attempts: job.attempts + 1 },
        "Object cleanup will be retried"
      );
    }
  });
}
