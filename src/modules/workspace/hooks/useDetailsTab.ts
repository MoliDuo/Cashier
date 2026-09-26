"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
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
import type { PeriodParams } from "@/lib/period-utils";
import type {
  ActiveLedgerEntryDto,
  CategoryAssignmentMode,
  CategoryReclassificationJob,
  EntryCategory,
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
import { startCategoryAssignmentAction } from "@/modules/ledger/server-actions/reclassification";
import { resolveBatchCategoryPick } from "@/modules/ledger/ui/batch-action-toolbar";
import { useCategoryAssignment } from "@/modules/ledger/ui/category-assignment-context";
import type { LedgerAdvancedFilters } from "../initial-query-state";

/** One pick is written through as-is up to this many entries; more start a run. */
const DIRECT_ASSIGNMENT_LIMIT = 100;

type BatchDateImpact = Awaited<ReturnType<typeof previewBatchLedgerEntryDateAction>>;

/** The selection a date preview answered for, kept so confirmation can use it. */
interface DatePreviewRequest {
  entryIds: string[];
  sourceDocumentIds: string[];
  queryFingerprint: string;
  impact: BatchDateImpact;
}

/**
 * The date dialog has one source of truth: what it is currently showing.
 * Closed, waiting for the preview, failed to compute it, or holding the
 * result — with the impact and the selection it describes kept together, so a
 * result can never be confirmed against a different selection.
 */
type DatePreviewState =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; request: DatePreviewRequest };

/** The selection the open category dialog is asking about, fixed at the moment it opened. */
interface CategorySnapshot {
  queryFingerprint: string;
  categorySignature: string;
  ledgerEntryIds: string[];
}

interface EntryDateGroup {
  title: string;
  timestamp: number;
  items: ActiveLedgerEntryDto[];
  total: string;
}

/** True when both selections hold the same ids in the same order. */
function selectionMatches(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function entryDate(entry: ActiveLedgerEntryDto): string {
  if (entry.sourceDocument.documentDate != null && entry.sourceDocument.documentDate !== "") {
    return entry.sourceDocument.documentDate;
  }
  return formatDateTimeForApi(new Date(entry.createdAt));
}

interface UseDetailsTabOptions {
  /** The book the list is narrowed to; undefined means 总账. */
  bookId?: string | undefined;
  categories: readonly EntryCategory[];
  ledger?: Ledger | undefined;
  periodParams: PeriodParams;
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
  categories,
  ledger,
  periodParams,
  advancedFilters,
  timeZone,
}: UseDetailsTabOptions) {
  const t = useTranslations("DetailsTab");
  const tBatch = useTranslations("BatchActions");
  const tCommon = useTranslations("Common");
  const queryClient = useQueryClient();

  // --- The entries ----------------------------------------------------------

  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const descriptor = useMemo(
    () =>
      buildDetailsQueryDescriptor({
        ...(bookId == null ? {} : { bookId }),
        periodParams,
        advancedFilters,
        ...(timeZone !== undefined ? { timeZone } : {}),
        mainCurrency,
      }),
    [advancedFilters, bookId, mainCurrency, periodParams, timeZone]
  );

  const summaryQuery = useQuery({
    queryKey: descriptor.summaryQueryKey,
    queryFn: () => fetchLedgerSummary(descriptor.summaryInput),
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
  const entriesQuery = useInfiniteQuery({
    queryKey: descriptor.entriesQueryKey,
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
    void queryClient.refetchQueries({
      type: "active",
      predicate: ({ queryKey: key }) =>
        key[0] === "ledger" && (key[1] === "entries" || key[1] === "summary"),
    });
  }, [queryClient]);

  const sentinelRef = useInfiniteScroll({
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  });

  // Entries arrive newest first, so the days keep the order they were read in.
  const groupedItems = useMemo(() => {
    const labels = { today: t("today"), yesterday: t("yesterday") };
    const groups = new Map<string, EntryDateGroup>();
    for (const entry of entries) {
      const dateStr = entryDate(entry);
      let group = groups.get(dateStr);
      if (group == null) {
        group = {
          title: formatRelativeDateLabel(dateStr, DISPLAY_LOCALE, labels, timeZone),
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
  }, [entries, t, timeZone]);

  // --- The selection --------------------------------------------------------

  const queryFingerprint = useMemo(
    () =>
      JSON.stringify({
        tab: "details",
        period: periodParams,
        filters: advancedFilters,
        bookId,
      }),
    [advancedFilters, bookId, periodParams]
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
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: (data) =>
      batchUpdateLedgerEntriesAction(sourceDocumentIdsFor(selectedIds), selectedIds, data),
    errorMessage: tCommon("error"),
    onSuccess: (result) => {
      if (result.affectedCount > 0)
        toast.success(t("batchUpdated", { count: result.affectedCount }));
      clearSelection();
    },
  });

  const remove = useLedgerMutation<
    Awaited<ReturnType<typeof batchDeleteLedgerEntriesAction>>,
    void
  >({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: () =>
      batchDeleteLedgerEntriesAction(sourceDocumentIdsFor(selectedIds), selectedIds),
    errorMessage: tCommon("deleteFailed"),
    onSuccess: (result) => {
      const unresolved = result.failed.map((item) => item.id);
      if (unresolved.length === 0) setDeleteDialogOpen(false);
      if (unresolved.length > 0) selection.retainSelection(unresolved);
      else clearSelection();
      if (result.succeeded.length > 0)
        toast.success(t("batchDeleted", { count: result.succeeded.length }));
      if (unresolved.length > 0) toast.warning(t("batchUnresolved", { count: unresolved.length }));
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
   * Asks for the impact of the selection as it stands right now. The request
   * number is taken before the call and every open, retry or close supersedes
   * it, so an answer that arrives late — out of order, or after the dialog was
   * reopened on something else — is dropped instead of overwriting the current
   * one. A preview never describes a selection it was not asked about.
   */
  const startDatePreview = useCallback(() => {
    const requestId = ++dateRequestIdRef.current;
    const entryIds = [...selectedIds];
    const capturedFingerprint = queryFingerprint;
    setDatePreview({ status: "loading" });
    void (async () => {
      let impact: BatchDateImpact;
      let sourceDocumentIds: string[];
      try {
        impact = await previewBatchLedgerEntryDateAction(entryIds);
        sourceDocumentIds = sourceDocumentIdsFor(entryIds);
      } catch {
        if (dateRequestIdRef.current === requestId) setDatePreview({ status: "error" });
        return;
      }
      if (dateRequestIdRef.current !== requestId) return;
      setDatePreview({
        status: "ready",
        request: { entryIds, sourceDocumentIds, queryFingerprint: capturedFingerprint, impact },
      });
    })();
  }, [queryFingerprint, selectedIds, sourceDocumentIdsFor]);

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

  // A preview answered for one book says nothing about the next one, and a
  // request still in flight when the screen goes away has nowhere to land.
  useEffect(() => {
    return () => {
      dateRequestIdRef.current += 1;
    };
  }, []);

  // The preview is answered for a snapshot of the selection, so a selection
  // that moved since then is no longer what the dialog describes.
  const dateSelectionChanged =
    datePreview.status === "ready" &&
    (datePreview.request.queryFingerprint !== queryFingerprint ||
      !selectionMatches(datePreview.request.entryIds, selectedIds));
  const dateImpact = datePreview.status === "ready" ? datePreview.request.impact : null;
  const datePreviewFailed = datePreview.status === "error";
  const isPreviewingDate = datePreview.status === "loading";

  const updateDates = useLedgerMutation<{ impact: BatchDateImpact }, void>({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: async () => {
      if (datePreview.status !== "ready") throw new Error("selection_changed");
      const { request } = datePreview;
      if (
        request.queryFingerprint !== queryFingerprint ||
        !selectionMatches(request.entryIds, selectedIds)
      ) {
        throw new Error("selection_changed");
      }
      return batchUpdateLedgerEntryDatesAction(
        request.sourceDocumentIds,
        request.entryIds,
        selectedDate
      );
    },
    errorMessage: tBatch("selectionChanged"),
    onSuccess: (result) => {
      toast.success(tBatch("datesUpdated", { count: result.impact.affectedEntryCount }));
      clearSelection();
      setDateDialogVisibility(false);
    },
  });

  // --- Batch category -------------------------------------------------------

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [pickedCategoryIds, setPickedCategoryIds] = useState<string[]>([]);
  const [clearCategoryPicked, setClearCategoryPicked] = useState(false);
  // Captured when the dialog opens. There is no server preview to ask for, so
  // the task row's ledger entry ids are the authority from the moment it is
  // written; the snapshot only has to survive the trip from open to confirm.
  const [categorySnapshot, setCategorySnapshot] = useState<CategorySnapshot | null>(null);
  const categoryRequestKeyRef = useRef<string | null>(null);
  // The run outlives this tab, so the page follows it and this dialog only hands
  // it over: nothing here polls, and nothing here announces what the page began.
  const { registerSubmittedJob } = useCategoryAssignment();
  const categorySelectionChanged =
    categorySnapshot != null &&
    (categorySnapshot.queryFingerprint !== queryFingerprint ||
      categorySnapshot.categorySignature !== categories.map((category) => category.id).join(":") ||
      !selectionMatches(categorySnapshot.ledgerEntryIds, selectedIds));

  // Opening captures the selection and drops the picks of the previous visit;
  // closing drops both. A snapshot that no longer matches the selection can
  // never be confirmed, so the dialog cannot promise one thing and do another.
  const setCategoryDialogVisibility = useCallback(
    (open: boolean) => {
      setCategoryDialogOpen(open);
      if (open) categoryRequestKeyRef.current = null;
      setCategorySnapshot(
        open
          ? {
              queryFingerprint,
              categorySignature: categories.map((category) => category.id).join(":"),
              ledgerEntryIds: [...selectedIds],
            }
          : null
      );
      setPickedCategoryIds([]);
      setClearCategoryPicked(false);
    },
    [categories, queryFingerprint, selectedIds]
  );

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
    CategoryReclassificationJob,
    { requestKey: string; mode: CategoryAssignmentMode; ledgerEntryIds: string[] }
  >({
    refreshMode: "background",
    invalidates: ["documents", "stats"],
    mutationFn: (input) => startCategoryAssignmentAction(input),
    errorMessage: tBatch("aiCategoryFailed"),
    onSuccess: (job) => {
      // Hand the run to the page before it can finish: a run whose first answer
      // already reports it over still has to say so, once, to this reader.
      registerSubmittedJob(job);
      toast.success(tBatch("aiCategoryRunning"));
      clearSelection();
      categoryRequestKeyRef.current = null;
      setCategoryDialogVisibility(false);
    },
    onError: (error) => {
      if (error instanceof Error && error.message.includes("CONFLICT")) {
        toast.error(tBatch("aiCategoryBusy"));
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
    const snapshot = categorySnapshot;
    if (snapshot == null || snapshot.ledgerEntryIds.length === 0) return;
    if (categorySelectionChanged) {
      toast.error(tBatch("selectionMoved"));
      return;
    }

    const pick = resolveBatchCategoryPick({
      categoryIds: pickedCategoryIds,
      clearPicked: clearCategoryPicked,
    });
    if (
      (pick.kind === "clear" || pick.kind === "assign") &&
      snapshot.ledgerEntryIds.length <= DIRECT_ASSIGNMENT_LIMIT
    ) {
      void assignCategory({ categoryId: pick.kind === "clear" ? null : pick.categoryId }).then(
        () => setCategoryDialogVisibility(false),
        () => undefined
      );
      return;
    }
    if (pick.kind === "ai" || pick.kind === "assign" || pick.kind === "clear") {
      if (snapshot.ledgerEntryIds.length > CATEGORY_ASSIGNMENT_MAX_ENTRIES) {
        toast.error(tBatch("categorySelectionTooLarge", { max: CATEGORY_ASSIGNMENT_MAX_ENTRIES }));
        return;
      }
      startCategoryRun({
        requestKey: (categoryRequestKeyRef.current ??= crypto.randomUUID()),
        ledgerEntryIds: snapshot.ledgerEntryIds,
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
    categorySelectionChanged,
    categorySnapshot,
    clearCategoryPicked,
    pickedCategoryIds,
    setCategoryDialogVisibility,
    startCategoryRun,
    tBatch,
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
    dateSelectionChanged,
    isPreviewingDate,
    updateDates,
    categoryDialogOpen,
    setCategoryDialogOpen: setCategoryDialogVisibility,
    pickedCategoryIds,
    clearCategoryPicked,
    toggleCategoryPick,
    categorySelectionChanged,
    confirmCategory,
    isConfirmingCategory: update.isPending || startAiCategory.isPending,
  };
}
