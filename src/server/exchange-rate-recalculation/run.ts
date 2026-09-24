import "server-only";
import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import {
  claimExchangeRateRecalculations,
  completeExchangeRateRecalculation,
  failExchangeRateRecalculation,
  type ClaimedExchangeRateRecalculation,
} from "./jobs";
import { recalculateLedgerForDate } from "./recalculate-ledger";
import { logger } from "@/lib/logger";

const CLAIM_LIMIT = 25;
const CLAIM_LEASE_MS = 300_000;
const MAX_DRAIN_BATCHES = 20;
const MAX_DRAIN_DURATION_MS = 30_000;

/**
 * Claim and process one bounded batch of durable recalculation jobs.
 * Processes jobs sequentially; a failure schedules its own retry without
 * blocking the rest of the batch.
 */
export async function runBoundedExchangeRateRecalculation(now = new Date()): Promise<number> {
  const claimed = await claimExchangeRateRecalculations({
    now,
    limit: CLAIM_LIMIT,
    leaseMs: CLAIM_LEASE_MS,
  });
  if (claimed.length === 0) {
    return 0;
  }

  for (const job of claimed) {
    await processRecalculationJob(job, now);
  }
  return claimed.length;
}

/** Drain every currently due batch while preserving the worker's batch and concurrency bounds. */
export async function drainDueExchangeRateRecalculations(now = new Date()): Promise<void> {
  const deadline = Date.now() + MAX_DRAIN_DURATION_MS;
  for (let batches = 0; batches < MAX_DRAIN_BATCHES && Date.now() < deadline; batches += 1) {
    if ((await runBoundedExchangeRateRecalculation(now)) === 0) return;
  }
}

async function processRecalculationJob(
  job: ClaimedExchangeRateRecalculation,
  now: Date
): Promise<void> {
  try {
    await recalculateLedgerForDate(job.ledgerId, job.rateDate);
    await completeExchangeRateRecalculation({
      rateDate: job.rateDate,
      ledgerId: job.ledgerId,
      claimToken: job.claimToken,
    });
  } catch (error) {
    const errorCode =
      error instanceof AppError
        ? error.code
        : error instanceof Error && error.name !== ""
          ? error.name
          : "RecalculationFailed";
    const outcome = await failExchangeRateRecalculation({
      rateDate: job.rateDate,
      ledgerId: job.ledgerId,
      claimToken: job.claimToken,
      now,
      errorCode,
    });
    logger.error(
      {
        rateDate: job.rateDate,
        ledgerSubject: maskLedgerId(job.ledgerId),
        attempts: job.attempts + 1,
        errorCode,
        outcome,
      },
      "Exchange rate recalculation job failed"
    );
  }
}

function maskLedgerId(ledgerId: string): string {
  return createHash("sha256").update(ledgerId).digest("hex").slice(0, 16);
}
