"use client";

import { ArrowLeft, SquareDashedMousePointer } from "lucide-react";
import type { EntryCategory, Ledger } from "@/modules/ledger/contracts";
import type { EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import { EntryFilterPanel } from "@/modules/ledger/ui/EntryFilterPanel";
import { LedgerEntryGroupsView } from "@/modules/ledger/ui/LedgerEntryGroupsView";
import {
  BatchDateDialog,
  batchDateImpactSummary,
  LedgerEntriesBatchActionToolbar,
} from "@/modules/ledger/ui/batch-action-toolbar";
import type { PeriodParams } from "@/lib/period-utils";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { openLedgerEntrySourceDocument } from "@/lib/navigation/ledger-detail-navigation";
import { DISPLAY_LOCALE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TOOLBAR_ICON_BUTTON_CLASS } from "@/components/toolbar-control";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/EmptyState";
import { useDetailsTab } from "../hooks/useDetailsTab";
import type { LedgerAdvancedFilters } from "../initial-query-state";
import { EntriesToolbarShell } from "./EntriesToolbarShell";
import { LedgerQueryErrorBanner } from "./LedgerQueryErrorBanner";
import { usePeriodLabel } from "./usePeriodLabel";
import { commonCopy } from "@/copy/common";
import { detailsTabCopy, entryFilterPanelCopy } from "@/copy/workspace";

interface DetailsTabProps {
  /** The book the list is narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  categories: EntryCategory[];
  ledger?: Ledger;
  periodParams: PeriodParams;
  filters: EntryFilters;
  onFiltersChange: (filters: EntryFilters) => void;
  advancedFilters: LedgerAdvancedFilters;
  timeZone?: string;
}

export function DetailsTab({
  bookId,
  categories,
  ledger,
  periodParams,
  filters,
  onFiltersChange,
  advancedFilters,
  timeZone,
}: DetailsTabProps) {
  const { sentinelRef, ...tab } = useDetailsTab({
    bookId,
    categories,
    ledger,
    periodParams,
    advancedFilters,
    timeZone,
  });
  const rangeLabel = usePeriodLabel(periodParams, timeZone);
  const { entries, monthStats } = tab;

  if (tab.queryStatus === "error" && !tab.queryHasData) {
    return <LedgerQueryErrorBanner empty onRetry={tab.retry} />;
  }
  return (
    <>
      {tab.queryStatus === "error" && <LedgerQueryErrorBanner empty={false} onRetry={tab.retry} />}
      <EntriesToolbarShell
        {...(!tab.isSelectionMode && rangeLabel != null ? { rangeLabel } : {})}
        {...(!tab.isSelectionMode && monthStats.mainTotal != null
          ? {
              totalLabel: formatCurrencyAmount(
                monthStats.mainTotal,
                monthStats.mainCurrency,
                DISPLAY_LOCALE
              ),
            }
          : {})}
        batchActions={
          tab.isSelectionMode ? (
            <LedgerEntriesBatchActionToolbar
              selectedCount={tab.selectedIds.length}
              loadedCount={entries.length}
              isAllSelected={tab.isAllSelected}
              hasMoreData={tab.hasNextPage || entries.length > tab.selectableCount}
              onSelectAll={() => !tab.isPending && tab.selectAll()}
              onClearSelection={() => !tab.isPending && tab.clearSelection()}
              categories={categories}
              preferredCurrencies={ledger?.settings.currencies ?? []}
              onChangeCategory={async (categoryId) => {
                await tab.update.mutateAsync({ categoryId });
              }}
              onChangeCurrency={async (currency) => {
                await tab.update.mutateAsync({ currency });
              }}
              onChangeDate={tab.openDateDialog}
              onDelete={() => tab.setDeleteDialogOpen(true)}
              isDeleting={tab.remove.isPending}
              categoryDialogOpen={tab.categoryDialogOpen}
              onCategoryDialogOpenChange={tab.setCategoryDialogOpen}
              pickedCategoryIds={tab.pickedCategoryIds}
              clearCategoryPicked={tab.clearCategoryPicked}
              onToggleCategoryPick={tab.toggleCategoryPick}
              categorySelectionChanged={tab.categorySelectionChanged}
              onConfirmCategory={tab.confirmCategory}
              isConfirmingCategory={tab.isConfirmingCategory}
              isReclassifying={false}
              isProcessing={tab.isPending}
            />
          ) : undefined
        }
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={tab.toggleSelectionMode}
          disabled={tab.isPending}
          className={cn("shrink-0", TOOLBAR_ICON_BUTTON_CLASS)}
          aria-label={tab.isSelectionMode ? detailsTabCopy.cancelSelect : detailsTabCopy.select}
        >
          {tab.isSelectionMode ? (
            <ArrowLeft className="h-4 w-4" />
          ) : (
            <SquareDashedMousePointer className="h-4 w-4" />
          )}
        </Button>
        {!tab.isSelectionMode ? (
          <EntryFilterPanel
            filters={filters}
            onFiltersChange={onFiltersChange}
            periodParams={periodParams}
            categories={categories}
            preferredCurrencies={ledger?.settings.currencies ?? []}
            showStatus={false}
            {...(timeZone != null ? { timeZone } : {})}
            // Deliberately unsized, like the stream's: the panel does not grow
            // past its trigger, so the toolbar's middle stays free for the
            // centred refresh hint instead of being reserved by empty space.
          />
        ) : null}
      </EntriesToolbarShell>
      {monthStats.unconvertedCount > 0 ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {commonCopy.incompleteAccountingProjection}
        </div>
      ) : null}
      <div className="space-y-4">
        <div className="space-y-4">
          <LedgerEntryGroupsView
            groups={tab.groupedItems}
            mainCurrency={ledger?.settings.mainCurrency ?? monthStats.mainCurrency}
            // An entry has no detail sheet of its own — opening one lands on the
            // record it belongs to, the same sheet the stream card opens.
            onView={openLedgerEntrySourceDocument}
            selectionMode={tab.isSelectionMode}
            selectedIds={tab.selectedIds}
            disableUnselected={tab.isSelectionLimitReached}
            onToggleSelection={tab.toggleEntrySelection}
            onSetGroupSelection={tab.setGroupSelection}
          />
          {tab.isLoading ? (
            <div className="space-y-4 px-2 animate-pulse" role="status" aria-busy="true">
              {[1, 2, 3].map((idx) => (
                <div key={idx} className="bg-surface rounded-xl border border-border p-4 h-20" />
              ))}
            </div>
          ) : null}
          {!tab.isLoading && entries.length === 0 ? (
            <EmptyState
              title={
                advancedFilters.search != null ||
                advancedFilters.categoryId != null ||
                advancedFilters.currency != null ||
                advancedFilters.minAmount != null ||
                advancedFilters.maxAmount != null
                  ? entryFilterPanelCopy.noMatchingResults
                  : commonCopy.noRecords
              }
            />
          ) : null}
          <div ref={sentinelRef} className="h-1" />
          {tab.isFetchingNextPage ? (
            <div className="flex justify-center py-4">
              <span className="text-sm text-muted-foreground">{commonCopy.loading}</span>
            </div>
          ) : null}
          {tab.isFetchNextPageError ? (
            <div className="flex justify-center py-4">
              <Button variant="outline" size="sm" onClick={() => void tab.fetchNextPage()}>
                {detailsTabCopy.loadMoreFailed}
              </Button>
            </div>
          ) : null}
          {!tab.hasNextPage && entries.length > 0 ? (
            <div className="flex justify-center py-4">
              <span className="text-xs text-muted-foreground">— {detailsTabCopy.noMore} —</span>
            </div>
          ) : null}
        </div>

        <ConfirmDialog
          open={tab.deleteDialogOpen}
          onOpenChange={tab.setDeleteDialogOpen}
          title={detailsTabCopy.deleteSelectedTitle}
          description={detailsTabCopy.deleteSelectedDescription({ count: tab.selectedIds.length })}
          variant="destructive"
          confirmLabel={commonCopy.delete}
          onConfirm={async () => {
            const result = await tab.remove.mutateAsync();
            return result.failed.length === 0;
          }}
        />
        <BatchDateDialog
          open={tab.dateDialogOpen}
          onOpenChange={tab.setDateDialogOpen}
          value={tab.selectedDate}
          onChange={tab.setSelectedDate}
          impact={tab.dateImpact == null ? null : batchDateImpactSummary(tab.dateImpact)}
          isPreviewing={tab.isPreviewingDate}
          previewFailed={tab.datePreviewFailed}
          onRetryPreview={tab.retryDatePreview}
          selectionChanged={tab.dateSelectionChanged}
          isConfirming={tab.updateDates.isPending}
          onConfirm={() => tab.updateDates.mutate()}
          {...(timeZone != null ? { timeZone } : {})}
        />
      </div>
    </>
  );
}
