import type { RevisionProcessingStatus } from "@/modules/source-document/lifecycle";

/** A processing attempt waiting to run; the attempt is its own queue entry. */
export interface ProcessingJobContract {
  sourceDocumentId: string;
  revisionId: string;
  requestedAt: string;
}

/**
 * Claim identity for a leased processing worker. Writes that finalize a
 * revision or projection must verify this lease inside their transaction so a
 * worker whose lease was lost or reclaimed cannot commit stale results.
 */
export interface ProcessingLeaseContract {
  revisionId: string;
  claimToken: string;
}

export interface ProcessingClaimContract {
  ledgerId: string;
  job: ProcessingJobContract;
  claimToken: string;
  /** Runs this attempt has been given, this one included. */
  attempt: number;
  expiresAt: string;
}

export interface RecoverableProcessingJobContract extends ProcessingJobContract {
  attemptCount: number;
  nextAvailableAt: string;
}

export interface ProcessingRecoveryConfig {
  maxBatch: number;
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
    latestSubmissionRevisionId: string | null;
    createdAt: Date;
  } | null;
  storedFileIds: string[];
  categories: Array<{ id: string; name: string; description: string | null }>;
}
