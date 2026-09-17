import type { Ledger, LedgerEntry } from "@/modules/ledger/contracts";
import type { SourceDocument } from "@/modules/source-document/contracts";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { type PeriodParams } from "@/lib/period-utils";
import {
  openLedgerDetail,
  openLedgerEntrySourceDocument,
} from "@/lib/navigation/ledger-detail-navigation";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useLedgerEntriesMutations } from "@/modules/ledger/hooks/useLedgerEntriesMutations";
import { type EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import type { LedgerAdvancedFilters } from "@/modules/workspace/initial-query-state";
import { LedgerEntriesToolbar } from "./LedgerEntriesToolbar";
import { LedgerEntriesStreamBody } from "./LedgerEntriesStreamBody";
import { LedgerEntriesOverlays, preloadEditRetryDialog } from "./LedgerEntriesOverlays";
import { useLedgerEntriesTabState } from "./useLedgerEntriesTabState";
import { useLedgerEntriesFilters } from "./useLedgerEntriesFilters";
import { useLedgerEntriesStreamData } from "@/modules/workspace/hooks/useLedgerEntriesStreamData";
import { useLedgerEntriesSelection } from "@/modules/workspace/hooks/useLedgerEntriesSelection";
import { LedgerQueryErrorBanner } from "./LedgerQueryErrorBanner";
import { previewSourceDocumentDateImpactAction } from "@/modules/workspace/server-actions/date-impact";
import { useStreamSourceDocumentRecoveryMutations } from "@/modules/source-document/hooks/useStreamSourceDocumentRecoveryMutations";

interface LedgerEntriesTabProps {
  recordScope?: "all" | "mine" | "partner";
  onRecordScopeChange?: (scope: "all" | "mine" | "partner") => void;
  userId: string;
  partnerUserId: string;
  ledgerId: string;
  ledger?: Ledger;
  periodParams: PeriodParams;
  onFiltersChange: (filters: EntryFilters) => void;
  advancedFilters?: LedgerAdvancedFilters;
  collapseEntriesDefault?: boolean;
  timeZone?: string;
  onRefresh?: (() => Promise<unknown> | unknown) | undefined;
  isRefreshing?: boolean | undefined;
}

export function LedgerEntriesTab({
  recordScope,
  onRecordScopeChange,
  userId,
  partnerUserId,
  ledgerId,
  ledger,
  periodParams,
  onFiltersChange,
  advancedFilters,
  collapseEntriesDefault = false,
  timeZone,
  onRefresh,
  isRefreshing,
}: LedgerEntriesTabProps) {
  const t = useTranslations("LedgerEntriesTab");
  const [localScope, setLocalScope] = useState<"all" | "mine" | "partner">("all");
  const scope = recordScope ?? localScope;
  const setScope = onRecordScopeChange ?? setLocalScope;
  const tCommon = useTranslations("Common");
  const { filters, startDateStr, endDateStr } = useLedgerEntriesFilters(
    periodParams,
    advancedFilters,
    timeZone
  );
  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";

  const {
    deleteConfirm,
    setDeleteConfirm,
    closeDeleteConfirm,
    retrySourceDocument,
    setRetrySourceDocument,
    openSourceDocumentDeleteConfirm,
    closeRetrySourceDocument,
  } = useLedgerEntriesTabState();

  const { deleteEntry } = useLedgerEntriesMutations(ledgerId, closeDeleteConfirm);
  const recovery = useStreamSourceDocumentRecoveryMutations(ledgerId);

  const streamData = useLedgerEntriesStreamData({
    ledgerId,
    ...(scope === "all" ? {} : { attributedUserId: scope === "mine" ? userId : partnerUserId }),
    mainCurrency,
    filters,
    startDateStr,
    endDateStr,
  });

  const selection = useLedgerEntriesSelection({
    ledgerId,
    streamGroups: streamData.streamGroups,
    periodParams,
    advancedFilters,
  });

  const handleViewSourceDetail = useCallback(
    (group: { sourceDocument: SourceDocument; ledgerEntries: LedgerEntry[] }) => {
      openLedgerDetail({
        type: "source-document",
        id: group.sourceDocument.id,
        ledgerId: group.sourceDocument.ledgerId,
      });
    },
    []
  );

  // An entry row opens the record it belongs to; entries have no sheet of
  // their own.
  const handleViewLedgerEntry = useCallback(
    (entry: LedgerEntry) => openLedgerEntrySourceDocument(entry),
    []
  );

  const handleDeleteSourceConfirm = useCallback(
    (doc: SourceDocument) =>
      openSourceDocumentDeleteConfirm(doc.id, t("deleteConfirmTitle"), t("deleteConfirmDesc")),
    [openSourceDocumentDeleteConfirm, t]
  );

  const handleDeleteConfirmAction = useCallback(async () => {
    if (deleteConfirm.id == null || deleteConfirm.id === "" || deleteConfirm.type == null) return;
    if (deleteConfirm.type === "sourceDocument") {
      await selection.deleteSourceDocument.mutateAsync({
        id: deleteConfirm.id,
        onCommitted: closeDeleteConfirm,
      });
    } else if (deleteConfirm.type === "ledgerEntry") {
      const entry = streamData.streamGroups
        .flatMap((group) => group.items)
        .flatMap((item) => item.ledgerEntries)
        .find((candidate) => candidate.id === deleteConfirm.id);
      if (entry == null) throw new Error("Ledger entry is no longer available");
      await deleteEntry.mutateAsync(entry);
    }
  }, [
    deleteConfirm,
    selection.deleteSourceDocument,
    deleteEntry,
    streamData.streamGroups,
    closeDeleteConfirm,
  ]);

  const sentinelRef = useInfiniteScroll({
    hasNextPage: streamData.hasNextPage,
    isFetchingNextPage: streamData.isFetchingNextPage,
    isFetchNextPageError: streamData.isFetchNextPageError,
    fetchNextPage: streamData.fetchNextPage,
    rootMargin: "400px",
  });

  return (
    <>
      <LedgerEntriesToolbar
        recordScope={scope}
        onRecordScopeChange={setScope}
        isSelectionMode={selection.isSelectionMode}
        isAllSelected={selection.isAllSelected}
        hasMoreData={
          streamData.hasNextPage ||
          selection.allSourceDocumentIds.length > selection.selectableCount
        }
        selectedCount={selection.selectedIds.length}
        queryFingerprint={selection.queryFingerprint}
        selectedSourceDocumentIds={selection.selectedIds}
        selectedEntryIds={selection.selectedEntryIds}
        onToggleSelectionMode={selection.handleToggleSelectionMode}
        onSelectAll={() => !selection.isBatchPending && selection.selectAll()}
        onClearSelection={() => !selection.isBatchPending && selection.clearSelection()}
        onUpdateDates={selection.handleBatchUpdateDates}
        onPreviewDateImpact={(sourceDocumentIds, entryIds) =>
          previewSourceDocumentDateImpactAction(ledgerId, {
            sourceDocumentIds,
            ledgerEntryIds: entryIds,
          })
        }
        isUpdatingDates={selection.batchUpdateDates.isPending}
        onRetry={async () => {
          await selection.batchRetry.mutateAsync(selection.selectedIds);
        }}
        onDelete={async (onCommitted) => {
          const result = await selection.batchDelete.mutateAsync({
            ids: selection.selectedIds,
            onCommitted,
          });
          return result.stale.length + result.failed.length === 0;
        }}
        isRetrying={selection.batchRetry.isPending}
        isDeleting={selection.batchDelete.isPending}
        isProcessing={selection.isBatchPending}
        filters={filters}
        onFiltersChange={onFiltersChange}
        periodParams={periodParams}
        mainCurrency={mainCurrency}
        {...(streamData.filteredTotal === undefined
          ? {}
          : { filteredTotal: streamData.filteredTotal })}
        {...(timeZone != null ? { timeZone } : {})}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
      />
      {streamData.streamTotalData?.unconvertedCount != null &&
      streamData.streamTotalData.unconvertedCount > 0 ? (
        <div
          role="status"
          className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {tCommon("incompleteAccountingProjection")}
        </div>
      ) : null}

      {streamData.isError && (
        <LedgerQueryErrorBanner empty={!streamData.hasData} onRetry={streamData.retry} />
      )}
      {(!streamData.isError || streamData.hasData) && (
        <LedgerEntriesStreamBody
          isLoading={streamData.isLoading}
          streamGroups={streamData.streamGroups}
          mainCurrency={mainCurrency}
          filters={filters}
          onViewLedgerEntry={handleViewLedgerEntry}
          onViewSourceDetail={handleViewSourceDetail}
          onEditRetry={setRetrySourceDocument}
          onEditRetryIntent={preloadEditRetryDialog}
          onDeleteSourceConfirm={handleDeleteSourceConfirm}
          isSelectionMode={selection.isSelectionMode}
          selectedIds={selection.selectedIds}
          disableUnselected={selection.isSelectionLimitReached}
          onToggleSelection={selection.handleToggleSelection}
          onSetGroupSelection={selection.handleSetGroupSelection}
          timeZone={timeZone}
          collapseEntriesDefault={collapseEntriesDefault}
          recovery={recovery}
          hasNextPage={streamData.hasNextPage}
          isFetchingNextPage={streamData.isFetchingNextPage}
          isFetchNextPageError={streamData.isFetchNextPageError}
          fetchNextPage={streamData.fetchNextPage}
          sentinelRef={sentinelRef}
        />
      )}

      <LedgerEntriesOverlays
        deleteConfirm={deleteConfirm}
        onDeleteConfirmOpenChange={(open) => setDeleteConfirm((prev) => ({ ...prev, open }))}
        onDeleteConfirm={handleDeleteConfirmAction}
        deleteLabel={tCommon("delete")}
        retrySourceDocument={retrySourceDocument}
        onRetryDialogOpenChange={(open) => !open && closeRetrySourceDocument()}
        ledgerId={ledgerId}
      />
    </>
  );
}
