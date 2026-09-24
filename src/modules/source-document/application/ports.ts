import type {
  ProcessingRecoveryConfig,
  RecoverableProcessingJobContract,
} from "@/application/contracts";

export interface ApplyCategoryAssignmentsInput {
  ledgerId: string;
  jobId: string;
  sourceDocumentId: string;
  claimToken: string;
  now?: Date;
}
export type ApplyCategoryAssignmentsResult =
  | { status: "applied"; appliedCount: number; confirmedCount: number; version: number }
  | { status: "conflict" | "skipped" | "cancelled" | "claim_lost" };

export interface ProcessingRecoveryPort {
  recoverBatch(
    ledgerId: string,
    config: ProcessingRecoveryConfig
  ): Promise<readonly RecoverableProcessingJobContract[]>;
}
