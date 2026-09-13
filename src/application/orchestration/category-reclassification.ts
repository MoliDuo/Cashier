import "server-only";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { postgresCategoryReclassificationJobAdapter } from "@/application/adapters/postgres/category-reclassification-jobs";
import { postgresEntryCategoryAssignmentAdapter } from "@/application/adapters/postgres/ledger-entry-category-assignment";
import { entryReclassifierAdapter } from "@/application/adapters/ai/entry-reclassifier";
import { postgresCategoryAdapter } from "@/application/adapters/postgres/business-ports/categories";
import { postgresSettingsAdapter } from "@/application/adapters/postgres/business-ports/settings";
import {
  isSuccessfulLoadImageResult,
  loadStoredFilesForAI,
} from "@/application/adapters/in-process";
import { storedFileAdapter } from "@/application/adapters/storage";
import {
  runCategoryReclassification,
  type CategoryReclassificationDependencies,
} from "@/modules/ledger/application/use-cases/run-category-reclassification";
import type { ClaimedCategoryReclassificationJob } from "@/modules/ledger/application/ports";

const CLAIM_LEASE_MS = 120_000;
const DRAIN_CLAIM_LIMIT = 5;
const MAX_DRAIN_BATCHES = 10;
const MAX_DRAIN_DURATION_MS = 30_000;

async function loadDependencies(
  job: ClaimedCategoryReclassificationJob,
  now: Date
): Promise<CategoryReclassificationDependencies> {
  const settings = await postgresSettingsAdapter.get(job.ledgerId);
  return {
    jobs: postgresCategoryReclassificationJobAdapter,
    assignment: postgresEntryCategoryAssignmentAdapter,
    reclassifier: entryReclassifierAdapter,
    categories: postgresCategoryAdapter,
    // Evidence the model gets to see, loaded per document. A file that fails to
    // read is already logged with its ledger and stored-file subject inside the
    // loader; here it just drops out, so a document keeps whatever did load and
    // degrades to text-only when nothing did.
    loadStoredFiles: async ({ ledgerId, storedFileIds }) => {
      const loaded = await loadStoredFilesForAI(
        (authorizedLedgerId, storedFileId) =>
          storedFileAdapter.readAuthorized(authorizedLedgerId, storedFileId),
        ledgerId,
        [...storedFileIds]
      );
      return loaded
        .filter(isSuccessfulLoadImageResult)
        .map((image) => ({ dataUrl: image.dataUrl }));
    },
    now,
    ...(settings?.aiCustomPrompt == null || settings.aiCustomPrompt === ""
      ? {}
      : { customPrompt: settings.aiCustomPrompt }),
  };
}

/**
 * Run one claimed job to completion. The claim token fences the run: if the
 * lease is taken over, `recordProgress` returns false and the run abandons its
 * remaining slices instead of racing the new owner.
 */
export async function runCategoryReclassificationJob(
  jobId: string,
  now = new Date()
): Promise<boolean> {
  const claimed = await postgresCategoryReclassificationJobAdapter.claim({
    now,
    leaseMs: CLAIM_LEASE_MS,
    jobId,
    limit: 1,
  });
  const job = claimed[0];
  if (job == null) return false;
  await processJob(job, now);
  return true;
}

/** Recovery pass for a single ledger, driven by that ledger's polling client. */
export async function recoverLedgerCategoryReclassifications(
  ledgerId: string,
  now = new Date()
): Promise<void> {
  const claimed = await postgresCategoryReclassificationJobAdapter.claim({
    now,
    leaseMs: CLAIM_LEASE_MS,
    ledgerId,
    limit: 1,
  });
  for (const job of claimed) await processJob(job, now);
}

/**
 * Fallback drain for ledgers nobody is polling any more — a closed tab, a
 * crashed process. Not the primary driver: status polling recovers its own
 * ledger far sooner.
 */
export async function drainDueCategoryReclassifications(now = new Date()): Promise<void> {
  const deadline = Date.now() + MAX_DRAIN_DURATION_MS;
  for (let batch = 0; batch < MAX_DRAIN_BATCHES && Date.now() < deadline; batch += 1) {
    const claimed = await postgresCategoryReclassificationJobAdapter.claim({
      now,
      leaseMs: CLAIM_LEASE_MS,
      limit: DRAIN_CLAIM_LIMIT,
    });
    if (claimed.length === 0) return;
    for (const job of claimed) await processJob(job, now);
  }
}

async function processJob(job: ClaimedCategoryReclassificationJob, now: Date): Promise<void> {
  try {
    const dependencies = await loadDependencies(job, now);
    const outcome = await runCategoryReclassification(job, dependencies);
    logger.info(
      {
        jobSubject: logIdentifier("processing-job", job.id),
        ledgerSubject: logIdentifier("ledger", job.ledgerId),
        completed: outcome.completed,
        appliedCount: outcome.appliedCount,
        confirmedCount: outcome.confirmedCount,
      },
      "Category reclassification finished"
    );
  } catch (error) {
    const errorCode =
      error instanceof AppError
        ? error.code
        : error instanceof Error && error.name !== ""
          ? error.name
          : "ReclassificationFailed";
    const outcome = await postgresCategoryReclassificationJobAdapter.fail({
      jobId: job.id,
      claimToken: job.claimToken,
      now,
      errorCode,
    });
    logger.error(
      {
        jobSubject: logIdentifier("processing-job", job.id),
        ledgerSubject: logIdentifier("ledger", job.ledgerId),
        attempts: job.attempts + 1,
        errorCode,
        outcome,
      },
      "Category reclassification job failed"
    );
  }
}
