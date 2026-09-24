import type { ApplicationErrorCode } from "@/lib/application-errors";
import type {
  ProcessingFailureCode,
  RevisionProcessingStatus,
} from "@/modules/source-document/lifecycle";

export interface ProcessingJobContract {
  id: string;
  sourceDocumentId: string;
  revisionId: string;
  requestedAt: string;
  attemptNumber: number;
}

/**
 * Claim identity for a leased processing worker. Writes that finalize a
 * revision or projection must verify this lease inside their transaction so a
 * worker whose lease was lost or reclaimed cannot commit stale results.
 */
export interface ProcessingLeaseContract {
  jobId: string;
  claimToken: string;
}

interface ProcessingDiagnostic {
  correlationId: string;
  code: ApplicationErrorCode;
  stableCode?: ProcessingFailureCode;
}

export interface ProcessingCompletionContract {
  jobId: string;
  claimToken: string;
  processingStatus: Extract<RevisionProcessingStatus, "completed" | "failed">;
  diagnostic?: ProcessingDiagnostic;
}

export interface ProcessingClaimContract {
  ledgerId: string;
  job: ProcessingJobContract;
  claimToken: string;
  expiresAt: string;
}

export interface RecoverableProcessingJobContract extends ProcessingJobContract {
  scheduleAttemptCount: number;
  nextAvailableAt: string;
}

export interface ProcessingRecoveryConfig {
  maxBatch: number;
  maxAttempts: number;
  cooldownSeconds: number;
}

export interface RevisionProcessingRequestContract {
  ledgerId: string;
  sourceDocumentId: string;
  revisionId: string;
  signal: AbortSignal;
  lease: ProcessingLeaseContract;
}

export interface RevisionProcessingResultContract {
  completion: "atomic" | "residual";
  processingStatus: Extract<RevisionProcessingStatus, "completed" | "failed">;
  failureMessage?: string;
}

export interface RevisionProcessingContextContract {
  revision: {
    inputText: string | null;
    inputDocumentDate: string | null;
    inputDateReference: string | null;
    processingStatus: RevisionProcessingStatus | null;
  } | null;
  document: {
    activeRevisionId: string | null;
    latestSubmissionRevisionId: string | null;
    createdAt: Date;
  } | null;
  storedFileIds: string[];
  categories: Array<{ id: string; name: string; description: string | null }>;
}
