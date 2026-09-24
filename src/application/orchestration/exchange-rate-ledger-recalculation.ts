import "server-only";
import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import {
  claimExchangeRateRecalculations,
  completeExchangeRateRecalculation,
  failExchangeRateRecalculation,
  type ClaimedExchangeRateRecalculation,
} from "@/application/adapters/postgres/exchange-rate-recalculation-jobs";
import { postgresCurrencyAdapter } from "@/application/adapters/postgres/business-ports/currency";
import { logger } from "@/lib/logger";
import type { CurrencyPort } from "@/application/contracts";

const CLAIM_LIMIT = 25;
const CLAIM_LEASE_MS = 300_000;
const MAX_DRAIN_BATCHES = 20;
const MAX_DRAIN_DURATION_MS = 30_000;

export interface ExchangeRateRecalculationDependencies {
  currencies: CurrencyPort;
}

const defaultDependencies: ExchangeRateRecalculationDependencies = {
  currencies: postgresCurrencyAdapter,
};

/**
 * Claim and process one bounded batch of durable recalculation jobs.
 * Processes jobs sequentially; a failure schedules its own retry without
 * blocking the rest of the batch.
 */
export async function runBoundedExchangeRateRecalculation(
  now = new Date(),
  dependencies: ExchangeRateRecalculationDependencies = defaultDependencies
): Promise<number> {
  const claimed = await claimExchangeRateRecalculations({
    now,
    limit: CLAIM_LIMIT,
    leaseMs: CLAIM_LEASE_MS,
  });
  if (claimed.length === 0) {
    return 0;
  }

  for (const job of claimed) {
    await processRecalculationJob(job, now, dependencies);
  }
  return claimed.length;
}

/** Drain every currently due batch while preserving the worker's batch and concurrency bounds. */
export async function drainDueExchangeRateRecalculations(
  now = new Date(),
  dependencies: ExchangeRateRecalculationDependencies = defaultDependencies
): Promise<void> {
  const deadline = Date.now() + MAX_DRAIN_DURATION_MS;
  for (let batches = 0; batches < MAX_DRAIN_BATCHES && Date.now() < deadline; batches += 1) {
    if ((await runBoundedExchangeRateRecalculation(now, dependencies)) === 0) return;
  }
}

async function processRecalculationJob(
  job: ClaimedExchangeRateRecalculation,
  now: Date,
  dependencies: ExchangeRateRecalculationDependencies
): Promise<void> {
  try {
    await dependencies.currencies.recalculateLedgerForDate(job.ledgerId, job.rateDate);
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
