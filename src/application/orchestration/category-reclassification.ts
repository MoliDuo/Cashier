import "server-only";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { postgresCategoryAssignmentV2Adapter } from "@/application/adapters/postgres/category-assignment-v2";
import { postgresEntryCategoryAssignmentAdapter } from "@/application/adapters/postgres/ledger-entry-category-assignment";
import { applyCategoryAssignments } from "@/application/adapters/postgres/source-document-aggregate/category-assignments";
import { entryReclassifierAdapter } from "@/application/adapters/ai/entry-reclassifier";
import { isSuccessfulLoadImageResult, loadStoredFilesForAI } from "@/server/processing/evidence";
import type { ClaimedCategoryAssignmentDocument } from "@/application/adapters/postgres/category-assignment-v2";
import { AI_CATEGORY_CONCURRENCY, AI_CATEGORY_MAX_ATTEMPTS } from "@/config/tuning";

const CLAIM_LEASE_MS = 120_000;
const CLAIM_HEARTBEAT_MS = 20_000;
const REQUEST_CHUNK_SIZE = 50;
const MAX_IDLE_WAIT_MS = 30_000;
const SLOT_RECHECK_MS = 250;

function stableErrorCode(error: unknown): string {
  if (error instanceof AppError) return error.code;
  return "ai_provider_unavailable";
}

async function processDocument(work: ClaimedCategoryAssignmentDocument): Promise<void> {
  const startedAt = Date.now();
  const selection = await postgresCategoryAssignmentV2Adapter.loadDocumentSelection({
    ledgerId: work.ledgerId,
    jobId: work.jobId,
    sourceDocumentId: work.sourceDocumentId,
  });
  try {
    if (work.mode.kind === "ai") {
      const groups = await postgresEntryCategoryAssignmentAdapter.loadDocumentGroups({
        ledgerId: work.ledgerId,
        ledgerEntryIds: selection.entryIds,
      });
      const group = groups.find(
        (candidate) => candidate.sourceDocumentId === work.sourceDocumentId
      );
      if (group == null) {
        await applyCategoryAssignments({
          ledgerId: work.ledgerId,
          jobId: work.jobId,
          sourceDocumentId: work.sourceDocumentId,
          claimToken: work.claimToken,
        });
        return;
      }
      const imageStartedAt = Date.now();
      const loaded = await loadStoredFilesForAI(work.ledgerId, [...group.storedFileIds]);
      const images = loaded
        .filter(isSuccessfulLoadImageResult)
        .map((image) => ({ dataUrl: image.dataUrl }));
      if (loaded.some((image) => !image.success)) {
        await postgresCategoryAssignmentV2Adapter.markEvidenceIncomplete({
          ledgerId: work.ledgerId,
          jobId: work.jobId,
          sourceDocumentId: work.sourceDocumentId,
          claimToken: work.claimToken,
        });
      }
      for (
        let chunkIndex = selection.completedChunkCount;
        chunkIndex * REQUEST_CHUNK_SIZE < group.subjects.length;
        chunkIndex += 1
      ) {
        const now = new Date();
        const owned = await postgresCategoryAssignmentV2Adapter.renewDocumentClaim({
          ledgerId: work.ledgerId,
          jobId: work.jobId,
          sourceDocumentId: work.sourceDocumentId,
          claimToken: work.claimToken,
          leaseMs: CLAIM_LEASE_MS,
          now,
        });
        if (!owned) return;
        const controller = new AbortController();
        const chunk = {
          ...group,
          subjects: group.subjects.slice(
            chunkIndex * REQUEST_CHUNK_SIZE,
            (chunkIndex + 1) * REQUEST_CHUNK_SIZE
          ),
        };
        const aiStartedAt = Date.now();
        let heartbeatInFlight: Promise<void> | null = null;
        const heartbeat = setInterval(() => {
          if (heartbeatInFlight != null) return;
          heartbeatInFlight = postgresCategoryAssignmentV2Adapter
            .renewDocumentClaim({
              ledgerId: work.ledgerId,
              jobId: work.jobId,
              sourceDocumentId: work.sourceDocumentId,
              claimToken: work.claimToken,
              leaseMs: CLAIM_LEASE_MS,
              now: new Date(),
            })
            .then((renewed) => {
              if (!renewed) controller.abort();
            })
            .catch(() => controller.abort())
            .finally(() => {
              heartbeatInFlight = null;
            });
        }, CLAIM_HEARTBEAT_MS);
        let result;
        try {
          result = await entryReclassifierAdapter.decide({
            candidates: work.candidates,
            group: chunk,
            images,
            signal: controller.signal,
            ...(work.customPrompt == null || work.customPrompt === ""
              ? {}
              : { customPrompt: work.customPrompt }),
          });
        } finally {
          clearInterval(heartbeat);
          if (heartbeatInFlight != null) await heartbeatInFlight;
        }
        const persisted = await postgresCategoryAssignmentV2Adapter.persistDecisions({
          ledgerId: work.ledgerId,
          jobId: work.jobId,
          sourceDocumentId: work.sourceDocumentId,
          claimToken: work.claimToken,
          decisions: result.decisions,
          completedChunkCount: chunkIndex + 1,
          now: new Date(),
        });
        logger.info(
          {
            jobSubject: logIdentifier("processing-job", work.jobId),
            documentSubject: logIdentifier("source-document", work.sourceDocumentId),
            attempt: work.attempts,
            entryCount: chunk.subjects.length,
            imageCount: images.length,
            imageLoadDurationMs: Date.now() - imageStartedAt,
            aiDurationMs: Date.now() - aiStartedAt,
            errorCode: persisted ? null : "claim_lost",
          },
          "Category assignment request block finished"
        );
        if (!persisted) return;
      }
    }
    const commitStartedAt = Date.now();
    const result = await applyCategoryAssignments({
      ledgerId: work.ledgerId,
      jobId: work.jobId,
      sourceDocumentId: work.sourceDocumentId,
      claimToken: work.claimToken,
      now: new Date(),
    });
    logger.info(
      {
        jobSubject: logIdentifier("processing-job", work.jobId),
        documentSubject: logIdentifier("source-document", work.sourceDocumentId),
        attempt: work.attempts,
        entryCount: selection.entryIds.length,
        databaseCommitDurationMs: Date.now() - commitStartedAt,
        totalDurationMs: Date.now() - startedAt,
        outcome: result.status,
      },
      "Category assignment document finished"
    );
  } catch (error) {
    const errorCode = stableErrorCode(error);
    const outcome = await postgresCategoryAssignmentV2Adapter.failDocument({
      ledgerId: work.ledgerId,
      jobId: work.jobId,
      sourceDocumentId: work.sourceDocumentId,
      claimToken: work.claimToken,
      errorCode,
      maxAttempts: AI_CATEGORY_MAX_ATTEMPTS,
      ...(errorCode === "ai_rate_limited"
        ? {
            retryAfterMs:
              error instanceof AppError && typeof error.details?.retryAfterMs === "number"
                ? error.details.retryAfterMs
                : 10_000,
          }
        : {}),
      now: new Date(),
    });
    logger.warn(
      {
        jobSubject: logIdentifier("processing-job", work.jobId),
        documentSubject: logIdentifier("source-document", work.sourceDocumentId),
        attempt: work.attempts,
        entryCount: selection.entryIds.length,
        totalDurationMs: Date.now() - startedAt,
        errorCode,
        retrying: outcome === "retry_scheduled",
      },
      "Category assignment document failed"
    );
  }
}

async function runLoop(scope: { jobId?: string; ledgerId?: string }): Promise<boolean> {
  let processed = false;
  for (;;) {
    const claimed = await postgresCategoryAssignmentV2Adapter.claimDocuments({
      now: new Date(),
      leaseMs: CLAIM_LEASE_MS,
      concurrency: AI_CATEGORY_CONCURRENCY,
      ...scope,
    });
    if (claimed.length > 0) {
      processed = true;
      await Promise.all(claimed.map(processDocument));
      continue;
    }
    const nextDue = await postgresCategoryAssignmentV2Adapter.nextDue(scope);
    if (nextDue == null) return processed;
    const waitMs = nextDue.getTime() - Date.now();
    if (waitMs <= 0) {
      // Due work can remain unclaimed while another process owns every global
      // slot. Keep this after() lifecycle alive so the job starts as soon as a
      // lease is released instead of waiting for a future browser request.
      await new Promise((resolve) => setTimeout(resolve, SLOT_RECHECK_MS));
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, MAX_IDLE_WAIT_MS)));
  }
}

export async function runCategoryReclassificationJob(jobId: string): Promise<boolean> {
  return runLoop({ jobId });
}

export async function recoverLedgerCategoryReclassifications(ledgerId: string): Promise<void> {
  await runLoop({ ledgerId });
}

export async function drainDueCategoryReclassifications(_now?: Date): Promise<void> {
  await runLoop({});
}
