import type {
  RecoverableProcessingJobContract,
  DirectStoredFilePort,
  LedgerProjectionPort,
  StoredFileContract,
  SourceDocumentIdempotencyInput,
  SourceDocumentSubmissionInput,
  SourceDocumentSubmissionPort,
} from "@/application/contracts";
import type { LedgerEntryCommandPort } from "@/modules/ledger/application/ports";
import type {
  BatchUpdateSourceDocumentsInput,
  UpdateSourceDocumentInput,
} from "../contract-schemas";
import type {
  BatchUpdateSourceDocumentsResultDto,
  SaveSourceDocumentChangesResultDto,
  SplitSourceDocumentResultDto,
  AtomicBatchCommandResult,
  VersionedCommandResult,
  VersionedTarget,
} from "../contracts";

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

/** The only application-facing boundary for writes that change a document's visible projection. */
export interface SourceDocumentAggregateWritePort {
  /**
   * Moves one record to another book of the same ledger. A target that is gone
   * or archived is refused rather than written: the record would otherwise be
   * filed somewhere the reader cannot see it.
   */
  assignBook(input: {
    ledgerId: string;
    sourceDocumentId: string;
    expectedVersion: number;
    bookId: string;
  }): Promise<
    | { ok: true; version: number }
    | { ok: false; reason: "stale"; currentVersion: number }
    | { ok: false; reason: "book_unavailable" }
  >;
  applyCategoryAssignments(
    input: ApplyCategoryAssignmentsInput
  ): Promise<ApplyCategoryAssignmentsResult>;
  createProcessingDocument: SourceDocumentSubmissionPort["submit"];
  createIdempotentProcessingDocument: (
    idempotency: SourceDocumentIdempotencyInput,
    prepare: () => Promise<SourceDocumentSubmissionInput>
  ) => ReturnType<SourceDocumentSubmissionPort["submitIdempotently"]>;
  createManualDocument: LedgerProjectionPort["createManual"];
  updateDocuments(input: {
    ledgerId: string;
    targets: VersionedTarget[];
    data: BatchUpdateSourceDocumentsInput;
  }): Promise<AtomicBatchCommandResult<BatchUpdateSourceDocumentsResultDto>>;
  saveChanges(input: {
    ledgerId: string;
    sourceDocumentId: string;
    expectedVersion: number;
    sourceDocument?: UpdateSourceDocumentInput;
    entries: Array<{
      ledgerEntryId: string;
      data: import("@/modules/ledger/contract-schemas").UpdateLedgerEntryInput;
    }>;
  }): Promise<VersionedCommandResult<SaveSourceDocumentChangesResultDto>>;
  splitEntries(input: {
    ledgerId: string;
    sourceDocumentId: string;
    expectedVersion: number;
    ledgerEntryIds: string[];
    entryDate: string;
  }): Promise<VersionedCommandResult<SplitSourceDocumentResultDto>>;
  applyDateOrganization(
    input: import("../contracts").ApplyDateOrganizationInput & {
      ledgerId: string;
    }
  ): Promise<VersionedCommandResult<import("../contracts").ApplyDateOrganizationResultDto>>;
  dismissDateOrganization(
    input: import("../contracts").DismissDateOrganizationInput & {
      ledgerId: string;
    }
  ): Promise<VersionedCommandResult<{ dismissed: true }>>;
  updateEntryDates(input: {
    ledgerId: string;
    targets: VersionedTarget[];
    ledgerEntryIds: string[];
    entryDate: string;
  }): Promise<
    AtomicBatchCommandResult<{
      impact: import("@/modules/ledger/contracts").BatchEntryDateImpact;
    }>
  >;
  addEntry: LedgerEntryCommandPort["create"];
  deleteEntries: LedgerEntryCommandPort["delete"];
  batchUpdateEntries: LedgerEntryCommandPort["batchUpdate"];
  batchDeleteEntries: LedgerEntryCommandPort["batchDelete"];
  installRetry(
    input: SourceDocumentSubmissionInput & { sourceDocumentId: string; expectedVersion: number }
  ): ReturnType<SourceDocumentSubmissionPort["submit"]>;
  cancelProcessing(
    ledgerId: string,
    sourceDocumentId: string,
    expectedVersion: number
  ): Promise<{
    version: number;
    processingStatus: "cancelled";
  }>;
  deleteDocuments(input: {
    ledgerId: string;
    target: VersionedTarget;
  }): Promise<VersionedCommandResult<import("../contracts").DeleteSourceDocumentResultDto>>;
}

export interface SourceDocumentCredentialPorts {
  submissions: SourceDocumentSubmissionPort;
  storedFiles: DirectStoredFilePort & {
    uploadTarget(input: {
      ledgerId: string;
      uploadSessionId: string;
      targetId: string;
      contentType: string;
      body: Uint8Array;
    }): Promise<StoredFileContract>;
  };
}

export interface QuickEntryPorts {
  projections: Pick<LedgerProjectionPort, "createManual">;
  convertAmount(input: {
    amount: string;
    fromCurrency: string;
    toCurrency: string;
    date?: string;
  }): Promise<{ convertedAmount: string; exchangeRate: string }>;
}

export interface ProcessingRecoveryPort {
  recoverBatch(
    ledgerId: string,
    config: import("@/application/contracts").ProcessingRecoveryConfig
  ): Promise<readonly RecoverableProcessingJobContract[]>;
}
