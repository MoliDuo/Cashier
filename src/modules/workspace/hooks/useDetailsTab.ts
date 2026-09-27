"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CATEGORY_ASSIGNMENT_MAX_ENTRIES } from "@/config/tuning";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { useSelection } from "@/hooks/use-selection";
import { DISPLAY_LOCALE, QUERY } from "@/lib/constants";
import {
  formatDateTimeForApi,
  formatRelativeDateLabel,
  getDateInTimezone,
  parseDateString,
} from "@/lib/date-utils";
import { add as addDecimal } from "@/lib/money/decimal";
import { useLedgerMutation } from "@/lib/mutations/use-ledger-mutation";
import { queryKeys } from "@/lib/query-keys";
import { periodKey, type Period } from "@/modules/ledger/domain/period";
import type {
  ActiveLedgerEntryDto,
  CategoryAssignmentMode,
  CategoryAssignmentJob,
  Ledger,
} from "@/modules/ledger/contracts";
import { buildDetailsQueryDescriptor } from "@/modules/ledger/ledger-query-descriptor";
import { fetchLedgerEntries, fetchLedgerSummary } from "@/modules/ledger/queries";
import {
  batchDeleteLedgerEntriesAction,
  batchUpdateLedgerEntriesAction,
  batchUpdateLedgerEntryDatesAction,
  previewBatchLedgerEntryDateAction,
} from "@/modules/ledger/server-actions/entries";
import { startCategoryAssignmentAction } from "@/modules/ledger/server-actions/category-assignment";
import { resolveBatchCategoryPick } from "@/modules/ledger/ui/batch-action-toolbar";
import { useCategoryAssignment } from "@/modules/ledger/ui/category-assignment-context";
import type { LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";
import { commonCopy } from "@/copy/common";
import { batchActionsCopy, detailsTabCopy } from "@/copy/workspace";

/** One pick is written through as-is up to this many entries; more start a run. */
const DIRECT_ASSIGNMENT_LIMIT = 100;

type BatchDateImpact = Awaited<ReturnType<typeof previewBatchLedgerEntryDateAction>>;

/**
 * The date dialog has one source of truth: what it is currently showing.
 * Closed, waiting for the preview, failed to compute it, or holding the
 * result. The list is frozen while selecting, so the selection it describes
 * cannot move underneath it.
 */
type DatePreviewState =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; impact: BatchDateImpact };

interface EntryDateGroup {
  title: string;
  timestamp: number;
  items: ActiveLedgerEntryDto[];
  total: string;
}

interface UseDetailsTabOptions {
  /** The book the list is narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  ledger?: Ledger | undefined;
  period: Period;
  advancedFilters: LedgerAdvancedFilters;
  timeZone?: string | undefined;
}

/**
 * Everything the 明细 tab does: it reads the filtered entries and their total,
 * groups them by day, and runs the batch commands on the selection — delete,
 * a date move previewed before it is confirmed, and a category assignment that
 * is either written through or handed to the page as a persistent run.
 */
export function useDetailsTab({
  bookId,
  ledger,
  period,
  advancedFilters,
  timeZone,
}: UseDetailsTabOptions) {
  const queryClient = useQueryClient();

  // --- The entries ----------------------------------------------------------

  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const descriptor = useMemo(
    () =>
      buildDetailsQueryDescriptor({
        ...(bookId == null ? {} : { bookId }),
        period,
        advancedFilters,
        mainCurrency,
      }),
    [advancedFilters, bookId, mainCurrency, period]
  );

  // Selecting freezes the list: a background refresh must not swap the rows
  // out from under the selection. The queries read again once it ends.
  const [frozen, setFrozen] = useState(false);

  const summaryQuery = useQuery({
    queryKey: descriptor.summaryQueryKey,
    enabled: !frozen,
    queryFn: () => fetchLedgerSummary(descriptor.summaryInput),
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  const entriesQuery = useInfiniteQuery({
    queryKey: descriptor.entriesQueryKey,
    enabled: !frozen,
    queryFn: ({ pageParam }) =>
      fetchLedgerEntries(descriptor.getEntriesInput(pageParam as string | undefined)),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: undefined as string | undefined,
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError, isLoading } =
    entriesQuery;

  const pages = entriesQuery.data?.pages;
  const entries = useMemo(() => {
    const byId = new Map<string, ActiveLedgerEntryDto>();
    for (const page of pages ?? []) for (const item of page.items) byId.set(item.id, item);
    return Array.from(byId.values());
  }, [pages]);

  const summary = summaryQuery.data;
  const monthStats = {
    mainTotal: summary?.convertedTotal?.total ?? null,
    mainCurrency: summary?.convertedTotal?.currency ?? mainCurrency,
    unconvertedCount: summary?.unconvertedCount ?? 0,
  };

  const queryStatus =
    entriesQuery.status === "error" || summaryQuery.status === "error"
      ? "error"
      : entriesQuery.status === "pending" || summaryQuery.status === "pending"
        ? "pending"
        : "success";
  const queryHasData = entriesQuery.data !== undefined || summaryQuery.data !== undefined;

  const retry = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: queryKeys.ledger(), type: "active" });
  }, [queryClient]);

  const sentinelRef = useInfiniteScroll({
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  });

  // Entries arrive newest first, so the days keep the order they were read in.
  const groupedItems = useMemo(() => {
    const groups = new Map<string, EntryDateGroup>();
    for (const entry of entries) {
      const dateStr = entry.sourceDocument.effectiveDate;
      let group = groups.get(dateStr);
      if (group == null) {
        group = {
          title: formatRelativeDateLabel(dateStr, DISPLAY_LOCALE, timeZone),
          timestamp: parseDateString(dateStr).getTime(),
          items: [],
          total: "0",
        };
        groups.set(dateStr, group);
      }
      group.items.push(entry);
      group.total = addDecimal(group.total, entry.convertedAmount ?? "0");
    }
    return Array.from(groups.values());
  }, [entries, timeZone]);

  // --- The selection --------------------------------------------------------

  const queryFingerprint = useMemo(
    () =>
      JSON.stringify({
        tab: "details",
        period: periodKey(period),
        filters: advancedFilters,
        bookId,
      }),
    [advancedFilters, bookId, period]
  );
  const allIds = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const sourceDocumentIdsFor = useCallback(
    (ids: readonly string[]): string[] => {
      const sourceDocumentIds = new Set<string>();
      for (const id of ids) {
        const entry = entryById.get(id);
        if (entry == null) throw new Error("Selected entry is no longer in the loaded page");
        sourceDocumentIds.add(entry.sourceDocument.id);
      }
      return [...sourceDocumentIds].sort((left, right) => left.localeCompare(right));
    },
    [entryById]
  );
  const selection = useSelection({ allIds, queryFingerprint, maxSelected: null });
  const { selectedIds, clearSelection, isSelectionMode } = selection;
  if (frozen !== isSelectionMode) setFrozen(isSelectionMode);

  useEffect(() => {
    document.documentElement.dataset.batchSelection = String(isSelectionMode);
    return () => {
      delete document.documentElement.dataset.batchSelection;
    };
  }, [isSelectionMode]);

  // --- Batch update and delete ----------------------------------------------

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const update = useLedgerMutation<
    { ledgerEntryIds: string[]; affectedCount: number },
    { categoryId?: string | null; currency?: string | null }
  >({
    waitFor: false,
    mutationFn: (data) =>
      batchUpdateLedgerEntriesAction(sourceDocumentIdsFor(selectedIds), selectedIds, data),
    errorMessage: commonCopy.error,
    onSuccess: (result) => {
      if (result.affectedCount > 0)
        toast.success(detailsTabCopy.batchUpdated({ count: result.affectedCount }));
      clearSelection();
    },
  });

  const remove = useLedgerMutation<
    Awaited<ReturnType<typeof batchDeleteLedgerEntriesAction>>,
    void
  >({
    waitFor: false,
    mutationFn: () =>
      batchDeleteLedgerEntriesAction(sourceDocumentIdsFor(selectedIds), selectedIds),
    errorMessage: commonCopy.deleteFailed,
    onSuccess: (result) => {
      const unresolved = result.failed.map((item) => item.id);
      if (unresolved.length === 0) setDeleteDialogOpen(false);
      if (unresolved.length > 0) selection.retainSelection(unresolved);
      else clearSelection();
      if (result.succeeded.length > 0)
        toast.success(detailsTabCopy.batchDeleted({ count: result.succeeded.length }));
      if (unresolved.length > 0)
        toast.warning(detailsTabCopy.batchUnresolved({ count: unresolved.length }));
    },
  });

  // --- Batch date -----------------------------------------------------------

  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    () => getDateInTimezone(timeZone) ?? formatDateTimeForApi(new Date())
  );
  const [datePreview, setDatePreview] = useState<DatePreviewState>({ status: "closed" });
  const dateRequestIdRef = useRef(0);

  /**
   * Asks for the impact of the selection. Every open, retry or close takes a new
   * request number, so an answer that arrives after the dialog closed or asked
   * again is dropped instead of overwriting the current one.
   */
  const startDatePreview = useCallback(() => {
    const requestId = ++dateRequestIdRef.current;
    const entryIds = [...selectedIds];
    setDatePreview({ status: "loading" });
    void (async () => {
      try {
        const impact = await previewBatchLedgerEntryDateAction(entryIds);
        if (dateRequestIdRef.current === requestId) setDatePreview({ status: "ready", impact });
      } catch {
        if (dateRequestIdRef.current === requestId) setDatePreview({ status: "error" });
      }
    })();
  }, [selectedIds]);

  const setDateDialogVisibility = useCallback((open: boolean) => {
    dateRequestIdRef.current += 1;
    setDateDialogOpen(open);
    setDatePreview({ status: "closed" });
  }, []);

  // The dialog opens on the day the user is about to set and fills in what the
  // change touches, instead of asking for the day first and the impact after.
  const openDateDialog = useCallback(() => {
    setDateDialogVisibility(true);
    startDatePreview();
  }, [setDateDialogVisibility, startDatePreview]);

  // A request still in flight when the screen goes away has nowhere to land.
  useEffect(() => {
    return () => {
      dateRequestIdRef.current += 1;
    };
  }, []);

  const dateImpact = datePreview.status === "ready" ? datePreview.impact : null;
  const datePreviewFailed = datePreview.status === "error";
  const isPreviewingDate = datePreview.status === "loading";

  const updateDates = useLedgerMutation<{ impact: BatchDateImpact }, void>({
    waitFor: false,
    mutationFn: () =>
      batchUpdateLedgerEntryDatesAction(
        sourceDocumentIdsFor(selectedIds),
        selectedIds,
        selectedDate
      ),
    errorMessage: commonCopy.error,
    onSuccess: (result) => {
      toast.success(batchActionsCopy.datesUpdated({ count: result.impact.affectedEntryCount }));
      clearSelection();
      setDateDialogVisibility(false);
    },
  });

  // --- Batch category -------------------------------------------------------

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [pickedCategoryIds, setPickedCategoryIds] = useState<string[]>([]);
  const [clearCategoryPicked, setClearCategoryPicked] = useState(false);
  const categoryRequestKeyRef = useRef<string | null>(null);
  // The run outlives this tab, so the page follows it and this dialog only hands
  // it over: nothing here polls, and nothing here announces what the page began.
  const { registerSubmittedJob } = useCategoryAssignment();

  // Opening drops the picks of the previous visit, and so does closing.
  const setCategoryDialogVisibility = useCallback((open: boolean) => {
    setCategoryDialogOpen(open);
    if (open) categoryRequestKeyRef.current = null;
    setPickedCategoryIds([]);
    setClearCategoryPicked(false);
  }, []);

  // Clearing is exclusive: "no category" is not one more candidate to weigh
  // against the others, it is the other answer to the same question.
  const toggleCategoryPick = useCallback((categoryId: string | null, picked: boolean) => {
    if (categoryId == null) {
      setClearCategoryPicked(picked);
      if (picked) setPickedCategoryIds([]);
      return;
    }
    setPickedCategoryIds((current) =>
      picked
        ? current.includes(categoryId)
          ? current
          : [...current, categoryId]
        : current.filter((id) => id !== categoryId)
    );
    if (picked) setClearCategoryPicked(false);
  }, []);

  const startAiCategory = useLedgerMutation<
    CategoryAssignmentJob,
    { requestKey: string; mode: CategoryAssignmentMode; ledgerEntryIds: string[] }
  >({
    waitFor: false,
    mutationFn: (input) => startCategoryAssignmentAction(input),
    errorMessage: batchActionsCopy.aiCategoryFailed,
    onSuccess: (job) => {
      // Hand the run to the page before it can finish: a run whose first answer
      // already reports it over still has to say so, once, to this reader.
      registerSubmittedJob(job);
      toast.success(batchActionsCopy.aiCategoryRunning);
      clearSelection();
      categoryRequestKeyRef.current = null;
      setCategoryDialogVisibility(false);
    },
    onError: (error) => {
      if (error instanceof Error && error.message.includes("CONFLICT")) {
        toast.error(batchActionsCopy.aiCategoryBusy);
      }
    },
  });

  /**
   * One pick is the user's own answer and is written directly; several are a
   * question for the model. Which of the two it is comes from the same resolver
   * the dialog's summary reads, so the button cannot promise one thing and do
   * another.
   *
   * The manual write leaves the dialog open when it fails — the pick is still
   * on screen to retry — while the run closes it, because the run outlives the
   * dialog and reports itself.
   */
  const { mutateAsync: assignCategory } = update;
  const { mutate: startCategoryRun } = startAiCategory;
  const confirmCategory = useCallback(() => {
    const ledgerEntryIds = [...selectedIds];
    if (ledgerEntryIds.length === 0) return;

    const pick = resolveBatchCategoryPick({
      categoryIds: pickedCategoryIds,
      clearPicked: clearCategoryPicked,
    });
    if (
      (pick.kind === "clear" || pick.kind === "assign") &&
      ledgerEntryIds.length <= DIRECT_ASSIGNMENT_LIMIT
    ) {
      void assignCategory({ categoryId: pick.kind === "clear" ? null : pick.categoryId }).then(
        () => setCategoryDialogVisibility(false),
        () => undefined
      );
      return;
    }
    if (pick.kind === "ai" || pick.kind === "assign" || pick.kind === "clear") {
      if (ledgerEntryIds.length > CATEGORY_ASSIGNMENT_MAX_ENTRIES) {
        toast.error(
          batchActionsCopy.categorySelectionTooLarge({ max: CATEGORY_ASSIGNMENT_MAX_ENTRIES })
        );
        return;
      }
      startCategoryRun({
        requestKey: (categoryRequestKeyRef.current ??= crypto.randomUUID()),
        ledgerEntryIds,
        mode:
          pick.kind === "ai"
            ? { kind: "ai", candidateCategoryIds: [...pick.categoryIds] }
            : pick.kind === "assign"
              ? { kind: "assign", categoryId: pick.categoryId }
              : { kind: "clear" },
      });
    }
  }, [
    assignCategory,
    clearCategoryPicked,
    pickedCategoryIds,
    selectedIds,
    setCategoryDialogVisibility,
    startCategoryRun,
  ]);

  const isPending =
    update.isPending ||
    remove.isPending ||
    isPreviewingDate ||
    updateDates.isPending ||
    startAiCategory.isPending;

  // A command in flight holds the selection it was given.
  const { toggleSelection, handleSelectMany } = selection;
  const toggleEntrySelection = useCallback(
    (id: string) => {
      if (!isPending) toggleSelection(id);
    },
    [isPending, toggleSelection]
  );
  const setGroupSelection = useCallback(
    (ids: readonly string[], selected: boolean) => {
      if (!isPending) handleSelectMany(ids, selected);
    },
    [handleSelectMany, isPending]
  );

  return {
    queryStatus,
    queryHasData,
    retry,
    entries,
    groupedItems,
    monthStats,
    isLoading,
    isFetchingNextPage,
    isFetchNextPageError,
    hasNextPage,
    fetchNextPage,
    sentinelRef,
    ...selection,
    toggleEntrySelection,
    setGroupSelection,
    isPending,
    update,
    remove,
    deleteDialogOpen,
    setDeleteDialogOpen,
    dateDialogOpen,
    setDateDialogOpen: setDateDialogVisibility,
    openDateDialog,
    retryDatePreview: startDatePreview,
    selectedDate,
    setSelectedDate,
    dateImpact,
    datePreviewFailed,
    isPreviewingDate,
    updateDates,
    categoryDialogOpen,
    setCategoryDialogOpen: setCategoryDialogVisibility,
    pickedCategoryIds,
    clearCategoryPicked,
    toggleCategoryPick,
    confirmCategory,
    isConfirmingCategory: update.isPending || startAiCategory.isPending,
  };
}
