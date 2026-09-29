import type { AttemptProcessingStatus } from "@/modules/source-document/lifecycle";

/** A processing attempt waiting to run; the attempt is its own queue entry. */
export interface ProcessingJobContract {
  sourceDocumentId: string;
  attemptId: string;
  requestedAt: string;
}

/**
 * Claim identity for a leased processing worker. Writes that finalize a
 * attempt or projection must verify this lease inside their transaction so a
 * worker whose lease was lost or reclaimed cannot commit stale results.
 */
export interface ProcessingLeaseContract {
  attemptId: string;
  claimToken: string;
}

export interface ProcessingClaimContract {
  job: ProcessingJobContract;
  claimToken: string;
  /** Runs this attempt has been given, this one included. */
  runNumber: number;
  expiresAt: string;
}

export interface RecoverableProcessingJobContract extends ProcessingJobContract {
  attemptCount: number;
  nextAttemptAt: string;
}

export interface AttemptProcessingRequestContract {
  sourceDocumentId: string;
  attemptId: string;
  signal: AbortSignal;
  lease: ProcessingLeaseContract;
}

export interface AttemptProcessingResultContract {
  processingStatus: Extract<AttemptProcessingStatus, "completed" | "failed">;
  failureMessage?: string;
}

export interface AttemptProcessingContextContract {
  attempt: {
    inputText: string | null;
    requestedDate: string | null;
    referenceDate: string | null;
    processingStatus: AttemptProcessingStatus | null;
  } | null;
  document: {
    latestAttemptId: string | null;
    createdAt: Date;
  } | null;
  storedFileIds: string[];
  categories: Array<{ id: string; name: string; description: string | null }>;
}
