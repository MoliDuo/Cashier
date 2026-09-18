"use client";

import { useCallback, type RefCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, SquareDashedMousePointer } from "lucide-react";
import type { EntryCategory, Ledger, LedgerEntry } from "@/modules/ledger/contracts";
import type { EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import { EntryFilterPanel } from "@/modules/ledger/ui/EntryFilterPanel";
import { LedgerEntryGroupsView } from "@/modules/ledger/ui/LedgerEntryGroupsView";
import {
  BatchDateDialog,
  batchDateImpactSummary,
  LedgerEntriesBatchActionToolbar,
} from "@/modules/ledger/ui/batch-action-toolbar";
import type { GroupedEntry } from "@/modules/ledger/hooks/useDetailsTabGrouping";
import type { PeriodParams } from "@/lib/period-utils";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TOOLBAR_ICON_BUTTON_CLASS } from "@/components/toolbar-control";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DetailsToolbar } from "./DetailsToolbar";
import { usePeriodLabel } from "./usePeriodLabel";
import { EmptyState } from "@/components/EmptyState";
import type { useDetailsBatchController } from "./useDetailsBatchController";

type BatchController = ReturnType<typeof useDetailsBatchController>;
interface DetailsTabViewProps {
  categories: EntryCategory[];
  ledger?: Ledger;
  periodParams: PeriodParams;
  filters: EntryFilters;
  scopeBookName: string | null;
  advancedFilters: {
    categoryId?: string | null;
    currency?: string | null;
    minAmount?: string | null;
    maxAmount?: string | null;
    search?: string | null;
  };
  onFiltersChange: (filters: EntryFilters) => void;
  entries: LedgerEntry[];
  groupedItems: GroupedEntry[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onRetryNextPage: () => void;
  hasNextPage: boolean;
  monthStats: { mainTotal: string | null; mainCurrency: string; unconvertedCount: number };
  sentinelRef: RefCallback<HTMLDivElement>;
  batch: BatchController;
  onViewEntry: (entry: LedgerEntry) => void;
  onRefresh?: (() => Promise<unknown> | unknown) | undefined;
  isRefreshing?: boolean | undefined;
}

export function DetailsTabView(props: DetailsTabViewProps) {
  const {
    categories,
    ledger,
    periodParams,
    filters,
    scopeBookName,
    advancedFilters,
    onFiltersChange,
    entries,
    groupedItems,
    isLoading,
    isFetchingNextPage,
    isFetchNextPageError,
    onRetryNextPage,
    hasNextPage,
    monthStats,
    sentinelRef,
    batch,
    onViewEntry,
    onRefresh,
    isRefreshing,
  } = props;
  const t = useTranslations("DetailsTab");
  const tCommon = useTranslations("Common");
  const tFilter = useTranslations("EntryFilterPanel");
  const locale = useLocale();
  const rangeLabel = usePeriodLabel(periodParams, batch.timeZone);
  const { isPending, toggleSelection, handleSelectMany } = batch;
  const handleToggleSelection = useCallback(
    (id: string) => {
      if (!isPending) toggleSelection(id);
    },
    [isPending, toggleSelection]
  );
  const handleSetGroupSelection = useCallback(
    (ids: readonly string[], selected: boolean) => {
      if (!isPending) handleSelectMany(ids, selected);
    },
    [handleSelectMany, isPending]
  );

  return (
    <>
      {/* Selection replaces the browsing controls, so the box stops being a
          refresh surface there: no hint over the count, and no stray refetch
          from a tap on the band. */}
      <DetailsToolbar
        onRefresh={batch.isSelectionMode ? undefined : onRefresh}
        isRefreshing={isRefreshing}
        {...(!batch.isSelectionMode && rangeLabel != null ? { rangeLabel } : {})}
        {...(!batch.isSelectionMode && monthStats.mainTotal != null
          ? {
              totalLabel: formatCurrencyAmount(
                monthStats.mainTotal,
                monthStats.mainCurrency,
                locale
              ),
            }
          : {})}
        {...(scopeBookName != null ? { scopeBookName } : {})}
        batchActions={
          batch.isSelectionMode ? (
            <LedgerEntriesBatchActionToolbar
              selectedCount={batch.selectedIds.length}
              loadedCount={entries.length}
              isAllSelected={batch.isAllSelected}
              hasMoreData={hasNextPage || entries.length > batch.selectableCount}
              onSelectAll={() => !batch.isPending && batch.selectAll()}
              onClearSelection={() => !batch.isPending && batch.clearSelection()}
              categories={categories}
              preferredCurrencies={ledger?.settings.currencies ?? []}
              onChangeCategory={async (categoryId) => {
                await batch.update.mutateAsync({ categoryId });
              }}
              onChangeCurrency={async (currency) => {
                await batch.update.mutateAsync({ currency });
              }}
              onChangeDate={batch.openDateDialog}
              onDelete={() => batch.setDeleteDialogOpen(true)}
              isDeleting={batch.remove.isPending}
              categoryDialogOpen={batch.categoryDialogOpen}
              onCategoryDialogOpenChange={batch.setCategoryDialogOpen}
              pickedCategoryIds={batch.pickedCategoryIds}
              clearCategoryPicked={batch.clearCategoryPicked}
              onToggleCategoryPick={batch.toggleCategoryPick}
              categorySelectionChanged={batch.categorySelectionChanged}
              onConfirmCategory={batch.confirmCategory}
              isConfirmingCategory={batch.isConfirmingCategory}
              selectionUploadProgress={batch.selectionUploadProgress}
              isReclassifying={false}
              isProcessing={batch.isPending}
            />
          ) : undefined
        }
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={batch.toggleSelectionMode}
          disabled={batch.isPending}
          className={cn("shrink-0", TOOLBAR_ICON_BUTTON_CLASS)}
          aria-label={batch.isSelectionMode ? t("cancelSelect") : t("select")}
        >
          {batch.isSelectionMode ? (
            <ArrowLeft className="h-4 w-4" />
          ) : (
            <SquareDashedMousePointer className="h-4 w-4" />
          )}
        </Button>
        {!batch.isSelectionMode ? (
          <EntryFilterPanel
            filters={filters}
            onFiltersChange={onFiltersChange}
            periodParams={periodParams}
            categories={categories}
            preferredCurrencies={ledger?.settings.currencies ?? []}
            showStatus={false}
            {...(batch.timeZone != null ? { timeZone: batch.timeZone } : {})}
            // Deliberately unsized, like the stream's: the panel does not grow
            // past its trigger, so the toolbar's middle stays free for the
            // centred refresh hint instead of being reserved by empty space.
          />
        ) : null}
      </DetailsToolbar>
      {monthStats.unconvertedCount > 0 ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {tCommon("incompleteAccountingProjection")}
        </div>
      ) : null}
      <div className="space-y-4">
        <div className="space-y-4">
          <LedgerEntryGroupsView
            groups={groupedItems}
            mainCurrency={ledger?.settings.mainCurrency ?? monthStats.mainCurrency}
            onView={onViewEntry}
            selectionMode={batch.isSelectionMode}
            selectedIds={batch.selectedIds}
            disableUnselected={batch.isSelectionLimitReached}
            onToggleSelection={handleToggleSelection}
            onSetGroupSelection={handleSetGroupSelection}
          />
          {isLoading ? (
            <div className="space-y-4 px-2 animate-pulse" role="status" aria-busy="true">
              {[1, 2, 3].map((idx) => (
                <div key={idx} className="bg-surface rounded-xl border border-border p-4 h-20" />
              ))}
            </div>
          ) : null}
          {!isLoading && entries.length === 0 ? (
            <EmptyState
              title={
                advancedFilters.search != null ||
                advancedFilters.categoryId != null ||
                advancedFilters.currency != null ||
                advancedFilters.minAmount != null ||
                advancedFilters.maxAmount != null
                  ? tFilter("noMatchingResults")
                  : tCommon("noRecords")
              }
            />
          ) : null}
          <div ref={sentinelRef} className="h-1" />
          {isFetchingNextPage ? (
            <div className="flex justify-center py-4">
              <span className="text-sm text-muted-foreground">{tCommon("loading")}</span>
            </div>
          ) : null}
          {isFetchNextPageError ? (
            <div className="flex justify-center py-4">
              <Button variant="outline" size="sm" onClick={onRetryNextPage}>
                {t("loadMoreFailed")}
              </Button>
            </div>
          ) : null}
          {!hasNextPage && entries.length > 0 ? (
            <div className="flex justify-center py-4">
              <span className="text-xs text-muted-foreground">— {t("noMore")} —</span>
            </div>
          ) : null}
        </div>

        <ConfirmDialog
          open={batch.deleteDialogOpen}
          onOpenChange={batch.setDeleteDialogOpen}
          title={t("deleteSelectedTitle")}
          description={t("deleteSelectedDescription", { count: batch.selectedIds.length })}
          variant="destructive"
          confirmLabel={tCommon("delete")}
          onConfirm={async () => {
            const result = await batch.remove.mutateAsync();
            return result.stale.length + result.failed.length === 0;
          }}
        />
        <BatchDateDialog
          open={batch.dateDialogOpen}
          onOpenChange={batch.setDateDialogOpen}
          value={batch.selectedDate}
          onChange={batch.setSelectedDate}
          impact={batch.dateImpact == null ? null : batchDateImpactSummary(batch.dateImpact)}
          isPreviewing={batch.isPreviewingDate}
          previewFailed={batch.datePreviewFailed}
          onRetryPreview={batch.retryDatePreview}
          selectionChanged={batch.dateSelectionChanged}
          isConfirming={batch.updateDates.isPending}
          onConfirm={() => batch.updateDates.mutate()}
          {...(batch.timeZone != null ? { timeZone: batch.timeZone } : {})}
        />
      </div>
    </>
  );
}
