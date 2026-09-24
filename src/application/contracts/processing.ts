import type {
  LedgerId,
  ProcessingClaimContract,
  ProcessingCompletionContract,
  ProcessingJobContract,
  ProcessingJobId,
  ProcessingLeaseContract,
  RevisionId,
  RevisionProcessingStatus,
  SourceDocumentId,
} from "./source-documents";

export interface ProcessingPort {
  dispatch(job: ProcessingJobContract): Promise<void>;
  claim(jobId: ProcessingJobId): Promise<ProcessingClaimContract | null>;
  renew(jobId: ProcessingJobId, claimToken: string): Promise<string | null>;
  complete(result: ProcessingCompletionContract): Promise<boolean>;
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
  ledgerId: LedgerId;
  sourceDocumentId: SourceDocumentId;
  revisionId: RevisionId;
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
    activeRevisionId: RevisionId | null;
    latestSubmissionRevisionId: RevisionId | null;
    createdAt: Date;
  } | null;
  storedFileIds: string[];
  categories: Array<{ id: string; name: string; description: string | null }>;
}

export interface RevisionProcessorPort {
  process(request: RevisionProcessingRequestContract): Promise<RevisionProcessingResultContract>;
}
