import type { Ledger } from "@/modules/ledger/contracts";
import { type PeriodParams } from "@/lib/period-utils";
import { type EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import type { LedgerAdvancedFilters } from "@/modules/workspace/initial-query-state";
import { useLedgerEntriesTab } from "@/modules/workspace/hooks/useLedgerEntriesTab";
import { LedgerEntriesToolbar } from "./LedgerEntriesToolbar";
import { LedgerEntriesStreamBody } from "./LedgerEntriesStreamBody";
import { LedgerEntriesOverlays, preloadEditRetryDialog } from "./LedgerEntriesOverlays";
import { LedgerQueryErrorBanner } from "./LedgerQueryErrorBanner";
import { commonCopy } from "@/copy/common";

interface LedgerEntriesTabProps {
  /** The book the list is narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  ledger?: Ledger;
  periodParams: PeriodParams;
  onFiltersChange: (filters: EntryFilters) => void;
  advancedFilters?: LedgerAdvancedFilters;
  collapseEntriesDefault?: boolean;
  timeZone?: string;
}

export function LedgerEntriesTab({
  bookId,
  ledger,
  periodParams,
  onFiltersChange,
  advancedFilters,
  collapseEntriesDefault = false,
  timeZone,
}: LedgerEntriesTabProps) {
  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const { filters, stream, selection, recovery, dialogs, actions } = useLedgerEntriesTab({
    bookId,
    mainCurrency,
    periodParams,
    advancedFilters,
    timeZone,
  });

  return (
    <>
      <LedgerEntriesToolbar
        isSelectionMode={selection.isSelectionMode}
        isAllSelected={selection.isAllSelected}
        hasMoreData={selection.hasMoreData}
        selectedCount={selection.selectedIds.length}
        queryFingerprint={selection.queryFingerprint}
        selectedSourceDocumentIds={selection.selectedIds}
        selectedEntryIds={selection.selectedEntryIds}
        onToggleSelectionMode={selection.handleToggleSelectionMode}
        onSelectAll={selection.handleSelectAll}
        onClearSelection={selection.handleClearSelection}
        onUpdateDates={selection.handleUpdateDates}
        onPreviewDateImpact={selection.handlePreviewDateImpact}
        isUpdatingDates={selection.isUpdatingDates}
        onRetry={selection.handleRetry}
        onDelete={selection.handleDelete}
        isRetrying={selection.isRetrying}
        isDeleting={selection.isDeleting}
        isProcessing={selection.isBatchPending}
        filters={filters}
        onFiltersChange={onFiltersChange}
        periodParams={periodParams}
        mainCurrency={mainCurrency}
        {...(stream.filteredTotal === undefined ? {} : { filteredTotal: stream.filteredTotal })}
        {...(timeZone != null ? { timeZone } : {})}
      />
      {stream.hasUnconverted ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {commonCopy.incompleteAccountingProjection}
        </div>
      ) : null}

      {stream.isError && <LedgerQueryErrorBanner empty={!stream.hasData} onRetry={stream.retry} />}
      {(!stream.isError || stream.hasData) && (
        <LedgerEntriesStreamBody
          isLoading={stream.isLoading}
          streamGroups={stream.groups}
          mainCurrency={mainCurrency}
          filters={filters}
          onViewLedgerEntry={actions.handleViewLedgerEntry}
          onViewSourceDetail={actions.handleViewSourceDetail}
          onEditRetry={dialogs.setRetrySourceDocument}
          onEditRetryIntent={preloadEditRetryDialog}
          onDeleteSourceConfirm={actions.handleRequestDelete}
          isSelectionMode={selection.isSelectionMode}
          selectedIds={selection.selectedIds}
          disableUnselected={selection.isSelectionLimitReached}
          onToggleSelection={selection.handleToggleSelection}
          onSetGroupSelection={selection.handleSetGroupSelection}
          timeZone={timeZone}
          collapseEntriesDefault={collapseEntriesDefault}
          recovery={recovery}
          hasNextPage={stream.hasNextPage}
          isFetchingNextPage={stream.isFetchingNextPage}
          isFetchNextPageError={stream.isFetchNextPageError}
          fetchNextPage={stream.fetchNextPage}
          sentinelRef={stream.sentinelRef}
        />
      )}

      <LedgerEntriesOverlays
        deleteConfirmOpen={dialogs.deleteConfirmOpen}
        onDeleteConfirmOpenChange={dialogs.setDeleteConfirmOpen}
        onDeleteConfirm={actions.handleConfirmDelete}
        retrySourceDocument={dialogs.retrySourceDocument}
        onRetryDialogOpenChange={(open) => !open && dialogs.closeRetrySourceDocument()}
      />
    </>
  );
}
