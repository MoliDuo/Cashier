"use client";
import { useCallback } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { safePrefetch } from "@/lib/safe-prefetch";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { EntryCategoryWithCount } from "@/modules/ledger/contracts";
import type { EntryFilters } from "@/modules/ledger/filters";
import type { CreatedRecordResult } from "@/modules/source-document/contracts";
import { writeLastNewRecordBookId } from "../new-record-book-memory";
import {
  showNewRecordSuccessFeedback,
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
  committedFilters: EntryFilters;
  inputMode: NewRecordInputMode;
  categories: EntryCategoryWithCount[];
  mainCurrency: string;
  preferredCurrencies: string[];
  timeZone?: string;
  aiDirty: boolean;
  quickDirty: boolean;
  setInputMode: (mode: NewRecordInputMode) => void;
  setInputOpen: (open: boolean) => void;
  setAiPending: (pending: boolean) => void;
  setQuickPending: (pending: boolean) => void;
  setAiDirty: (dirty: boolean) => void;
  setQuickDirty: (dirty: boolean) => void;
}

export function NewRecordForms({
  bookId,
  viewedBookId,
  savedBook,
  activeTab,
  committedFilters,
  inputMode,
  categories,
  mainCurrency,
  preferredCurrencies,
  timeZone,
  aiDirty,
  quickDirty,
  setInputMode,
  setInputOpen,
  setAiPending,
  setQuickPending,
  setAiDirty,
  setQuickDirty,
}: NewRecordFormsProps) {
  const tSourceDocument = useTranslations("SourceDocumentInput");
  const tQuickEntry = useTranslations("QuickEntryForm");

  const handleSuccess = useCallback(
    (mode: NewRecordInputMode, result: CreatedRecordResult) => {
      // Only a saved record counts as the picker's "last choice": a pick that
      // was changed and then cancelled must not become the next default.
      if (savedBook != null) writeLastNewRecordBookId(savedBook.id);

      showNewRecordSuccessFeedback({
        mode,
        result,
        activeTab,
        committedFilters,
        viewedBookId,
        savedBook,
        messages: {
          aiSuccess: tSourceDocument("uploadSuccess"),
          quickSuccess: tQuickEntry("quickEntrySuccess"),
          savedMayBeHidden: tSourceDocument("savedMayBeHidden"),
          savedToOtherBook: (bookName: string) =>
            tSourceDocument("savedToOtherBook", { book: bookName }),
          viewRecord: tSourceDocument("viewRecord"),
        },
      });

      if (mode === "ai") {
        if (quickDirty) setInputMode("quick");
        else setInputOpen(false);
        return;
      }

      if (aiDirty) setInputMode("ai");
      else setInputOpen(false);
    },
    [
      activeTab,
      aiDirty,
      committedFilters,
      quickDirty,
      savedBook,
      setInputMode,
      setInputOpen,
      tQuickEntry,
      tSourceDocument,
      viewedBookId,
    ]
  );

  return (
    <>
      <div className={inputMode === "ai" ? undefined : "hidden"} aria-hidden={inputMode !== "ai"}>
        <SourceDocumentInput
          bookId={bookId}

          isActive={inputMode === "ai"}
          onPendingChange={setAiPending}
          onDirtyChange={setAiDirty}
          {...(timeZone != null ? { timeZone } : {})}
          onSuccess={(result) => handleSuccess("ai", result)}
        />
      </div>
      <div
        className={inputMode === "quick" ? undefined : "hidden"}
        aria-hidden={inputMode !== "quick"}
      >
        <QuickEntryForm
          bookId={bookId}

          categories={categories}
          mainCurrency={mainCurrency}
          preferredCurrencies={preferredCurrencies}
          onPendingChange={setQuickPending}
          onDirtyChange={setQuickDirty}
          {...(timeZone != null ? { timeZone } : {})}
          onSuccess={(result) => handleSuccess("quick", result)}
        />
      </div>
    </>
  );
}
