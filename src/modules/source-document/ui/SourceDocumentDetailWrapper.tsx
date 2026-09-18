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

  const assignment = useLedgerMutation(ledgerId, {
    invalidates: ["documents", "stats"],
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
