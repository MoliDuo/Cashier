import "server-only";
import { and, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  categoryReclassificationJobs,
  emailChangeChallenges,
  ledgers,
  objectCleanupJobs,
  uploadSessionFiles,
  uploadSessions,
} from "@/persistence";
import { getS3Storage } from "@/lib/storage/s3";
import { logger } from "@/lib/logger";
import { runWithConcurrency } from "@/lib/concurrency";
import { refreshExchangeRates } from "@/modules/currency/server/exchange-rates";
import { scheduleCategoryReclassificationDrainAfter } from "@/server/category-reclassification/schedule";
import { scheduleProcessingRecovery } from "@/server/processing/recovery";
import { acknowledgeObjectCleanup, claimObjectCleanup } from "./object-cleanup";
import { CRON_BUDGET_MS } from "@/config/tuning";

const BATCH = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DailyStep =
  | "expired_records"
  | "processing_recovery"
  | "category_recovery"
  | "exchange_rates"
  | "upload_sessions"
  | "object_cleanup";

export type DailyStepOutcome = "done" | "failed" | "skipped";

export interface DailyMaintenanceOptions {
  now?: Date;
  /** When the run stops starting new steps and batches; defaults to the cron budget. */
  deadlineAt?: number;
}

/**
 * The daily sweep behind `/api/cron/daily`. Each step is independent: one
 * that fails is logged and the rest still run, and steps that would start
 * after the deadline are skipped for the next day. Work that needs a model
 * call is only scheduled here, with `after()`, so it gets the function's
 * remaining time rather than the sweep's.
 */
export async function runDailyMaintenance(
  options: DailyMaintenanceOptions = {}
): Promise<Record<DailyStep, DailyStepOutcome>> {
  const now = options.now ?? new Date();
  const deadlineAt = options.deadlineAt ?? Date.now() + CRON_BUDGET_MS;
  const outcomes = {} as Record<DailyStep, DailyStepOutcome>;
  const step = async (name: DailyStep, run: () => Promise<void>): Promise<void> => {
    if (Date.now() >= deadlineAt) {
      outcomes[name] = "skipped";
      return;
    }
    try {
      await run();
      outcomes[name] = "done";
    } catch (error) {
      outcomes[name] = "failed";
      logger.warn(
        { step: name, errorName: error instanceof Error ? error.name : "UnknownError" },
        "Daily maintenance step failed"
      );
    }
  };

  await step("expired_records", () => deleteExpiredRecords(now, deadlineAt));
  await step("processing_recovery", scheduleDueProcessing);
  await step("category_recovery", async () => scheduleCategoryReclassificationDrainAfter());
  await step("exchange_rates", () => refreshExchangeRates(now));
  await step("upload_sessions", () => sweepStaleUploadSessions(now));
  await step("object_cleanup", () => drainObjectCleanup(deadlineAt));
  return outcomes;
}

/** Deletes in batches until a batch comes back short or the deadline passes. */
async function deleteInBatches(statement: SQL, deadlineAt: number): Promise<void> {
  while (Date.now() < deadlineAt) {
    const result = await db.execute(statement);
    if ((result.rowCount ?? 0) < BATCH) return;
  }
}

async function deleteExpiredRecords(now: Date, deadlineAt: number): Promise<void> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const twoDaysAgo = new Date(now.getTime() - 2 * DAY_MS);
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
  const statements = [
    sql`DELETE FROM rate_limit_buckets WHERE bucket_key IN (
      SELECT bucket_key FROM rate_limit_buckets WHERE window_start < ${twoDaysAgo} LIMIT ${BATCH}
    )`,
    sql`DELETE FROM idempotency_records WHERE (principal_type, principal_id, key) IN (
      SELECT principal_type, principal_id, key FROM idempotency_records
      WHERE expires_at < ${now} OR (status = 'completed' AND completed_at < ${dayAgo})
      LIMIT ${BATCH}
    )`,
    sql`DELETE FROM otp_tokens WHERE id IN (
      SELECT id FROM otp_tokens WHERE expires < ${now} LIMIT ${BATCH}
    )`,
    sql`DELETE FROM ${emailChangeChallenges} WHERE id IN (
      SELECT id FROM ${emailChangeChallenges} WHERE expires_at < ${now} LIMIT ${BATCH}
    )`,
    // Result work rows cascade with the parent after the seven-day viewing window.
    sql`DELETE FROM ${categoryReclassificationJobs} WHERE id IN (
      SELECT id FROM ${categoryReclassificationJobs}
      WHERE status IN ('succeeded', 'partial', 'failed', 'cancelled')
        AND updated_at < ${sevenDaysAgo}
      LIMIT ${BATCH}
    )`,
  ];
  for (const statement of statements) await deleteInBatches(statement, deadlineAt);
}

/** Schedules every ledger's due processing attempts that no run holds. */
async function scheduleDueProcessing(): Promise<void> {
  const rows = await db.select({ id: ledgers.id }).from(ledgers);
  for (const ledger of rows) await scheduleProcessingRecovery(ledger.id);
}

/** Queues the temporary objects of upload sessions that ended over a day ago. */
async function sweepStaleUploadSessions(now: Date): Promise<void> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  await db.transaction(async (tx) => {
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
      .limit(BATCH);
    const sessionIds = staleSessions.map((session) => session.id);
    if (sessionIds.length === 0) return;
    const targets = await tx
      .select({
        uploadSessionId: uploadSessionFiles.uploadSessionId,
        targetId: uploadSessionFiles.targetId,
      })
      .from(uploadSessionFiles)
      .where(inArray(uploadSessionFiles.uploadSessionId, sessionIds));
    const ledgerBySession = new Map(staleSessions.map((session) => [session.id, session.ledgerId]));
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
  });
}

/** Deletes queued objects, four at a time, until the queue is empty or time runs out. */
async function drainObjectCleanup(deadlineAt: number): Promise<void> {
  const storage = getS3Storage();
  while (Date.now() < deadlineAt) {
    const jobs = await claimObjectCleanup(new Date());
    if (jobs.length === 0) return;
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
}
