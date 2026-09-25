import "server-only";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { classifyFailure, retryDelayMs } from "@/lib/background/retry";
import { holdLease } from "@/lib/db/lease";
import { applyCategoryAssignments } from "@/modules/source-document/server/category-assignments";
import { isSuccessfulLoadImageResult, loadStoredFilesForAI } from "@/server/processing/evidence";
import { BACKGROUND_MAX_ATTEMPTS, CATEGORY_RUN_BUDGET_MS } from "@/config/tuning";
import type {
  CategoryAssignmentDocumentWork,
  ClaimedCategoryAssignmentJob,
} from "@/server/category-reclassification/assignments";
import {
  claimCategoryAssignmentJob,
  failCategoryAssignmentDocument,
  loadCategoryAssignmentSelection,
  markCategoryAssignmentEvidenceIncomplete,
  nextCategoryAssignmentDocument,
  persistCategoryAssignmentDecisions,
  releaseCategoryAssignmentJob,
  renewCategoryAssignmentLease,
  rescheduleCategoryAssignmentDocument,
  yieldCategoryAssignmentDocument,
} from "@/server/category-reclassification/assignments";
import { loadReclassificationDocumentGroups } from "@/server/category-reclassification/document-groups";
import { decideEntryCategories } from "@/server/category-reclassification/reclassifier";

const REQUEST_CHUNK_SIZE = 50;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Asks the model about one document's entries, a request block at a time, then
 * writes the decisions. Returns false when the run has to stop: its lease is
 * gone or its budget ended between blocks.
 */
async function processDocument(
  job: ClaimedCategoryAssignmentJob,
  document: CategoryAssignmentDocumentWork,
  signal: AbortSignal,
  deadlineAt: number
): Promise<boolean> {
  const { sourceDocumentId } = document;
  const startedAt = Date.now();
  const subject = {
    jobSubject: logIdentifier("processing-job", job.jobId),
    documentSubject: logIdentifier("source-document", sourceDocumentId),
    attempt: document.attempt,
  };
  if (document.attempt > BACKGROUND_MAX_ATTEMPTS) {
    // Every earlier attempt died without recording an outcome.
    await failCategoryAssignmentDocument({
      lease: job,
      sourceDocumentId,
      errorCode: document.lastErrorCode ?? "ai_timeout",
    });
    logger.warn(subject, "Category assignment document ran out of attempts");
    return true;
  }
  try {
    if (job.mode.kind === "ai") {
      const entryIds = await loadCategoryAssignmentSelection({
        ledgerId: job.ledgerId,
        jobId: job.jobId,
        sourceDocumentId,
      });
      const groups = await loadReclassificationDocumentGroups({
        ledgerId: job.ledgerId,
        ledgerEntryIds: entryIds,
      });
      // A document that no longer holds these entries is settled by the apply.
      const group = groups.find((candidate) => candidate.sourceDocumentId === sourceDocumentId);
      if (group != null) {
        const loaded = await loadStoredFilesForAI(job.ledgerId, [...group.storedFileIds]);
        const images = loaded
          .filter(isSuccessfulLoadImageResult)
          .map((image) => ({ dataUrl: image.dataUrl }));
        if (loaded.some((image) => !image.success)) {
          await markCategoryAssignmentEvidenceIncomplete(job, sourceDocumentId);
        }
        for (
          let chunkIndex = document.completedChunkCount;
          chunkIndex * REQUEST_CHUNK_SIZE < group.subjects.length;
          chunkIndex += 1
        ) {
          if (signal.aborted) return false;
          if (Date.now() >= deadlineAt) {
            await yieldCategoryAssignmentDocument(job, sourceDocumentId);
            return false;
          }
          const chunk = {
            ...group,
            subjects: group.subjects.slice(
              chunkIndex * REQUEST_CHUNK_SIZE,
              (chunkIndex + 1) * REQUEST_CHUNK_SIZE
            ),
          };
          const aiStartedAt = Date.now();
          const result = await decideEntryCategories({
            candidates: job.candidates,
            group: chunk,
            images,
            signal,
            ...(job.customPrompt == null || job.customPrompt === ""
              ? {}
              : { customPrompt: job.customPrompt }),
          });
          const persisted = await persistCategoryAssignmentDecisions({
            lease: job,
            sourceDocumentId,
            decisions: result.decisions,
            completedChunkCount: chunkIndex + 1,
          });
          logger.info(
            {
              ...subject,
              entryCount: chunk.subjects.length,
              imageCount: images.length,
              aiDurationMs: Date.now() - aiStartedAt,
              errorCode: persisted ? null : "claim_lost",
            },
            "Category assignment request block finished"
          );
          if (!persisted) return false;
        }
      }
    }
    const commitStartedAt = Date.now();
    const result = await applyCategoryAssignments({ lease: job, sourceDocumentId });
    logger.info(
      {
        ...subject,
        databaseCommitDurationMs: Date.now() - commitStartedAt,
        totalDurationMs: Date.now() - startedAt,
        outcome: result.status,
      },
      "Category assignment document finished"
    );
    return result.status !== "claim_lost";
  } catch (error) {
    // A lost lease aborts the request; there is nothing left to record.
    if (signal.aborted) return false;
    const failure = classifyFailure(error);
    const errorCode = failure.code ?? "ai_provider_unavailable";
    const retrying = failure.kind === "transient" && document.attempt < BACKGROUND_MAX_ATTEMPTS;
    const recorded = retrying
      ? await rescheduleCategoryAssignmentDocument({
          lease: job,
          sourceDocumentId,
          errorCode,
          delayMs: retryDelayMs(document.attempt, failure.retryAfterMs),
        })
      : await failCategoryAssignmentDocument({ lease: job, sourceDocumentId, errorCode });
    const details = { ...subject, totalDurationMs: Date.now() - startedAt, errorCode, retrying };
    // A configuration failure fails every document the same way until fixed.
    if (failure.kind === "configuration") {
      logger.error(details, "Category assignment document failed");
    } else {
      logger.warn(details, "Category assignment document failed");
    }
    return recorded;
  }
}

/**
 * Works through a claimed job's documents one at a time until none is left,
 * the budget is spent, or the lease is lost. A document waiting out a retry
 * that comes due within the budget is waited for; one due later is left to the
 * next run, which the status poll starts.
 */
async function runJob(job: ClaimedCategoryAssignmentJob, deadlineAt: number): Promise<void> {
  const lease = holdLease(
    () => renewCategoryAssignmentLease(job),
    (reason, error) =>
      logger.warn(
        { error, reason, jobSubject: logIdentifier("processing-job", job.jobId) },
        "Category assignment lease lost"
      )
  );
  try {
    while (!lease.signal.aborted && Date.now() < deadlineAt) {
      const next = await nextCategoryAssignmentDocument(job);
      if (next.kind === "lost") return;
      if (next.kind === "done") break;
      if (next.kind === "wait") {
        if (Date.now() + next.delayMs >= deadlineAt) break;
        await sleep(next.delayMs, lease.signal);
        continue;
      }
      if (!(await processDocument(job, next.document, lease.signal, deadlineAt))) break;
    }
  } finally {
    lease.stop();
  }
  await releaseCategoryAssignmentJob(job);
}

async function runClaimed(scope: { jobId?: string; ledgerId?: string }): Promise<boolean> {
  const deadlineAt = Date.now() + CATEGORY_RUN_BUDGET_MS;
  let ran = false;
  while (Date.now() < deadlineAt) {
    const job = await claimCategoryAssignmentJob(scope);
    if (job == null) return ran;
    ran = true;
    await runJob(job, deadlineAt);
  }
  return ran;
}

export async function runCategoryReclassificationJob(jobId: string): Promise<boolean> {
  return runClaimed({ jobId });
}

export async function recoverLedgerCategoryReclassifications(ledgerId: string): Promise<void> {
  await runClaimed({ ledgerId });
}

export async function drainDueCategoryReclassifications(): Promise<void> {
  await runClaimed({});
}
