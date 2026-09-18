import type {
  RecoverableProcessingJobContract,
  CategoryPort,
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
  SourceDocumentDetailDto,
  SourceDocumentListItemDto,
  SourceDocumentProcessingStatus,
  AtomicBatchCommandResult,
  VersionedCommandResult,
  VersionedTarget,
} from "../contracts";

interface SourceDocumentFilterInput {
  ledgerId: string;
  bookId?: string;
  statuses?: readonly SourceDocumentProcessingStatus[];
  startDate?: string | null;
  endDate?: string | null;
  minAmount?: string;
  maxAmount?: string;
  search?: string;
}

interface SourceDocumentListInput extends SourceDocumentFilterInput {
  cursor?: string | null;
  limit: number;
}

export interface SourceDocumentReadPort {
  calculateCompletedTotal(input: SourceDocumentFilterInput): Promise<{
    total: string;
    unconvertedCount: number;
  }>;
  getInput(
    ledgerId: string,
    sourceDocumentId: string
  ): Promise<import("../contracts").SourceDocumentInputDto | null>;
  get(ledgerId: string, sourceDocumentId: string): Promise<SourceDocumentDetailDto | null>;
  getAccessContext(
    sourceDocumentId: string
  ): Promise<{ ledgerId: string; hasImages: boolean } | null>;
  list(input: SourceDocumentListInput): Promise<{
    items: SourceDocumentListItemDto[];
    nextCursor: string | null;
  }>;
}

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
  /** The record's current book, for the detail page's book field. */
  getBook(input: {
    ledgerId: string;
    sourceDocumentId: string;
  }): Promise<{ bookId: string; version: number } | null>;
  /** Moves one record to another book of the same ledger. */
  assignBook(input: {
    ledgerId: string;
    sourceDocumentId: string;
    expectedVersion: number;
    bookId: string;
  }): Promise<{ ok: true; version: number } | { ok: false; currentVersion: number }>;
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
      impact: import("@/modules/ledger/application/ports").BatchEntryDateImpact;
    }>
  >;
  addEntry: LedgerEntryCommandPort["create"];
  updateEntries: LedgerEntryCommandPort["update"];
  deleteEntries: LedgerEntryCommandPort["delete"];
  batchUpdateEntries: LedgerEntryCommandPort["batchUpdate"];
  batchDeleteEntries: LedgerEntryCommandPort["batchDelete"];
  installRetry(
    input: SourceDocumentSubmissionInput & { sourceDocumentId: string; expectedVersion: number }
  ): ReturnType<SourceDocumentSubmissionPort["submit"]>;
  cancelProcessing: SourceDocumentLifecyclePort["cancelProcessing"];
  deleteDocuments(input: {
    ledgerId: string;
    target: VersionedTarget;
  }): Promise<VersionedCommandResult<import("../contracts").DeleteSourceDocumentResultDto>>;
  completeProcessing: LedgerProjectionPort["activateRevision"];
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
  categories: Pick<CategoryPort, "get">;
  projections: Pick<LedgerProjectionPort, "createManual">;
  convertAmount(input: {
    amount: string;
    fromCurrency: string;
    toCurrency: string;
    date?: string;
  }): Promise<{ convertedAmount: string; exchangeRate: string }>;
}

export interface SourceDocumentLifecyclePort {
  cancelProcessing(
    ledgerId: string,
    sourceDocumentId: string,
    expectedVersion: number
  ): Promise<{
    version: number;
    processingStatus: "cancelled";
  }>;
}

export interface ProcessingRecoveryPort {
  recoverBatch(
    ledgerId: string,
    config: import("@/application/contracts").ProcessingRecoveryConfig
  ): Promise<readonly RecoverableProcessingJobContract[]>;
}

export interface CredentialSourceDocumentStatusResult {
  sourceDocumentId: string;
  revisionId: string;
  status: "processing" | "completed" | "invalid" | "failed" | "cancelled";
  submittedAt: string;
  finalizedAt: string | null;
  entryDate: string | null;
  result: null | {
    title: string | null;
    /** Accounting total in the ledger's main currency (convertedAmount sum). */
    total: string;
    /** Three-letter ISO currency code of `total`, from the ledger's main currency. */
    totalCurrency: string;
    entries: Array<{
      name: string;
      description: string | null;
      amount: string;
      currency: string | null;
      category: string | null;
    }>;
  };
  /**
   * Sanitized failure information. `code` is always a stable, non-empty
   * public code; `message` is an optional user-facing explanation.
   */
  error: null | { code: string; message?: string | null };
}

export interface CredentialSourceDocumentReadPort {
  getStatus(
    ledgerId: string,
    sourceDocumentId: string
  ): Promise<CredentialSourceDocumentStatusResult | null>;
}

export interface LedgerChangeReadPort {
  getVersion(ledgerId: string): Promise<bigint>;
  getRefreshBaseline(ledgerId: string): Promise<{ version: bigint; hasTransitionalWork: boolean }>;
  summarizeChanges(input: { ledgerId: string; afterVersion: bigint }): Promise<{
    currentVersion: bigint;
    firstRetainedVersion: bigint | null;
    lastRetainedVersion: bigint | null;
    categoriesChanged: boolean;
    settingsChanged: boolean;
    statsChanged: boolean;
    resetRequired: boolean;
    hasTransitionalWork: boolean;
  }>;
}
