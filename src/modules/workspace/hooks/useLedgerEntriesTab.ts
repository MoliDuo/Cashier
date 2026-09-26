"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useSelection } from "@/hooks/use-selection";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import {
  openLedgerDetail,
  openLedgerEntrySourceDocument,
} from "@/lib/navigation/ledger-detail-navigation";
import type { PeriodParams } from "@/lib/period-utils";
import { queryKeys } from "@/lib/query-keys";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import type { LedgerRefreshResult } from "@/modules/source-document/contract-refresh";
import type {
  BatchUpdateSourceDocumentsResultDto,
  PartialBatchCommandResult,
  SourceDocumentListItemDto,
} from "@/modules/source-document/contracts";
import { useLedgerRefreshPolling } from "@/modules/source-document/hooks/useLedgerRefreshPolling";
import { fetchStreamPage, fetchStreamTotal } from "@/modules/source-document/queries";
import {
  batchDeleteSourceDocumentsAction,
  batchRetrySourceDocumentsAction,
} from "@/modules/source-document/server-actions/batch";
import { deleteSourceDocumentAction } from "@/modules/source-document/server-actions/delete";
import { cancelSourceDocumentProcessingAction } from "@/modules/source-document/server-actions/processing";
import { retrySourceDocumentAction } from "@/modules/source-document/server-actions/retry";
import { batchUpdateSourceDocumentsAction } from "@/modules/source-document/server-actions/update";
import { buildUnifiedStreamGroups } from "@/modules/source-document/stream-grouping";
import type { LedgerAdvancedFilters } from "@/modules/workspace/initial-query-state";
import { buildLedgerEntryFilters } from "@/modules/workspace/ledger-filter-state";
import { buildStreamQueryDescriptor } from "@/modules/workspace/ledger-tab-query-descriptors";
import { previewSourceDocumentDateImpactAction } from "@/modules/workspace/server-actions/date-impact";
import { commonCopy } from "@/copy/common";
import { sourceDocumentActionCopy } from "@/copy/source-document";
import { batchActionsCopy } from "@/copy/workspace";

type StreamPage = Awaited<ReturnType<typeof fetchStreamPage>>;

interface StreamRecoveryVariables {
  sourceDocumentId: string;
}

type RecoveryAction = (variables: StreamRecoveryVariables) => Promise<unknown>;

function flattenAndDeduplicate(
  pages: readonly { items: SourceDocumentListItemDto[] }[] | undefined
): SourceDocumentListItemDto[] {
  const seen = new Set<string>();
  const result: SourceDocumentListItemDto[] = [];
  for (const page of pages ?? []) {
    for (const doc of page.items) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      result.push(doc);
    }
  }
  return result;
}

function seedRefreshBaseline(
  queryClient: QueryClient,
  page: { generation: string; hasTransitionalWork: boolean }
) {
  queryClient.setQueryData<LedgerRefreshResult>(queryKeys.sourceDocumentRefresh(), (current) => {
    // A page refreshes only its own projection, not every ledger cache.
    // Only the refresh consumer may advance an existing baseline. A newer page
    // that shows work still processing does start its polling, though: a list
    // refetched after a mutation can show another device's upload that the
    // idle baseline never heard of, and without the poll it would stay
    // "processing" on screen until the window next regains focus.
    if (current != null) {
      return page.hasTransitionalWork &&
        !current.hasTransitionalWork &&
        BigInt(page.generation) > BigInt(current.version)
        ? { ...current, hasTransitionalWork: true }
        : current;
    }
    return {
      version: page.generation,
      changed: false,
      hasTransitionalWork: page.hasTransitionalWork,
      invalidations: { categories: false, settings: false, stats: false },
    };
  });
}

interface UseLedgerEntriesTabOptions {
  /** The book the list is narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  mainCurrency: string;
  periodParams: PeriodParams;
  advancedFilters?: LedgerAdvancedFilters | undefined;
  timeZone?: string | undefined;
}

/**
 * Everything the stream tab does: it pages through the source-document
 * stream and its total, keeps the refresh poll running, and owns batch
 * selection, row recovery and the tab's dialogs.
 */
export function useLedgerEntriesTab({
  bookId,
  mainCurrency,
  periodParams,
  advancedFilters,
  timeZone,
}: UseLedgerEntriesTabOptions) {
  const queryClient = useQueryClient();

  // --- The stream -----------------------------------------------------------

  const filters = useMemo(
    () => buildLedgerEntryFilters(periodParams, advancedFilters, timeZone),
    [periodParams, advancedFilters, timeZone]
  );
  const queryDescriptor = useMemo(
    () =>
      buildStreamQueryDescriptor({
        ...(bookId == null ? {} : { bookId }),
        startDate: filters.startDate,
        endDate: filters.endDate,
        minAmount: filters.minAmount,
        maxAmount: filters.maxAmount,
        statuses: filters.statuses,
        search: filters.search,
      }),
    [
      bookId,
      filters.endDate,
      filters.maxAmount,
      filters.minAmount,
      filters.search,
      filters.statuses,
      filters.startDate,
    ]
  );
  const streamPageKey = queryDescriptor.queryKey;

  const totalQuery = useQuery({
    queryKey: queryDescriptor.totalQueryKey,
    queryFn: () => fetchStreamTotal(queryDescriptor.totalInput),
  });

  const streamQuery = useInfiniteQuery({
    queryKey: streamPageKey,
    queryFn: async ({ pageParam }) => {
      const pageInput = queryDescriptor.getPageInput(pageParam as string | undefined);
      let page = await fetchStreamPage(pageInput);
      if (pageParam == null && page.restartRequired) {
        page = await fetchStreamPage(pageInput);
        if (page.restartRequired) {
          throw new Error("Stream restart did not produce a valid first page");
        }
      }
      seedRefreshBaseline(queryClient, page);
      return page;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } =
    streamQuery;

  // A new filter window starts fresh: generation/restart state from the
  // previous window must not trigger a background restart for the new key.
  const observedRestartFingerprintRef = useRef<string | null>(null);
  useEffect(() => {
    observedRestartFingerprintRef.current = null;
  }, [queryDescriptor.filterSignature]);

  // Replace an invalid paginated window only after its fresh first page is
  // ready. Resetting the query first would briefly replace the loaded list
  // with its skeleton during background refreshes.
  useEffect(() => {
    const pages = data?.pages;
    if (!pages || pages.length === 0) return;

    const anyRestart = pages.some((p) => p.restartRequired);
    const firstGen = pages[0]?.generation;
    if (firstGen == null) return;

    const generationChanged =
      anyRestart || (pages.length > 1 && pages.some((p) => p.generation !== firstGen));
    if (!generationChanged) return;
    const fingerprint = pages
      .map((page) => `${page.generation}:${page.restartRequired ? "1" : "0"}`)
      .join("|");
    if (observedRestartFingerprintRef.current === fingerprint) return;
    observedRestartFingerprintRef.current = fingerprint;
    let cancelled = false;
    void (async () => {
      try {
        const firstPageInput = queryDescriptor.getPageInput(undefined);
        let page = await fetchStreamPage(firstPageInput);
        if (page.restartRequired) page = await fetchStreamPage(firstPageInput);
        if (page.restartRequired || cancelled) return;
        seedRefreshBaseline(queryClient, page);
        queryClient.setQueryData<InfiniteData<StreamPage, string | undefined>>(streamPageKey, {
          pages: [page],
          pageParams: [undefined],
        });
      } catch {
        // Keep the last rendered window. A later refresh can provide a new
        // fingerprint and retry without blanking the list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data, queryClient, queryDescriptor, streamPageKey]);

  useLedgerRefreshPolling(data?.pages[0] != null);

  const streamGroups = useMemo(
    () => buildUnifiedStreamGroups(flattenAndDeduplicate(data?.pages), mainCurrency),
    [data, mainCurrency]
  );

  const sentinelRef = useInfiniteScroll({
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    rootMargin: "400px",
  });

  // --- Selection and batch commands -----------------------------------------

  const allSourceDocumentIds = useMemo(
    () => streamGroups.flatMap((g) => g.items.map((i) => i.sourceDocument.id)),
    [streamGroups]
  );
  const queryFingerprint = useMemo(
    () => JSON.stringify({ tab: "stream", period: periodParams, filters: advancedFilters }),
    [advancedFilters, periodParams]
  );
  const {
    isSelectionMode,
    toggleSelectionMode,
    selectedIds,
    toggleSelection,
    handleSelectMany,
    selectAll,
    clearSelection,
    retainSelection,
    isAllSelected,
    isSelectionLimitReached,
    selectableCount,
  } = useSelection({ allIds: allSourceDocumentIds, queryFingerprint });

  const selectedEntryIds = useMemo(() => {
    const selected = new Set(selectedIds);
    return [
      ...new Set(
        streamGroups.flatMap((group) =>
          group.items.flatMap((item) =>
            selected.has(item.sourceDocument.id) ? item.ledgerEntries.map((entry) => entry.id) : []
          )
        )
      ),
    ];
  }, [selectedIds, streamGroups]);

  const settleBatchResult = (
    result: PartialBatchCommandResult,
    successLabel: string,
    preserveIds: string[] = []
  ) => {
    const unresolved = result.failed.map((item) => item.id);
    const retained = [...new Set([...preserveIds, ...unresolved])];
    if (retained.length === 0) clearSelection();
    else retainSelection(retained);
    if (result.succeeded.length > 0) toast.success(successLabel);
    if (unresolved.length > 0) {
      toast.warning(
        batchActionsCopy.partialResult({
          succeeded: result.succeeded.length,
          failed: result.failed.length,
        })
      );
    }
  };

  const batchUpdateDates = useLedgerMutation<
    BatchUpdateSourceDocumentsResultDto,
    { ids: string[]; entryDate: string }
  >({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: ({ ids, entryDate }) =>
      batchUpdateSourceDocumentsAction({
        sourceDocumentIds: ids,
        data: { documentDate: entryDate },
      }),
    onSuccess: (result) => {
      toast.success(batchActionsCopy.datesUpdated({ count: result.updatedCount }));
      clearSelection();
    },
    onError: () => toast.error(commonCopy.error),
  });

  const batchDelete = useLedgerMutation<
    PartialBatchCommandResult,
    { ids: string[]; onCommitted: () => void }
  >({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: ({ ids }) => batchDeleteSourceDocumentsAction(ids),
    onSuccess: (result, { onCommitted }) => {
      if (result.failed.length === 0) onCommitted();
      settleBatchResult(result, batchActionsCopy.deleted({ count: result.succeeded.length }));
    },
    onError: () => toast.error(commonCopy.deleteFailed),
  });

  const batchRetry = useLedgerMutation<PartialBatchCommandResult, string[]>({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: (ids) => batchRetrySourceDocumentsAction(ids),
    onSuccess: (result) =>
      settleBatchResult(result, batchActionsCopy.retried({ count: result.succeeded.length })),
    onError: () => toast.error(commonCopy.error),
  });

  const isBatchPending =
    batchUpdateDates.isPending || batchDelete.isPending || batchRetry.isPending;

  useEffect(() => {
    document.documentElement.dataset.batchSelection = String(isSelectionMode);
    return () => {
      delete document.documentElement.dataset.batchSelection;
    };
  }, [isSelectionMode]);

  const handleToggleSelection = useCallback(
    (id: string) => {
      if (!isBatchPending) toggleSelection(id);
    },
    [isBatchPending, toggleSelection]
  );

  const handleSetGroupSelection = useCallback(
    (ids: readonly string[], selected: boolean) => {
      if (!isBatchPending) handleSelectMany(ids, selected);
    },
    [handleSelectMany, isBatchPending]
  );

  // --- Row recovery ---------------------------------------------------------

  const recoveryLocksRef = useRef(new Set<string>());
  const [retryingIds, setRetryingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [cancellingIds, setCancellingIds] = useState<ReadonlySet<string>>(() => new Set());

  const retryMutation = useLedgerMutation<unknown, StreamRecoveryVariables>({
    invalidates: ["documents", "stats"],
    mutationFn: ({ sourceDocumentId }) => retrySourceDocumentAction(sourceDocumentId),
    successMessage: sourceDocumentActionCopy.retrySuccess,
    errorMessage: sourceDocumentActionCopy.retryError,
  });
  const cancelMutation = useLedgerMutation<unknown, StreamRecoveryVariables>({
    invalidates: ["documents", "stats"],
    mutationFn: ({ sourceDocumentId }) => cancelSourceDocumentProcessingAction(sourceDocumentId),
    successMessage: sourceDocumentActionCopy.cancelSuccess,
    errorMessage: sourceDocumentActionCopy.cancelError,
  });
  const retryMutationRef = useRef(retryMutation.mutateAsync);
  const cancelMutationRef = useRef(cancelMutation.mutateAsync);
  retryMutationRef.current = retryMutation.mutateAsync;
  cancelMutationRef.current = cancelMutation.mutateAsync;

  const runRecovery = useCallback(
    async (
      variables: StreamRecoveryVariables,
      action: RecoveryAction,
      setPending: Dispatch<SetStateAction<ReadonlySet<string>>>
    ) => {
      const { sourceDocumentId } = variables;
      if (recoveryLocksRef.current.has(sourceDocumentId)) return;
      recoveryLocksRef.current.add(sourceDocumentId);
      const markPending = (pending: boolean) =>
        setPending((current) => {
          const next = new Set(current);
          if (pending) next.add(sourceDocumentId);
          else next.delete(sourceDocumentId);
          return next;
        });
      markPending(true);
      try {
        await action(variables);
      } catch {
        // The mutation owns user-visible error reporting.
      } finally {
        recoveryLocksRef.current.delete(sourceDocumentId);
        markPending(false);
      }
    },
    []
  );
  const retryRecovery = useCallback(
    (variables: StreamRecoveryVariables) =>
      runRecovery(variables, retryMutationRef.current, setRetryingIds),
    [runRecovery]
  );
  const cancelRecovery = useCallback(
    (variables: StreamRecoveryVariables) =>
      runRecovery(variables, cancelMutationRef.current, setCancellingIds),
    [runRecovery]
  );
  const recovery = useMemo(
    () => ({
      retryingIds,
      cancellingIds,
      retry: retryRecovery,
      cancelProcessing: cancelRecovery,
    }),
    [cancellingIds, cancelRecovery, retryRecovery, retryingIds]
  );

  // --- Dialogs --------------------------------------------------------------

  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });
  const [retrySourceDocument, setRetrySourceDocument] = useState<SourceDocumentListItemDto | null>(
    null
  );

  const deleteSourceDocument = useLedgerMutation<void, string>({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: async (id) => {
      await deleteSourceDocumentAction(id);
    },
    successMessage: commonCopy.deleteSuccess,
    errorMessage: commonCopy.deleteFailed,
    onSuccess: () => {
      setDeleteConfirm((prev) => ({ ...prev, open: false }));
      clearSelection();
    },
  });

  const handleRequestDelete = useCallback((doc: SourceDocumentListItemDto) => {
    setDeleteConfirm({ open: true, id: doc.id });
  }, []);

  const handleViewSourceDetail = useCallback(
    (group: { sourceDocument: SourceDocumentListItemDto; ledgerEntries: LedgerEntry[] }) => {
      openLedgerDetail({ type: "source-document", id: group.sourceDocument.id });
    },
    []
  );

  // An entry row opens the record it belongs to; entries have no sheet of
  // their own.
  const handleViewLedgerEntry = useCallback(
    (entry: LedgerEntry) => openLedgerEntrySourceDocument(entry),
    []
  );

  return {
    filters,
    stream: {
      groups: streamGroups,
      isLoading: streamQuery.isLoading,
      isError: streamQuery.status === "error" || totalQuery.isError,
      hasData: data !== undefined,
      retry: () => {
        void streamQuery.refetch();
        void totalQuery.refetch();
      },
      hasNextPage,
      isFetchingNextPage,
      isFetchNextPageError,
      fetchNextPage,
      sentinelRef,
      filteredTotal: totalQuery.data?.total,
      hasUnconverted: (totalQuery.data?.unconvertedCount ?? 0) > 0,
    },
    selection: {
      isSelectionMode,
      isAllSelected,
      isSelectionLimitReached,
      hasMoreData: hasNextPage || allSourceDocumentIds.length > selectableCount,
      queryFingerprint,
      selectedIds,
      selectedEntryIds,
      isBatchPending,
      isUpdatingDates: batchUpdateDates.isPending,
      isRetrying: batchRetry.isPending,
      isDeleting: batchDelete.isPending,
      handleToggleSelectionMode: () => {
        if (!isBatchPending) toggleSelectionMode();
      },
      handleToggleSelection,
      handleSetGroupSelection,
      handleSelectAll: () => {
        if (!isBatchPending) selectAll();
      },
      handleClearSelection: () => {
        if (!isBatchPending) clearSelection();
      },
      handleUpdateDates: (date: string, ids: string[]) =>
        batchUpdateDates.mutate({ ids, entryDate: date }),
      handlePreviewDateImpact: (sourceDocumentIds: string[], entryIds: string[]) =>
        previewSourceDocumentDateImpactAction({ sourceDocumentIds, ledgerEntryIds: entryIds }),
      handleRetry: async () => {
        await batchRetry.mutateAsync(selectedIds);
      },
      handleDelete: async (onCommitted: () => void) => {
        const result = await batchDelete.mutateAsync({ ids: selectedIds, onCommitted });
        return result.failed.length === 0;
      },
    },
    recovery,
    dialogs: {
      deleteConfirmOpen: deleteConfirm.open,
      setDeleteConfirmOpen: (open: boolean) => setDeleteConfirm((prev) => ({ ...prev, open })),
      retrySourceDocument,
      setRetrySourceDocument,
      closeRetrySourceDocument: () => setRetrySourceDocument(null),
    },
    actions: {
      handleViewSourceDetail,
      handleViewLedgerEntry,
      handleRequestDelete,
      handleConfirmDelete: async () => {
        if (deleteConfirm.id == null || deleteConfirm.id === "") return;
        await deleteSourceDocument.mutateAsync(deleteConfirm.id);
      },
    },
  };
}
