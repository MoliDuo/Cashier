import type { LedgerEntryDto, LedgerEntryEmbeddedViewDto, LedgerEntrySummary } from "../contracts";
import type { LedgerEntryFilterParams } from "../filters";
import type {
  ReclassificationCandidate,
  ReclassificationDocumentGroup,
} from "./reclassification-protocol";
import type {
  AtomicBatchCommandResult,
  PartialBatchCommandResult,
  VersionedCommandResult,
  VersionedTarget,
} from "@/modules/source-document/contracts";

export interface BatchEntryDateImpact {
  selectedEntryCount: number;
  sourceDocumentCount: number;
  affectedEntryCount: number;
  sourceDocumentIds: string[];
}

export interface CategoryMetadataGeneratorPort {
  generate(input: {
    categoryName: string;
    existingCategoryNames: readonly string[];
    language?: string;
    customPrompt?: string;
  }): Promise<{ icon: string; description: string }>;
}

/**
 * Places entries into one of a caller-chosen set of categories. Narrow on
 * purpose: it is neither the category-collection port nor a versioned entry
 * command, because a comparison against candidates is a different kind of
 * decision from editing an entry.
 */
export interface EntryReclassifierPort {
  decide(input: {
    candidates: readonly ReclassificationCandidate[];
    group: ReclassificationDocumentGroup;
    /** Encoded evidence for this document; empty for a text-only submission. */
    images: readonly { dataUrl: string }[];
    customPrompt?: string;
  }): Promise<{
    decisions: readonly { ledgerEntryId: string; categoryId: string }[];
    confirmedCount: number;
  }>;
}

/**
 * Reads the entries a run needs and writes the categories back. `assign` is a
 * non-versioned, set-based write of `ledger_entries.category_id`; see the
 * adapter's file header for the trade-off that implies.
 */
export interface EntryCategoryAssignmentPort {
  /**
   * Entries grouped by the source document their evidence hangs off. Entries
   * whose document has no live active revision are absent, exactly as the
   * ungrouped read excluded them.
   */
  loadDocumentGroups(input: {
    ledgerId: string;
    ledgerEntryIds: readonly string[];
  }): Promise<readonly ReclassificationDocumentGroup[]>;
  assign(input: {
    ledgerId: string;
    decisions: readonly { ledgerEntryId: string; categoryId: string }[];
  }): Promise<{ appliedCount: number }>;
}

/** A job as stored, including the ids a run has to walk. */
export interface CategoryReclassificationJobRecord {
  id: string;
  ledgerId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  ledgerEntryIds: string[];
  candidateCategoryIds: string[];
  cursor: number;
  appliedCount: number;
  confirmedCount: number;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimedCategoryReclassificationJob extends CategoryReclassificationJobRecord {
  claimToken: string;
}

export interface CategoryReclassificationJobPort {
  enqueue(input: {
    ledgerId: string;
    ledgerEntryIds: readonly string[];
    candidateCategoryIds: readonly string[];
  }): Promise<CategoryReclassificationJobRecord>;
  get(input: {
    ledgerId: string;
    jobId: string;
  }): Promise<CategoryReclassificationJobRecord | null>;
  /**
   * The ledger's most recent run, running or finished. Status polling reads
   * this: a run's terminal state is how the client learns its counts, so the
   * last job has to stay visible after it stops being active.
   */
  getLatest(input: { ledgerId: string }): Promise<CategoryReclassificationJobRecord | null>;
  claim(input: {
    now: Date;
    leaseMs: number;
    jobId?: string;
    ledgerId?: string;
    limit?: number;
  }): Promise<readonly ClaimedCategoryReclassificationJob[]>;
  /** `false` means the lease was taken over and the caller must stop at once. */
  recordProgress(input: {
    jobId: string;
    claimToken: string;
    cursor: number;
    appliedCount: number;
    confirmedCount: number;
    now: Date;
  }): Promise<boolean>;
  complete(input: {
    jobId: string;
    claimToken: string;
    cursor: number;
    appliedCount: number;
    confirmedCount: number;
    now: Date;
  }): Promise<boolean>;
  fail(input: {
    jobId: string;
    claimToken: string;
    now: Date;
    errorCode: string;
  }): Promise<"retry_scheduled" | "permanently_failed">;
}

export interface LedgerReadPort {
  hasActiveEntries(ledgerId: string): Promise<boolean>;
  getEntry(id: string, ledgerId: string): Promise<LedgerEntryDto | null>;
  listEntries(input: {
    ledgerId: string;
    limit?: number;
    cursor?: string | null;
    filters: LedgerEntryFilterParams;
  }): Promise<{ items: LedgerEntryDto[]; nextCursor: string | null }>;
  calculateStats(input: {
    ledgerId: string;
    filters: LedgerEntryFilterParams;
  }): Promise<LedgerEntrySummary>;
  getBatchEntryDateImpact(input: {
    ledgerId: string;
    ledgerEntryIds: string[];
  }): Promise<BatchEntryDateImpact>;
  listEntriesBySourceDocumentIds(input: {
    ledgerId: string;
    sourceDocumentIds: string[];
  }): Promise<Map<string, LedgerEntryEmbeddedViewDto[]>>;
}

export interface LedgerEntryCommandPort {
  create(input: {
    ledgerId: string;
    target: VersionedTarget;
    amount: string;
    currency?: string;
    itemName: string;
    categoryId?: string;
    description?: string | null;
  }): Promise<VersionedCommandResult<{ ledgerEntryId: string }>>;
  update(input: {
    ledgerId: string;
    target: VersionedTarget;
    ledgerEntryId: string;
    categoryId?: string | null;
    amount?: string;
    currency?: string | null;
    itemName?: string;
    description?: string | null;
  }): Promise<VersionedCommandResult<{ ledgerEntryId: string }>>;
  delete(input: {
    ledgerId: string;
    target: VersionedTarget;
    ledgerEntryId: string;
  }): Promise<VersionedCommandResult<{ ledgerEntryId: string; deleted: true }>>;
  batchUpdate(input: {
    ledgerId: string;
    targets: VersionedTarget[];
    ledgerEntryIds: string[];
    categoryId?: string | null;
    amount?: string;
    currency?: string | null;
    itemName?: string;
    description?: string | null;
  }): Promise<AtomicBatchCommandResult<{ ledgerEntryIds: string[]; affectedCount: number }>>;
  batchDelete(input: {
    ledgerId: string;
    targets: VersionedTarget[];
    ledgerEntryIds: string[];
  }): Promise<PartialBatchCommandResult>;
}
