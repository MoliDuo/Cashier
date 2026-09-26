"use client";

import { toast } from "sonner";
import type { EntryFilters } from "@/modules/ledger/filters";
import type { CreatedRecordResult } from "@/modules/source-document/contracts";
import { openLedgerDetail } from "@/lib/navigation/ledger-detail-navigation";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { quickEntryFormCopy, sourceDocumentInputCopy } from "@/copy/source-document";

export type NewRecordInputMode = "ai" | "quick";

interface SavedBook {
  id: string;
  name: string;
}

interface ShowNewRecordSuccessFeedbackOptions {
  mode: NewRecordInputMode;
  result: CreatedRecordResult;
  activeTab: LedgerTab;
  committedFilters: EntryFilters;
  /** The book being viewed, or null for 总账. */
  viewedBookId: string | null;
  /** The book the record went into, when it is known. */
  savedBook: SavedBook | null;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

/**
 * A record saved into a book other than the one being viewed cannot appear in
 * the current view, no matter what the filters say.
 */
export function shouldWarnNewRecordSavedToOtherBook(
  viewedBookId: string | null,
  savedBook: SavedBook | null
): savedBook is SavedBook {
  return viewedBookId != null && savedBook != null && savedBook.id !== viewedBookId;
}

export function shouldWarnNewRecordMayBeHidden(
  activeTab: LedgerTab,
  committedFilters: EntryFilters,
  entryDate: string
): boolean {
  if (activeTab !== "stream") return true;

  if (
    (committedFilters.search != null && committedFilters.search !== "") ||
    (committedFilters.statuses?.length ?? 0) > 0 ||
    (committedFilters.categoryId != null && committedFilters.categoryId !== "") ||
    (committedFilters.currency != null && committedFilters.currency !== "") ||
    committedFilters.minAmount != null ||
    committedFilters.maxAmount != null
  ) {
    return true;
  }

  const submittedDate = dateOnly(entryDate);
  if (committedFilters.startDate != null && submittedDate < dateOnly(committedFilters.startDate)) {
    return true;
  }
  if (committedFilters.endDate != null && submittedDate > dateOnly(committedFilters.endDate)) {
    return true;
  }

  return false;
}

export function showNewRecordSuccessFeedback({
  mode,
  result,
  activeTab,
  committedFilters,
  viewedBookId,
  savedBook,
}: ShowNewRecordSuccessFeedbackOptions): void {
  if (shouldWarnNewRecordSavedToOtherBook(viewedBookId, savedBook)) {
    toast.success(sourceDocumentInputCopy.savedToOtherBook({ book: savedBook.name }), {
      action: {
        label: sourceDocumentInputCopy.viewRecord,
        onClick: () =>
          openLedgerDetail({
            type: "source-document",
            id: result.sourceDocumentId,
          }),
      },
    });
    return;
  }

  if (shouldWarnNewRecordMayBeHidden(activeTab, committedFilters, result.documentDate)) {
    toast.success(sourceDocumentInputCopy.savedMayBeHidden, {
      action: {
        label: sourceDocumentInputCopy.viewRecord,
        onClick: () =>
          openLedgerDetail({
            type: "source-document",
            id: result.sourceDocumentId,
          }),
      },
    });
    return;
  }

  toast.success(
    mode === "ai" ? sourceDocumentInputCopy.uploadSuccess : quickEntryFormCopy.quickEntrySuccess
  );
}
