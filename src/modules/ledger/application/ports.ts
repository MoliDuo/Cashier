import type {
  ReclassificationCandidate,
  ReclassificationDocumentGroup,
} from "./reclassification-protocol";

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
    signal?: AbortSignal;
  }): Promise<{
    decisions: readonly { ledgerEntryId: string; categoryId: string }[];
    confirmedCount: number;
  }>;
}

/** Reads the source-document groups and evidence references a run needs. */
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
}

/** A job as stored, including the ids a run has to walk. */
export interface CategoryReclassificationJobRecord {
  id: string;
  ledgerId: string;
  status: import("../contracts").CategoryAssignmentJobStatus;
  mode: import("../contracts").CategoryAssignmentMode;
  candidateSnapshot: ReclassificationCandidate[];
  declaredEntryCount: number;
  receivedEntryCount: number;
  appliedCount: number;
  confirmedCount: number;
  failedCount: number;
  conflictCount: number;
  skippedCount: number;
  cancelledCount: number;
  documentTotal: number;
  documentCompleted: number;
  lastError: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryReclassificationJobPort {
  get(input: {
    ledgerId: string;
    jobId: string;
  }): Promise<CategoryReclassificationJobRecord | null>;
  getLatest(input: { ledgerId: string }): Promise<CategoryReclassificationJobRecord | null>;
}
