import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  categoryReclassificationJobs,
  emailChangeChallenges,
  ledgers,
  sourceDocumentFiles,
  storedFiles,
} from "@/persistence";
import { getS3Storage } from "@/lib/storage/s3";
import { logger } from "@/lib/logger";
import { runWithConcurrency } from "@/lib/concurrency";
import { refreshExchangeRates } from "@/modules/currency/server/exchange-rates";
import { scheduleCategoryReclassificationDrainAfter } from "@/server/category-reclassification/schedule";
import { scheduleProcessingRecovery } from "@/server/processing/recovery";
import { CRON_BUDGET_MS } from "@/config/tuning";

const BATCH = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DailyStep =
  | "expired_records"
  | "processing_recovery"
  | "category_recovery"
  | "exchange_rates"
  | "pending_files"
  | "temporary_objects";

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
  await step("pending_files", () => deleteStalePendingFiles(now, deadlineAt));
  await step("temporary_objects", () => deleteStaleTemporaryObjects(now, deadlineAt));
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

/**
 * Deletes files planned over a day ago and never finalized, rows first and
 * then their objects. A document never takes a pending file, so none is in
 * use; an object whose delete fails is left for the orphan sweep.
 */
async function deleteStalePendingFiles(now: Date, deadlineAt: number): Promise<void> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const storage = getS3Storage();
  while (Date.now() < deadlineAt) {
    const deleted = await db.execute<{ id: string; ledgerId: string; storageKey: string }>(sql`
      DELETE FROM ${storedFiles} WHERE id IN (
        SELECT file.id FROM ${storedFiles} AS file
        WHERE file.finalized_at IS NULL
          AND file.created_at < ${dayAgo}
          AND NOT EXISTS (
            SELECT 1 FROM ${sourceDocumentFiles} AS link
            WHERE link.ledger_id = file.ledger_id AND link.stored_file_id = file.id
          )
        LIMIT ${BATCH}
      )
      RETURNING id, ledger_id AS "ledgerId", storage_key AS "storageKey"
    `);
    const keys = deleted.rows.flatMap((file) => [
      file.storageKey,
      `temporary/${file.ledgerId}/${file.id}`,
    ]);
    await runWithConcurrency(keys, 4, async (key) => {
      await storage.delete(key);
    });
    if (deleted.rows.length < BATCH) return;
  }
}

/**
 * Deletes objects under `temporary/` last written over a day ago. Finalization
 * removes its own; these are uploads that never finished or whose delete
 * failed. Nothing refers to a temporary object, so age alone decides.
 */
async function deleteStaleTemporaryObjects(now: Date, deadlineAt: number): Promise<void> {
  const dayAgo = now.getTime() - DAY_MS;
  const storage = getS3Storage();
  let continuationToken: string | null = null;
  do {
    const page = await storage.listObjectsPage("temporary/", continuationToken);
    const stale = page.objects
      .filter((object) => object.lastModified != null && object.lastModified.getTime() < dayAgo)
      .map((object) => object.key);
    await runWithConcurrency(stale, 4, async (key) => {
      await storage.delete(key);
    });
    continuationToken = page.isTruncated ? page.nextContinuationToken : null;
  } while (continuationToken != null && Date.now() < deadlineAt);
}
