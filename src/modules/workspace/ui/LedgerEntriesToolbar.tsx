import { useState } from "react";
import { ArrowLeft, SquareDashedMousePointer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TOOLBAR_ICON_BUTTON_CLASS } from "@/components/toolbar-control";
import { EntryFilterPanel, type EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import {
  BatchDateDialog,
  batchDateImpactSummary,
  LedgerEntriesBatchActionToolbar,
} from "@/modules/ledger/ui/batch-action-toolbar";
import type { Period } from "@/modules/ledger/domain/period";
import { cn } from "@/lib/utils";
import { formatDateTimeForApi, getDateInTimezone } from "@/lib/date-utils";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EntriesToolbarShell } from "./EntriesToolbarShell";
import { PeriodBar } from "./PeriodBar";
import type { BatchEntryDateImpact } from "@/modules/ledger/contracts";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { commonCopy } from "@/copy/common";
import { batchActionsCopy, ledgerEntriesTabCopy } from "@/copy/workspace";

interface LedgerEntriesToolbarProps {
  isSelectionMode: boolean;
  isAllSelected: boolean;
  hasMoreData?: boolean;
  selectedCount: number;
  /** How many records the stream has loaded, which select-all takes in. */
  loadedCount: number;
  selectedSourceDocumentIds?: string[];
  selectedEntryIds?: string[];
  queryFingerprint: string;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onUpdateDates?: (date: string, sourceDocumentIds: string[]) => Promise<void> | void;
  onPreviewDateImpact?: (
    sourceDocumentIds: string[],
    entryIds: string[]
  ) => Promise<BatchEntryDateImpact>;
  isUpdatingDates?: boolean;
  onRetry?: () => Promise<void> | void;
  onDelete?: (onCommitted: () => void) => Promise<void | boolean> | void;
  isRetrying?: boolean;
  isDeleting?: boolean;
  isProcessing?: boolean;
  filters: EntryFilters;
  onFiltersChange: (filters: EntryFilters) => void;
  period: Period;
  /** Today in the ledger's zone, which the period is counted from. */
  today: string;
  onPeriodChange: (period: Period) => void;
  mainCurrency: string;
  filteredTotal?: string;
  timeZone?: string;
}

export function LedgerEntriesToolbar({
  isSelectionMode,
  isAllSelected,
  hasMoreData = false,
  selectedCount,
  loadedCount,
  selectedSourceDocumentIds = [],
  selectedEntryIds = [],
  queryFingerprint,
  onToggleSelectionMode,
  onSelectAll,
  onClearSelection,
  onUpdateDates,
  onPreviewDateImpact,
  isUpdatingDates = false,
  onRetry,
  onDelete,
  isRetrying = false,
  isDeleting = false,
  isProcessing: externallyProcessing = false,
  filters,
  onFiltersChange,
  period,
  today,
  onPeriodChange,
  mainCurrency,
  filteredTotal,
  timeZone,
}: LedgerEntriesToolbarProps) {
  const locale = DISPLAY_LOCALE;
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    () => getDateInTimezone(timeZone) ?? formatDateTimeForApi(new Date()) ?? ""
  );
  const [dateImpact, setDateImpact] = useState<BatchEntryDateImpact | null>(null);
  const [dateImpactError, setDateImpactError] = useState(false);
  const [isPreviewingDateImpact, setIsPreviewingDateImpact] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [dateSelectionSnapshot, setDateSelectionSnapshot] = useState<{
    sourceDocumentIds: string[];
    entryIds: string[];
    queryFingerprint: string;
  } | null>(null);
  const dateSelectionMatches =
    dateSelectionSnapshot != null &&
    dateSelectionSnapshot.queryFingerprint === queryFingerprint &&
    dateSelectionSnapshot.sourceDocumentIds.length === selectedSourceDocumentIds.length &&
    dateSelectionSnapshot.sourceDocumentIds.every(
      (id, index) => id === selectedSourceDocumentIds[index]
    ) &&
    dateSelectionSnapshot.entryIds.length === selectedEntryIds.length &&
    dateSelectionSnapshot.entryIds.every((id, index) => id === selectedEntryIds[index]);
  const isProcessing = externallyProcessing || isUpdatingDates || isRetrying || isDeleting;

  const previewDateImpact = async () => {
    if (onPreviewDateImpact == null) return;
    const snapshot = {
      sourceDocumentIds: [...selectedSourceDocumentIds],
      entryIds: [...selectedEntryIds],
      queryFingerprint,
    };
    setIsPreviewingDateImpact(true);
    setDateImpactError(false);
    try {
      setDateImpact(await onPreviewDateImpact(snapshot.sourceDocumentIds, snapshot.entryIds));
      setDateSelectionSnapshot(snapshot);
    } catch {
      setDateImpactError(true);
    } finally {
      setIsPreviewingDateImpact(false);
    }
  };

  const handleOpenDateDialog = () => {
    setDateDialogOpen(true);
    void previewDateImpact();
  };

  const handleDateDialogOpenChange = (open: boolean) => {
    if (!open) {
      setDateImpact(null);
      setDateSelectionSnapshot(null);
      setDateImpactError(false);
    }
    setDateDialogOpen(open);
  };

  const handleConfirmDate = async () => {
    if (onUpdateDates == null) return;
    if (dateSelectionSnapshot == null) {
      // No preview to honour, so the live selection is the one that was shown.
      await onUpdateDates(selectedDate, [...selectedSourceDocumentIds]);
      handleDateDialogOpenChange(false);
      return;
    }
    if (!dateSelectionMatches) return;
    await onUpdateDates(selectedDate, dateSelectionSnapshot.sourceDocumentIds);
    handleDateDialogOpenChange(false);
  };

  return (
    <EntriesToolbarShell
      totalLabel={
        !isSelectionMode && filteredTotal !== undefined
          ? formatCurrencyAmount(filteredTotal, mainCurrency, locale)
          : undefined
      }
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleSelectionMode}
        disabled={isProcessing}
        className={cn("shrink-0", TOOLBAR_ICON_BUTTON_CLASS)}
        aria-label={
          isSelectionMode ? ledgerEntriesTabCopy.cancelSelect : ledgerEntriesTabCopy.select
        }
        title={isSelectionMode ? ledgerEntriesTabCopy.cancelSelect : ledgerEntriesTabCopy.select}
      >
        {isSelectionMode ? (
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        ) : (
          <SquareDashedMousePointer aria-hidden="true" className="h-4 w-4" />
        )}
      </Button>

      {isSelectionMode && (
        <LedgerEntriesBatchActionToolbar
          className="min-w-0 flex-1"
          selectedCount={selectedCount}
          loadedCount={loadedCount}
          isAllSelected={isAllSelected}
          hasMoreData={hasMoreData}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
          {...(onUpdateDates != null ? { onChangeDate: handleOpenDateDialog } : {})}
          {...(onRetry != null ? { onRetry: () => void onRetry(), isRetrying } : {})}
          {...(onDelete != null ? { onDelete: () => setDeleteConfirmOpen(true), isDeleting } : {})}
          isProcessing={isProcessing}
        />
      )}

      {!isSelectionMode && (
        <>
          <PeriodBar
            period={period}
            today={today}
            onChange={onPeriodChange}
            {...(timeZone != null ? { timeZone } : {})}
          />
          <EntryFilterPanel
            filters={filters}
            onFiltersChange={onFiltersChange}
            showCategory={false}
            showCurrency={false}
            className="w-auto"
          />
        </>
      )}
      <BatchDateDialog
        open={dateDialogOpen}
        onOpenChange={handleDateDialogOpenChange}
        value={selectedDate}
        onChange={setSelectedDate}
        impact={dateImpact == null ? null : batchDateImpactSummary(dateImpact)}
        isPreviewing={isPreviewingDateImpact || isUpdatingDates}
        previewFailed={dateImpactError}
        onRetryPreview={() => void previewDateImpact()}
        selectionChanged={dateSelectionSnapshot != null && !dateSelectionMatches}
        {...(isAllSelected && hasMoreData ? { scopeNote: batchActionsCopy.loadedScope } : {})}
        isConfirming={isUpdatingDates}
        onConfirm={() => void handleConfirmDate()}
        {...(timeZone != null ? { timeZone } : {})}
      />
      {onDelete != null && (
        <ConfirmDialog
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          title={batchActionsCopy.deleteTitleDocuments}
          description={batchActionsCopy.deleteDescriptionDocuments({
            count: selectedCount,
            scope: isAllSelected && hasMoreData ? batchActionsCopy.loadedScope : "",
          })}
          variant="destructive"
          confirmLabel={commonCopy.delete}
          onConfirm={onDelete}
        />
      )}
    </EntriesToolbarShell>
  );
}
