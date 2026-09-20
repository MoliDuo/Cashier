"use client";
import type { BookDto, LedgerEntry } from "@/modules/ledger/contracts";
import { useCallback } from "react";
import { SourceDocumentDetailModal } from "./SourceDocumentDetailModal";
import { useSourceDocumentDetailData } from "@/modules/source-document/hooks/useSourceDocumentDetailData";
import { useSourceDocumentDetailMutations } from "@/modules/source-document/hooks/useSourceDocumentDetailMutations";
import { useSourceDocumentRecoveryMutations } from "@/modules/source-document/hooks/useSourceDocumentRecoveryMutations";
import type { EntryCategory } from "@/modules/ledger/contracts";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { assignSourceDocumentBookAction } from "@/modules/source-document/server-actions/book";
import { getBookAction } from "@/lib/queries/ledger-query-client";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER } from "@/lib/constants";
import { useTranslations } from "next-intl";

interface SourceDocumentDetailWrapperProps {
  /** The live books, for this record's own book picker. */
  books: readonly BookDto[];
  id: string;
  ledgerId: string;
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  onExitComplete?: () => void;
  categories: EntryCategory[];
  mainCurrency: string;
  preferredCurrencies: string[];
  ledgerEntries?: LedgerEntry[];
  timeZone?: string;
}

export function SourceDocumentDetailWrapper({
  books,
  id,
  ledgerId,
  open,
  onClose,
  onBack,
  onExitComplete,
  categories,
  mainCurrency,
  preferredCurrencies,
  ledgerEntries: initialLedgerEntries,
  timeZone,
}: SourceDocumentDetailWrapperProps) {
  const t = useTranslations("Common");
  const {
    sourceDocument,
    currentLedgerEntries,
    ledgerId: detailLedgerId,
    isLoading,
    isLoadingImages,
    error,
    refetch,
  } = useSourceDocumentDetailData({
    id,
    ledgerId,
    open,
    ...(initialLedgerEntries !== undefined ? { initialLedgerEntries } : {}),
  });

  const {
    saveChanges,
    splitEntries,
    addEntry,
    deleteEntry,
    batchUpdate,
    batchDeleteEntries,
    deleteDocument,
    applyDateOrganization,
    dismissDateOrganization,
    isOrganizingDates,
  } = useSourceDocumentDetailMutations({
    id,
    ledgerId,
    version: sourceDocument?.version ?? null,
    onClose,
  });

  const { cancelProcessing, isCancelling } = useSourceDocumentRecoveryMutations({
    ledgerId: detailLedgerId ?? ledgerId,
    sourceDocumentId: id,
    version: sourceDocument?.version ?? null,
    onSuccess: onClose,
  });

  const handleReload = useCallback(async () => {
    const result = await refetch();
    if (result.error != null || result.data == null) {
      throw result.error ?? new Error("Source document is unavailable");
    }
  }, [refetch]);

  // A record whose book was archived after it was filed is not in the live list,
  // so the picker resolves it separately rather than rendering blank. The query
  // only runs in that case.
  const recordBookId = sourceDocument?.bookId ?? null;
  const recordBookIsLive = recordBookId != null && books.some((book) => book.id === recordBookId);
  const { data: archivedRecordBook } = useQuery({
    queryKey: queryKeys.book(ledgerId, recordBookId ?? ""),
    queryFn: () => getBookAction(ledgerId, recordBookId!),
    enabled: open && recordBookId != null && !recordBookIsLive,
    staleTime: LEDGER.STALE_TIME_MS,
  });
  const archivedBookLabel =
    archivedRecordBook == null ? null : t("archivedBookOption", { name: archivedRecordBook.name });

  const assignment = useLedgerMutation(ledgerId, {
    invalidates: ["documents", "stats"],
    // A failed change used to be silent: the picker snapped back with no
    // explanation. A conflict or an archived target now says so.
    errorMessage: t("bookChangeFailed"),
    mutationFn: (bookId: string) =>
      assignSourceDocumentBookAction(ledgerId, {
        sourceDocumentId: id,
        expectedVersion: sourceDocument!.version,
        bookId,
      }),
    onSuccess: async () => {
      await refetch();
    },
  });

  return (
    <SourceDocumentDetailModal
      books={books}
      {...(archivedBookLabel == null ? {} : { archivedBookLabel })}
      onAssignBook={(bookId: string) => assignment.mutate(bookId)}
      isAssigningBook={assignment.isPending}
      sourceDocumentId={id}
      ledgerId={detailLedgerId}
      sourceDocument={sourceDocument}
      isLoading={isLoading}
      isLoadingImages={isLoadingImages}
      loadError={error != null}
      onReload={handleReload}
      ledgerEntries={currentLedgerEntries}
      categories={categories}
      mainCurrency={mainCurrency}
      preferredCurrencies={preferredCurrencies}
      open={open}
      onClose={onClose}
      {...(onBack !== undefined ? { onBack } : {})}
      {...(onExitComplete !== undefined ? { onExitComplete } : {})}
      onSaveAll={saveChanges}
      onSplit={splitEntries}
      onAddEntry={addEntry}
      onDeleteEntry={deleteEntry}
      onBatchUpdate={batchUpdate}
      onBatchDeleteEntries={batchDeleteEntries}
      onDelete={deleteDocument}
      onCancelProcessing={cancelProcessing}
      isCancelling={isCancelling}
      onApplyDateOrganization={applyDateOrganization}
      onDismissDateOrganization={dismissDateOrganization}
      isOrganizingDates={isOrganizingDates}
      {...(timeZone != null ? { timeZone } : {})}
    />
  );
}
