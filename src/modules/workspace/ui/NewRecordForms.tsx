"use client";
import { useCallback, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { safePrefetch } from "@/lib/safe-prefetch";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { EntryCategoryWithCount } from "@/modules/ledger/contracts";
import type { CreatedRecordResult } from "@/modules/source-document/contracts";
import { writeLastNewRecordBookId } from "../new-record-book-memory";
import {
  showNewRecordSuccessFeedback,
  type CommittedView,
  type NewRecordInputMode,
} from "./new-record-success-feedback";

const SourceDocumentInput = dynamic(
  () =>
    import("@/modules/source-document/ui/SourceDocumentInput").then((m) => ({
      default: m.SourceDocumentInput,
    })),
  { ssr: false, loading: () => <InputFormLoadingFallback /> }
);
const QuickEntryForm = dynamic(
  () =>
    import("@/modules/source-document/ui/QuickEntryForm").then((m) => ({
      default: m.QuickEntryForm,
    })),
  { ssr: false, loading: () => <InputFormLoadingFallback /> }
);

export function preloadNewRecordModules() {
  safePrefetch(
    import("@/modules/source-document/ui/SourceDocumentInput"),
    "PREFETCH_SOURCE_DOCUMENT_INPUT_FAILED"
  );
  safePrefetch(
    import("@/modules/source-document/ui/QuickEntryForm"),
    "PREFETCH_QUICK_ENTRY_FAILED"
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-surface2", className)} />;
}

export function InputFormLoadingFallback() {
  return (
    <div className="space-y-4 pt-1" role="status" aria-busy="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

interface NewRecordFormsProps {
  bookId: string;
  /** The book being viewed, or null for 总账. */
  viewedBookId: string | null;
  /** The book the record goes into, when it is resolvable in the live list. */
  savedBook: { id: string; name: string } | null;
  activeTab: LedgerTab;
  committedView: CommittedView;
  inputMode: NewRecordInputMode;
  categories: EntryCategoryWithCount[];
  mainCurrency: string;
  preferredCurrencies: string[];
  timeZone?: string;
  setInputOpen: (open: boolean) => void;
  setAiPending: (pending: boolean) => void;
  setQuickPending: (pending: boolean) => void;
  /** The record's book picker, shown in each form's footer. */
  bookPicker: ReactNode;
}

export function NewRecordForms({
  bookId,
  viewedBookId,
  savedBook,
  activeTab,
  committedView,
  inputMode,
  categories,
  mainCurrency,
  preferredCurrencies,
  timeZone,
  setInputOpen,
  setAiPending,
  setQuickPending,
  bookPicker,
}: NewRecordFormsProps) {
  const handleSuccess = useCallback(
    (mode: NewRecordInputMode, result: CreatedRecordResult) => {
      // Only a saved record counts as the picker's "last choice": a pick that
      // was changed and then cancelled must not become the next default.
      if (savedBook != null) writeLastNewRecordBookId(savedBook.id);

      showNewRecordSuccessFeedback({
        mode,
        result,
        activeTab,
        committedView,
        viewedBookId,
        savedBook,
      });

      // A saved record closes the dialog. Whatever was typed into the other
      // mode stays in that mode's draft for the next opening.
      setInputOpen(false);
    },
    [activeTab, committedView, savedBook, setInputOpen, viewedBookId]
  );

  return (
    <>
      <div
        className={inputMode === "ai" ? "flex flex-1 flex-col" : "hidden"}
        aria-hidden={inputMode !== "ai"}
      >
        <SourceDocumentInput
          bookId={bookId}

          isActive={inputMode === "ai"}
          footerStart={bookPicker}
          onPendingChange={setAiPending}
          {...(timeZone != null ? { timeZone } : {})}
          onSuccess={(result) => handleSuccess("ai", result)}
        />
      </div>
      <div
        className={inputMode === "quick" ? "flex flex-1 flex-col" : "hidden"}
        aria-hidden={inputMode !== "quick"}
      >
        <QuickEntryForm
          bookId={bookId}

          categories={categories}
          mainCurrency={mainCurrency}
          preferredCurrencies={preferredCurrencies}
          onPendingChange={setQuickPending}
          footerStart={bookPicker}
          {...(timeZone != null ? { timeZone } : {})}
          onSuccess={(result) => handleSuccess("quick", result)}
        />
      </div>
    </>
  );
}
